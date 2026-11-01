from django.db.models import Q
from rest_framework import serializers

from negocios.mixins import TenantModelViewSet
from negocios.serializers_base import TenantFKField

from .models import Categoria, Producto


class CategoriaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Categoria
        fields = ["id", "nombre", "orden", "color", "activa"]


class ProductoSerializer(serializers.ModelSerializer):
    categoria = TenantFKField(queryset=Categoria.objects.all(), allow_null=True, required=False)
    categoria_nombre = serializers.CharField(source="categoria.nombre", read_only=True, default=None)
    margen = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    margen_pct = serializers.DecimalField(max_digits=6, decimal_places=1, read_only=True)
    stock_bajo = serializers.BooleanField(read_only=True)

    class Meta:
        model = Producto
        fields = [
            "id", "categoria", "categoria_nombre", "nombre", "codigo", "precio", "costo",
            "margen", "margen_pct", "controla_stock", "stock", "stock_minimo", "unidad",
            "stock_bajo", "activo", "favorito",
        ]
        # El stock solo cambia por movimientos de inventario (trazabilidad).
        read_only_fields = ["stock"]

    def validate(self, data):
        if data.get("precio") is not None and data["precio"] < 0:
            raise serializers.ValidationError({"precio": "No puede ser negativo."})
        return data


class CategoriaViewSet(TenantModelViewSet):
    queryset = Categoria.objects.all()
    serializer_class = CategoriaSerializer
    modulo = "catalogo"


class ProductoViewSet(TenantModelViewSet):
    queryset = Producto.objects.select_related("categoria")
    serializer_class = ProductoSerializer
    modulo = "catalogo"

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get("q"):
            qs = qs.filter(Q(nombre__icontains=p["q"]) | Q(codigo__iexact=p["q"]))
        if p.get("categoria"):
            qs = qs.filter(categoria_id=p["categoria"])
        if p.get("activos") == "1":
            qs = qs.filter(activo=True)
        return qs

    def perform_create(self, serializer):
        # Stock inicial opcional -> se registra como movimiento de inventario
        from inventario.servicios import mover_stock
        from inventario.models import MovimientoInventario

        stock_inicial = self.request.data.get("stock_inicial")
        producto = serializer.save(negocio=self.negocio)
        if stock_inicial and producto.controla_stock:
            mover_stock(producto, stock_inicial, MovimientoInventario.Tipo.AJUSTE_ENTRADA,
                        usuario=self.request.user, nota="Stock inicial")

    def perform_destroy(self, instancia):
        # Si ya tiene ventas no se borra: se desactiva
        if instancia.detalles_venta.exists():
            instancia.activo = False
            instancia.save(update_fields=["activo"])
        else:
            instancia.delete()
