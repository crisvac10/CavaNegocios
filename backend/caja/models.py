from django.conf import settings
from django.db import models

from negocios.models import MedioPago, TenantModel


class SesionCaja(TenantModel):
    """Un turno de caja: se abre con una base y se cierra contando el efectivo."""

    class Estado(models.TextChoices):
        ABIERTA = "ABIERTA", "Abierta"
        CERRADA = "CERRADA", "Cerrada"

    estado = models.CharField(max_length=8, choices=Estado.choices, default=Estado.ABIERTA)
    usuario_apertura = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    abierta_en = models.DateTimeField(auto_now_add=True)
    base_inicial = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    usuario_cierre = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    cerrada_en = models.DateTimeField(null=True, blank=True)
    efectivo_esperado = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    efectivo_contado = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    diferencia = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    resumen = models.JSONField(default=dict, blank=True, help_text="Foto del resumen al cierre")
    nota = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["-abierta_en"]
        constraints = [
            models.UniqueConstraint(
                fields=["negocio"], condition=models.Q(estado="ABIERTA"), name="una_caja_abierta_por_negocio"
            )
        ]


class MovimientoCaja(TenantModel):
    """
    Libro único de dinero de la caja. Toda operación que mueve plata
    (venta, abono de fiado, gasto, compra, cuota de crédito, apartado...) deja aquí
    una fila con signo. El cierre de caja es la suma de este libro.
    """

    class Origen(models.TextChoices):
        VENTA = "VENTA", "Venta"
        ABONO_FIADO = "ABONO_FIADO", "Abono de fiado"
        ANULACION = "ANULACION", "Anulación de venta"
        GASTO = "GASTO", "Gasto"
        COMPRA = "COMPRA", "Compra a proveedor"
        PAGO_CREDITO = "PAGO_CREDITO", "Pago de crédito"
        APARTADO_CREDITO = "APARTADO_CREDITO", "Apartado para crédito"
        DESEMBOLSO_CREDITO = "DESEMBOLSO_CREDITO", "Desembolso de crédito"
        ENTRADA_MANUAL = "ENTRADA_MANUAL", "Entrada manual"
        SALIDA_MANUAL = "SALIDA_MANUAL", "Salida / retiro manual"

    sesion = models.ForeignKey(SesionCaja, on_delete=models.PROTECT, null=True, blank=True,
                               related_name="movimientos", help_text="Vacío si el negocio no usa caja")
    origen = models.CharField(max_length=20, choices=Origen.choices)
    medio = models.CharField(max_length=15, choices=MedioPago.choices, default=MedioPago.EFECTIVO)
    monto = models.DecimalField(max_digits=14, decimal_places=2, help_text="+ entra / - sale")
    concepto = models.CharField(max_length=200, blank=True)
    referencia = models.CharField(max_length=60, blank=True)
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        ordering = ["-creado", "-id"]
