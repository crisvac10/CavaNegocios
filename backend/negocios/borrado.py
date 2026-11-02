"""
Borrado definitivo de un negocio con TODO lo suyo: ventas, caja, inventario,
gastos, créditos, clientes, productos, usuarios y sus archivos (fotos y logo en R2).

Las ventas y movimientos protegen (PROTECT) a productos, clientes y usuarios para que
el día a día nunca deje historial con huecos; por eso un borrado normal se bloquea.
Aquí se borra en orden, de lo que depende hacia lo que es dependido, dentro de una
transacción: o se borra todo o no se borra nada. Los archivos se borran solo después
de confirmar la transacción.

Para dejar de atender a un cliente que no paga, lo normal es SUSPENDER (Activo apagado):
conserva todo y se puede reactivar.
"""
import logging
import shutil
from pathlib import Path

from django.conf import settings
from django.db import transaction

log = logging.getLogger(__name__)


def _modelos_en_orden():
    from caja.models import MovimientoCaja, SesionCaja
    from catalogo.models import Categoria, Producto
    from creditos.models import ApartadoCredito, Credito, PagoCredito
    from gastos.models import CategoriaGasto, Compra, Gasto, Proveedor
    from inventario.models import MovimientoInventario
    from negocios.models import Consecutivo
    from ventas.models import Cliente, PagoVenta, Venta

    return [
        MovimientoCaja, PagoVenta, Venta,            # Venta borra sus DetalleVenta
        MovimientoInventario, Compra, Gasto,         # Compra borra sus DetalleCompra
        ApartadoCredito, PagoCredito, Credito,       # Credito borra sus CuotaCredito
        SesionCaja, Cliente, Producto, Categoria,
        CategoriaGasto, Proveedor, Consecutivo,
    ]


NOMBRES = {
    "MovimientoCaja": "movimientos de dinero", "PagoVenta": "pagos de ventas", "Venta": "ventas",
    "MovimientoInventario": "movimientos de inventario", "Compra": "compras", "Gasto": "gastos",
    "ApartadoCredito": "movimientos del fondo de créditos", "PagoCredito": "pagos de créditos", "Credito": "créditos",
    "SesionCaja": "turnos de caja", "Cliente": "clientes", "Producto": "productos", "Categoria": "categorías",
    "CategoriaGasto": "categorías de gasto", "Proveedor": "proveedores", "Consecutivo": "consecutivos",
}


def resumen(negocio):
    """Cuántos registros se borrarían, para mostrarlo antes de confirmar."""
    filas = [(NOMBRES[m.__name__], m.objects.filter(negocio=negocio).count()) for m in _modelos_en_orden()]
    filas.append(("usuarios", negocio.usuarios.count()))
    return [(nombre, n) for nombre, n in filas if n]


def borrar_archivos(negocio_id):
    """Borra la carpeta negocios/<id>/ en R2 (o en media/ en desarrollo). Mejor esfuerzo."""
    from negocios import almacenamiento

    prefijo = f"negocios/{negocio_id}/"
    borrados = 0
    try:
        if almacenamiento.usa_r2():
            s3 = almacenamiento._r2()
            for pagina in s3.get_paginator("list_objects_v2").paginate(Bucket=settings.R2_BUCKET, Prefix=prefijo):
                claves = [{"Key": o["Key"]} for o in pagina.get("Contents", [])]
                for i in range(0, len(claves), 1000):
                    s3.delete_objects(Bucket=settings.R2_BUCKET, Delete={"Objects": claves[i:i + 1000], "Quiet": True})
                    borrados += len(claves[i:i + 1000])
        else:
            carpeta = Path(settings.MEDIA_ROOT) / prefijo
            if carpeta.exists():
                borrados = sum(1 for p in carpeta.rglob("*") if p.is_file())
                shutil.rmtree(carpeta)
    except Exception:  # los datos ya se borraron; un archivo suelto no debe romper nada
        log.exception("No se pudieron borrar los archivos de %s", prefijo)
    return borrados


def borrar_negocio(negocio):
    """Borra el negocio y todo lo suyo. Devuelve el resumen de lo borrado."""
    from rest_framework.authtoken.models import Token

    negocio_id, detalle = negocio.id, resumen(negocio)
    with transaction.atomic():
        for modelo in _modelos_en_orden():
            modelo.objects.filter(negocio=negocio).delete()
        Token.objects.filter(user__negocio=negocio).delete()
        negocio.usuarios.all().delete()
        negocio.delete()
        transaction.on_commit(lambda: borrar_archivos(negocio_id))
    return detalle
