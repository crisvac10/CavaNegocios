from django.conf import settings
from django.db import models

from negocios.models import TenantModel


class MovimientoInventario(TenantModel):
    class Tipo(models.TextChoices):
        VENTA = "VENTA", "Venta"
        ANULACION_VENTA = "ANULACION_VENTA", "Anulación de venta"
        COMPRA = "COMPRA", "Compra a proveedor"
        ANULACION_COMPRA = "ANULACION_COMPRA", "Compra eliminada o corregida"
        AJUSTE_ENTRADA = "AJUSTE_ENTRADA", "Ajuste de entrada"
        AJUSTE_SALIDA = "AJUSTE_SALIDA", "Ajuste de salida"
        CONSUMO_INTERNO = "CONSUMO_INTERNO", "Consumo interno"
        MERMA = "MERMA", "Merma / daño / vencido"

    producto = models.ForeignKey("catalogo.Producto", on_delete=models.CASCADE, related_name="movimientos")
    tipo = models.CharField(max_length=20, choices=Tipo.choices)
    cantidad = models.DecimalField(max_digits=14, decimal_places=3, help_text="+ entra / - sale")
    stock_resultante = models.DecimalField(max_digits=14, decimal_places=3)
    costo_unitario = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    referencia = models.CharField(max_length=60, blank=True)
    nota = models.CharField(max_length=200, blank=True)
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        ordering = ["-creado", "-id"]
