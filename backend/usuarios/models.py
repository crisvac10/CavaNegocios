from django.contrib.auth.models import AbstractUser
from django.db import models


class Usuario(AbstractUser):
    class Rol(models.TextChoices):
        SUPERADMIN = "SUPERADMIN", "Super Admin CavaTech"
        ADMIN = "ADMIN", "Administrador (dueño)"
        CAJERO = "CAJERO", "Cajero"

    rol = models.CharField(max_length=12, choices=Rol.choices, default=Rol.CAJERO)
    negocio = models.ForeignKey(
        "negocios.Negocio", on_delete=models.CASCADE, null=True, blank=True, related_name="usuarios"
    )
    telefono = models.CharField(max_length=30, blank=True)

    @property
    def es_superadmin(self):
        return self.rol == self.Rol.SUPERADMIN or self.is_superuser

    def __str__(self):
        return f"{self.username} ({self.rol})"
