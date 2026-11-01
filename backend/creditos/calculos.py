"""
Motor financiero puro (sin base de datos): tasas, tablas de amortización,
TIR real y simulaciones de abonos. Todo en pesos sin centavos.
"""
import calendar
import datetime as dt
import math
from decimal import Decimal, ROUND_HALF_UP

DIARIA, SEMANAL, QUINCENAL, MENSUAL = "DIARIA", "SEMANAL", "QUINCENAL", "MENSUAL"
PERIODOS_ANIO = {DIARIA: 365, SEMANAL: 52, QUINCENAL: 24, MENSUAL: 12}

EA, TASA_MENSUAL = "EA", "MENSUAL"
FRANCES, PLANO = "FRANCES", "PLANO"
REDUCIR_PLAZO, REDUCIR_CUOTA = "REDUCIR_PLAZO", "REDUCIR_CUOTA"

MAX_PERIODOS = 20000


def D(x):
    return Decimal(str(x))


def pesos(x):
    return D(x).quantize(Decimal("1"), rounding=ROUND_HALF_UP)


# ---------------- Tasas ----------------

def a_ea(tasa_pct, tipo_tasa):
    """Tasa en % (ej. 28.5) -> efectiva anual en fracción."""
    t = float(tasa_pct) / 100
    if tipo_tasa == EA:
        return t
    if tipo_tasa == TASA_MENSUAL:  # efectiva mensual
        return (1 + t) ** 12 - 1
    raise ValueError("tipo_tasa inválido")


def ea_a_periodica(ea, frecuencia):
    return (1 + ea) ** (1 / PERIODOS_ANIO[frecuencia]) - 1


def periodica_a_ea(i, frecuencia):
    return (1 + i) ** PERIODOS_ANIO[frecuencia] - 1


def ea_a_mensual(ea):
    return (1 + ea) ** (1 / 12) - 1


# ---------------- Fechas ----------------

def sumar_meses(fecha, meses):
    m = fecha.month - 1 + meses
    anio, mes = fecha.year + m // 12, m % 12 + 1
    return dt.date(anio, mes, min(fecha.day, calendar.monthrange(anio, mes)[1]))


def fecha_cuota(primera, k, frecuencia):
    """Fecha de la cuota k (k=0 es la primera)."""
    if frecuencia == MENSUAL:
        return sumar_meses(primera, k)
    dias = {DIARIA: 1, SEMANAL: 7, QUINCENAL: 15}[frecuencia]
    return primera + dt.timedelta(days=dias * k)


# ---------------- Tablas ----------------

def cuota_francesa(capital, i, n):
    capital = float(capital)
    if n <= 0:
        return 0.0
    if i == 0:
        return capital / n
    return capital * i / (1 - (1 + i) ** -n)


def tabla_francesa(capital, i, n=None, cuota=None):
    """
    Cuota fija. Si se da `cuota` (y no n) se calcula cuántas cuotas hacen falta
    (para 'reducir plazo' tras un abono). La última cuota se ajusta al saldo.
    """
    saldo = pesos(capital)
    if cuota is None:
        cuota = pesos(cuota_francesa(saldo, i, n))
    else:
        cuota = pesos(cuota)
    filas, k = [], 0
    while saldo > 0 and k < MAX_PERIODOS:
        k += 1
        interes = pesos(float(saldo) * i)
        if n is not None and k == n:
            abono = saldo
        else:
            abono = min(cuota - interes, saldo)
        if abono <= 0 and (n is None or k < n):
            raise ValueError("La cuota no alcanza ni para cubrir los intereses.")
        filas.append({"numero": k, "saldo_inicial": saldo, "interes": interes, "capital": abono,
                      "valor": interes + abono, "saldo_final": saldo - abono})
        saldo -= abono
    return filas


def tabla_plana(capital, tasa_mensual, n, frecuencia):
    """
    Interés plano (típico de prestamistas/"gota a gota"): el interés se cobra
    sobre el monto inicial todo el plazo, aunque la deuda baje.
    """
    capital = pesos(capital)
    # Prestamistas cuentan el mes como 30 días (30 cuotas diarias = 1 mes)
    dias_periodo = {DIARIA: 1, SEMANAL: 7, QUINCENAL: 15, MENSUAL: 30}[frecuencia]
    meses = n * dias_periodo / 30
    interes_total = pesos(float(capital) * tasa_mensual * meses)
    cap_cuota, int_cuota = pesos(capital / n), pesos(interes_total / n)
    filas, saldo = [], capital
    for k in range(1, n + 1):
        cap = saldo if k == n else cap_cuota
        intr = interes_total - int_cuota * (n - 1) if k == n else int_cuota
        filas.append({"numero": k, "saldo_inicial": saldo, "interes": intr, "capital": cap,
                      "valor": cap + intr, "saldo_final": saldo - cap})
        saldo -= cap
    return filas


def tir_periodica(capital, pagos):
    """TIR por bisección: la tasa real que iguala lo recibido con lo pagado."""
    capital = float(capital)
    pagos = [float(p) for p in pagos]
    if sum(pagos) <= capital:
        return 0.0

    def vpn(r):
        return sum(p / (1 + r) ** (k + 1) for k, p in enumerate(pagos)) - capital

    lo, hi = 0.0, 1.0
    while vpn(hi) > 0:
        hi *= 2
        if hi > 1e6:
            return hi
    for _ in range(200):
        mid = (lo + hi) / 2
        if vpn(mid) > 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


# ---------------- Simulaciones ----------------

def simular_frances(saldo, i, cuota, extra_periodico=0, abono_unico=0, estrategia=REDUCIR_PLAZO, n_restantes=None):
    """
    Proyecta el pago del saldo actual. Devuelve periodos e intereses totales.
    - abono_unico: abono a capital hoy (reduce plazo o cuota según estrategia).
    - extra_periodico: plata extra a capital en cada cuota (siempre reduce plazo).
    """
    saldo = float(saldo) - float(abono_unico)
    cuota = float(cuota)
    if saldo <= 0:
        return {"periodos": 0, "interes_total": pesos(0), "total_pagado": pesos(abono_unico), "cuota": pesos(0)}
    if abono_unico and estrategia == REDUCIR_CUOTA and n_restantes:
        cuota = cuota_francesa(saldo, i, n_restantes)
    pago = cuota + float(extra_periodico)
    if pago <= saldo * i:
        raise ValueError("La cuota no cubre los intereses.")
    periodos, interes_total, total = 0, 0.0, float(abono_unico)
    while saldo > 0.5 and periodos < MAX_PERIODOS:
        periodos += 1
        intr = saldo * i
        p = min(pago, saldo + intr)
        saldo = saldo + intr - p
        interes_total += intr
        total += p
    return {"periodos": periodos, "interes_total": pesos(interes_total), "total_pagado": pesos(total),
            "cuota": pesos(cuota)}


def estrategia_multiples(deudas, extra_mensual, orden):
    """
    Avalancha (mayor tasa primero) vs bola de nieve (menor saldo primero).
    deudas: [{id, nombre, saldo, ea, cuota_mensual}] (equivalencias mensuales, es una estimación).
    Cuando una deuda termina, su cuota se suma al extra ("efecto bola de nieve").
    """
    ds = [dict(d, saldo=float(d["saldo"]), i=ea_a_mensual(d["ea"]), cuota=float(d["cuota_mensual"])) for d in deudas]
    if orden == "AVALANCHA":
        prioridad = sorted(ds, key=lambda d: -d["i"])
    else:
        prioridad = sorted(ds, key=lambda d: d["saldo"])
    meses, interes_total, fin = 0, 0.0, {}
    while any(d["saldo"] > 0.5 for d in ds) and meses < 1200:
        meses += 1
        libre = float(extra_mensual)
        for d in ds:
            if d["saldo"] <= 0.5:
                libre += d["cuota"]  # cuota liberada
                continue
            intr = d["saldo"] * d["i"]
            interes_total += intr
            pago = min(d["cuota"], d["saldo"] + intr)
            d["saldo"] = d["saldo"] + intr - pago
            libre += d["cuota"] - pago
        for d in prioridad:
            if libre <= 0:
                break
            if d["saldo"] > 0.5:
                abono = min(libre, d["saldo"])
                d["saldo"] -= abono
                libre -= abono
        for d in ds:
            if d["saldo"] <= 0.5 and d["id"] not in fin:
                fin[d["id"]] = meses
    return {
        "orden_pago": [d["nombre"] for d in prioridad],
        "meses_total": meses,
        "interes_total": pesos(interes_total),
        "mes_fin_por_credito": {d["nombre"]: fin.get(d["id"]) for d in ds},
    }
