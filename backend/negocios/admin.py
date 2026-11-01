from django.contrib import admin

from .models import Negocio


@admin.register(Negocio)
class NegocioAdmin(admin.ModelAdmin):
    list_display = ("nombre", "tipo", "plan", "activo", "creado")
    list_filter = ("tipo", "plan", "activo")
