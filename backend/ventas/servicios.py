from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from caja import servicios as caja
from caja.models import MovimientoCaja
from catalogo.models import Producto
from inventario.models import MovimientoInventario
from inventario.servicios import mover_stock
from negocios.models import Consecutivo, MedioPago
from negocios.utils import CERO, link_whatsapp, pesos

from .models import Cliente, DetalleVenta, PagoVenta, Venta

Origen = MovimientoCaja.Origen


@transaction.atomic
def crear_venta(negocio, usuario, items, pagos, descuento=0, cliente=None,
                efectivo_recibido=None, nota="", entregar_ya=False):
    """
    items: [{producto: id, cantidad, precio?}]   (precio opcional = precio de lista)
    pagos: [{medio, monto}]  (puede ser vacío o parcial si es fiado con cliente)
    """
    sesion = caja.sesion_abierta(negocio, requerida=negocio.usa_caja)
    if not items:
        raise ValidationError("La venta no tiene productos.")

    medios_ok = set(negocio.medios_pago_activos)
    ids = [int(i["producto"]) for i in items]
    productos = {p.id: p for p in Producto.objects.filter(negocio=negocio, id__in=ids, activo=True)}
    if len(productos) != len(set(ids)):
        raise ValidationError("Hay productos que no existen o están inactivos.")

    lineas, subtotal, costo_total = [], CERO, CERO
    for it in items:
        p = productos[int(it["producto"])]
        cant = Decimal(str(it.get("cantidad", 1)))
        if cant <= 0:
            raise ValidationError(f"Cantidad inválida para {p.nombre}.")
        precio = Decimal(str(it["precio"])) if it.get("precio") not in (None, "") else p.precio
        if precio < 0:
            raise ValidationError("Precio inválido.")
        sub = (precio * cant).quantize(Decimal("0.01"))
        lineas.append((p, cant, precio, sub))
        subtotal += sub
        costo_total += (p.costo * cant)

    descuento = Decimal(str(descuento or 0))
    if descuento < 0 or descuento > subtotal:
        raise ValidationError("Descuento inválido.")
    total = subtotal - descuento

    pagos_limpios = []
    for pg in pagos or []:
        monto = Decimal(str(pg.get("monto", 0)))
        if monto <= 0:
            continue
        if pg.get("medio") not in medios_ok:
            raise ValidationError(f"Medio de pago no habilitado: {pg.get('medio')}")
        pagos_limpios.append((pg["medio"], monto))
    pagado = sum((m for _, m in pagos_limpios), CERO)

    if pagado > total:
        raise ValidationError("Los pagos superan el total. El cambio se calcula con 'efectivo_recibido'.")
    saldo = total - pagado
    if saldo > 0:
        if not negocio.permitir_fiado:
            raise ValidationError(f"Faltan {pesos(saldo)} por pagar y el negocio no permite fiados.")
        if not cliente:
            raise ValidationError(f"Faltan {pesos(saldo)}. Para fiar, selecciona un cliente.")
        if cliente.cupo_fiado and cliente.saldo_pendiente + saldo > cliente.cupo_fiado:
            raise ValidationError(f"{cliente.nombre} supera su cupo de fiado ({pesos(cliente.cupo_fiado)}).")

    efectivo = sum((m for med, m in pagos_limpios if med == MedioPago.EFECTIVO), CERO)
    cambio = CERO
    if efectivo_recibido not in (None, ""):
        efectivo_recibido = Decimal(str(efectivo_recibido))
        if efectivo_recibido < efectivo:
            raise ValidationError("El efectivo recibido es menor que el pago en efectivo.")
        cambio = efectivo_recibido - efectivo
    else:
        efectivo_recibido = None

    # Turno corto que se reinicia cada día ("¡Turno 14!"); sale de la cola al entregarse
    turno = Consecutivo.siguiente(negocio, f"turno-{timezone.localdate():%Y%m%d}")
    entregado = entregar_ya or not negocio.usa_cola_pedidos
    venta = Venta.objects.create(
        negocio=negocio, numero=Consecutivo.siguiente(negocio, "venta"), sesion_caja=sesion, turno=turno,
        entregado_en=timezone.now() if entregado else None, entregado_por=usuario if entregado else None,
        usuario=usuario, cliente=cliente, subtotal=subtotal, descuento=descuento, total=total,
        costo_total=costo_total.quantize(Decimal("0.01")), saldo_pendiente=saldo,
        estado=Venta.Estado.FIADO if saldo > 0 else Venta.Estado.PAGADA,
        efectivo_recibido=efectivo_recibido, cambio=cambio, nota=nota[:200],
    )

    for p, cant, precio, sub in lineas:
        DetalleVenta.objects.create(venta=venta, producto=p, nombre=p.nombre, cantidad=cant,
                                    precio_unitario=precio, costo_unitario=p.costo, subtotal=sub)
        if p.controla_stock:
            mover_stock(p, cant, MovimientoInventario.Tipo.VENTA, usuario=usuario,
                        referencia=f"Venta #{venta.numero}", validar_stock=negocio.bloquear_sin_stock)

    for medio, monto in pagos_limpios:
        PagoVenta.objects.create(negocio=negocio, venta=venta, medio=medio, monto=monto,
                                 sesion_caja=sesion, usuario=usuario)
        caja.registrar(negocio, Origen.VENTA, monto, medio=medio, concepto=f"Venta #{venta.numero}",
                       referencia=str(venta.id), usuario=usuario, sesion=sesion)
    return venta


@transaction.atomic
def abonar_fiado(negocio, usuario, cliente, monto, medio):
    """Reparte el abono sobre las ventas fiadas más antiguas del cliente."""
    monto = Decimal(str(monto))
    if monto <= 0:
        raise ValidationError("El abono debe ser mayor a cero.")
    if medio not in negocio.medios_pago_activos:
        raise ValidationError("Medio de pago no habilitado.")
    sesion = caja.sesion_abierta(negocio, requerida=negocio.usa_caja)
    pendientes = Venta.objects.select_for_update().filter(
        negocio=negocio, cliente=cliente, estado=Venta.Estado.FIADO).order_by("creado")
    deuda = sum((v.saldo_pendiente for v in pendientes), CERO)
    if monto > deuda:
        raise ValidationError(f"El abono supera la deuda de {cliente.nombre} ({pesos(deuda)}).")

    restante, aplicados = monto, []
    for v in pendientes:
        if restante <= 0:
            break
        aplica = min(restante, v.saldo_pendiente)
        v.saldo_pendiente -= aplica
        if v.saldo_pendiente == 0:
            v.estado = Venta.Estado.PAGADA
        v.save(update_fields=["saldo_pendiente", "estado", "actualizado"])
        PagoVenta.objects.create(negocio=negocio, venta=v, medio=medio, monto=aplica, es_abono=True,
                                 sesion_caja=sesion, usuario=usuario)
        aplicados.append({"venta": v.numero, "abonado": aplica, "saldo_venta": v.saldo_pendiente})
        restante -= aplica

    caja.registrar(negocio, Origen.ABONO_FIADO, monto, medio=medio, concepto=f"Abono fiado {cliente.nombre}",
                   referencia=f"cliente:{cliente.id}", usuario=usuario, sesion=sesion)
    return {"abonado": monto, "aplicado_a": aplicados, "saldo_cliente": deuda - monto}


@transaction.atomic
def anular_venta(negocio, usuario, venta, motivo):
    venta = Venta.objects.select_for_update().get(pk=venta.pk, negocio=negocio)
    if venta.estado == Venta.Estado.ANULADA:
        raise ValidationError("La venta ya está anulada.")
    if not motivo:
        raise ValidationError("Indica el motivo de la anulación.")
    sesion = caja.sesion_abierta(negocio, requerida=negocio.usa_caja)

    for d in venta.detalles.select_related("producto"):
        if d.producto.controla_stock:
            mover_stock(d.producto, d.cantidad, MovimientoInventario.Tipo.ANULACION_VENTA,
                        usuario=usuario, referencia=f"Anula venta #{venta.numero}")
    # Devuelve el dinero recibido (venta + abonos) por el mismo medio
    for pago in venta.pagos.all():
        caja.registrar(negocio, Origen.ANULACION, -pago.monto, medio=pago.medio,
                       concepto=f"Anulación venta #{venta.numero}", referencia=str(venta.id),
                       usuario=usuario, sesion=sesion)

    venta.estado = Venta.Estado.ANULADA
    venta.saldo_pendiente = CERO
    venta.anulada_por = usuario
    venta.motivo_anulacion = motivo[:200]
    venta.save()
    return venta


# ---------- Recibos ----------

def texto_recibo(venta, ancho=32):
    n = venta.negocio
    linea = "-" * ancho
    filas = [n.nombre.upper()[:ancho]]
    if n.nit:
        filas.append(f"NIT {n.nit}")
    if n.direccion:
        filas.append(n.direccion[:ancho])
    filas += [linea, f"Recibo #{venta.numero}" + (f"   TURNO {venta.turno}" if venta.turno else ""),
              timezone.localtime(venta.creado).strftime("%d/%m/%Y %I:%M %p")]
    if venta.cliente:
        filas.append(f"Cliente: {venta.cliente.nombre}"[:ancho])
    filas.append(linea)
    for d in venta.detalles.all():
        cant = d.cantidad.normalize()
        izq = f"{cant:f} {d.nombre}"
        der = pesos(d.subtotal)
        filas.append(f"{izq[:ancho - len(der) - 1]:<{ancho - len(der)}}{der}")
    filas.append(linea)

    def total(etq, valor):
        v = pesos(valor)
        return f"{etq:<{ancho - len(v)}}{v}"

    if venta.descuento:
        filas += [total("Subtotal", venta.subtotal), total("Descuento", -venta.descuento)]
    filas.append(total("TOTAL", venta.total))
    for p in venta.pagos.filter(es_abono=False):
        filas.append(total(p.get_medio_display(), p.monto))
    if venta.cambio:
        filas.append(total("Cambio", venta.cambio))
    if venta.saldo_pendiente:
        filas.append(total("SALDO PENDIENTE", venta.saldo_pendiente))
    if venta.estado == Venta.Estado.ANULADA:
        filas.append("*** VENTA ANULADA ***")
    filas += [linea, "Documento no fiscal", n.mensaje_recibo[:ancho] if n.mensaje_recibo else ""]
    return "\n".join(filas)


def link_recibo(venta):
    from django.conf import settings
    return f"{settings.FRONTEND_URL.rstrip('/')}/r/{venta.token_publico}"


def whatsapp_recibo(venta, telefono=None):
    tel = telefono or (venta.cliente.telefono if venta.cliente else "")
    texto = (f"Hola, este es tu recibo #{venta.numero} de {venta.negocio.nombre} "
             f"por {pesos(venta.total)}: {link_recibo(venta)}")
    return link_whatsapp(tel, texto)


def whatsapp_recordatorio_fiado(cliente, negocio):
    texto = (f"Hola {cliente.nombre}, te saludamos de {negocio.nombre}. "
             f"Te recordamos que tienes un saldo pendiente de {pesos(cliente.saldo_pendiente)}. ¡Gracias!")
    return link_whatsapp(cliente.telefono, texto)
