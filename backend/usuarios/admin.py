from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import Usuario


@admin.register(Usuario)
class UsuarioAdmin(UserAdmin):
    list_display = ("username", "rol", "negocio", "is_active")
    list_filter = ("rol", "negocio")
    fieldsets = UserAdmin.fieldsets + (("CavaNegocios", {"fields": ("rol", "negocio", "telefono")}),)
