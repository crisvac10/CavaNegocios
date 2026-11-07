from collections import namedtuple
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


Linea = namedtuple("Linea", "producto cantidad precio subtotal nombre costo")


def _lineas(negocio, items, existentes=()):
    """Valida los productos de una venta y calcula subtotal y costo.
    Un ítem sin `producto` es algo personalizado: lleva `nombre` y `precio` (y `costo` si se sabe).
    `existentes`: ids que ya estaban en la venta (se permiten aunque el producto ya esté inactivo)."""
    if not items:
        raise ValidationError("La venta no tiene productos.")
    ids = [int(i["producto"]) for i in items if i.get("producto")]
    productos = {p.id: p for p in Producto.objects.filter(negocio=negocio, id__in=ids)}
    lineas, subtotal, costo = [], CERO, CERO
    for it in items:
        if it.get("producto"):
            p = productos.get(int(it["producto"]))
            if not p or (not p.activo and p.id not in existentes):
                raise ValidationError("Hay productos que no existen o están inactivos.")
            nombre, costo_u = p.nombre, p.costo
        else:
            p, nombre = None, (it.get("nombre") or "").strip()[:120]
            if not nombre or it.get("precio") in (None, ""):
                raise ValidationError("Lo personalizado necesita una descripción y un precio.")
            costo_u = Decimal(str(it.get("costo") or 0))
            if costo_u < 0:
                raise ValidationError("Costo inválido.")
        cant = Decimal(str(it.get("cantidad", 1)))
        if cant <= 0:
            raise ValidationError(f"Cantidad inválida para {nombre}.")
        precio = Decimal(str(it["precio"])) if it.get("precio") not in (None, "") else p.precio
        if precio < 0:
            raise ValidationError("Precio inválido.")
        sub = (precio * cant).quantize(Decimal("0.01"))
        lineas.append(Linea(p, cant, precio, sub, nombre, costo_u))
        subtotal += sub
        costo += costo_u * cant
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


def _guardar_detalles(venta, lineas, usuario, validar_stock, referencia, encargo=False):
    """Guarda las líneas y descuenta inventario. En un encargo se toma solo lo que hay en stock;
    lo que falta queda 'por conseguir' y se descuenta al entregarlo."""
    for ln in lineas:
        p, cant = ln.producto, ln.cantidad
        tomar, falta = cant, CERO
        if encargo and p and p.controla_stock:
            disponible = max(Producto.objects.get(pk=p.pk).stock, CERO)
            tomar = min(cant, disponible)
            falta = cant - tomar
        DetalleVenta.objects.create(venta=venta, producto=p, nombre=ln.nombre, cantidad=cant, por_conseguir=falta,
                                    precio_unitario=ln.precio, costo_unitario=ln.costo, subtotal=ln.subtotal)
        if p and p.controla_stock and tomar > 0:
            mover_stock(p, tomar, MovimientoInventario.Tipo.VENTA, usuario=usuario,
                        referencia=referencia, validar_stock=validar_stock)


def _devolver_stock(venta, usuario, referencia):
    for d in venta.detalles.select_related("producto"):
        devolver = d.cantidad - d.por_conseguir
        if d.producto and d.producto.controla_stock and devolver > 0:
            mover_stock(d.producto, devolver, MovimientoInventario.Tipo.ANULACION_VENTA,
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
    # Sin cola (tiendas, o si el negocio la apagó) la venta sale entregada de una
    entregado = momento is not None or entregar_ya or not negocio.usa_cola
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


def _totales(venta):
    """Recalcula subtotal, total y costo de una venta a partir de sus líneas."""
    lineas = list(venta.detalles.all())
    venta.subtotal = sum((d.subtotal for d in lineas), CERO)
    venta.costo_total = sum((d.cantidad * d.costo_unitario for d in lineas), CERO)
    venta.total = venta.subtotal - venta.descuento
    venta.saldo_pendiente = venta.total


def _separar(negocio, venta, partes):
    """
    Dividir la cuenta: saca de un pedido por cobrar lo que paga una persona y lo deja como otra venta
    por cobrar (mismo turno y mesa). Devuelve esa venta nueva; el pedido original queda con el resto.
    El descuento se reparte en proporción a lo que se lleva cada parte.
    """
    detalles = {d.id: d for d in venta.detalles.all()}
    tomar = {}
    for p in partes:
        d = detalles.get(int(p["detalle"]))
        cant = Decimal(str(p["cantidad"]))
        if d is None:
            raise ValidationError("Ese producto no está en el pedido.")
        if cant <= 0:
            continue
        tomar[d.id] = tomar.get(d.id, CERO) + cant
        if tomar[d.id] > d.cantidad:
            raise ValidationError(f"El pedido solo tiene {d.cantidad.normalize():f} de {d.nombre}.")
    if not tomar:
        raise ValidationError("Elige lo que paga esta persona.")
    if all(tomar.get(i, CERO) == d.cantidad for i, d in detalles.items()):
        return None  # se lleva todo: no hay nada que dividir

    sub_parte = sum((detalles[i].precio_unitario * c for i, c in tomar.items()), CERO)
    desc_parte = (venta.descuento * sub_parte / venta.subtotal).quantize(Decimal("1")) if venta.subtotal else CERO
    nueva = Venta.objects.create(
        negocio=negocio, numero=Consecutivo.siguiente(negocio, "venta"), sesion_caja=venta.sesion_caja,
        turno=venta.turno, mesa=venta.mesa, nota=venta.nota, usuario=venta.usuario, cliente=venta.cliente,
        entregado_en=venta.entregado_en, entregado_por=venta.entregado_por, estado=Venta.Estado.ABIERTA,
        subtotal=CERO, descuento=min(desc_parte, sub_parte), total=CERO,
    )
    for i, cant in tomar.items():
        d = detalles[i]
        DetalleVenta.objects.create(venta=nueva, producto=d.producto, nombre=d.nombre, cantidad=cant,
                                    precio_unitario=d.precio_unitario, costo_unitario=d.costo_unitario,
                                    subtotal=d.precio_unitario * cant)
        if cant == d.cantidad:
            d.delete()
        else:
            d.cantidad -= cant
            d.subtotal = d.precio_unitario * d.cantidad
            d.save(update_fields=["cantidad", "subtotal"])
    _totales(nueva)
    nueva.save()
    venta.descuento -= nueva.descuento
    _totales(venta)
    venta.save()
    return nueva


@transaction.atomic
def cobrar_pedido(negocio, usuario, venta, pagos, cliente=None, efectivo_recibido=None, partes=None):
    """
    Cobra un pedido registrado (por cobrar). Lo que falte se fía a un cliente.
    Con `partes` (dividir la cuenta) cobra solo esos productos; el resto sigue por cobrar en `venta.resto`.
    """
    venta = Venta.objects.select_for_update(of=("self",)).get(pk=venta.pk, negocio=negocio)
    if venta.estado != Venta.Estado.ABIERTA:
        raise ValidationError("Este pedido ya está cobrado.")
    resto = None
    if partes:
        parte = _separar(negocio, venta, partes)
        if parte is not None:
            resto, venta = venta, parte
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
    venta.resto = resto
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

    if venta.estado == Venta.Estado.ENCARGO:
        raise ValidationError("Los encargos se editan desde Encargos.")
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

    _devolver_stock(venta, usuario, f"Anula venta #{venta.numero}")
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


# ---------- Encargos (tienda de regalos) ----------
# Un encargo es una venta con fecha de entrega. Cada abono entra a la caja del día en que se paga,
# pero la venta cuenta en reportes el día que se entrega (ahí se mueve su fecha a ese día).

def _fecha_entrega(fecha):
    import datetime as dt
    if fecha in (None, ""):
        raise ValidationError("Pon la fecha de entrega del encargo.")
    if isinstance(fecha, str):
        fecha = dt.date.fromisoformat(fecha)
    if fecha < timezone.localdate():
        raise ValidationError("La fecha de entrega no puede ser de un día que ya pasó.")
    return fecha


def _abonar(venta, pagos_limpios, usuario, sesion):
    for medio, monto in pagos_limpios:
        PagoVenta.objects.create(negocio=venta.negocio, venta=venta, medio=medio, monto=monto, es_abono=True,
                                 sesion_caja=sesion, usuario=usuario)
        caja.registrar(venta.negocio, Origen.ABONO_ENCARGO, monto, medio=medio,
                       concepto=f"Abono encargo #{venta.numero}"[:200], referencia=str(venta.id),
                       usuario=usuario, sesion=sesion)


def _encargo(negocio, venta):
    venta = Venta.objects.select_for_update(of=("self",)).get(pk=venta.pk, negocio=negocio)
    if venta.estado != Venta.Estado.ENCARGO:
        raise ValidationError("Este encargo ya se entregó o se canceló.")
    return venta


@transaction.atomic
def crear_encargo(negocio, usuario, items, cliente, fecha_entrega, pagos=None, descuento=0, nota=""):
    if not negocio.tiene_modulo("encargos"):
        raise ValidationError("Este negocio no tiene encargos activos.")
    if not cliente:
        raise ValidationError("Elige o crea el cliente del encargo.")
    fecha_entrega = _fecha_entrega(fecha_entrega)
    lineas, subtotal, costo_total = _lineas(negocio, items)
    descuento = Decimal(str(descuento or 0))
    if descuento < 0 or descuento > subtotal:
        raise ValidationError("Descuento inválido.")
    total = subtotal - descuento
    pagos_limpios, abonado = _pagos(negocio, pagos)
    if abonado > total:
        raise ValidationError(f"El abono ({pesos(abonado)}) supera el total del encargo ({pesos(total)}).")
    sesion = caja.sesion_abierta(negocio, requerida=negocio.usa_caja and abonado > 0)
    venta = Venta.objects.create(
        negocio=negocio, numero=Consecutivo.siguiente(negocio, "venta"), usuario=usuario, cliente=cliente,
        origen=Venta.Origen.ENCARGO, estado=Venta.Estado.ENCARGO, fecha_entrega=fecha_entrega,
        encargado_en=timezone.now(), subtotal=subtotal, descuento=descuento, total=total,
        costo_total=costo_total, saldo_pendiente=total - abonado, nota=nota[:200],
    )
    _guardar_detalles(venta, lineas, usuario, False, f"Encargo #{venta.numero}", encargo=True)
    _abonar(venta, pagos_limpios, usuario, sesion)
    return venta  # si lo pagaron completo, ya cuenta como venta de hoy (se creó hoy)


def _marcar_pagado(venta):
    """Al quedar pagado completo, el encargo pasa a contar como venta del día en que se terminó de pagar."""
    if venta.estado == Venta.Estado.ENCARGO and venta.saldo_pendiente <= 0:
        ahora = timezone.now()
        Venta.objects.filter(pk=venta.pk).update(creado=ahora)
        venta.creado = ahora


@transaction.atomic
def abonar_encargo(negocio, usuario, venta, pagos):
    venta = _encargo(negocio, venta)
    pagos_limpios, monto = _pagos(negocio, pagos)
    if monto <= 0:
        raise ValidationError("El abono debe ser mayor a cero.")
    if monto > venta.saldo_pendiente:
        raise ValidationError(f"El abono supera lo que falta ({pesos(venta.saldo_pendiente)}).")
    sesion = caja.sesion_abierta(negocio, requerida=negocio.usa_caja)
    _abonar(venta, pagos_limpios, usuario, sesion)
    venta.saldo_pendiente -= monto
    venta.save(update_fields=["saldo_pendiente", "actualizado"])
    _marcar_pagado(venta)
    return venta


@transaction.atomic
def editar_encargo(negocio, usuario, venta, items=None, fecha_entrega=None, nota=None, descuento=None, cliente=None):
    """Cambia lo encargado, la fecha o la nota. Lo ya abonado se mantiene."""
    venta = _encargo(negocio, venta)
    abonado = venta.total - venta.saldo_pendiente
    if items is not None:
        existentes = set(venta.detalles.exclude(producto=None).values_list("producto_id", flat=True))
        lineas, subtotal, costo = _lineas(negocio, items, existentes)
        descuento = venta.descuento if descuento is None else Decimal(str(descuento or 0))
        if descuento < 0 or descuento > subtotal:
            raise ValidationError("Descuento inválido.")
        total = subtotal - descuento
        if total < abonado:
            raise ValidationError(f"Ya abonaron {pesos(abonado)}; el encargo no puede quedar en menos.")
        _devolver_stock(venta, usuario, f"Edición encargo #{venta.numero}")
        venta.detalles.all().delete()
        _guardar_detalles(venta, lineas, usuario, False, f"Edición encargo #{venta.numero}", encargo=True)
        venta.subtotal, venta.descuento, venta.total, venta.costo_total = subtotal, descuento, total, costo
        venta.saldo_pendiente = total - abonado
    if fecha_entrega not in (None, ""):
        venta.fecha_entrega = _fecha_entrega(fecha_entrega)
    if nota is not None:
        venta.nota = nota[:200]
    if cliente is not None:
        venta.cliente = cliente
    pagado_antes = Venta.objects.filter(pk=venta.pk, saldo_pendiente__lte=0).exists()
    venta.editada_en, venta.editada_por = timezone.now(), usuario
    venta.save()
    if not pagado_antes:  # quitaron cosas y lo abonado ya cubre todo
        _marcar_pagado(venta)
    return venta


@transaction.atomic
def entregar_encargo(negocio, usuario, venta, pagos=None, efectivo_recibido=None):
    """Entrega el encargo: cobra lo que falte (o lo deja fiado al cliente) y desde hoy cuenta como venta."""
    venta = _encargo(negocio, venta)
    ya_pagado = venta.saldo_pendiente <= 0  # ya contó como venta el día que lo terminaron de pagar
    sesion = caja.sesion_abierta(negocio, requerida=negocio.usa_caja and not ya_pagado)
    pagos_limpios, pagado = _pagos(negocio, pagos)
    if pagado > venta.saldo_pendiente:
        raise ValidationError(f"Solo faltan {pesos(venta.saldo_pendiente)}. El cambio se calcula con el efectivo recibido.")
    saldo = venta.saldo_pendiente - pagado
    _validar_saldo(negocio, saldo, venta.cliente)
    # Lo que no había al tomar el encargo sale ahora del inventario
    for d in venta.detalles.select_related("producto").filter(por_conseguir__gt=0):
        if d.producto and d.producto.controla_stock:
            mover_stock(d.producto, d.por_conseguir, MovimientoInventario.Tipo.VENTA, usuario=usuario,
                        referencia=f"Entrega encargo #{venta.numero}", validar_stock=negocio.bloquear_sin_stock)
        d.por_conseguir = CERO
        d.save(update_fields=["por_conseguir"])
    _cobrar(venta, pagos_limpios, usuario, None, sesion)
    ahora = timezone.now()
    venta.efectivo_recibido, venta.cambio = _cambio(pagos_limpios, efectivo_recibido)
    venta.saldo_pendiente = saldo
    venta.estado = Venta.Estado.FIADO if saldo > 0 else Venta.Estado.PAGADA
    venta.entregado_en, venta.entregado_por = ahora, usuario
    if not ya_pagado:
        venta.sesion_caja = sesion
    venta.save()
    if not ya_pagado:
        Venta.objects.filter(pk=venta.pk).update(creado=ahora)  # con saldo: cuenta como venta del día de entrega
        venta.creado = ahora
    return venta


@transaction.atomic
def cancelar_encargo(negocio, usuario, venta, devolver_abonos=True, motivo=""):
    """Cancela el encargo y devuelve el inventario. Lo abonado se devuelve hoy (sale de la caja)
    o, si el cliente lo pierde, se queda como ingreso."""
    venta = _encargo(negocio, venta)
    _devolver_stock(venta, usuario, f"Cancela encargo #{venta.numero}")
    abonado = venta.total - venta.saldo_pendiente
    if devolver_abonos and abonado > 0:
        sesion = caja.sesion_abierta(negocio, requerida=negocio.usa_caja)
        for pago in venta.pagos.all():
            caja.registrar(negocio, Origen.ANULACION, -pago.monto, medio=pago.medio,
                           concepto=f"Devolución encargo #{venta.numero}", referencia=str(venta.id),
                           usuario=usuario, sesion=sesion)
    venta.estado, venta.saldo_pendiente = Venta.Estado.ANULADA, CERO
    venta.anulada_por = usuario
    venta.motivo_anulacion = (motivo or "Encargo cancelado")[:200] + ("" if devolver_abonos or not abonado else " (abono no devuelto)")
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
    es_encargo = venta.origen == Venta.Origen.ENCARGO
    for p in (venta.pagos.all() if es_encargo else venta.pagos.filter(es_abono=False)):
        etq = f"Abono {timezone.localtime(p.creado):%d/%m}" if p.es_abono else p.get_medio_display()
        filas.append(total(etq[:ancho - 12], p.monto))
    if es_encargo and venta.fecha_entrega:
        filas.append(f"Entrega: {venta.fecha_entrega:%d/%m/%Y}")
    if venta.cambio:
        filas.append(total("Cambio", venta.cambio))
    if venta.saldo_pendiente:
        filas.append(total("FALTA POR PAGAR" if venta.estado == Venta.Estado.ENCARGO else "SALDO PENDIENTE", venta.saldo_pendiente))
    if venta.estado == Venta.Estado.ANULADA:
        filas.append("*** VENTA ANULADA ***")
    filas += [linea, "Documento no fiscal", n.mensaje_recibo[:ancho] if n.mensaje_recibo else ""]
    return "\n".join(filas)


def link_recibo(venta):
    from django.conf import settings
    return f"{settings.FRONTEND_URL.rstrip('/')}/r/{venta.token_publico}"


def whatsapp_recibo(venta, telefono=None):
    tel = telefono or (venta.cliente.telefono if venta.cliente else "")
    if venta.estado == Venta.Estado.ENCARGO:
        abonado = venta.total - venta.saldo_pendiente
        texto = (f"Hola, te confirmamos tu encargo #{venta.numero} en {venta.negocio.nombre} para el "
                 f"{venta.fecha_entrega:%d/%m/%Y}. Total {pesos(venta.total)}, abonado {pesos(abonado)}, "
                 f"falta {pesos(venta.saldo_pendiente)}: {link_recibo(venta)}")
    else:
        texto = (f"Hola, este es tu recibo #{venta.numero} de {venta.negocio.nombre} "
                 f"por {pesos(venta.total)}: {link_recibo(venta)}")
    return link_whatsapp(tel, texto)


def whatsapp_recordatorio_fiado(cliente, negocio):
    texto = (f"Hola {cliente.nombre}, te saludamos de {negocio.nombre}. "
             f"Te recordamos que tienes un saldo pendiente de {pesos(cliente.saldo_pendiente)}. ¡Gracias!")
    return link_whatsapp(cliente.telefono, texto)
