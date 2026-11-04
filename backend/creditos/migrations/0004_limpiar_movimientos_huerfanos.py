"""
Limpia dinero huérfano en el cuadre: desembolsos y pagos de créditos que ya fueron borrados
(o marcados como cancelados) seguían apareciendo en "Hoy".
"""
from django.db import migrations


def limpiar(apps, schema_editor):
    MovimientoCaja = apps.get_model("caja", "MovimientoCaja")
    Credito = apps.get_model("creditos", "Credito")
    PagoCredito = apps.get_model("creditos", "PagoCredito")

    creditos_vivos = set(Credito.objects.exclude(estado="CANCELADO").values_list("id", flat=True))
    pagos_vivos = set(PagoCredito.objects.values_list("id", flat=True))
    borrar = []
    for m in MovimientoCaja.objects.filter(referencia__startswith="credito:").only("id", "referencia"):
        if int(m.referencia.split(":")[1]) not in creditos_vivos:
            borrar.append(m.id)
    for m in MovimientoCaja.objects.filter(referencia__startswith="pago_credito:").only("id", "referencia"):
        if int(m.referencia.split(":")[1]) not in pagos_vivos:
            borrar.append(m.id)
    MovimientoCaja.objects.filter(id__in=borrar).delete()
    # Los cancelados ya no se usan: se borran del todo (cuotas y pagos en cascada)
    Credito.objects.filter(estado="CANCELADO").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("creditos", "0003_credito_aporte_estrategia_credito_aporte_extra"),
        ("caja", "0003_alter_movimientocaja_sesion"),
    ]

    operations = [migrations.RunPython(limpiar, migrations.RunPython.noop)]
