import datetime as dt
from decimal import Decimal, ROUND_HALF_UP

from django.utils import timezone
from rest_framework.exceptions import ValidationError

CERO = Decimal("0")


def redondear(valor, decimales=0):
    """Pesos colombianos: por defecto sin centavos."""
    q = Decimal(1).scaleb(-decimales)
    return Decimal(valor).quantize(q, rounding=ROUND_HALF_UP)


def hoy():
    return timezone.localdate()


def rango_dia(fecha):
    tz = timezone.get_current_timezone()
    inicio = timezone.make_aware(dt.datetime.combine(fecha, dt.time.min), tz)
    return inicio, inicio + dt.timedelta(days=1)


def rango_fechas(desde, hasta):
    """[desde 00:00, hasta+1 00:00) en hora de Bogotá."""
    inicio, _ = rango_dia(desde)
    _, fin = rango_dia(hasta)
    return inicio, fin


def momento_en(fecha):
    """
    Fecha elegida por el usuario -> datetime para guardar el registro en ese día.
    Hoy (o vacía) -> None, que significa "ahora". Días anteriores -> esa fecha a la hora actual.
    """
    if not fecha:
        return None
    if isinstance(fecha, str):
        fecha = dt.date.fromisoformat(fecha)
    if isinstance(fecha, dt.datetime):
        fecha = fecha.date()
    if fecha > hoy():
        raise ValidationError("La fecha no puede ser futura.")
    if fecha == hoy():
        return None
    tz = timezone.get_current_timezone()
    return timezone.make_aware(dt.datetime.combine(fecha, timezone.localtime().time().replace(microsecond=0)), tz)


def leer_rango(request, dias_defecto=0):
    """Lee ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD; por defecto hoy (o últimos N días)."""
    try:
        hasta = dt.date.fromisoformat(request.query_params["hasta"]) if request.query_params.get("hasta") else hoy()
        if request.query_params.get("desde"):
            desde = dt.date.fromisoformat(request.query_params["desde"])
        else:
            desde = hasta - dt.timedelta(days=dias_defecto)
    except ValueError:
        raise ValidationError("Fechas inválidas, usa YYYY-MM-DD.")
    if desde > hasta:
        raise ValidationError("'desde' no puede ser mayor que 'hasta'.")
    return desde, hasta


def link_whatsapp(telefono, texto):
    from urllib.parse import quote
    numero = "".join(c for c in (telefono or "") if c.isdigit())
    if numero and len(numero) == 10:  # celular colombiano sin indicativo
        numero = "57" + numero
    base = f"https://wa.me/{numero}" if numero else "https://wa.me/"
    return f"{base}?text={quote(texto)}"


def pesos(valor):
    return "$" + f"{redondear(valor):,.0f}".replace(",", ".")
