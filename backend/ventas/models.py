import uuid

from django.conf import settings
from django.db import models
from django.db.models import Sum

from negocios.models import MedioPago, TenantModel
from negocios.utils import CERO


class Cliente(TenantModel):
    nombre = models.CharField(max_length=120)
    telefono = models.CharField(max_length=30, blank=True)
    documento = models.CharField(max_length=30, blank=True)
    notas = models.CharField(max_length=300, blank=True)
    cupo_fiado = models.DecimalField(max_digits=14, decimal_places=2, default=0, help_text="0 = sin límite")
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["nombre"]

    def __str__(self):
        return self.nombre

    @property
    def saldo_pendiente(self):
        return self.ventas.exclude(estado=Venta.Estado.ANULADA).aggregate(s=Sum("saldo_pendiente"))["s"] or CERO


class Venta(TenantModel):
    class Estado(models.TextChoices):
        PAGADA = "PAGADA", "Pagada"
        FIADO = "FIADO", "Fiado (saldo pendiente)"
        ANULADA = "ANULADA", "Anulada"

    numero = models.PositiveIntegerField()
    token_publico = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    sesion_caja = models.ForeignKey("caja.SesionCaja", on_delete=models.PROTECT, null=True, blank=True, related_name="ventas")
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    cliente = models.ForeignKey(Cliente, on_delete=models.PROTECT, null=True, blank=True, related_name="ventas")
    estado = models.CharField(max_length=8, choices=Estado.choices, default=Estado.PAGADA)

    subtotal = models.DecimalField(max_digits=14, decimal_places=2)
    descuento = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=14, decimal_places=2)
    costo_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    saldo_pendiente = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    efectivo_recibido = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    cambio = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    nota = models.CharField(max_length=200, blank=True)

    anulada_por = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    motivo_anulacion = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["-creado", "-id"]
        unique_together = [("negocio", "numero")]

    def __str__(self):
        return f"Venta #{self.numero}"

    @property
    def utilidad(self):
        return self.total - self.costo_total


class DetalleVenta(models.Model):
    venta = models.ForeignKey(Venta, on_delete=models.CASCADE, related_name="detalles")
    producto = models.ForeignKey("catalogo.Producto", on_delete=models.PROTECT, related_name="detalles_venta")
    nombre = models.CharField(max_length=120)  # foto del nombre al vender
    cantidad = models.DecimalField(max_digits=14, decimal_places=3)
    precio_unitario = models.DecimalField(max_digits=14, decimal_places=2)
    costo_unitario = models.DecimalField(max_digits=14, decimal_places=2)
    subtotal = models.DecimalField(max_digits=14, decimal_places=2)


class PagoVenta(TenantModel):
    """Pagos al vender y abonos posteriores a un fiado."""
    venta = models.ForeignKey(Venta, on_delete=models.CASCADE, related_name="pagos")
    medio = models.CharField(max_length=15, choices=MedioPago.choices)
    monto = models.DecimalField(max_digits=14, decimal_places=2)
    es_abono = models.BooleanField(default=False)
    sesion_caja = models.ForeignKey("caja.SesionCaja", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["creado"]
