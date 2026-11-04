"""
Al borrar un crédito o un pago de crédito (desde la app o desde el admin de Django),
su dinero sale también del libro de caja. Antes quedaban movimientos huérfanos y el
cuadre de "Hoy" seguía mostrando el desembolso y las cuotas de un crédito que ya no existía.
"""
from django.db.models.signals import pre_delete
from django.dispatch import receiver

from caja.models import MovimientoCaja

from .models import ApartadoCredito, Credito, PagoCredito


@receiver(pre_delete, sender=PagoCredito)
def limpiar_pago(sender, instance, **kwargs):
    MovimientoCaja.objects.filter(negocio_id=instance.negocio_id, referencia=f"pago_credito:{instance.id}").delete()


@receiver(pre_delete, sender=Credito)
def limpiar_credito(sender, instance, **kwargs):
    MovimientoCaja.objects.filter(negocio_id=instance.negocio_id, referencia=f"credito:{instance.id}").delete()
    # Lo que se SACÓ del fondo para pagar este crédito vuelve al fondo; lo apartado se queda en el fondo.
    ApartadoCredito.objects.filter(credito=instance, tipo=ApartadoCredito.Tipo.USO_PAGO).delete()
