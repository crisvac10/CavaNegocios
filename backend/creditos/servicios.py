import datetime as dt
import math
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from rest_framework.exceptions import ValidationError

from caja import servicios as caja
from caja.models import MovimientoCaja
from negocios.utils import CERO, hoy, pesos as fmt

from . import calculos as C
from .models import ApartadoCredito, Credito, CuotaCredito, PagoCredito, TasaUsura

Origen = MovimientoCaja.Origen


# ---------------- Crear ----------------

def construir_tabla(monto, tasa, tipo_tasa, sistema, frecuencia, num_cuotas):
    ea = C.a_ea(tasa, tipo_tasa)
    if sistema == C.FRANCES:
        filas = C.tabla_francesa(monto, C.ea_a_periodica(ea, frecuencia), n=num_cuotas)
    else:
        filas = C.tabla_plana(monto, C.ea_a_mensual(ea), num_cuotas, frecuencia)
    tir = C.tir_periodica(monto, [f["valor"] for f in filas])
    return filas, Decimal(str(round(C.periodica_a_ea(tir, frecuencia) * 100, 4)))


@transaction.atomic
def crear_credito(negocio, usuario, datos):
    if datos["monto"] <= 0 or datos["num_cuotas"] <= 0 or datos["tasa"] < 0:
        raise ValidationError("Monto, tasa y número de cuotas deben ser válidos.")
    if datos["fecha_primera_cuota"] < datos["fecha_desembolso"]:
        raise ValidationError("La primera cuota no puede ser antes del desembolso.")
    try:
        filas, ea_real = construir_tabla(datos["monto"], datos["tasa"], datos["tipo_tasa"],
                                         datos["sistema"], datos["frecuencia"], datos["num_cuotas"])
    except ValueError as e:
        raise ValidationError(str(e))

    cr = Credito.objects.create(negocio=negocio, usuario=usuario, cuota_valor=filas[0]["valor"],
                                tasa_ea_real=ea_real, **datos)
    _guardar_cuotas(cr, filas, inicio_numero=1, primera_fecha=cr.fecha_primera_cuota)

    if cr.desembolso_a_caja:
        caja.registrar(negocio, Origen.DESEMBOLSO_CREDITO, cr.monto, medio=cr.medio_desembolso,
                       concepto=f"Desembolso crédito {cr.entidad}", referencia=f"credito:{cr.id}", usuario=usuario)
    return cr


def _guardar_cuotas(cr, filas, inicio_numero, primera_fecha):
    CuotaCredito.objects.bulk_create([
        CuotaCredito(credito=cr, numero=inicio_numero + k, fecha_vencimiento=C.fecha_cuota(primera_fecha, k, cr.frecuencia),
                     saldo_inicial=f["saldo_inicial"], capital=f["capital"], interes=f["interes"], valor=f["valor"])
        for k, f in enumerate(filas)
    ])


# ---------------- Fondo apartado ----------------

def saldo_fondo(negocio, credito=None):
    qs = ApartadoCredito.objects.filter(negocio=negocio)
    if credito is not None:
        qs = qs.filter(credito=credito)
    return qs.aggregate(s=Sum("monto"))["s"] or CERO


@transaction.atomic
def registrar_apartado(negocio, monto, usuario, credito_id=None, desde_caja=True, sesion=None, nota=""):
    monto = Decimal(str(monto))
    if monto <= 0:
        raise ValidationError("El monto a apartar debe ser mayor a cero.")
    credito = None
    if credito_id:
        credito = Credito.objects.filter(negocio=negocio, pk=credito_id).first()
        if not credito:
            raise ValidationError("Crédito no encontrado.")
    ap = ApartadoCredito.objects.create(negocio=negocio, credito=credito, fecha=hoy(), monto=monto,
                                        desde_caja=desde_caja, usuario=usuario, nota=nota)
    if desde_caja:
        caja.registrar(negocio, Origen.APARTADO_CREDITO, -monto, concepto="Apartado para crédito",
                       referencia=f"apartado:{ap.id}", usuario=usuario, sesion=sesion)
    return ap


@transaction.atomic
def liberar_fondo(negocio, monto, usuario, a_caja=True, nota=""):
    monto = Decimal(str(monto))
    if monto <= 0 or monto > saldo_fondo(negocio):
        raise ValidationError("Monto inválido o mayor al saldo del fondo.")
    ap = ApartadoCredito.objects.create(negocio=negocio, fecha=hoy(), tipo=ApartadoCredito.Tipo.LIBERADO,
                                        monto=-monto, desde_caja=a_caja, usuario=usuario, nota=nota)
    if a_caja:
        caja.registrar(negocio, Origen.APARTADO_CREDITO, monto, concepto="Liberado del fondo de créditos",
                       referencia=f"apartado:{ap.id}", usuario=usuario)
    return ap


def _sacar_dinero(negocio, credito, monto, medio, origen_fondos, usuario, concepto, pago_id):
    if origen_fondos == PagoCredito.OrigenFondos.CAJA:
        caja.registrar(negocio, Origen.PAGO_CREDITO, -monto, medio=medio, concepto=concepto,
                       referencia=f"pago_credito:{pago_id}", usuario=usuario)
    elif origen_fondos == PagoCredito.OrigenFondos.FONDO:
        ApartadoCredito.objects.create(negocio=negocio, credito=credito, fecha=hoy(), tipo=ApartadoCredito.Tipo.USO_PAGO,
                                       monto=-monto, desde_caja=False, usuario=usuario, nota=concepto)


def _validar_fondo(negocio, monto, origen_fondos):
    if origen_fondos == PagoCredito.OrigenFondos.FONDO and monto > saldo_fondo(negocio):
        raise ValidationError(f"El fondo apartado solo tiene {fmt(saldo_fondo(negocio))}.")


# ---------------- Pagos ----------------

@transaction.atomic
def pagar_cuotas(credito, monto, usuario, medio="EFECTIVO", origen_fondos="CAJA", fecha=None, nota=""):
    """Aplica el pago a las cuotas más antiguas: primero interés, luego capital."""
    cr = Credito.objects.select_for_update().get(pk=credito.pk)
    if cr.estado != Credito.Estado.ACTIVO:
        raise ValidationError("El crédito no está activo.")
    monto = Decimal(str(monto))
    pendientes = list(cr.cuotas.exclude(estado=CuotaCredito.Estado.PAGADA).order_by("numero"))
    deuda = sum((c.pendiente for c in pendientes), CERO)
    if monto <= 0 or monto > deuda:
        raise ValidationError(f"Monto inválido. Lo pendiente en cuotas es {fmt(deuda)}.")
    _validar_fondo(cr.negocio, monto, origen_fondos)
    fecha = fecha or hoy()

    restante, cap_total, int_total, detalle = monto, CERO, CERO, []
    for c in pendientes:
        if restante <= 0:
            break
        a_int = min(restante, c.interes - c.pagado_interes)
        restante -= a_int
        a_cap = min(restante, c.capital - c.pagado_capital)
        restante -= a_cap
        c.pagado_interes += a_int
        c.pagado_capital += a_cap
        if c.pendiente == 0:
            c.estado, c.pagada_en = CuotaCredito.Estado.PAGADA, fecha
        else:
            c.estado = CuotaCredito.Estado.PARCIAL
        c.save()
        cap_total += a_cap
        int_total += a_int
        detalle.append({"cuota": c.numero, "interes": str(a_int), "capital": str(a_cap), "estado": c.estado})

    pago = PagoCredito.objects.create(
        negocio=cr.negocio, credito=cr, fecha=fecha, tipo=PagoCredito.Tipo.CUOTA, monto=monto,
        aplicado_capital=cap_total, aplicado_interes=int_total, medio=medio, origen_fondos=origen_fondos,
        detalle=detalle, nota=nota, usuario=usuario)
    _sacar_dinero(cr.negocio, cr, monto, medio, origen_fondos, usuario, f"Cuota crédito {cr.entidad}", pago.id)
    _cerrar_si_pagado(cr)
    return pago


def lo_que_toca(cr, fecha=None):
    """Lo que hay que pagar ahora: cuotas vencidas + la próxima cuota pendiente."""
    fecha = fecha or hoy()
    pend = list(cr.cuotas.exclude(estado=CuotaCredito.Estado.PAGADA).order_by("numero"))
    vencidas = [c for c in pend if c.fecha_vencimiento < fecha]
    siguiente = next((c for c in pend if c.fecha_vencimiento >= fecha), None)
    return sum((c.pendiente for c in vencidas + ([siguiente] if siguiente else [])), CERO)


@transaction.atomic
def pagar(credito, monto, usuario, medio="EFECTIVO", origen_fondos="CAJA", fecha=None, nota="",
          excedente="CAPITAL", estrategia=None):
    """
    Pago que puede traer plata de más. Cubre primero lo que toca (vencidas + próxima cuota)
    y el resto:
      - excedente="CAPITAL" (cuota fija): abono a capital -> menos intereses.
      - excedente="ADELANTAR": adelanta las cuotas siguientes (lo único posible en interés plano).
    """
    cr = Credito.objects.get(pk=credito.pk)
    monto = Decimal(str(monto))
    if monto <= 0:
        raise ValidationError("El monto debe ser mayor a cero.")
    _validar_fondo(cr.negocio, monto, origen_fondos)
    toca = lo_que_toca(cr)
    if cr.sistema != C.FRANCES or excedente != "CAPITAL" or monto <= toca:
        return pagar_cuotas(cr, monto, usuario, medio, origen_fondos, fecha, nota), None
    pago = pagar_cuotas(cr, toca, usuario, medio, origen_fondos, fecha, nota) if toca > 0 else None
    cr.refresh_from_db()
    if cr.estado != Credito.Estado.ACTIVO:
        raise ValidationError("Con la cuota ya quedó pagado: no hay capital para el excedente.")
    extra = monto - toca
    # Capital que aún queda en cuotas futuras: pagarlo todo liquida el crédito sin cobrar
    # los intereses futuros (en cuota fija se pagan solo sobre lo que se debe).
    capital_restante = sum((c.capital for c in cr.cuotas.filter(
        estado=CuotaCredito.Estado.PENDIENTE, pagado_capital=0, pagado_interes=0)), CERO)
    sobrante = max(CERO, extra - capital_restante)
    extra = min(extra, capital_restante)
    abono, efecto = abonar_capital(cr, extra, estrategia or cr.aporte_estrategia, usuario, medio, origen_fondos,
                                   fecha, nota or "Excedente del pago de cuota")
    cr.refresh_from_db()
    return pago or abono, {"cuota": toca, "a_capital": extra, "liquidado": cr.estado == Credito.Estado.PAGADO,
                           "no_cobrado": sobrante, **efecto}


@transaction.atomic
def configurar_aporte(cr, aporte_extra, estrategia):
    aporte_extra = Decimal(str(aporte_extra or 0))
    if aporte_extra < 0:
        raise ValidationError("El aporte no puede ser negativo.")
    if aporte_extra and cr.sistema != C.FRANCES:
        raise ValidationError("En interés plano los aportes extra no bajan el interés; negócialo con el prestamista.")
    if estrategia not in (C.REDUCIR_PLAZO, C.REDUCIR_CUOTA):
        raise ValidationError("Estrategia inválida.")
    cr.aporte_extra, cr.aporte_estrategia = aporte_extra, estrategia
    cr.save(update_fields=["aporte_extra", "aporte_estrategia", "actualizado"])
    return cr


@transaction.atomic
def abonar_capital(credito, monto, estrategia, usuario, medio="EFECTIVO", origen_fondos="CAJA", fecha=None, nota=""):
    """
    Abono extra a capital (solo cuota fija). Se recalculan las cuotas futuras:
    REDUCIR_PLAZO mantiene la cuota y termina antes; REDUCIR_CUOTA mantiene el plazo con cuota menor.
    """
    cr = Credito.objects.select_for_update().get(pk=credito.pk)
    if cr.estado != Credito.Estado.ACTIVO:
        raise ValidationError("El crédito no está activo.")
    if cr.sistema != C.FRANCES:
        raise ValidationError("En interés plano el interés no baja con abonos: registra un pago normal "
                              "(adelanta cuotas) y negocia con el prestamista el descuento de intereses.")
    if estrategia not in (C.REDUCIR_PLAZO, C.REDUCIR_CUOTA):
        raise ValidationError("Estrategia inválida.")
    monto = Decimal(str(monto))
    intactas = list(cr.cuotas.filter(estado=CuotaCredito.Estado.PENDIENTE, pagado_capital=0, pagado_interes=0)
                    .order_by("numero"))
    if not intactas:
        raise ValidationError("No hay cuotas futuras para recalcular.")
    if cr.cuotas.filter(estado__in=[CuotaCredito.Estado.PENDIENTE, CuotaCredito.Estado.PARCIAL],
                        fecha_vencimiento__lt=hoy()).exists():
        raise ValidationError("Primero ponte al día con las cuotas vencidas; el abono extra va después.")
    saldo_regen = sum((c.capital for c in intactas), CERO)
    if monto <= 0 or monto > saldo_regen:
        raise ValidationError(f"El abono debe ser entre $1 y {fmt(saldo_regen)}.")
    _validar_fondo(cr.negocio, monto, origen_fondos)

    i = cr.tasa_periodica
    nuevo_saldo = saldo_regen - monto
    primera, numero = intactas[0].fecha_vencimiento, intactas[0].numero
    antes = {"cuotas_restantes": len(intactas), "cuota": cr.cuota_valor,
             "intereses_restantes": sum((c.interes for c in intactas), CERO)}
    CuotaCredito.objects.filter(pk__in=[c.pk for c in intactas]).delete()

    filas = []
    if nuevo_saldo > 0:
        if estrategia == C.REDUCIR_PLAZO:
            filas = C.tabla_francesa(nuevo_saldo, i, cuota=cr.cuota_valor)
        else:
            filas = C.tabla_francesa(nuevo_saldo, i, n=len(intactas))
            cr.cuota_valor = filas[0]["valor"]
        _guardar_cuotas(cr, filas, inicio_numero=numero, primera_fecha=primera)
    cr.num_cuotas = numero - 1 + len(filas)
    cr.save(update_fields=["cuota_valor", "num_cuotas", "actualizado"])

    despues = {"cuotas_restantes": len(filas), "cuota": filas[0]["valor"] if filas else CERO,
               "intereses_restantes": sum((f["interes"] for f in filas), CERO)}
    pago = PagoCredito.objects.create(
        negocio=cr.negocio, credito=cr, fecha=fecha or hoy(), tipo=PagoCredito.Tipo.ABONO_CAPITAL, monto=monto,
        aplicado_capital=monto, medio=medio, origen_fondos=origen_fondos, estrategia=estrategia,
        detalle={"antes": _s(antes), "despues": _s(despues)}, nota=nota, usuario=usuario)
    _sacar_dinero(cr.negocio, cr, monto, medio, origen_fondos, usuario, f"Abono a capital {cr.entidad}", pago.id)
    _cerrar_si_pagado(cr)
    return pago, {
        "antes": antes, "despues": despues,
        "cuotas_menos": antes["cuotas_restantes"] - despues["cuotas_restantes"],
        "intereses_ahorrados": antes["intereses_restantes"] - despues["intereses_restantes"],
    }


def _cerrar_si_pagado(cr):
    if not cr.cuotas.exclude(estado=CuotaCredito.Estado.PAGADA).exists():
        cr.estado = Credito.Estado.PAGADO
        cr.save(update_fields=["estado", "actualizado"])


def _s(d):
    return {k: str(v) for k, v in d.items()}


# ---------------- Análisis y plan ----------------

def estado_credito(cr, fecha=None):
    fecha = fecha or hoy()
    cuotas = list(cr.cuotas.all())
    pendientes = [c for c in cuotas if c.estado != CuotaCredito.Estado.PAGADA]
    vencidas = [c for c in pendientes if c.fecha_vencimiento < fecha]
    proxima = pendientes[0] if pendientes else None
    pagado_cap = cr.capital_pagado
    usura = TasaUsura.vigente(cr.modalidad, cr.fecha_desembolso)
    return {
        "saldo_capital": cr.monto - pagado_cap,
        "deuda_pendiente_cuotas": sum((c.pendiente for c in pendientes), CERO),
        "intereses_pagados": cr.interes_pagado,
        "intereses_por_pagar": sum((c.interes - c.pagado_interes for c in pendientes), CERO),
        "progreso_pct": round(pagado_cap / cr.monto * 100, 1) if cr.monto else 0,
        "cuotas_pagadas": len(cuotas) - len(pendientes),
        "cuotas_restantes": len(pendientes),
        "cuotas_vencidas": len(vencidas),
        "valor_vencido": sum((c.pendiente for c in vencidas), CERO),
        "proxima_cuota": {"numero": proxima.numero, "fecha": proxima.fecha_vencimiento, "valor": proxima.pendiente,
                          "dias": (proxima.fecha_vencimiento - fecha).days} if proxima else None,
        "fecha_fin": pendientes[-1].fecha_vencimiento if pendientes else None,
        "cuota_diaria_equivalente": round(cr.cuota_diaria_equivalente, 0),
        "aporte_diario_equivalente": round(cr.aporte_diario_equivalente, 0),
        "aportado_extra": cr.aportado_extra,
        "intereses_ahorrados_por_aportes": _ahorrado_por_aportes(cr),
        "proyeccion_con_aporte": _proyeccion_aporte(cr) if pendientes else None,
        "lo_que_toca": sum((c.pendiente for c in vencidas), CERO) + (
            next((c.pendiente for c in pendientes if c.fecha_vencimiento >= fecha), CERO)),
        "usura": {
            "tasa_usura_ea": usura.tasa_ea if usura else None,
            "supera_usura": bool(usura and cr.tasa_ea_real > usura.tasa_ea),
            "nota": None if usura else "No hay tasa de usura cargada para esa fecha.",
        },
    }


def _ahorrado_por_aportes(cr):
    """Intereses que ya dejaste de pagar gracias a los abonos a capital hechos."""
    total = CERO
    for p in cr.pagos.filter(tipo=PagoCredito.Tipo.ABONO_CAPITAL):
        try:
            total += Decimal(p.detalle["antes"]["intereses_restantes"]) - Decimal(p.detalle["despues"]["intereses_restantes"])
        except (KeyError, TypeError, ArithmeticError):
            continue
    return total


def _proyeccion_aporte(cr):
    """Si sigue aportando su extra fijo en cada cuota: cuándo termina y cuánto se ahorra."""
    if not cr.aporte_extra or cr.sistema != C.FRANCES:
        return None
    try:
        sim = simular(cr, extra_periodico=cr.aporte_extra)
    except ValidationError:
        return None
    return {"aporte": cr.aporte_extra, "periodos_menos": sim["periodos_menos"],
            "intereses_ahorrados": sim["intereses_ahorrados"], "fecha_fin": sim["con_plan"]["fecha_fin"],
            "fecha_fin_sin_aporte": sim["actual"]["fecha_fin"]}


def simular(cr, abono_unico=0, extra_periodico=0, estrategia=C.REDUCIR_PLAZO):
    """Compara pagar normal vs con abonos. No guarda nada."""
    pendientes = list(cr.cuotas.exclude(estado=CuotaCredito.Estado.PAGADA))
    if not pendientes:
        raise ValidationError("El crédito ya está pagado.")
    saldo = sum((c.capital - c.pagado_capital for c in pendientes), CERO)
    n = len(pendientes)

    if cr.sistema == C.PLANO:
        int_rest = sum((c.interes - c.pagado_interes for c in pendientes), CERO)
        pago_per = cr.cuota_valor + Decimal(str(extra_periodico))
        deuda = saldo + int_rest - Decimal(str(abono_unico))
        periodos = math.ceil(deuda / pago_per) if deuda > 0 else 0
        return {
            "sistema": cr.sistema,
            "actual": {"periodos": n, "interes_total": int_rest},
            "con_plan": {"periodos": periodos, "interes_total": int_rest},
            "periodos_menos": n - periodos, "intereses_ahorrados": CERO,
            "nota": "Interés plano: adelantar pagos acorta el plazo pero el interés pactado no baja, "
                    "salvo que el prestamista acepte descontarlo. Negócialo antes de abonar.",
        }

    i = cr.tasa_periodica
    try:
        base = C.simular_frances(saldo, i, cr.cuota_valor)
        plan = C.simular_frances(saldo, i, cr.cuota_valor, extra_periodico=extra_periodico,
                                 abono_unico=abono_unico, estrategia=estrategia, n_restantes=n)
    except ValueError as e:
        raise ValidationError(str(e))
    fecha_base = C.fecha_cuota(pendientes[0].fecha_vencimiento, max(base["periodos"] - 1, 0), cr.frecuencia)
    fecha_plan = C.fecha_cuota(pendientes[0].fecha_vencimiento, max(plan["periodos"] - 1, 0), cr.frecuencia)
    return {
        "sistema": cr.sistema,
        "actual": {**base, "fecha_fin": fecha_base},
        "con_plan": {**plan, "fecha_fin": fecha_plan},
        "periodos_menos": base["periodos"] - plan["periodos"],
        "intereses_ahorrados": base["interes_total"] - plan["interes_total"],
    }


def creditos_activos(negocio):
    return Credito.objects.filter(negocio=negocio, estado=Credito.Estado.ACTIVO)


def cuota_diaria_total(negocio):
    return sum((c.cuota_diaria_equivalente for c in creditos_activos(negocio)), CERO)


def semaforo(cobertura):
    """cobertura = utilidad operativa diaria / cuota diaria de créditos."""
    if cobertura is None:
        return "SIN_DATOS"
    if cobertura >= Decimal("1.5"):
        return "VERDE"
    if cobertura >= 1:
        return "AMARILLO"
    return "ROJO"


def plan_pago(cr, porcentaje_excedente=50):
    """
    Recomienda cuánto abonar extra según lo que el negocio realmente gana:
    excedente diario = utilidad operativa promedio (30 días) - cuotas diarias de todos los créditos.
    Se sugiere destinar un % de ese excedente (el resto queda como colchón del negocio).
    """
    from reportes.servicios import utilidad_promedio_diaria

    util_dia, dias_datos = utilidad_promedio_diaria(cr.negocio, 30)
    cuotas_dia = round(cuota_diaria_total(cr.negocio), 0)
    excedente_dia = util_dia - cuotas_dia
    pct = Decimal(str(porcentaje_excedente)) / 100
    extra_dia = max(CERO, round(excedente_dia * pct, 0))
    dias_periodo = Decimal(365) / C.PERIODOS_ANIO[cr.frecuencia]
    extra_periodo = round(extra_dia * dias_periodo, 0)
    cobertura = round(util_dia / cuotas_dia, 2) if cuotas_dia else None

    escenarios = []
    for p in (25, 50, 75):
        e = round(max(CERO, round(excedente_dia * Decimal(p) / 100, 0)) * dias_periodo, 0)
        sim = simular(cr, extra_periodico=e)
        escenarios.append({"porcentaje_excedente": p, "extra_por_cuota": e,
                           "cuotas_menos": sim["periodos_menos"], "intereses_ahorrados": sim["intereses_ahorrados"]})

    sim = simular(cr, extra_periodico=extra_periodo)
    if dias_datos == 0:
        mensaje = "Aún no hay ventas registradas para calcular un plan. Registra unos días de ventas y vuelve."
    elif excedente_dia <= 0:
        mensaje = (f"Hoy el negocio genera en promedio {fmt(util_dia)} diarios de utilidad y las cuotas exigen "
                   f"{fmt(cuotas_dia)} diarios. No hay excedente para abonar: prioriza pagar puntual, revisar "
                   f"gastos y precios, y evita tomar más crédito.")
    else:
        mensaje = (f"Ganas en promedio {fmt(util_dia)} al día y tus cuotas piden {fmt(cuotas_dia)} diarios. "
                   f"Si apartas {fmt(cuotas_dia + extra_dia)} cada día y abonas {fmt(extra_periodo)} extra a capital "
                   f"en cada cuota, terminas {sim['periodos_menos']} cuota(s) antes")
        mensaje += (f" y te ahorras {fmt(sim['intereses_ahorrados'])} en intereses." if sim["intereses_ahorrados"] > 0
                    else ".")
    if 0 < dias_datos < 14:
        mensaje += f" Ojo: solo hay {dias_datos} día(s) de datos; toma este plan como referencia hasta tener más historial."
    return {
        "utilidad_operativa_promedio_dia": util_dia,
        "dias_con_datos": dias_datos,
        "cuotas_diarias_todos_los_creditos": cuotas_dia,
        "cobertura": cobertura,
        "semaforo": semaforo(cobertura),
        "excedente_diario": excedente_dia,
        "porcentaje_excedente_usado": porcentaje_excedente,
        "apartar_diario_recomendado": cuotas_dia + extra_dia,
        "abono_extra_por_cuota": extra_periodo,
        "simulacion": sim,
        "escenarios": escenarios,
        "mensaje": mensaje,
    }


def tablero(negocio):
    """Resumen de créditos para el dashboard: meta del día, semáforo, fondo y alertas."""
    from reportes.servicios import serie_diaria, utilidad_promedio_diaria

    hoy_ = hoy()
    activos = list(creditos_activos(negocio))
    estados = [(c, estado_credito(c, hoy_)) for c in activos]
    cuota_dia = round(sum((c.cuota_diaria_equivalente for c in activos), CERO), 0)
    aporte_dia = round(sum((c.aporte_diario_equivalente for c in activos), CERO), 0)
    meta_dia = cuota_dia + aporte_dia

    serie7 = serie_diaria(negocio, hoy_ - dt.timedelta(days=6), hoy_)
    util_hoy = serie7[-1]["utilidad_operativa"]
    util_prom, dias = utilidad_promedio_diaria(negocio, 30)
    apartado_hoy = (ApartadoCredito.objects.filter(negocio=negocio, fecha=hoy_, tipo=ApartadoCredito.Tipo.APARTADO)
                    .aggregate(s=Sum("monto"))["s"] or CERO)
    fondo = saldo_fondo(negocio)

    proximas = sorted([e["proxima_cuota"] | {"credito": c.entidad, "credito_id": c.id}
                       for c, e in estados if e["proxima_cuota"]], key=lambda x: x["fecha"])
    proxima = proximas[0] if proximas else None

    alertas = []
    for c, e in estados:
        if e["cuotas_vencidas"]:
            alertas.append({"nivel": "ROJO", "credito_id": c.id,
                            "mensaje": f"{c.entidad}: {e['cuotas_vencidas']} cuota(s) vencida(s) por {fmt(e['valor_vencido'])}."})
        elif e["proxima_cuota"] and 0 <= e["proxima_cuota"]["dias"] <= 3:
            alertas.append({"nivel": "AMARILLO", "credito_id": c.id,
                            "mensaje": f"{c.entidad}: cuota de {fmt(e['proxima_cuota']['valor'])} vence en "
                                       f"{e['proxima_cuota']['dias']} día(s)."})
        if e["usura"]["supera_usura"]:
            alertas.append({"nivel": "ROJO", "credito_id": c.id,
                            "mensaje": f"{c.entidad}: el costo real ({c.tasa_ea_real}% E.A.) supera la tasa de usura "
                                       f"({e['usura']['tasa_usura_ea']}% E.A.). Revisa este crédito."})
        if 0 < e["cuotas_restantes"] <= 2:
            alertas.append({"nivel": "VERDE", "credito_id": c.id,
                            "mensaje": f"{c.entidad}: ¡te faltan {e['cuotas_restantes']} cuota(s)!"})
    if activos and cuota_dia:
        dias_sin_cubrir = sum(1 for d in serie7 if d["num_ventas"] and d["utilidad_operativa"] < cuota_dia)
        if dias_sin_cubrir >= 3:
            alertas.append({"nivel": "AMARILLO", "credito_id": None,
                            "mensaje": f"En {dias_sin_cubrir} de los últimos 7 días la utilidad no alcanzó para la "
                                       f"cuota diaria de {fmt(cuota_dia)}."})
    if proxima and fondo < proxima["valor"] and proxima["dias"] <= 7:
        alertas.append({"nivel": "AMARILLO", "credito_id": proxima["credito_id"],
                        "mensaje": f"El fondo tiene {fmt(fondo)} y la próxima cuota es de {fmt(proxima['valor'])} "
                                   f"en {proxima['dias']} día(s). Faltan {fmt(proxima['valor'] - fondo)}."})

    cob_hoy = round(util_hoy / cuota_dia, 2) if cuota_dia else None
    cob_prom = round(util_prom / cuota_dia, 2) if cuota_dia and dias else None
    return {
        "creditos_activos": len(activos),
        "deuda_total_capital": sum((e["saldo_capital"] for _, e in estados), CERO),
        "deuda_total_cuotas": sum((e["deuda_pendiente_cuotas"] for _, e in estados), CERO),
        "meta_dia": {
            "apartar_hoy": meta_dia,
            "cuota_obligatoria_dia": cuota_dia,
            "aporte_extra_dia": aporte_dia,
            "apartado_hoy": apartado_hoy,
            "falta_hoy": max(CERO, meta_dia - apartado_hoy),
            "utilidad_operativa_hoy": util_hoy,
            "cobertura_hoy": cob_hoy,
            "semaforo_hoy": semaforo(cob_hoy),
        },
        "promedio_30_dias": {
            "utilidad_operativa_dia": util_prom,
            "cobertura": cob_prom,
            "semaforo": semaforo(cob_prom),
        },
        "fondo_apartado": fondo,
        "proxima_cuota": proxima,
        "fondo_cubre_proxima": bool(proxima and fondo >= proxima["valor"]),
        "ultimos_7_dias": [{"fecha": d["fecha"], "utilidad_operativa": d["utilidad_operativa"],
                            "cubre_cuota": bool(cuota_dia) and d["utilidad_operativa"] >= cuota_dia} for d in serie7],
        "alertas": alertas,
        "aportado_extra_total": sum((e["aportado_extra"] for _, e in estados), CERO),
        "ahorrado_por_aportes_total": sum((e["intereses_ahorrados_por_aportes"] for _, e in estados), CERO),
        "creditos": [{"id": c.id, "entidad": c.entidad, "cuota": c.cuota_valor, "frecuencia": c.frecuencia,
                      "aporte_extra": c.aporte_extra,
                      **{k: e[k] for k in ("saldo_capital", "progreso_pct", "cuotas_restantes", "cuotas_vencidas",
                                           "proxima_cuota", "fecha_fin")}} for c, e in estados],
    }


def comparar_estrategias(negocio, extra_mensual):
    activos = [c for c in creditos_activos(negocio)]
    deudas = []
    for c in activos:
        pend = c.cuotas.exclude(estado=CuotaCredito.Estado.PAGADA)
        saldo = sum((q.capital - q.pagado_capital for q in pend), CERO)
        if saldo <= 0:
            continue
        deudas.append({"id": c.id, "nombre": f"{c.entidad} #{c.id}", "saldo": saldo,
                       "ea": float(c.tasa_ea_real) / 100,
                       "cuota_mensual": c.cuota_valor * C.PERIODOS_ANIO[c.frecuencia] / 12})
    if not deudas:
        raise ValidationError("No hay créditos activos con saldo.")
    sin_extra = C.estrategia_multiples(deudas, 0, "AVALANCHA")
    ava = C.estrategia_multiples(deudas, extra_mensual, "AVALANCHA")
    bola = C.estrategia_multiples(deudas, extra_mensual, "BOLA_NIEVE")
    mejor = "AVALANCHA" if ava["interes_total"] <= bola["interes_total"] else "BOLA_NIEVE"
    return {
        "extra_mensual": extra_mensual,
        "sin_extra": sin_extra,
        "avalancha": ava | {"descripcion": "Abona primero al crédito más caro (mayor tasa). Ahorra más intereses."},
        "bola_de_nieve": bola | {"descripcion": "Abona primero al crédito más pequeño. Cierras deudas antes y motiva."},
        "recomendada": mejor,
        "ahorro_vs_sin_extra": sin_extra["interes_total"] - (ava if mejor == "AVALANCHA" else bola)["interes_total"],
        "nota": "Estimación en equivalente mensual usando el costo real (TIR) de cada crédito.",
    }
