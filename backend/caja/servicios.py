from decimal import Decimal

from django.db.models import Sum
from rest_framework.exceptions import ValidationError

from negocios.models import MedioPago
from negocios.utils import CERO

from .models import MovimientoCaja, SesionCaja

Origen = MovimientoCaja.Origen


def sesion_abierta(negocio, requerida=True):
    s = SesionCaja.objects.filter(negocio=negocio, estado=SesionCaja.Estado.ABIERTA).first()
    if requerida and not s:
        raise ValidationError("No hay caja abierta. Abre la caja para registrar movimientos de dinero.")
    return s


def registrar(negocio, origen, monto, medio=MedioPago.EFECTIVO, concepto="", referencia="",
              usuario=None, sesion=None):
    """Registra dinero en la caja abierta. `monto` con signo (+ entra, - sale)."""
    sesion = sesion or sesion_abierta(negocio)
    return MovimientoCaja.objects.create(
        negocio=negocio, sesion=sesion, origen=origen, medio=medio, monto=Decimal(monto),
        concepto=concepto[:200], referencia=referencia, usuario=usuario,
    )


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
