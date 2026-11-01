from django.db.models import F, Sum
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from catalogo.models import Producto
from negocios.mixins import PERMISOS_TENANT, TenantMixin
from negocios.permisos import AdminOSoloLectura
from negocios.serializers_base import TenantFKField

from .models import MovimientoInventario
from .servicios import mover_stock

T = MovimientoInventario.Tipo
TIPOS_AJUSTE = [T.AJUSTE_ENTRADA, T.AJUSTE_SALIDA, T.CONSUMO_INTERNO, T.MERMA]


class MovimientoSerializer(serializers.ModelSerializer):
    producto = TenantFKField(queryset=Producto.objects.all())
    producto_nombre = serializers.CharField(source="producto.nombre", read_only=True)
    usuario_nombre = serializers.CharField(source="usuario.username", read_only=True, default=None)
    cantidad = serializers.DecimalField(max_digits=14, decimal_places=3)
    tipo = serializers.ChoiceField(choices=T.choices)

    class Meta:
        model = MovimientoInventario
        fields = ["id", "producto", "producto_nombre", "tipo", "cantidad", "stock_resultante",
                  "costo_unitario", "referencia", "nota", "usuario_nombre", "creado"]
        read_only_fields = ["stock_resultante", "costo_unitario", "referencia"]

    def validate(self, data):
        if self.instance is None and data["tipo"] not in TIPOS_AJUSTE:
            raise serializers.ValidationError("Ventas y compras mueven el stock solas; aquí solo ajustes.")
        if data["cantidad"] <= 0:
            raise serializers.ValidationError({"cantidad": "Debe ser positiva; el tipo define si entra o sale."})
        return data


class MovimientoViewSet(TenantMixin, mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    """Kardex + ajustes manuales. Los movimientos no se editan ni se borran."""
    queryset = MovimientoInventario.objects.select_related("producto", "usuario")
    serializer_class = MovimientoSerializer
    permission_classes = PERMISOS_TENANT + [AdminOSoloLectura]
    modulo = "inventario"

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("producto"):
            qs = qs.filter(producto_id=self.request.query_params["producto"])
        return qs[:500]

    def create(self, request, *args, **kwargs):
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        mov = mover_stock(
            s.validated_data["producto"], s.validated_data["cantidad"], s.validated_data["tipo"],
            usuario=request.user, nota=s.validated_data.get("nota", ""),
        )
        return Response(MovimientoSerializer(mov, context=self.get_serializer_context()).data, status=201)

    @action(detail=False)
    def resumen(self, request):
        """Tablero de inventario: valor, productos bajos y agotados."""
        prods = Producto.objects.filter(negocio=self.negocio, activo=True, controla_stock=True)
        bajos = prods.filter(stock__lte=F("stock_minimo"))
        valor = prods.filter(stock__gt=0).aggregate(v=Sum(F("stock") * F("costo")))["v"] or 0
        return Response({
            "productos_controlados": prods.count(),
            "valor_inventario_costo": round(valor, 0),
            "agotados": bajos.filter(stock__lte=0).count(),
            "stock_bajo": [
                {"id": p.id, "nombre": p.nombre, "stock": p.stock, "stock_minimo": p.stock_minimo, "unidad": p.unidad}
                for p in bajos.order_by("stock")
            ],
        })
