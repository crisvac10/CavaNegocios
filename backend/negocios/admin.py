from django.contrib import admin, messages

from .borrado import borrar_negocio, resumen
from .models import Negocio


@admin.register(Negocio)
class NegocioAdmin(admin.ModelAdmin):
    list_display = ("nombre", "slug", "tipo", "plan", "activo", "creado")
    list_filter = ("tipo", "plan", "activo")
    search_fields = ("nombre", "slug", "nit")
    actions = ["suspender", "reactivar"]

    @admin.action(description="Suspender (conserva todo, corta el acceso)")
    def suspender(self, request, queryset):
        from rest_framework.authtoken.models import Token
        n = queryset.update(activo=False)
        Token.objects.filter(user__negocio__in=queryset).delete()
        self.message_user(request, f"{n} negocio(s) suspendido(s).")

    @admin.action(description="Reactivar")
    def reactivar(self, request, queryset):
        self.message_user(request, f"{queryset.update(activo=True)} negocio(s) reactivado(s).")

    # --- Borrado definitivo: todo el negocio, sus usuarios y sus fotos/logo en R2 ---
    def get_deleted_objects(self, objs, request):
        """La página de confirmación muestra el resumen real en lugar de bloquear por las ventas."""
        lista = []
        for n in objs:
            detalle = [f"{cantidad} {nombre}" for nombre, cantidad in resumen(n)]
            lista.append(f"{n.nombre}: " + (", ".join(detalle) or "sin datos") + ", y sus fotos y logo")
        return lista, {"negocios": len(lista)}, set(), []

    def delete_model(self, request, obj):
        borrar_negocio(obj)

    def delete_queryset(self, request, queryset):
        for n in queryset:
            borrar_negocio(n)
        messages.warning(request, "Se borró todo: datos, usuarios, fotos y logo. No se puede deshacer.")
