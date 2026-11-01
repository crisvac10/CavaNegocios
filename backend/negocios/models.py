from django.db import models
from django.utils.text import slugify


class Modulo(models.TextChoices):
    """Módulos activables por negocio (feature flags por plan)."""
    CATALOGO = "catalogo", "Catálogo"
    POS = "pos", "Punto de venta"
    INVENTARIO = "inventario", "Inventario"
    FIADOS = "fiados", "Fiados / cuentas por cobrar"
    GASTOS = "gastos", "Gastos y compras"
    CAJA = "caja", "Caja"
    REPORTES = "reportes", "Reportes"
    CREDITOS = "creditos", "Créditos y plan de pago"


MODULOS_BASE = [m.value for m in Modulo]


class MedioPago(models.TextChoices):
    EFECTIVO = "EFECTIVO", "Efectivo"
    NEQUI = "NEQUI", "Nequi"
    DAVIPLATA = "DAVIPLATA", "Daviplata"
    TRANSFERENCIA = "TRANSFERENCIA", "Transferencia"
    TARJETA = "TARJETA", "Tarjeta"


class Negocio(models.Model):
    class Tipo(models.TextChoices):
        CAFETERIA = "CAFETERIA", "Cafetería"
        RESTAURANTE = "RESTAURANTE", "Restaurante"
        TIENDA = "TIENDA", "Tienda"
        OTRO = "OTRO", "Otro"

    class Plan(models.TextChoices):
        BASICO = "BASICO", "Básico"
        PRO = "PRO", "Pro"

    nombre = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140, unique=True, blank=True)
    tipo = models.CharField(max_length=20, choices=Tipo.choices, default=Tipo.CAFETERIA)
    plan = models.CharField(max_length=10, choices=Plan.choices, default=Plan.BASICO)
    nit = models.CharField(max_length=30, blank=True)
    telefono = models.CharField(max_length=30, blank=True)
    direccion = models.CharField(max_length=200, blank=True)
    logo_url = models.URLField(blank=True)

    # Configuración operativa
    modulos = models.JSONField(default=list, blank=True, help_text="Módulos activos. Vacío = todos.")
    medios_pago = models.JSONField(default=list, blank=True, help_text="Medios de pago habilitados. Vacío = todos.")
    bloquear_sin_stock = models.BooleanField(default=False)
    permitir_fiado = models.BooleanField(default=True)
    mensaje_recibo = models.CharField(max_length=200, blank=True, default="¡Gracias por su compra!")

    activo = models.BooleanField(default=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["nombre"]

    def __str__(self):
        return self.nombre

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.nombre) or "negocio"
            slug, i = base, 2
            while Negocio.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug, i = f"{base}-{i}", i + 1
            self.slug = slug
        super().save(*args, **kwargs)

    @property
    def modulos_activos(self):
        return self.modulos or MODULOS_BASE

    @property
    def medios_pago_activos(self):
        return self.medios_pago or [m.value for m in MedioPago]

    def tiene_modulo(self, modulo):
        return modulo in self.modulos_activos


class TenantModel(models.Model):
    """Base de todo dato de un negocio: cada fila sabe a quién pertenece."""
    negocio = models.ForeignKey(Negocio, on_delete=models.CASCADE, related_name="+")
    creado = models.DateTimeField(auto_now_add=True)
    actualizado = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Consecutivo(models.Model):
    """Numeración por negocio (ventas, compras...). Se incrementa con bloqueo."""
    negocio = models.ForeignKey(Negocio, on_delete=models.CASCADE)
    clave = models.CharField(max_length=30)
    valor = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [("negocio", "clave")]

    @classmethod
    def siguiente(cls, negocio, clave):
        obj, _ = cls.objects.select_for_update().get_or_create(negocio=negocio, clave=clave)
        obj.valor += 1
        obj.save(update_fields=["valor"])
        return obj.valor
