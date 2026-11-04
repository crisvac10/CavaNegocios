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
from negocios.utils import CERO, link_whatsapp, momento_en, pesos

from .models import Cliente, DetalleVenta, PagoVenta, Venta

Origen = MovimientoCaja.Origen


def _lineas(negocio, items, existentes=()):
    """Valida los productos de una venta y calcula subtotal y costo.
    `existentes`: ids que ya estaban en la venta (se permiten aunque el producto ya esté inactivo)."""
    if not items:
        raise ValidationError("La venta no tiene productos.")
    ids = [int(i["producto"]) for i in items]
    productos = {p.id: p for p in Producto.objects.filter(negocio=negocio, id__in=ids)}
    lineas, subtotal, costo = [], CERO, CERO
    for it in items:
        p = productos.get(int(it["producto"]))
        if not p or (not p.activo and p.id not in existentes):
            raise ValidationError("Hay productos que no existen o están inactivos.")
        cant = Decimal(str(it.get("cantidad", 1)))
        if cant <= 0:
            raise ValidationError(f"Cantidad inválida para {p.nombre}.")
        precio = Decimal(str(it["precio"])) if it.get("precio") not in (None, "") else p.precio
        if precio < 0:
            raise ValidationError("Precio inválido.")
        sub = (precio * cant).quantize(Decimal("0.01"))
        lineas.append((p, cant, precio, sub))
        subtotal += sub
        costo += p.costo * cant
    return lineas, subtotal, costo.quantize(Decimal("0.01"))


def _pagos(negocio, pagos):
    medios_ok = set(negocio.medios_pago_activos)
    limpios = []
    for pg in pagos or []:
        monto = Decimal(str(pg.get("monto", 0)))
        if monto <= 0:
            continue
        if pg.get("medio") not in medios_ok:
            raise ValidationError(f"Medio de pago no habilitado: {pg.get('medio')}")
        limpios.append((pg["medio"], monto))
    return limpios, sum((m for _, m in limpios), CERO)


def _validar_saldo(negocio, saldo, cliente, venta_actual=None):
    if saldo <= 0:
        return
    if not negocio.permitir_fiado:
        raise ValidationError(f"Faltan {pesos(saldo)} por pagar y el negocio no permite fiados.")
    if not cliente:
        raise ValidationError(f"Faltan {pesos(saldo)}. Para fiar, selecciona un cliente.")
    previo = cliente.saldo_pendiente - (venta_actual.saldo_pendiente if venta_actual and venta_actual.cliente_id == cliente.id
                                         and venta_actual.estado == Venta.Estado.FIADO else CERO)
    if cliente.cupo_fiado and previo + saldo > cliente.cupo_fiado:
        raise ValidationError(f"{cliente.nombre} supera su cupo de fiado ({pesos(cliente.cupo_fiado)}).")


def _cambio(pagos_limpios, efectivo_recibido):
    efectivo = sum((m for med, m in pagos_limpios if med == MedioPago.EFECTIVO), CERO)
    if efectivo_recibido in (None, ""):
        return None, CERO
    efectivo_recibido = Decimal(str(efectivo_recibido))
    if efectivo_recibido < efectivo:
        raise ValidationError("El efectivo recibido es menor que el pago en efectivo.")
    return efectivo_recibido, efectivo_recibido - efectivo


def _guardar_detalles(venta, lineas, usuario, validar_stock, referencia):
    for p, cant, precio, sub in lineas:
        DetalleVenta.objects.create(venta=venta, producto=p, nombre=p.nombre, cantidad=cant,
                                    precio_unitario=precio, costo_unitario=p.costo, subtotal=sub)
        if p.controla_stock:
            mover_stock(p, cant, MovimientoInventario.Tipo.VENTA, usuario=usuario,
                        referencia=referencia, validar_stock=validar_stock)


def _devolver_stock(venta, usuario, referencia):
    for d in venta.detalles.select_related("producto"):
        if d.producto.controla_stock:
            mover_stock(d.producto, d.cantidad, MovimientoInventario.Tipo.ANULACION_VENTA,
                        usuario=usuario, referencia=referencia)


def _cobrar(venta, pagos_limpios, usuario, momento=None, sesion=None):
    """Registra los pagos de una venta y su dinero en el libro (en el día de `momento`)."""
    for medio, monto in pagos_limpios:
        pago = PagoVenta.objects.create(negocio=venta.negocio, venta=venta, medio=medio, monto=monto,
                                        sesion_caja=sesion, usuario=usuario)
        if momento is not None:
            PagoVenta.objects.filter(pk=pago.pk).update(creado=momento)
        caja.registrar(venta.negocio, Origen.VENTA, monto, medio=medio, concepto=f"Venta #{venta.numero}",
                       referencia=str(venta.id), usuario=usuario, sesion=sesion, momento=momento)


def _borrar_cobro(venta):
    """Quita los pagos de la venta (no los abonos de fiado) y su dinero del libro."""
    MovimientoCaja.objects.filter(negocio=venta.negocio, referencia=str(venta.id),
                                  origen__in=[Origen.VENTA, Origen.ANULACION]).delete()
    venta.pagos.filter(es_abono=False).delete()


def _mesa(negocio, mesa):
    """'' (sin mesa), 'LLEVAR' o un número de mesa que exista en el local."""
    mesa = (mesa or "").strip().upper()
    if mesa in ("", "LLEVAR"):
        return mesa
    if not mesa.isdigit() or not 1 <= int(mesa) <= max(negocio.num_mesas, 0):
        raise ValidationError(f"La mesa {mesa} no existe (el local tiene {negocio.num_mesas}).")
    return str(int(mesa))


def _sesion_cerrada(venta):
    return bool(venta.sesion_caja_id and venta.sesion_caja.estado != "ABIERTA")


@transaction.atomic
def crear_venta(negocio, usuario, items, pagos, descuento=0, cliente=None,
                efectivo_recibido=None, nota="", entregar_ya=False, registrar=False, fecha=None, mesa=""):
    """
    items: [{producto: id, cantidad, precio?}]   (precio opcional = precio de lista)
    pagos: [{medio, monto}]  (vacío o parcial si es fiado con cliente)
    registrar=True: pedido POR COBRAR (sin pagos): entra a la cola y se cobra después.
    fecha: día anterior para registrar ventas que no se alcanzaron a poner (no pasan por la cola).
    """
    momento = momento_en(fecha)
    if momento is not None and registrar:
        raise ValidationError("Una venta de un día anterior se registra ya cobrada (o fiada), no por cobrar.")
    sesion = None if momento is not None else caja.sesion_abierta(negocio, requerida=negocio.usa_caja and not registrar)
    lineas, subtotal, costo_total = _lineas(negocio, items)
    descuento = Decimal(str(descuento or 0))
    if descuento < 0 or descuento > subtotal:
        raise ValidationError("Descuento inválido.")
    total = subtotal - descuento

    pagos_limpios, pagado = ([], CERO) if registrar else _pagos(negocio, pagos)
    if pagado > total:
        raise ValidationError("Los pagos superan el total. El cambio se calcula con 'efectivo_recibido'.")
    saldo = total - pagado
    if not registrar:
        _validar_saldo(negocio, saldo, cliente)
    efectivo_recibido, cambio = (None, CERO) if registrar else _cambio(pagos_limpios, efectivo_recibido)

    # Turno corto que se reinicia cada día ("¡Turno 14!"); sale de la cola al entregarse
    turno = None if momento is not None else Consecutivo.siguiente(negocio, f"turno-{timezone.localdate():%Y%m%d}")
    entregado = momento is not None or entregar_ya or not negocio.usa_cola_pedidos
    estado = Venta.Estado.ABIERTA if registrar else (Venta.Estado.FIADO if saldo > 0 else Venta.Estado.PAGADA)
    venta = Venta.objects.create(
        negocio=negocio, numero=Consecutivo.siguiente(negocio, "venta"), sesion_caja=sesion, turno=turno,
        entregado_en=(momento or timezone.now()) if entregado else None, entregado_por=usuario if entregado else None,
        usuario=usuario, cliente=cliente, subtotal=subtotal, descuento=descuento, total=total,
        costo_total=costo_total, saldo_pendiente=saldo, estado=estado,
        efectivo_recibido=efectivo_recibido, cambio=cambio, nota=nota[:200], mesa=_mesa(negocio, mesa),
    )
    if momento is not None:
        Venta.objects.filter(pk=venta.pk).update(creado=momento)
        venta.creado = momento
    _guardar_detalles(venta, lineas, usuario, negocio.bloquear_sin_stock, f"Venta #{venta.numero}")
    _cobrar(venta, pagos_limpios, usuario, momento, sesion)
    return venta


@transaction.atomic
def cobrar_pedido(negocio, usuario, venta, pagos, cliente=None, efectivo_recibido=None):
    """Cobra un pedido registrado (por cobrar). Lo que falte se fía a un cliente."""
    venta = Venta.objects.select_for_update().get(pk=venta.pk, negocio=negocio)
    if venta.estado != Venta.Estado.ABIERTA:
        raise ValidationError("Este pedido ya está cobrado.")
    sesion = caja.sesion_abierta(negocio, requerida=negocio.usa_caja)
    pagos_limpios, pagado = _pagos(negocio, pagos)
    if pagado > venta.total:
        raise ValidationError("Los pagos superan el total. El cambio se calcula con 'efectivo_recibido'.")
    saldo = venta.total - pagado
    cliente = cliente or venta.cliente
    _validar_saldo(negocio, saldo, cliente)
    venta.efectivo_recibido, venta.cambio = _cambio(pagos_limpios, efectivo_recibido)
    venta.cliente, venta.saldo_pendiente = cliente, saldo
    venta.estado = Venta.Estado.FIADO if saldo > 0 else Venta.Estado.PAGADA
    venta.save()
    _cobrar(venta, pagos_limpios, usuario, None, sesion)
    return venta


@transaction.atomic
def editar_venta(negocio, usuario, venta, items, descuento=None, nota=None, pagos=None, cliente=None,
                 fecha=None, efectivo_recibido=None, mesa=None):
    """
    Corrige una venta: productos, descuento, nota y (si ya estaba cobrada) cómo se pagó y su fecha.
    El inventario se ajusta con la diferencia y el dinero queda en el día de la venta.
    """
    venta = Venta.objects.select_for_update(of=("self",)).select_related("sesion_caja").get(pk=venta.pk, negocio=negocio)
    if venta.estado == Venta.Estado.ANULADA:
        raise ValidationError("La venta está eliminada.")
    if venta.origen == Venta.Origen.SALDO_ANTERIOR:
        raise ValidationError("Una deuda anterior no tiene productos: corrígela desde Fiados.")
    if venta.pagos.filter(es_abono=True).exists():
        raise ValidationError("Esta venta ya tiene abonos de fiado; no se puede editar. Elimínala y regístrala de nuevo.")
    abierta = venta.estado == Venta.Estado.ABIERTA
    if not abierta and _sesion_cerrada(venta):
        raise ValidationError("La caja de esa venta ya se cerró; su dinero no se puede cambiar.")

    existentes = set(venta.detalles.values_list("producto_id", flat=True))
    lineas, subtotal, costo = _lineas(negocio, items, existentes)
    descuento = venta.descuento if descuento is None else Decimal(str(descuento or 0))
    if descuento < 0 or descuento > subtotal:
        raise ValidationError("Descuento inválido.")
    total = subtotal - descuento

    if fecha not in (None, ""):
        momento = momento_en(fecha) or timezone.now()
        if timezone.localtime(momento).date() != timezone.localtime(venta.creado).date():
            venta.creado = momento
    momento_dinero = venta.creado if timezone.localtime(venta.creado).date() < timezone.localdate() else None

    pagos_limpios, pagado = [], CERO
    if not abierta:
        if pagos is None:  # mismos medios; si cambió el total, se ajusta el pago en proporción al único medio
            actuales = list(venta.pagos.filter(es_abono=False).values_list("medio", "monto"))
            if len(actuales) == 1 and venta.saldo_pendiente == 0:
                pagos = [{"medio": actuales[0][0], "monto": total}]
            else:
                pagos = [{"medio": m, "monto": v} for m, v in actuales]
        pagos_limpios, pagado = _pagos(negocio, pagos)
        if pagado > total:
            raise ValidationError(f"Los pagos ({pesos(pagado)}) superan el nuevo total ({pesos(total)}).")
        cliente = cliente or venta.cliente
        _validar_saldo(negocio, total - pagado, cliente, venta)
        venta.cliente = cliente

    _devolver_stock(venta, usuario, f"Edición venta #{venta.numero}")
    venta.detalles.all().delete()
    _guardar_detalles(venta, lineas, usuario, False, f"Edición venta #{venta.numero}")
    if not abierta:
        _borrar_cobro(venta)
        _cobrar(venta, pagos_limpios, usuario, momento_dinero, None if momento_dinero else venta.sesion_caja)
        venta.efectivo_recibido, venta.cambio = _cambio(pagos_limpios, efectivo_recibido)
        venta.estado = Venta.Estado.FIADO if total - pagado > 0 else Venta.Estado.PAGADA

    venta.subtotal, venta.descuento, venta.total, venta.costo_total = subtotal, descuento, total, costo
    venta.saldo_pendiente = total - pagado
    if nota is not None:
        venta.nota = nota[:200]
    if mesa is not None:
        venta.mesa = _mesa(negocio, mesa)
    venta.editada_en, venta.editada_por = timezone.now(), usuario
    venta.save()
    Venta.objects.filter(pk=venta.pk).update(creado=venta.creado)  # creado es auto_now_add
    return venta


@transaction.atomic
def eliminar_venta(negocio, usuario, venta, motivo=""):
    """
    Borra una venta registrada por error: devuelve el inventario y saca su dinero del día en que
    se vendió (como si nunca hubiera pasado). Queda en el historial marcada como eliminada.
    Para una devolución real de hoy con caja registradora, usa anular_venta.
    """
    venta = Venta.objects.select_for_update(of=("self",)).select_related("sesion_caja").get(pk=venta.pk, negocio=negocio)
    if venta.estado == Venta.Estado.ANULADA:
        raise ValidationError("La venta ya está eliminada.")
    if venta.pagos.filter(es_abono=True).exists():
        raise ValidationError("Esta venta tiene abonos de fiado. Ve a Fiados para corregirlos primero.")
    if venta.estado != Venta.Estado.ABIERTA and _sesion_cerrada(venta):
        raise ValidationError("La caja de esa venta ya se cerró. Anúlala hoy para registrar la devolución.")
    _devolver_stock(venta, usuario, f"Elimina venta #{venta.numero}")
    _borrar_cobro(venta)
    venta.estado, venta.saldo_pendiente = Venta.Estado.ANULADA, CERO
    venta.anulada_por, venta.motivo_anulacion = usuario, (motivo or "Registrada por error")[:200]
    venta.entregado_en = venta.entregado_en or timezone.now()
    venta.save()
    return venta


@transaction.atomic
def deuda_anterior(negocio, usuario, cliente, monto, fecha=None, nota=""):
    """Fiado que el cliente ya debía antes de usar la app: suma a su cartera pero NO es una venta."""
    monto = Decimal(str(monto or 0))
    if monto <= 0:
        raise ValidationError("El monto debe ser mayor a cero.")
    momento = momento_en(fecha)
    venta = Venta.objects.create(
        negocio=negocio, numero=Consecutivo.siguiente(negocio, "venta"), usuario=usuario, cliente=cliente,
        origen=Venta.Origen.SALDO_ANTERIOR, estado=Venta.Estado.FIADO, subtotal=monto, total=monto,
        saldo_pendiente=monto, entregado_en=momento or timezone.now(), entregado_por=usuario,
        nota=(nota or "Deuda anterior")[:200],
    )
    if momento is not None:
        Venta.objects.filter(pk=venta.pk).update(creado=momento)
        venta.creado = momento
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
