from rest_framework import serializers


class TenantFKField(serializers.PrimaryKeyRelatedField):
    """FK que solo acepta objetos del negocio del usuario (evita colarse a otro tenant)."""

    def get_queryset(self):
        qs = super().get_queryset()
        negocio = self.context.get("negocio")
        if negocio is None:
            return qs.none()
        return qs.filter(negocio=negocio)
