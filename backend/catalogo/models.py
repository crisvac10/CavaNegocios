from decimal import Decimal

from django.db import models

from negocios.models import TenantModel


class Categoria(TenantModel):
    nombre = models.CharField(max_length=80)
    orden = models.PositiveIntegerField(default=0)
    color = models.CharField(max_length=9, blank=True, help_text="Color del botón en el POS, ej. #C2410C")
    activa = models.BooleanField(default=True)

    class Meta:
        ordering = ["orden", "nombre"]

    def __str__(self):
        return self.nombre


class Producto(TenantModel):
    categoria = models.ForeignKey(Categoria, on_delete=models.SET_NULL, null=True, blank=True, related_name="productos")
    nombre = models.CharField(max_length=120)
    codigo = models.CharField(max_length=40, blank=True, help_text="Código interno o de barras")
    descripcion = models.CharField(max_length=160, blank=True, help_text="Se muestra en el menú digital")
    foto_url = models.URLField(max_length=500, blank=True)
    precio = models.DecimalField(max_digits=14, decimal_places=2)
    costo = models.DecimalField(max_digits=14, decimal_places=2, default=0, help_text="Costo promedio ponderado")
    controla_stock = models.BooleanField(default=True)
    stock = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    stock_minimo = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    unidad = models.CharField(max_length=20, default="und")
    activo = models.BooleanField(default=True)
    favorito = models.BooleanField(default=False, help_text="Aparece primero en el POS")
    en_menu = models.BooleanField(default=True, help_text="Visible en el menú digital (QR)")

    class Meta:
        ordering = ["-favorito", "nombre"]

    def __str__(self):
        return self.nombre

    @property
    def margen(self):
        return self.precio - self.costo

    @property
    def margen_pct(self):
        if not self.precio:
            return Decimal("0")
        return round((self.precio - self.costo) / self.precio * 100, 1)

    @property
    def stock_bajo(self):
        return self.controla_stock and self.stock <= self.stock_minimo
