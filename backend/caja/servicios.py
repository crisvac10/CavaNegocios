from decimal import Decimal

from django.db.models import Sum
from rest_framework.exceptions import ValidationError

from negocios.models import MedioPago
from negocios.utils import CERO

from .models import MovimientoCaja, SesionCaja

Origen = MovimientoCaja.Origen


def sesion_abierta(negocio, requerida=True):
    """Caja abierta del negocio. Si el negocio no usa caja, nunca se exige (devuelve None)."""
    if not negocio.usa_caja:
        return None
    s = SesionCaja.objects.filter(negocio=negocio, estado=SesionCaja.Estado.ABIERTA).first()
    if requerida and not s:
        raise ValidationError("No hay caja abierta. Abre la caja para registrar movimientos de dinero.")
    return s


def registrar(negocio, origen, monto, medio=MedioPago.EFECTIVO, concepto="", referencia="",
              usuario=None, sesion=None, momento=None):
    """Registra dinero en el libro. `monto` con signo (+ entra, - sale).
    Con caja: va a la sesión abierta. Sin caja: queda por fecha para el cuadre diario.
    `momento` (datetime de un día anterior) deja el movimiento en ese día: no pasa por la caja
    de hoy y aparece en el cuadre de esa fecha."""
    if momento is None:
        sesion = sesion or sesion_abierta(negocio)
    mov = MovimientoCaja.objects.create(
        negocio=negocio, sesion=sesion, origen=origen, medio=medio, monto=Decimal(monto),
        concepto=concepto[:200], referencia=referencia, usuario=usuario,
    )
    if momento is not None:
        MovimientoCaja.objects.filter(pk=mov.pk).update(creado=momento)
        mov.creado = momento
    return mov


def _totales(movs):
    por_medio = {m.value: CERO for m in MedioPago}
    for fila in movs.values("medio").annotate(t=Sum("monto")):
        por_medio[fila["medio"]] = fila["t"] or CERO
    por_origen = {}
    for fila in movs.values("origen", "medio").annotate(t=Sum("monto")).order_by("origen"):
        por_origen.setdefault(fila["origen"], {})[fila["medio"]] = fila["t"]
    return por_medio, por_origen


def resumen_dia(negocio, fecha):
    """
    Cuadre diario (negocios sin caja registradora): cuánto entró y salió hoy por
    cada medio. El efectivo neto es lo que debería tener el dueño en la mano/bolsillo
    respecto a como empezó el día.
    """
    from negocios.utils import rango_dia
    ini, fin = rango_dia(fecha)
    movs = MovimientoCaja.objects.filter(negocio=negocio, creado__gte=ini, creado__lt=fin)
    por_medio, por_origen = _totales(movs)
    entradas = movs.filter(monto__gt=0).aggregate(t=Sum("monto"))["t"] or CERO
    salidas = movs.filter(monto__lt=0).aggregate(t=Sum("monto"))["t"] or CERO
    return {
        "fecha": fecha,
        "entradas": entradas,
        "salidas": -salidas,
        "neto": entradas + salidas,
        "efectivo_neto": por_medio[MedioPago.EFECTIVO],
        "total_por_medio": por_medio,
        "detalle_por_origen": por_origen,
        "num_movimientos": movs.count(),
    }


def resumen_sesion(sesion):
    movs = sesion.movimientos.all()
    por_medio = {m.value: CERO for m in MedioPago}
    for fila in movs.values("medio").annotate(t=Sum("monto")):
        por_medio[fila["medio"]] = fila["t"] or CERO

    por_origen = {}
    for fila in movs.values("origen", "medio").annotate(t=Sum("monto")).order_by("origen"):
        por_origen.setdefault(fila["origen"], {})[fila["medio"]] = fila["t"]

    efectivo_esperado = sesion.base_inicial + por_medio[MedioPago.EFECTIVO]
    return {
        "sesion_id": sesion.id,
        "estado": sesion.estado,
        "abierta_en": sesion.abierta_en.isoformat(),
        "base_inicial": sesion.base_inicial,
        "efectivo_esperado": efectivo_esperado,
        "total_por_medio": por_medio,          # neto por medio (para conciliar Nequi, Daviplata...)
        "detalle_por_origen": por_origen,      # ventas, gastos, cuotas de crédito, apartados...
        "num_movimientos": movs.count(),
    }
