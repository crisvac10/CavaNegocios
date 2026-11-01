from django.conf import settings
from django.db import models

from negocios.models import MedioPago, TenantModel


class Proveedor(TenantModel):
    nombre = models.CharField(max_length=120)
    telefono = models.CharField(max_length=30, blank=True)
    nit = models.CharField(max_length=30, blank=True)
    notas = models.CharField(max_length=300, blank=True)
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["nombre"]

    def __str__(self):
        return self.nombre


class CategoriaGasto(TenantModel):
    nombre = models.CharField(max_length=80)

    class Meta:
        ordering = ["nombre"]

    def __str__(self):
        return self.nombre


CATEGORIAS_GASTO_DEFECTO = ["Arriendo", "Servicios públicos", "Nómina", "Transporte", "Aseo", "Mantenimiento",
                            "Impuestos", "Publicidad", "Otros"]


class Gasto(TenantModel):
    """Gastos operativos (arriendo, servicios, nómina...). Restan a la utilidad."""
    categoria = models.ForeignKey(CategoriaGasto, on_delete=models.PROTECT, related_name="gastos")
    proveedor = models.ForeignKey(Proveedor, on_delete=models.SET_NULL, null=True, blank=True, related_name="gastos")
    descripcion = models.CharField(max_length=200)
    monto = models.DecimalField(max_digits=14, decimal_places=2)
    fecha = models.DateField()
    medio = models.CharField(max_length=15, choices=MedioPago.choices, default=MedioPago.EFECTIVO)
    pagado_de_caja = models.BooleanField(default=True, help_text="Si salió de la caja abierta")
    anulado = models.BooleanField(default=False)
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["-fecha", "-id"]


class Compra(TenantModel):
    """Compra de mercancía: suma inventario. NO es gasto (se vuelve costo cuando se vende)."""
    numero = models.PositiveIntegerField()
    proveedor = models.ForeignKey(Proveedor, on_delete=models.PROTECT, null=True, blank=True, related_name="compras")
    fecha = models.DateField()
    total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    medio = models.CharField(max_length=15, choices=MedioPago.choices, default=MedioPago.EFECTIVO)
    pagado_de_caja = models.BooleanField(default=True)
    nota = models.CharField(max_length=200, blank=True)
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["-fecha", "-id"]
        unique_together = [("negocio", "numero")]


class DetalleCompra(models.Model):
    compra = models.ForeignKey(Compra, on_delete=models.CASCADE, related_name="detalles")
    producto = models.ForeignKey("catalogo.Producto", on_delete=models.PROTECT)
    cantidad = models.DecimalField(max_digits=14, decimal_places=3)
    costo_unitario = models.DecimalField(max_digits=14, decimal_places=2)
    subtotal = models.DecimalField(max_digits=14, decimal_places=2)
