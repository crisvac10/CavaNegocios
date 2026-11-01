from django.conf import settings
from django.db import models
from django.db.models import Sum

from negocios.models import MedioPago, TenantModel
from negocios.utils import CERO

from . import calculos as C


class Credito(TenantModel):
    class TipoEntidad(models.TextChoices):
        BANCO = "BANCO", "Banco"
        COOPERATIVA = "COOPERATIVA", "Cooperativa"
        FINTECH = "FINTECH", "Fintech / app"
        PROVEEDOR = "PROVEEDOR", "Crédito de proveedor"
        PRESTAMISTA = "PRESTAMISTA", "Prestamista particular"
        OTRO = "OTRO", "Otro"

    class Destino(models.TextChoices):
        INVENTARIO = "INVENTARIO", "Mercancía / inventario"
        EQUIPO = "EQUIPO", "Equipos / maquinaria"
        CAPITAL_TRABAJO = "CAPITAL_TRABAJO", "Capital de trabajo"
        LOCAL = "LOCAL", "Adecuación del local"
        DEUDAS = "DEUDAS", "Pagar otras deudas"
        OTRO = "OTRO", "Otro"

    class Frecuencia(models.TextChoices):
        DIARIA = C.DIARIA, "Diaria"
        SEMANAL = C.SEMANAL, "Semanal"
        QUINCENAL = C.QUINCENAL, "Quincenal"
        MENSUAL = C.MENSUAL, "Mensual"

    class TipoTasa(models.TextChoices):
        EA = C.EA, "Efectiva anual (E.A.)"
        MENSUAL = C.TASA_MENSUAL, "Mensual"

    class Sistema(models.TextChoices):
        FRANCES = C.FRANCES, "Cuota fija (bancos, cooperativas)"
        PLANO = C.PLANO, "Interés plano (prestamistas)"

    class Modalidad(models.TextChoices):
        CONSUMO = "CONSUMO", "Consumo y ordinario"
        MICROCREDITO = "MICROCREDITO", "Microcrédito"

    class Estado(models.TextChoices):
        ACTIVO = "ACTIVO", "Activo"
        PAGADO = "PAGADO", "Pagado"
        CANCELADO = "CANCELADO", "Cancelado"

    entidad = models.CharField(max_length=120, help_text="Ej. Bancolombia, Coopcentral, Don Pedro")
    tipo_entidad = models.CharField(max_length=12, choices=TipoEntidad.choices, default=TipoEntidad.BANCO)
    destino = models.CharField(max_length=16, choices=Destino.choices, default=Destino.CAPITAL_TRABAJO)
    descripcion = models.CharField(max_length=200, blank=True)

    monto = models.DecimalField(max_digits=14, decimal_places=2)
    tasa = models.DecimalField(max_digits=8, decimal_places=4, help_text="En %, ej. 28.5")
    tipo_tasa = models.CharField(max_length=8, choices=TipoTasa.choices, default=TipoTasa.EA)
    sistema = models.CharField(max_length=8, choices=Sistema.choices, default=Sistema.FRANCES)
    modalidad = models.CharField(max_length=12, choices=Modalidad.choices, default=Modalidad.CONSUMO)
    frecuencia = models.CharField(max_length=10, choices=Frecuencia.choices, default=Frecuencia.MENSUAL)
    num_cuotas = models.PositiveIntegerField()
    fecha_desembolso = models.DateField()
    fecha_primera_cuota = models.DateField()

    # Calculados al crear
    cuota_valor = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tasa_ea_real = models.DecimalField(max_digits=10, decimal_places=4, default=0,
                                       help_text="Costo real E.A. en % (TIR). En interés plano es mayor que la tasa anunciada.")

    desembolso_a_caja = models.BooleanField(default=False, help_text="Si el dinero entró a la caja (no al banco)")
    medio_desembolso = models.CharField(max_length=15, choices=MedioPago.choices, default=MedioPago.TRANSFERENCIA)
    estado = models.CharField(max_length=10, choices=Estado.choices, default=Estado.ACTIVO)
    notas = models.CharField(max_length=300, blank=True)
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["estado", "-fecha_desembolso"]

    def __str__(self):
        return f"{self.entidad} {self.monto:,.0f}"

    # --- métricas ---
    @property
    def tasa_periodica(self):
        return C.ea_a_periodica(C.a_ea(self.tasa, self.tipo_tasa), self.frecuencia)

    @property
    def capital_pagado(self):
        return self.pagos.aggregate(s=Sum("aplicado_capital"))["s"] or CERO

    @property
    def interes_pagado(self):
        return self.pagos.aggregate(s=Sum("aplicado_interes"))["s"] or CERO

    @property
    def saldo_capital(self):
        return self.monto - self.capital_pagado

    @property
    def cuota_diaria_equivalente(self):
        """Cuánto hay que 'apartar' cada día para llegar a la cuota."""
        return self.cuota_valor * C.PERIODOS_ANIO[self.frecuencia] / 365


class CuotaCredito(models.Model):
    class Estado(models.TextChoices):
        PENDIENTE = "PENDIENTE", "Pendiente"
        PARCIAL = "PARCIAL", "Pago parcial"
        PAGADA = "PAGADA", "Pagada"

    credito = models.ForeignKey(Credito, on_delete=models.CASCADE, related_name="cuotas")
    numero = models.PositiveIntegerField()
    fecha_vencimiento = models.DateField()
    saldo_inicial = models.DecimalField(max_digits=14, decimal_places=2)
    capital = models.DecimalField(max_digits=14, decimal_places=2)
    interes = models.DecimalField(max_digits=14, decimal_places=2)
    valor = models.DecimalField(max_digits=14, decimal_places=2)
    pagado_capital = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    pagado_interes = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    estado = models.CharField(max_length=9, choices=Estado.choices, default=Estado.PENDIENTE)
    pagada_en = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["numero"]
        unique_together = [("credito", "numero")]

    @property
    def pendiente(self):
        return self.valor - self.pagado_capital - self.pagado_interes


class PagoCredito(TenantModel):
    class Tipo(models.TextChoices):
        CUOTA = "CUOTA", "Pago de cuota"
        ABONO_CAPITAL = "ABONO_CAPITAL", "Abono extra a capital"

    class OrigenFondos(models.TextChoices):
        CAJA = "CAJA", "De la caja del día"
        FONDO = "FONDO", "Del fondo apartado para créditos"
        EXTERNO = "EXTERNO", "De cuenta bancaria / externo"

    credito = models.ForeignKey(Credito, on_delete=models.CASCADE, related_name="pagos")
    fecha = models.DateField()
    tipo = models.CharField(max_length=14, choices=Tipo.choices)
    monto = models.DecimalField(max_digits=14, decimal_places=2)
    aplicado_capital = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    aplicado_interes = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    medio = models.CharField(max_length=15, choices=MedioPago.choices, default=MedioPago.EFECTIVO)
    origen_fondos = models.CharField(max_length=8, choices=OrigenFondos.choices, default=OrigenFondos.CAJA)
    estrategia = models.CharField(max_length=14, blank=True, help_text="Solo abonos: REDUCIR_PLAZO | REDUCIR_CUOTA")
    detalle = models.JSONField(default=list, blank=True)
    nota = models.CharField(max_length=200, blank=True)
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["-fecha", "-id"]


class ApartadoCredito(TenantModel):
    """
    'Alcancía' del negocio para pagar créditos: cada día se aparta parte de la
    utilidad. Saldo del fondo = suma de montos (+ apartado, - usado/liberado).
    """

    class Tipo(models.TextChoices):
        APARTADO = "APARTADO", "Apartado"
        USO_PAGO = "USO_PAGO", "Usado para pagar"
        LIBERADO = "LIBERADO", "Liberado"

    credito = models.ForeignKey(Credito, on_delete=models.SET_NULL, null=True, blank=True, related_name="apartados")
    fecha = models.DateField()
    tipo = models.CharField(max_length=9, choices=Tipo.choices, default=Tipo.APARTADO)
    monto = models.DecimalField(max_digits=14, decimal_places=2)
    desde_caja = models.BooleanField(default=True)
    nota = models.CharField(max_length=200, blank=True)
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["-fecha", "-id"]


class TasaUsura(models.Model):
    """Tasa de usura certificada por la Superfinanciera (global, la carga el Super Admin cada mes)."""
    modalidad = models.CharField(max_length=12, choices=Credito.Modalidad.choices, default=Credito.Modalidad.CONSUMO)
    vigente_desde = models.DateField()
    vigente_hasta = models.DateField(null=True, blank=True)
    tasa_ea = models.DecimalField(max_digits=8, decimal_places=4, help_text="% E.A.")
    fuente = models.CharField(max_length=200, blank=True, default="Superintendencia Financiera de Colombia")

    class Meta:
        ordering = ["-vigente_desde"]

    @classmethod
    def vigente(cls, modalidad, fecha):
        return (cls.objects.filter(modalidad=modalidad, vigente_desde__lte=fecha)
                .filter(models.Q(vigente_hasta__isnull=True) | models.Q(vigente_hasta__gte=fecha)).first())
