from decimal import Decimal

from django.db import transaction
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from caja import servicios as caja
from caja.models import MovimientoCaja
from catalogo.models import Producto
from inventario.models import MovimientoInventario
from inventario.servicios import mover_stock
from negocios.mixins import PERMISOS_TENANT, TenantMixin, TenantModelViewSet
from negocios.models import Consecutivo
from negocios.permisos import EsAdmin
from negocios.serializers_base import TenantFKField
from negocios.utils import CERO, hoy, leer_rango

from .models import CATEGORIAS_GASTO_DEFECTO, CategoriaGasto, Compra, DetalleCompra, Gasto, Proveedor

Origen = MovimientoCaja.Origen


class ProveedorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Proveedor
        fields = ["id", "nombre", "telefono", "nit", "notas", "activo"]


class CategoriaGastoSerializer(serializers.ModelSerializer):
    class Meta:
        model = CategoriaGasto
        fields = ["id", "nombre"]


class GastoSerializer(serializers.ModelSerializer):
    categoria = TenantFKField(queryset=CategoriaGasto.objects.all())
    proveedor = TenantFKField(queryset=Proveedor.objects.all(), allow_null=True, required=False)
    categoria_nombre = serializers.CharField(source="categoria.nombre", read_only=True)
    proveedor_nombre = serializers.CharField(source="proveedor.nombre", read_only=True, default=None)
    fecha = serializers.DateField(required=False)

    class Meta:
        model = Gasto
        fields = ["id", "categoria", "categoria_nombre", "proveedor", "proveedor_nombre", "descripcion",
                  "monto", "fecha", "medio", "pagado_de_caja", "anulado", "creado"]
        read_only_fields = ["anulado"]

    def validate_monto(self, v):
        if v <= 0:
            raise serializers.ValidationError("Debe ser mayor a cero.")
        return v


class DetalleCompraEntrada(serializers.Serializer):
    producto = serializers.IntegerField()
    cantidad = serializers.DecimalField(max_digits=14, decimal_places=3)
    costo_unitario = serializers.DecimalField(max_digits=14, decimal_places=2)


class CompraSerializer(serializers.ModelSerializer):
    proveedor = TenantFKField(queryset=Proveedor.objects.all(), allow_null=True, required=False)
    proveedor_nombre = serializers.CharField(source="proveedor.nombre", read_only=True, default=None)
    detalles = serializers.SerializerMethodField()
    items = DetalleCompraEntrada(many=True, write_only=True)
    fecha = serializers.DateField(required=False)

    class Meta:
        model = Compra
        fields = ["id", "numero", "proveedor", "proveedor_nombre", "fecha", "total", "medio",
                  "pagado_de_caja", "nota", "detalles", "items", "creado"]
        read_only_fields = ["numero", "total"]

    def get_detalles(self, c):
        return [{"producto": d.producto_id, "nombre": d.producto.nombre, "cantidad": d.cantidad,
                 "costo_unitario": d.costo_unitario, "subtotal": d.subtotal}
                for d in c.detalles.select_related("producto")]


class ProveedorViewSet(TenantModelViewSet):
    queryset = Proveedor.objects.all()
    serializer_class = ProveedorSerializer
    modulo = "gastos"


class CategoriaGastoViewSet(TenantModelViewSet):
    queryset = CategoriaGasto.objects.all()
    serializer_class = CategoriaGastoSerializer
    modulo = "gastos"

    def list(self, request, *args, **kwargs):
        if not self.get_queryset().exists():  # crea las categorías por defecto la primera vez
            CategoriaGasto.objects.bulk_create(
                [CategoriaGasto(negocio=self.negocio, nombre=n) for n in CATEGORIAS_GASTO_DEFECTO])
        return super().list(request, *args, **kwargs)


class GastoViewSet(TenantMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                   mixins.CreateModelMixin, viewsets.GenericViewSet):
    """Cajero puede registrar gastos pagados de caja (ej. hielo, domicilio). Solo admin anula."""
    queryset = Gasto.objects.select_related("categoria", "proveedor")
    serializer_class = GastoSerializer
    modulo = "gastos"

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list":
            desde, hasta = leer_rango(self.request, dias_defecto=30)
            qs = qs.filter(fecha__range=(desde, hasta))
        return qs

    @transaction.atomic
    def perform_create(self, serializer):
        fecha = serializer.validated_data.get("fecha") or hoy()
        g = serializer.save(negocio=self.negocio, usuario=self.request.user, fecha=fecha)
        if g.pagado_de_caja:
            caja.registrar(self.negocio, Origen.GASTO, -g.monto, medio=g.medio, concepto=g.descripcion,
                           referencia=f"gasto:{g.id}", usuario=self.request.user)

    @action(detail=True, methods=["post"], permission_classes=PERMISOS_TENANT + [EsAdmin])
    @transaction.atomic
    def anular(self, request, pk=None):
        g = self.get_object()
        if g.anulado:
            raise ValidationError("Ya está anulado.")
        g.anulado = True
        g.save(update_fields=["anulado", "actualizado"])
        if g.pagado_de_caja:
            sesion = caja.sesion_abierta(self.negocio, requerida=False)
            if sesion:  # devuelve el dinero a la caja abierta
                caja.registrar(self.negocio, Origen.GASTO, g.monto, medio=g.medio,
                               concepto=f"Anula gasto: {g.descripcion}", referencia=f"gasto:{g.id}",
                               usuario=request.user, sesion=sesion)
        return Response(GastoSerializer(g, context=self.get_serializer_context()).data)


class CompraViewSet(TenantMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                    mixins.CreateModelMixin, viewsets.GenericViewSet):
    """Compra a proveedor: entra stock y actualiza costo promedio."""
    queryset = Compra.objects.select_related("proveedor")
    serializer_class = CompraSerializer
    permission_classes = PERMISOS_TENANT + [EsAdmin]
    modulo = "gastos"

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        items = d.pop("items")
        if not items:
            raise ValidationError("La compra no tiene productos.")
        productos = {p.id: p for p in Producto.objects.filter(negocio=self.negocio, id__in=[i["producto"] for i in items])}
        compra = Compra.objects.create(negocio=self.negocio, numero=Consecutivo.siguiente(self.negocio, "compra"),
                                       usuario=request.user, fecha=d.pop("fecha", None) or hoy(), **d)
        total = CERO
        for it in items:
            p = productos.get(it["producto"])
            if not p:
                raise ValidationError(f"Producto {it['producto']} no existe.")
            if it["cantidad"] <= 0 or it["costo_unitario"] < 0:
                raise ValidationError("Cantidad o costo inválido.")
            sub = (it["cantidad"] * it["costo_unitario"]).quantize(Decimal("0.01"))
            DetalleCompra.objects.create(compra=compra, producto=p, cantidad=it["cantidad"],
                                         costo_unitario=it["costo_unitario"], subtotal=sub)
            total += sub
            if p.controla_stock:
                mover_stock(p, it["cantidad"], MovimientoInventario.Tipo.COMPRA, usuario=request.user,
                            referencia=f"Compra #{compra.numero}", costo_unitario=it["costo_unitario"])
            else:
                p.costo = it["costo_unitario"]
                p.save(update_fields=["costo"])
        compra.total = total
        compra.save(update_fields=["total"])
        if compra.pagado_de_caja:
            nombre = compra.proveedor.nombre if compra.proveedor else "proveedor"
            caja.registrar(self.negocio, Origen.COMPRA, -total, medio=compra.medio,
                           concepto=f"Compra #{compra.numero} a {nombre}", referencia=f"compra:{compra.id}",
                           usuario=request.user)
        return Response(CompraSerializer(compra, context=self.get_serializer_context()).data, status=201)
