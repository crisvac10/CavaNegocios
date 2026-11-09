"""
Cálculo de estadísticas. Reglas contables clave:
- Ventas netas = total de ventas no anuladas (incluye lo fiado: se vendió).
- Costo de ventas = costo de lo vendido (las compras de mercancía NO son gasto).
- Utilidad operativa = ventas netas - costo de ventas - gastos operativos.
- Intereses de créditos = gasto financiero -> Utilidad neta = operativa - intereses.
- Desembolso de un crédito NO es ingreso ni utilidad; abono a capital NO es gasto.
"""
import datetime as dt

from django.db.models import Count, F, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from negocios.utils import CERO, rango_fechas


def _dias(desde, hasta):
    d = desde
    while d <= hasta:
        yield d
        d += dt.timedelta(days=1)


def ventas_validas(negocio, desde, hasta):
    from ventas.models import Venta
    ini, fin = rango_fechas(desde, hasta)
    return (Venta.objects.filter(negocio=negocio, creado__gte=ini, creado__lt=fin)
            .exclude(estado=Venta.Estado.ANULADA)
            # Un encargo cuenta como venta cuando se paga completo o, si no, al entregarse
            .exclude(estado=Venta.Estado.ENCARGO, saldo_pendiente__gt=0)
            .exclude(origen=Venta.Origen.SALDO_ANTERIOR))


def _insumos(negocio, desde, hasta):
    """Líneas de compra sin producto (leche, vasos…): no son mercancía, cuentan como gasto el día de la compra."""
    from gastos.models import DetalleCompra
    return DetalleCompra.objects.filter(compra__negocio=negocio, compra__anulada=False, producto__isnull=True,
                                        compra__fecha__range=(desde, hasta))


def serie_diaria(negocio, desde, hasta):
    """[{fecha, ventas, costo, gastos, utilidad_operativa, intereses, utilidad_neta, num_ventas}] por día."""
    from creditos.models import PagoCredito
    from gastos.models import Gasto

    tz = timezone.get_current_timezone()
    base = {d: {"ventas": CERO, "costo": CERO, "gastos": CERO, "intereses": CERO, "num_ventas": 0}
            for d in _dias(desde, hasta)}

    for f in (ventas_validas(negocio, desde, hasta).annotate(dia=TruncDate("creado", tzinfo=tz))
              .values("dia").annotate(v=Sum("total"), c=Sum("costo_total"), n=Count("id"))):
        base[f["dia"]].update(ventas=f["v"], costo=f["c"], num_ventas=f["n"])

    for f in (Gasto.objects.filter(negocio=negocio, anulado=False, fecha__range=(desde, hasta))
              .values("fecha").annotate(t=Sum("monto"))):
        base[f["fecha"]]["gastos"] = f["t"]
    for f in _insumos(negocio, desde, hasta).values("compra__fecha").annotate(t=Sum("subtotal")):
        base[f["compra__fecha"]]["gastos"] += f["t"]

    for f in (PagoCredito.objects.filter(negocio=negocio, fecha__range=(desde, hasta))
              .values("fecha").annotate(t=Sum("aplicado_interes"))):
        base[f["fecha"]]["intereses"] = f["t"]

    salida = []
    for d, x in base.items():
        operativa = x["ventas"] - x["costo"] - x["gastos"]
        salida.append({"fecha": d, **x, "utilidad_operativa": operativa, "utilidad_neta": operativa - x["intereses"]})
    return salida


def resumen(negocio, desde, hasta):
    from creditos.models import Credito, PagoCredito
    from gastos.models import Compra, Gasto
    from ventas.models import PagoVenta, Venta

    ini, fin = rango_fechas(desde, hasta)
    vs = ventas_validas(negocio, desde, hasta)
    agg = vs.aggregate(bruto=Sum("subtotal"), desc=Sum("descuento"), neto=Sum("total"),
                       costo=Sum("costo_total"), n=Count("id"))
    agg["fiado"] = vs.filter(estado=Venta.Estado.FIADO).aggregate(t=Sum("saldo_pendiente"))["t"]
    por_cobrar = vs.filter(estado=Venta.Estado.ABIERTA).aggregate(t=Sum("total"), n=Count("id"))
    neto, costo, n = agg["neto"] or CERO, agg["costo"] or CERO, agg["n"] or 0

    gastos = (Gasto.objects.filter(negocio=negocio, anulado=False, fecha__range=(desde, hasta))
              .aggregate(t=Sum("monto"))["t"] or CERO)
    gastos_cat = list(Gasto.objects.filter(negocio=negocio, anulado=False, fecha__range=(desde, hasta))
                      .values(categoria_nombre=F("categoria__nombre")).annotate(total=Sum("monto")).order_by("-total"))
    insumos = _insumos(negocio, desde, hasta).aggregate(t=Sum("subtotal"))["t"] or CERO
    if insumos:
        gastos += insumos
        gastos_cat = sorted(gastos_cat + [{"categoria_nombre": "Insumos (compras)", "total": insumos}], key=lambda g: -g["total"])
    # Mercancía comprada (lo que entra al inventario); los insumos ya van en gastos
    compras = (Compra.objects.filter(negocio=negocio, anulada=False, fecha__range=(desde, hasta))
               .aggregate(t=Sum("total"))["t"] or CERO) - insumos

    pagos_cred = PagoCredito.objects.filter(negocio=negocio, fecha__range=(desde, hasta))
    pc = pagos_cred.aggregate(i=Sum("aplicado_interes"), c=Sum("aplicado_capital"))
    intereses, capital_pagado = pc["i"] or CERO, pc["c"] or CERO
    desembolsos = (Credito.objects.filter(negocio=negocio, fecha_desembolso__range=(desde, hasta))
                   .aggregate(t=Sum("monto"))["t"] or CERO)

    pagos = PagoVenta.objects.filter(negocio=negocio, creado__gte=ini, creado__lt=fin).exclude(venta__estado=Venta.Estado.ANULADA)
    por_medio = {f["medio"]: f["t"] for f in pagos.values("medio").annotate(t=Sum("monto"))}
    abonos = pagos.filter(es_abono=True).exclude(venta__origen=Venta.Origen.ENCARGO).aggregate(t=Sum("monto"))["t"] or CERO
    abonos_encargos = pagos.filter(es_abono=True, venta__origen=Venta.Origen.ENCARGO).aggregate(t=Sum("monto"))["t"] or CERO
    pend = Venta.objects.filter(negocio=negocio, estado=Venta.Estado.ENCARGO).aggregate(
        t=Sum("total"), s=Sum("saldo_pendiente"), n=Count("id"))
    cartera = (Venta.objects.filter(negocio=negocio, estado=Venta.Estado.FIADO).aggregate(t=Sum("saldo_pendiente"))["t"] or CERO)

    operativa = neto - costo - gastos
    return {
        "desde": desde, "hasta": hasta,
        "ventas_brutas": agg["bruto"] or CERO,
        "descuentos": agg["desc"] or CERO,
        "ventas_netas": neto,
        "num_ventas": n,
        "ticket_promedio": round(neto / n, 0) if n else CERO,
        "costo_ventas": costo,
        "utilidad_bruta": neto - costo,
        "margen_bruto_pct": round((neto - costo) / neto * 100, 1) if neto else CERO,
        "gastos_operativos": gastos,
        "gastos_por_categoria": gastos_cat,
        "utilidad_operativa": operativa,
        "intereses_creditos": intereses,
        "utilidad_neta": operativa - intereses,
        "dinero_recibido_por_medio": por_medio,
        "fiado_otorgado_pendiente": agg["fiado"] or CERO,
        "pedidos_por_cobrar": {"total": por_cobrar["t"] or CERO, "cantidad": por_cobrar["n"] or 0},
        "abonos_fiado_cobrados": abonos,
        "abonos_encargos": abonos_encargos,
        "encargos_por_entregar": {"cantidad": pend["n"] or 0, "total": pend["t"] or CERO,
                                  "falta_por_cobrar": pend["s"] or CERO},
        "cartera_total": cartera,
        "compras_mercancia": compras,
        "no_operativo": {
            "desembolsos_credito": desembolsos,
            "abonos_a_capital_credito": capital_pagado,
            "nota": "Los desembolsos y abonos a capital mueven dinero pero no son utilidad ni gasto.",
        },
    }


def utilidad_promedio_diaria(negocio, dias=30, hasta=None):
    """
    Promedio de utilidad operativa por día en los últimos N días, contando solo
    desde la primera venta registrada (para no castigar negocios recién creados).
    """
    from ventas.models import Venta
    hasta = hasta or timezone.localdate()
    desde = hasta - dt.timedelta(days=dias - 1)
    primera = Venta.objects.filter(negocio=negocio).order_by("creado").values_list("creado", flat=True).first()
    if not primera:
        return CERO, 0
    desde = max(desde, timezone.localtime(primera).date())
    serie = serie_diaria(negocio, desde, hasta)
    total = sum((d["utilidad_operativa"] for d in serie), CERO)
    return round(total / len(serie), 0), len(serie)
