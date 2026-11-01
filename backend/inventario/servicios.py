from decimal import Decimal

from django.db import transaction
from rest_framework.exceptions import ValidationError

from catalogo.models import Producto

from .models import MovimientoInventario

T = MovimientoInventario.Tipo
SALIDAS = {T.VENTA, T.AJUSTE_SALIDA, T.CONSUMO_INTERNO, T.MERMA}


@transaction.atomic
def mover_stock(producto, cantidad, tipo, usuario=None, referencia="", nota="",
                costo_unitario=None, validar_stock=False):
    """
    Único punto donde cambia el stock. `cantidad` siempre positiva; el signo lo da el tipo.
    Bloquea la fila del producto para que dos cajas no se pisen.
    """
    cantidad = Decimal(str(cantidad))
    if cantidad <= 0:
        raise ValidationError("La cantidad debe ser mayor a cero.")

    p = Producto.objects.select_for_update().get(pk=producto.pk)
    delta = -cantidad if tipo in SALIDAS else cantidad

    if validar_stock and delta < 0 and p.stock + delta < 0:
        raise ValidationError(f"Stock insuficiente de '{p.nombre}' (disponible {p.stock.normalize()}).")

    # Costo promedio ponderado en compras
    if tipo == T.COMPRA and costo_unitario is not None:
        costo_unitario = Decimal(str(costo_unitario))
        if p.stock > 0:
            p.costo = ((p.stock * p.costo) + (cantidad * costo_unitario)) / (p.stock + cantidad)
            p.costo = p.costo.quantize(Decimal("0.01"))
        else:
            p.costo = costo_unitario

    p.stock = p.stock + delta
    p.save(update_fields=["stock", "costo", "actualizado"])
    producto.stock, producto.costo = p.stock, p.costo

    return MovimientoInventario.objects.create(
        negocio_id=p.negocio_id, producto=p, tipo=tipo, cantidad=delta,
        stock_resultante=p.stock, costo_unitario=costo_unitario if costo_unitario is not None else p.costo,
        referencia=referencia, nota=nota, usuario=usuario,
    )
