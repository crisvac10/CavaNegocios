from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from .permisos import AdminOSoloLectura, ModuloActivo, NegocioActivo, TieneNegocio

PERMISOS_TENANT = [IsAuthenticated, NegocioActivo, TieneNegocio, ModuloActivo]


class TenantMixin:
    """
    Aislamiento multi-tenant: toda consulta se filtra por el negocio del usuario
    y todo registro nuevo queda asignado a ese negocio. Nunca se confía en un
    negocio_id que venga del cliente.
    """
    permission_classes = PERMISOS_TENANT
    modulo = None

    @property
    def negocio(self):
        return self.request.user.negocio

    def get_queryset(self):
        return super().get_queryset().filter(negocio=self.negocio)

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if self.request and self.request.user.is_authenticated:
            ctx["negocio"] = self.request.user.negocio
        return ctx

    def perform_create(self, serializer):
        serializer.save(negocio=self.negocio)


class TenantModelViewSet(TenantMixin, viewsets.ModelViewSet):
    """CRUD tenant: cajero lee, admin escribe."""
    permission_classes = PERMISOS_TENANT + [AdminOSoloLectura]
