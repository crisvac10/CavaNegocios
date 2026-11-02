from django.db.models import Q
from rest_framework import serializers
from rest_framework.decorators import action, api_view, authentication_classes, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from negocios import almacenamiento
from negocios.models import Negocio

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
            "id", "categoria", "categoria_nombre", "nombre", "codigo", "descripcion", "foto_url", "precio", "costo",
            "margen", "margen_pct", "controla_stock", "stock", "stock_minimo", "unidad",
            "stock_bajo", "activo", "favorito", "en_menu",
        ]
        # El stock solo cambia por movimientos de inventario (trazabilidad).
        read_only_fields = ["stock", "foto_url"]

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
            almacenamiento.borrar(instancia.foto_url)
            instancia.delete()

    @action(detail=True, methods=["post", "delete"], parser_classes=[MultiPartParser, FormParser, JSONParser])
    def foto(self, request, pk=None):
        """POST multipart {foto}: sube/reemplaza. DELETE: quita la foto."""
        p = self.get_object()
        anterior = p.foto_url
        if request.method == "DELETE":
            p.foto_url = ""
        else:
            archivo = request.FILES.get("foto")
            if not archivo:
                raise ValidationError({"foto": "Adjunta una imagen."})
            p.foto_url = almacenamiento.subir_imagen(
                archivo, f"negocios/{self.negocio.id}/productos", request)
        p.save(update_fields=["foto_url", "actualizado"])
        almacenamiento.borrar(anterior)
        return Response(ProductoSerializer(p, context=self.get_serializer_context()).data)


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def menu_publico(request, slug):
    """Menú digital del negocio (lo abre el cliente escaneando el QR). Solo lectura."""
    n = Negocio.objects.filter(slug=slug, activo=True).first()
    if not n or not n.tiene_modulo("menu"):
        return Response({"detail": "Menú no disponible."}, status=404)
    productos = (Producto.objects.filter(negocio=n, activo=True, en_menu=True)
                 .select_related("categoria").order_by("-favorito", "nombre"))
    secciones, sin_categoria = {}, []
    for c in Categoria.objects.filter(negocio=n, activa=True):
        secciones[c.id] = {"id": c.id, "nombre": c.nombre, "productos": []}
    for p in productos:
        item = {"id": p.id, "nombre": p.nombre, "descripcion": p.descripcion, "precio": p.precio,
                "foto_url": p.foto_url or None, "destacado": p.favorito,
                "agotado": p.controla_stock and p.stock <= 0}
        if p.categoria_id in secciones:
            secciones[p.categoria_id]["productos"].append(item)
        elif not p.categoria_id:
            sin_categoria.append(item)
    categorias = [s for s in secciones.values() if s["productos"]]
    if sin_categoria:
        categorias.append({"id": None, "nombre": "Otros", "productos": sin_categoria})
    return Response({
        "negocio": {"nombre": n.nombre, "logo_url": n.logo_url or None, "direccion": n.direccion,
                    "telefono": n.telefono, "tipo": n.get_tipo_display(),
                    "color_primario": n.color_primario, "color_acento": n.color_acento},
        "categorias": categorias,
        "nota": "Precios en pesos colombianos. Pide en caja.",
    })
