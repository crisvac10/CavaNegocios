from django.db.models import Q, Sum
from rest_framework.exceptions import PermissionDenied, ValidationError
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action, api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from negocios.mixins import PERMISOS_TENANT, TenantMixin
from negocios.permisos import AdminOSoloLectura, EsAdmin
from negocios.utils import leer_rango, rango_fechas

from . import servicios
from .models import Cliente, DetalleVenta, PagoVenta, Venta


# ---------- Serializers ----------

class ClienteSerializer(serializers.ModelSerializer):
    saldo_pendiente = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = Cliente
        fields = ["id", "nombre", "telefono", "documento", "notas", "cupo_fiado", "activo", "saldo_pendiente"]


class DetalleSerializer(serializers.ModelSerializer):
    class Meta:
        model = DetalleVenta
        fields = ["producto", "nombre", "cantidad", "precio_unitario", "subtotal", "por_conseguir"]


class PagoSerializer(serializers.ModelSerializer):
    class Meta:
        model = PagoVenta
        fields = ["medio", "monto", "es_abono", "creado"]


class VentaSerializer(serializers.ModelSerializer):
    detalles = DetalleSerializer(many=True, read_only=True)
    pagos = PagoSerializer(many=True, read_only=True)
    cliente_nombre = serializers.CharField(source="cliente.nombre", read_only=True, default=None)
    cliente_telefono = serializers.CharField(source="cliente.telefono", read_only=True, default=None)
    usuario = serializers.CharField(source="usuario.username", read_only=True)
    utilidad = serializers.SerializerMethodField()

    class Meta:
        model = Venta
        fields = ["id", "numero", "turno", "mesa", "entregado_en", "estado", "origen", "editada_en", "cliente", "cliente_nombre", "usuario", "subtotal", "descuento",
                  "total", "saldo_pendiente", "efectivo_recibido", "cambio", "nota", "utilidad",
                  "detalles", "pagos", "motivo_anulacion", "token_publico", "creado",
                  "fecha_entrega", "encargado_en", "cliente_telefono"]

    def get_utilidad(self, v):
        # El cajero no ve costos/utilidad
        req = self.context.get("request")
        return v.utilidad if req and req.user.rol == "ADMIN" else None


class ItemEntrada(serializers.Serializer):
    producto = serializers.IntegerField(required=False, allow_null=True)  # vacío = algo personalizado
    nombre = serializers.CharField(required=False, allow_blank=True, max_length=120)
    costo = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)
    cantidad = serializers.DecimalField(max_digits=14, decimal_places=3, default=1)
    precio = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)


class PagoEntrada(serializers.Serializer):
    medio = serializers.CharField()
    monto = serializers.DecimalField(max_digits=14, decimal_places=2)


class VentaEntrada(serializers.Serializer):
    items = ItemEntrada(many=True)
    pagos = PagoEntrada(many=True, required=False, default=list)
    descuento = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, default=0)
    cliente = serializers.IntegerField(required=False, allow_null=True)
    efectivo_recibido = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)
    nota = serializers.CharField(required=False, allow_blank=True, default="")
    entregar_ya = serializers.BooleanField(required=False, default=False)
    registrar = serializers.BooleanField(required=False, default=False)
    mesa = serializers.CharField(required=False, allow_blank=True, default="", max_length=12)
    fecha = serializers.DateField(required=False, allow_null=True)


class CobroEntrada(serializers.Serializer):
    pagos = PagoEntrada(many=True, required=False, default=list)
    cliente = serializers.IntegerField(required=False, allow_null=True)
    efectivo_recibido = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)


class EdicionEntrada(serializers.Serializer):
    items = ItemEntrada(many=True)
    descuento = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)
    nota = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    pagos = PagoEntrada(many=True, required=False, allow_null=True, default=None)
    cliente = serializers.IntegerField(required=False, allow_null=True)
    fecha = serializers.DateField(required=False, allow_null=True)
    efectivo_recibido = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)
    mesa = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=12)


class EncargoEntrada(serializers.Serializer):
    items = ItemEntrada(many=True)
    cliente = serializers.IntegerField()
    fecha_entrega = serializers.DateField()
    pagos = PagoEntrada(many=True, required=False, default=list)  # abono inicial
    descuento = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, default=0)
    nota = serializers.CharField(required=False, allow_blank=True, default="")


class EdicionEncargoEntrada(serializers.Serializer):
    items = ItemEntrada(many=True, required=False)
    cliente = serializers.IntegerField(required=False, allow_null=True)
    fecha_entrega = serializers.DateField(required=False, allow_null=True)
    descuento = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)
    nota = serializers.CharField(required=False, allow_blank=True, allow_null=True)


class DeudaAnteriorEntrada(serializers.Serializer):
    monto = serializers.DecimalField(max_digits=14, decimal_places=2)
    fecha = serializers.DateField(required=False, allow_null=True)
    nota = serializers.CharField(required=False, allow_blank=True, default="")


# ---------- Vistas ----------

class ClienteViewSet(TenantMixin, viewsets.ModelViewSet):
    """Clientes y fiados. Cajero puede crear clientes (para fiar en el POS)."""
    queryset = Cliente.objects.all()
    serializer_class = ClienteSerializer
    modulo = "fiados"

    def get_queryset(self):
        qs = super().get_queryset()
        q = self.request.query_params.get("q")
        if q:
            qs = qs.filter(Q(nombre__icontains=q) | Q(telefono__icontains=q) | Q(documento__icontains=q))
        return qs

    def get_permissions(self):
        if self.action in ("destroy", "update", "partial_update"):
            return [p() for p in PERMISOS_TENANT + [EsAdmin]]
        return super().get_permissions()

    def perform_destroy(self, c):
        if c.ventas.exists():
            c.activo = False
            c.save(update_fields=["activo"])
        else:
            c.delete()

    @action(detail=False)
    def deudores(self, request):
        """Cartera: clientes con saldo pendiente, de mayor a menor."""
        filas = (Venta.objects.filter(negocio=self.negocio, estado=Venta.Estado.FIADO)
                 .values("cliente_id", "cliente__nombre", "cliente__telefono")
                 .annotate(saldo=Sum("saldo_pendiente")).order_by("-saldo"))
        total = sum(f["saldo"] for f in filas)
        return Response({"total_cartera": total, "clientes": [
            {"id": f["cliente_id"], "nombre": f["cliente__nombre"], "telefono": f["cliente__telefono"], "saldo": f["saldo"]}
            for f in filas]})

    @action(detail=True, methods=["post"])
    def abonar(self, request, pk=None):
        res = servicios.abonar_fiado(self.negocio, request.user, self.get_object(),
                                     request.data.get("monto"), request.data.get("medio", "EFECTIVO"))
        return Response(res, status=201)

    @action(detail=True)
    def estado_cuenta(self, request, pk=None):
        c = self.get_object()
        ventas = c.ventas.exclude(estado__in=[Venta.Estado.ANULADA, Venta.Estado.ENCARGO]).prefetch_related("detalles", "pagos")
        return Response({"cliente": ClienteSerializer(c).data,
                         "ventas": VentaSerializer(ventas, many=True, context={"request": request}).data})

    @action(detail=True, methods=["post"], url_path="deuda-anterior", permission_classes=PERMISOS_TENANT + [EsAdmin])
    def deuda_anterior(self, request, pk=None):
        """Lo que el cliente ya debía antes de usar la app (no cuenta como venta)."""
        e = DeudaAnteriorEntrada(data=request.data)
        e.is_valid(raise_exception=True)
        v = servicios.deuda_anterior(self.negocio, request.user, self.get_object(), **e.validated_data)
        return Response(VentaSerializer(v, context={"request": request}).data, status=201)

    @action(detail=True)
    def recordatorio(self, request, pk=None):
        c = self.get_object()
        return Response({"saldo": c.saldo_pendiente,
                         "whatsapp": servicios.whatsapp_recordatorio_fiado(c, self.negocio)})


class VentaViewSet(TenantMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                   mixins.CreateModelMixin, viewsets.GenericViewSet):
    """
    POST /ventas/   {items:[{producto,cantidad,precio?}], pagos:[{medio,monto}], descuento, cliente, efectivo_recibido}
    Las ventas no se editan: se anulan (admin) y quedan en el historial.
    """
    queryset = Venta.objects.select_related("cliente", "usuario").prefetch_related("detalles", "pagos")
    serializer_class = VentaSerializer
    modulo = "pos"

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get("desde") or p.get("hasta"):
            ini, fin = rango_fechas(*leer_rango(self.request))
            qs = qs.filter(creado__gte=ini, creado__lt=fin)
        if p.get("estado"):
            qs = qs.filter(estado=p["estado"])
        elif self.action == "list":
            qs = qs.exclude(estado=Venta.Estado.ENCARGO)  # los encargos sin entregar viven en /encargos/
        if p.get("sesion"):
            qs = qs.filter(sesion_caja_id=p["sesion"])
        if p.get("numero"):
            qs = qs.filter(numero=p["numero"])
        return qs[:300] if self.action == "list" else qs

    def create(self, request, *args, **kwargs):
        e = VentaEntrada(data=request.data)
        e.is_valid(raise_exception=True)
        d = e.validated_data
        cliente = None
        if d.get("cliente"):
            cliente = Cliente.objects.filter(negocio=self.negocio, pk=d["cliente"]).first()
            if not cliente:
                return Response({"cliente": "No existe."}, status=400)
        if d.get("fecha") and request.user.rol != "ADMIN":
            raise PermissionDenied("Solo el administrador registra ventas de días anteriores.")
        venta = servicios.crear_venta(
            self.negocio, request.user, d["items"], d.get("pagos"), d.get("descuento"),
            cliente, d.get("efectivo_recibido"), d.get("nota", ""), d.get("entregar_ya", False),
            registrar=d.get("registrar", False), fecha=d.get("fecha"), mesa=d.get("mesa", ""),
        )
        data = VentaSerializer(venta, context={"request": request}).data
        data["whatsapp_recibo"] = servicios.whatsapp_recibo(venta)
        return Response(data, status=201)

    def _cliente(self, cid):
        if not cid:
            return None
        c = Cliente.objects.filter(negocio=self.negocio, pk=cid).first()
        if not c:
            raise ValidationError({"cliente": "No existe."})
        return c

    def _puede_tocar(self, v, editar=False):
        """
        Pedidos por cobrar: cualquiera del negocio. Un cajero también corrige lo que se cobró hoy
        (ej. el cliente agregó algo). Eliminar lo cobrado o tocar otros días: solo el dueño.
        """
        if self.request.user.rol == "ADMIN" or v.estado == Venta.Estado.ABIERTA:
            return
        if editar and timezone.localdate(v.creado) == timezone.localdate():
            return
        raise PermissionDenied("Solo el administrador puede cambiar una venta ya cobrada de otro día o eliminarla.")

    def _respuesta(self, v, status=200):
        data = VentaSerializer(v, context={"request": self.request}).data
        data["whatsapp_recibo"] = servicios.whatsapp_recibo(v)
        return Response(data, status=status)

    @action(detail=True, methods=["post"])
    def cobrar(self, request, pk=None):
        """Cobra un pedido registrado: {pagos, cliente?, efectivo_recibido?}."""
        e = CobroEntrada(data=request.data)
        e.is_valid(raise_exception=True)
        d = e.validated_data
        v = servicios.cobrar_pedido(self.negocio, request.user, self.get_object(), d.get("pagos"),
                                    self._cliente(d.get("cliente")), d.get("efectivo_recibido"))
        return self._respuesta(v)

    @action(detail=True, methods=["post"])
    def editar(self, request, pk=None):
        v = self.get_object()
        self._puede_tocar(v, editar=True)
        e = EdicionEntrada(data=request.data)
        e.is_valid(raise_exception=True)
        d = e.validated_data
        if d.get("fecha") and request.user.rol != "ADMIN" and str(d["fecha"]) != str(timezone.localdate(v.creado)):
            raise PermissionDenied("Solo el administrador cambia la fecha de una venta.")
        v = servicios.editar_venta(self.negocio, request.user, v, d["items"], d.get("descuento"), d.get("nota"),
                                   d.get("pagos"), self._cliente(d.get("cliente")), d.get("fecha"),
                                   d.get("efectivo_recibido"), d.get("mesa"))
        return self._respuesta(v)

    @action(detail=True, methods=["post"])
    def eliminar(self, request, pk=None):
        """Borra una venta registrada por error (devuelve inventario y saca su dinero de ese día)."""
        v = self.get_object()
        self._puede_tocar(v)
        v = servicios.eliminar_venta(self.negocio, request.user, v, request.data.get("motivo", ""))
        return self._respuesta(v)

    @action(detail=True, methods=["post"], permission_classes=PERMISOS_TENANT + [EsAdmin])
    def anular(self, request, pk=None):
        v = servicios.anular_venta(self.negocio, request.user, self.get_object(), request.data.get("motivo", ""))
        return Response(VentaSerializer(v, context={"request": request}).data)

    @action(detail=True)
    def recibo(self, request, pk=None):
        v = self.get_object()
        return Response({
            "texto": servicios.texto_recibo(v),
            "link": servicios.link_recibo(v),
            "whatsapp": servicios.whatsapp_recibo(v, request.query_params.get("telefono")),
        })

    @action(detail=True)
    def ticket(self, request, pk=None):
        """Texto plano para impresora térmica (58mm=32 col, 80mm=48 col). Lo consume el agente de impresión."""
        ancho = 48 if request.query_params.get("ancho") == "80" else 32
        return HttpResponse(servicios.texto_recibo(self.get_object(), ancho), content_type="text/plain; charset=utf-8")


class PedidoViewSet(TenantMixin, viewsets.GenericViewSet):
    """
    Cola de pedidos: ventas aún no entregadas, de la más antigua a la más nueva.
    GET  /pedidos/                  pendientes
    GET  /pedidos/?estado=entregados   entregados de hoy (para deshacer un toque equivocado)
    POST /pedidos/{id}/entregar/
    POST /pedidos/{id}/deshacer/
    """
    queryset = Venta.objects.select_related("cliente").prefetch_related("detalles")
    modulo = "pedidos"

    def get_queryset(self):
        # Los encargos tienen su propia pantalla (no pasan por la cola de cocina)
        return super().get_queryset().exclude(estado__in=[Venta.Estado.ANULADA, Venta.Estado.ENCARGO])

    @staticmethod
    def _dato(v):
        return {
            "id": v.id, "turno": v.turno, "numero": v.numero, "mesa": v.mesa, "creado": v.creado, "entregado_en": v.entregado_en,
            "cliente": v.cliente.nombre if v.cliente else None, "cliente_id": v.cliente_id, "nota": v.nota,
            "subtotal": v.subtotal, "descuento": v.descuento, "total": v.total, "saldo_pendiente": v.saldo_pendiente,
            "estado_pago": v.estado,
            "items": [{"producto": d.producto_id, "nombre": d.nombre, "cantidad": d.cantidad,
                       "precio_unitario": d.precio_unitario, "subtotal": d.subtotal} for d in v.detalles.all()],
        }

    def list(self, request):
        qs = self.get_queryset()
        if request.query_params.get("estado") == "entregados":
            from negocios.utils import hoy, rango_dia
            ini, fin = rango_dia(hoy())
            qs = qs.filter(entregado_en__gte=ini, entregado_en__lt=fin).order_by("-entregado_en")[:60]
        else:
            qs = qs.filter(Q(entregado_en__isnull=True) | Q(estado=Venta.Estado.ABIERTA)).order_by("creado")[:150]
        return Response([self._dato(v) for v in qs])

    @action(detail=True, methods=["post"])
    def entregar(self, request, pk=None):
        v = self.get_object()
        if v.entregado_en is None:
            v.entregado_en, v.entregado_por = timezone.now(), request.user
            v.save(update_fields=["entregado_en", "entregado_por", "actualizado"])
        return Response(self._dato(v))

    @action(detail=True, methods=["post"])
    def deshacer(self, request, pk=None):
        v = self.get_object()
        v.entregado_en, v.entregado_por = None, None
        v.save(update_fields=["entregado_en", "entregado_por", "actualizado"])
        return Response(self._dato(v))


class EncargoViewSet(TenantMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """
    Encargos (tienda de regalos): se toman con fecha de entrega y abonos, y se cobran al entregarse.
    GET  /encargos/                       por entregar, por fecha de entrega
    GET  /encargos/?estado=entregados     entregados (últimos 100)
    POST /encargos/                       {items, cliente, fecha_entrega, pagos (abono), descuento, nota}
    POST /encargos/{id}/abonar/           {pagos}
    POST /encargos/{id}/entregar/         {pagos (lo que falta), efectivo_recibido}
    POST /encargos/{id}/editar/           {items?, fecha_entrega?, nota?, descuento?, cliente?}
    POST /encargos/{id}/cancelar/         {devolver_abonos, motivo}
    """
    queryset = (Venta.objects.filter(origen=Venta.Origen.ENCARGO)
                .select_related("cliente", "usuario").prefetch_related("detalles", "pagos"))
    serializer_class = VentaSerializer
    modulo = "encargos"

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action != "list":
            return qs
        estado = self.request.query_params.get("estado")
        if estado == "entregados":
            return qs.exclude(estado__in=[Venta.Estado.ENCARGO, Venta.Estado.ANULADA]).order_by("-entregado_en")[:100]
        if estado == "cancelados":
            return qs.filter(estado=Venta.Estado.ANULADA).order_by("-actualizado")[:100]
        return qs.filter(estado=Venta.Estado.ENCARGO).order_by("fecha_entrega", "encargado_en")

    def _cliente(self, cid):
        c = Cliente.objects.filter(negocio=self.negocio, pk=cid).first() if cid else None
        if cid and not c:
            raise ValidationError({"cliente": "No existe."})
        return c

    def _ok(self, v, status=200):
        data = VentaSerializer(v, context={"request": self.request}).data
        data["whatsapp_recibo"] = servicios.whatsapp_recibo(v)
        return Response(data, status=status)

    def list(self, request):
        datos = VentaSerializer(self.get_queryset(), many=True, context={"request": request}).data
        for d, v in zip(datos, self.get_queryset()):
            d["whatsapp_recibo"] = servicios.whatsapp_recibo(v)
        return Response(datos)

    def create(self, request):
        e = EncargoEntrada(data=request.data)
        e.is_valid(raise_exception=True)
        d = e.validated_data
        v = servicios.crear_encargo(self.negocio, request.user, d["items"], self._cliente(d["cliente"]),
                                    d["fecha_entrega"], d.get("pagos"), d.get("descuento"), d.get("nota", ""))
        return self._ok(v, 201)

    @action(detail=True, methods=["post"])
    def abonar(self, request, pk=None):
        e = CobroEntrada(data=request.data)
        e.is_valid(raise_exception=True)
        return self._ok(servicios.abonar_encargo(self.negocio, request.user, self.get_object(), e.validated_data.get("pagos")))

    @action(detail=True, methods=["post"])
    def entregar(self, request, pk=None):
        e = CobroEntrada(data=request.data)
        e.is_valid(raise_exception=True)
        d = e.validated_data
        return self._ok(servicios.entregar_encargo(self.negocio, request.user, self.get_object(),
                                                   d.get("pagos"), d.get("efectivo_recibido")))

    @action(detail=True, methods=["post"])
    def editar(self, request, pk=None):
        e = EdicionEncargoEntrada(data=request.data)
        e.is_valid(raise_exception=True)
        d = e.validated_data
        return self._ok(servicios.editar_encargo(self.negocio, request.user, self.get_object(), d.get("items"),
                                                 d.get("fecha_entrega"), d.get("nota"), d.get("descuento"),
                                                 self._cliente(d.get("cliente"))))

    @action(detail=True, methods=["post"])
    def cancelar(self, request, pk=None):
        v = self.get_object()
        devolver = request.data.get("devolver_abonos", True) not in (False, "false", 0, "0")
        if request.user.rol != "ADMIN" and (v.total - v.saldo_pendiente) > 0:
            raise PermissionDenied("Un encargo con abonos solo lo cancela el administrador.")
        return self._ok(servicios.cancelar_encargo(self.negocio, request.user, v, devolver, request.data.get("motivo", "")))


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def recibo_publico(request, token):
    """Recibo digital que abre el cliente desde el link de WhatsApp (sin login)."""
    v = (Venta.objects.select_related("negocio", "cliente").prefetch_related("detalles", "pagos")
         .filter(token_publico=token).first())
    if not v:
        return Response({"detail": "Recibo no encontrado."}, status=404)
    n = v.negocio
    return Response({
        "negocio": {"nombre": n.nombre, "nit": n.nit, "direccion": n.direccion, "telefono": n.telefono,
                    "logo_url": n.logo_url, "mensaje": n.mensaje_recibo,
                    "color_primario": n.color_primario, "color_acento": n.color_acento},
        "numero": v.numero, "turno": v.turno, "fecha": v.creado, "estado": v.estado,
        "cliente": v.cliente.nombre if v.cliente else None,
        "detalles": DetalleSerializer(v.detalles.all(), many=True).data,
        "subtotal": v.subtotal, "descuento": v.descuento, "total": v.total,
        "pagos": PagoSerializer(v.pagos.filter(es_abono=False) if v.origen != Venta.Origen.ENCARGO else v.pagos.all(), many=True).data,
        "fecha_entrega": v.fecha_entrega, "es_encargo": v.origen == Venta.Origen.ENCARGO,
        "cambio": v.cambio, "saldo_pendiente": v.saldo_pendiente,
        "nota_legal": "Documento no fiscal. No reemplaza la factura electrónica.",
    })
