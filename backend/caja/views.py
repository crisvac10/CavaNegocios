from decimal import Decimal

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from negocios.mixins import TenantMixin
from negocios.models import MedioPago

from . import servicios
from .models import MovimientoCaja, SesionCaja

Origen = MovimientoCaja.Origen


class SesionSerializer(serializers.ModelSerializer):
    usuario_apertura = serializers.CharField(source="usuario_apertura.username", read_only=True)
    usuario_cierre = serializers.CharField(source="usuario_cierre.username", read_only=True, default=None)

    class Meta:
        model = SesionCaja
        fields = ["id", "estado", "usuario_apertura", "abierta_en", "base_inicial", "usuario_cierre",
                  "cerrada_en", "efectivo_esperado", "efectivo_contado", "diferencia", "resumen", "nota"]


class MovimientoCajaSerializer(serializers.ModelSerializer):
    usuario = serializers.CharField(source="usuario.username", read_only=True, default=None)

    class Meta:
        model = MovimientoCaja
        fields = ["id", "origen", "medio", "monto", "concepto", "referencia", "usuario", "creado"]


class CajaViewSet(TenantMixin, viewsets.ReadOnlyModelViewSet):
    """
    GET  /caja/                 historial de cierres
    GET  /caja/actual/          caja abierta + resumen en vivo
    GET  /caja/dia/?fecha=      cuadre diario (sirve con o sin caja registradora)
    POST /caja/abrir/           {base_inicial}           (solo si el negocio usa caja)
    POST /caja/movimiento/      entrada/salida manual {tipo: ENTRADA|SALIDA, monto, medio, concepto}
    POST /caja/cerrar/          {efectivo_contado, apartar_credito?, credito?, nota?}
    GET  /caja/{id}/movimientos/
    """
    queryset = SesionCaja.objects.select_related("usuario_apertura", "usuario_cierre")
    serializer_class = SesionSerializer
    modulo = "caja"

    @action(detail=False)
    def dia(self, request):
        import datetime as dt
        from negocios.utils import hoy
        try:
            fecha = dt.date.fromisoformat(request.query_params["fecha"]) if request.query_params.get("fecha") else hoy()
        except ValueError:
            raise ValidationError("Fecha inválida, usa YYYY-MM-DD.")
        data = servicios.resumen_dia(self.negocio, fecha)
        data["usa_caja"] = self.negocio.usa_caja
        return Response(data)

    def _exigir_caja(self):
        if not self.negocio.usa_caja:
            raise ValidationError("Este negocio no usa caja registradora. Actívala en la configuración "
                                  "o usa el cuadre diario (/caja/dia/).")

    @action(detail=False)
    def actual(self, request):
        if not self.negocio.usa_caja:
            return Response({"usa_caja": False, "abierta": False, "cuadre_hoy": servicios.resumen_dia(self.negocio, timezone.localdate())})
        s = servicios.sesion_abierta(self.negocio, requerida=False)
        if not s:
            return Response({"usa_caja": True, "abierta": False})
        return Response({"usa_caja": True, "abierta": True, "sesion": SesionSerializer(s).data, "resumen": servicios.resumen_sesion(s)})

    @action(detail=False, methods=["post"])
    def abrir(self, request):
        self._exigir_caja()
        base = Decimal(str(request.data.get("base_inicial", 0) or 0))
        if base < 0:
            raise ValidationError("La base no puede ser negativa.")
        try:
            with transaction.atomic():
                s = SesionCaja.objects.create(negocio=self.negocio, usuario_apertura=request.user, base_inicial=base)
        except IntegrityError:
            raise ValidationError("Ya hay una caja abierta.")
        return Response(SesionSerializer(s).data, status=201)

    @action(detail=False, methods=["post"])
    def movimiento(self, request):
        tipo = request.data.get("tipo")
        monto = Decimal(str(request.data.get("monto") or 0))
        medio = request.data.get("medio", MedioPago.EFECTIVO)
        if tipo not in ("ENTRADA", "SALIDA") or monto <= 0 or medio not in MedioPago.values:
            raise ValidationError("Envía tipo ENTRADA|SALIDA, monto > 0 y un medio válido.")
        if tipo == "SALIDA" and request.user.rol != "ADMIN":
            raise ValidationError("Solo el administrador puede retirar dinero de la caja.")
        mov = servicios.registrar(
            self.negocio, Origen.ENTRADA_MANUAL if tipo == "ENTRADA" else Origen.SALIDA_MANUAL,
            monto if tipo == "ENTRADA" else -monto, medio=medio,
            concepto=request.data.get("concepto", ""), usuario=request.user,
        )
        return Response(MovimientoCajaSerializer(mov).data, status=201)

    @action(detail=False, methods=["post"])
    @transaction.atomic
    def cerrar(self, request):
        self._exigir_caja()
        s = servicios.sesion_abierta(self.negocio)
        s = SesionCaja.objects.select_for_update().get(pk=s.pk)
        try:
            contado = Decimal(str(request.data["efectivo_contado"]))
        except (KeyError, ArithmeticError, ValueError):
            raise ValidationError({"efectivo_contado": "Requerido: el efectivo que hay físicamente en la caja."})

        # Apartar plata para el crédito al cerrar (sale de la caja hacia el fondo del crédito)
        apartar = Decimal(str(request.data.get("apartar_credito") or 0))
        if apartar > 0:
            from creditos.servicios import registrar_apartado
            registrar_apartado(self.negocio, apartar, usuario=request.user,
                               credito_id=request.data.get("credito"), desde_caja=True, sesion=s)

        resumen = servicios.resumen_sesion(s)
        s.efectivo_esperado = resumen["efectivo_esperado"]
        s.efectivo_contado = contado
        s.diferencia = contado - s.efectivo_esperado
        s.resumen = _json(resumen)
        s.estado = SesionCaja.Estado.CERRADA
        s.cerrada_en = timezone.now()
        s.usuario_cierre = request.user
        s.nota = request.data.get("nota", "")[:300]
        s.save()
        data = SesionSerializer(s).data
        data["alerta"] = (
            None if s.diferencia == 0 else
            f"{'Sobran' if s.diferencia > 0 else 'Faltan'} ${abs(s.diferencia):,.0f} en efectivo."
        )
        return Response(data)

    @action(detail=True)
    def movimientos(self, request, pk=None):
        s = self.get_object()
        return Response(MovimientoCajaSerializer(s.movimientos.select_related("usuario"), many=True).data)


def _json(obj):
    """Decimal -> str para guardar el resumen en JSONField."""
    if isinstance(obj, dict):
        return {k: _json(v) for k, v in obj.items()}
    if isinstance(obj, Decimal):
        return str(obj)
    return obj
