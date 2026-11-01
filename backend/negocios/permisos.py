from rest_framework.permissions import BasePermission, SAFE_METHODS


def _rol(request):
    return getattr(request.user, "rol", None)


class NegocioActivo(BasePermission):
    """Bloquea a usuarios de negocios suspendidos (el Super Admin siempre pasa)."""
    message = "El negocio está suspendido. Comunícate con CavaTech."

    def has_permission(self, request, view):
        u = request.user
        if not u or not u.is_authenticated:
            return True  # lo resuelve IsAuthenticated / AllowAny
        if u.es_superadmin:
            return True
        return bool(u.negocio_id and u.negocio.activo)


class EsSuperAdmin(BasePermission):
    message = "Solo el Super Admin de CavaTech."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.es_superadmin)


class EsAdmin(BasePermission):
    message = "Solo el administrador del negocio."

    def has_permission(self, request, view):
        return _rol(request) == "ADMIN"


class AdminOSoloLectura(BasePermission):
    """Cajero puede consultar; solo el admin crea/edita/borra."""
    message = "Solo el administrador puede modificar esto."

    def has_permission(self, request, view):
        return request.method in SAFE_METHODS or _rol(request) == "ADMIN"


class TieneNegocio(BasePermission):
    message = "Tu usuario no pertenece a ningún negocio."

    def has_permission(self, request, view):
        return bool(getattr(request.user, "negocio_id", None))


class ModuloActivo(BasePermission):
    """La vista declara `modulo = "creditos"` y solo responde si el plan lo incluye."""
    message = "Este módulo no está activo en tu plan."

    def has_permission(self, request, view):
        modulo = getattr(view, "modulo", None)
        if not modulo:
            return True
        negocio = getattr(request.user, "negocio", None)
        return bool(negocio and negocio.tiene_modulo(modulo))
