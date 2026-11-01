from django.contrib import admin

from .models import Credito, TasaUsura

admin.site.register(TasaUsura)


@admin.register(Credito)
class CreditoAdmin(admin.ModelAdmin):
    list_display = ("entidad", "negocio", "monto", "cuota_valor", "frecuencia", "estado")
    list_filter = ("estado", "negocio")
