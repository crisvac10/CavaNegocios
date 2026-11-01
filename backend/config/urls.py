from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from caja.views import CajaViewSet
from catalogo.views import CategoriaViewSet, ProductoViewSet
from creditos.views import CreditoViewSet, TasaUsuraViewSet
from gastos.views import CategoriaGastoViewSet, CompraViewSet, GastoViewSet, ProveedorViewSet
from inventario.views import MovimientoViewSet
from reportes.views import ReportesViewSet
from saas.views import NegociosSaasViewSet
from usuarios import views as u
from catalogo.views import menu_publico
from ventas.views import ClienteViewSet, PedidoViewSet, VentaViewSet, recibo_publico

router = DefaultRouter()
router.register("categorias", CategoriaViewSet, basename="categoria")
router.register("productos", ProductoViewSet, basename="producto")
router.register("inventario", MovimientoViewSet, basename="inventario")
router.register("clientes", ClienteViewSet, basename="cliente")
router.register("ventas", VentaViewSet, basename="venta")
router.register("pedidos", PedidoViewSet, basename="pedido")
router.register("proveedores", ProveedorViewSet, basename="proveedor")
router.register("categorias-gasto", CategoriaGastoViewSet, basename="categoria-gasto")
router.register("gastos", GastoViewSet, basename="gasto")
router.register("compras", CompraViewSet, basename="compra")
router.register("caja", CajaViewSet, basename="caja")
router.register("reportes", ReportesViewSet, basename="reportes")
router.register("creditos", CreditoViewSet, basename="credito")
router.register("usuarios", u.UsuariosNegocioViewSet, basename="usuario")
router.register("tasas-usura", TasaUsuraViewSet, basename="tasa-usura")
router.register("saas/negocios", NegociosSaasViewSet, basename="saas-negocio")

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", lambda r: JsonResponse({"ok": True})),
    path("api/login/", u.login),
    path("api/logout/", u.logout),
    path("api/yo/", u.yo),
    path("api/mi-negocio/", u.MiNegocioView.as_view()),
    path("api/sistema/", u.catalogos_sistema),
    path("api/public/recibo/<uuid:token>/", recibo_publico),
    path("api/public/menu/<slug:slug>/", menu_publico),
    path("api/", include(router.urls)),
]

if settings.DEBUG:  # en producción las fotos se sirven desde Cloudflare R2
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
