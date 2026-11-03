from decimal import Decimal

from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from negocios.mixins import PERMISOS_TENANT, TenantMixin
from negocios.models import MedioPago
from negocios.permisos import AdminOSoloLectura, EsAdmin, EsSuperAdmin
from negocios.utils import hoy

from . import calculos as C
from . import servicios as S
from .models import ApartadoCredito, Credito, CuotaCredito, PagoCredito, TasaUsura


class CuotaSerializer(serializers.ModelSerializer):
    pendiente = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = CuotaCredito
        fields = ["numero", "fecha_vencimiento", "saldo_inicial", "capital", "interes", "valor",
                  "pagado_capital", "pagado_interes", "pendiente", "estado", "pagada_en"]


class PagoCreditoSerializer(serializers.ModelSerializer):
    class Meta:
        model = PagoCredito
        fields = ["id", "fecha", "tipo", "monto", "aplicado_capital", "aplicado_interes", "medio",
                  "origen_fondos", "estrategia", "detalle", "nota", "creado"]


class CreditoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Credito
        fields = ["id", "entidad", "tipo_entidad", "destino", "descripcion", "monto", "tasa", "tipo_tasa",
                  "sistema", "modalidad", "frecuencia", "num_cuotas", "fecha_desembolso", "fecha_primera_cuota",
                  "cuota_valor", "tasa_ea_real", "aporte_extra", "aporte_estrategia",
                  "desembolso_a_caja", "medio_desembolso", "estado", "notas", "creado"]
        read_only_fields = ["cuota_valor", "tasa_ea_real", "estado"]


class CreditoDetalleSerializer(CreditoSerializer):
    resumen = serializers.SerializerMethodField()
    cuotas = CuotaSerializer(many=True, read_only=True)
    pagos = PagoCreditoSerializer(many=True, read_only=True)

    class Meta(CreditoSerializer.Meta):
        fields = CreditoSerializer.Meta.fields + ["resumen", "cuotas", "pagos"]

    def get_resumen(self, cr):
        return S.estado_credito(cr)


class PreviewSerializer(serializers.Serializer):
    monto = serializers.DecimalField(max_digits=14, decimal_places=2)
    tasa = serializers.DecimalField(max_digits=8, decimal_places=4)
    tipo_tasa = serializers.ChoiceField(choices=Credito.TipoTasa.choices, default=C.EA)
    sistema = serializers.ChoiceField(choices=Credito.Sistema.choices, default=C.FRANCES)
    frecuencia = serializers.ChoiceField(choices=Credito.Frecuencia.choices, default=C.MENSUAL)
    num_cuotas = serializers.IntegerField(min_value=1, max_value=5000)
    fecha_primera_cuota = serializers.DateField(required=False)


class PagoEntrada(serializers.Serializer):
    monto = serializers.DecimalField(max_digits=14, decimal_places=2)
    medio = serializers.ChoiceField(choices=MedioPago.choices, default=MedioPago.EFECTIVO)
    origen_fondos = serializers.ChoiceField(choices=PagoCredito.OrigenFondos.choices, default="CAJA")
    fecha = serializers.DateField(required=False)
    nota = serializers.CharField(required=False, allow_blank=True, default="")


class PagoConExcedente(PagoEntrada):
    excedente = serializers.ChoiceField(choices=["CAPITAL", "ADELANTAR"], default="CAPITAL")
    estrategia = serializers.ChoiceField(choices=[C.REDUCIR_PLAZO, C.REDUCIR_CUOTA], required=False)


class AbonoEntrada(PagoEntrada):
    estrategia = serializers.ChoiceField(choices=[C.REDUCIR_PLAZO, C.REDUCIR_CUOTA], default=C.REDUCIR_PLAZO)


def _dec(request, nombre, defecto="0"):
    try:
        return Decimal(str(request.data.get(nombre, request.query_params.get(nombre, defecto)) or defecto))
    except ArithmeticError:
        raise ValidationError({nombre: "Número inválido."})


class CreditoViewSet(TenantMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                     mixins.CreateModelMixin, viewsets.GenericViewSet):
    """
    Créditos del negocio (préstamos que el negocio debe) y plan para pagarlos.

    POST /creditos/preview/                     tabla de amortización sin guardar
    POST /creditos/                             registra el crédito y genera las cuotas
    GET  /creditos/tablero/                     meta del día, semáforo, fondo, alertas
    GET  /creditos/{id}/                        detalle + cuotas + pagos + estado
    POST /creditos/{id}/pagar/                  pago de cuota(s)
    POST /creditos/{id}/abonar-capital/         abono extra (reduce plazo o cuota)
    POST /creditos/{id}/simular/                ¿qué pasa si abono X?
    GET  /creditos/{id}/plan/?porcentaje=50     plan recomendado según la utilidad real
    GET  /creditos/estrategia/?extra_mensual=X  avalancha vs bola de nieve
    POST /creditos/apartar/                     aparta plata al fondo (desde caja o no)
    POST /creditos/liberar-fondo/               devuelve plata del fondo
    GET  /creditos/fondo/                       movimientos del fondo
    """
    queryset = Credito.objects.all()
    serializer_class = CreditoSerializer
    permission_classes = PERMISOS_TENANT + [EsAdmin]  # finanzas: solo el dueño
    modulo = "creditos"

    def get_serializer_class(self):
        return CreditoDetalleSerializer if self.action == "retrieve" else CreditoSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "retrieve":
            qs = qs.prefetch_related("cuotas", "pagos")
        if self.request.query_params.get("estado"):
            qs = qs.filter(estado=self.request.query_params["estado"])
        return qs

    def create(self, request, *args, **kwargs):
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        datos = {"tipo_tasa": C.EA, "sistema": C.FRANCES, "frecuencia": C.MENSUAL, **s.validated_data}
        cr = S.crear_credito(self.negocio, request.user, datos)
        return Response(CreditoDetalleSerializer(cr, context=self.get_serializer_context()).data, status=201)

    @action(detail=False, methods=["post"])
    def preview(self, request):
        s = PreviewSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        try:
            filas, ea_real = S.construir_tabla(d["monto"], d["tasa"], d["tipo_tasa"], d["sistema"],
                                               d["frecuencia"], d["num_cuotas"])
        except ValueError as e:
            raise ValidationError(str(e))
        primera = d.get("fecha_primera_cuota") or hoy()
        for k, f in enumerate(filas):
            f["fecha"] = C.fecha_cuota(primera, k, d["frecuencia"])
        total = sum(f["valor"] for f in filas)
        usura = TasaUsura.vigente(request.data.get("modalidad", "CONSUMO"), hoy())
        return Response({
            "cuota": filas[0]["valor"],
            "total_a_pagar": total,
            "total_intereses": total - d["monto"],
            "tasa_ea_real": ea_real,
            "cuota_diaria_equivalente": round(filas[0]["valor"] * C.PERIODOS_ANIO[d["frecuencia"]] / 365, 0),
            "tasa_usura_ea": usura.tasa_ea if usura else None,
            "supera_usura": bool(usura and ea_real > usura.tasa_ea),
            "tabla": filas,
        })

    @action(detail=False)
    def tablero(self, request):
        return Response(S.tablero(self.negocio))

    @action(detail=True, methods=["post"])
    def pagar(self, request, pk=None):
        """Pago de cuota; si trae plata de más, el excedente va a capital (o adelanta cuotas)."""
        e = PagoConExcedente(data=request.data)
        e.is_valid(raise_exception=True)
        pago, efecto = S.pagar(self.get_object(), usuario=request.user, **e.validated_data)
        data = PagoCreditoSerializer(pago).data
        data["excedente"] = efecto
        return Response(data, status=201)

    @action(detail=True, methods=["post"])
    def aporte(self, request, pk=None):
        """Configura el aporte extra fijo por cuota: {aporte_extra, estrategia}."""
        cr = S.configurar_aporte(self.get_object(), request.data.get("aporte_extra", 0),
                                 request.data.get("estrategia", C.REDUCIR_PLAZO))
        return Response(CreditoDetalleSerializer(cr, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"], url_path="abonar-capital")
    def abonar_capital(self, request, pk=None):
        e = AbonoEntrada(data=request.data)
        e.is_valid(raise_exception=True)
        pago, efecto = S.abonar_capital(self.get_object(), usuario=request.user, **e.validated_data)
        return Response({"pago": PagoCreditoSerializer(pago).data, "efecto": efecto}, status=201)

    @action(detail=True, methods=["post", "get"])
    def simular(self, request, pk=None):
        estrategia = request.data.get("estrategia", request.query_params.get("estrategia", C.REDUCIR_PLAZO))
        return Response(S.simular(self.get_object(), abono_unico=_dec(request, "abono_unico"),
                                  extra_periodico=_dec(request, "abono_extra_periodico"), estrategia=estrategia))

    @action(detail=True)
    def plan(self, request, pk=None):
        pct = int(request.query_params.get("porcentaje", 50))
        if not 0 <= pct <= 100:
            raise ValidationError("porcentaje entre 0 y 100.")
        return Response(S.plan_pago(self.get_object(), pct))

    @action(detail=False)
    def estrategia(self, request):
        return Response(S.comparar_estrategias(self.negocio, _dec(request, "extra_mensual")))

    @action(detail=False, methods=["post"])
    def apartar(self, request):
        ap = S.registrar_apartado(self.negocio, _dec(request, "monto"), request.user,
                                  credito_id=request.data.get("credito"),
                                  desde_caja=bool(request.data.get("desde_caja", True)),
                                  nota=request.data.get("nota", ""))
        return Response({"id": ap.id, "monto": ap.monto, "saldo_fondo": S.saldo_fondo(self.negocio)}, status=201)

    @action(detail=False, methods=["post"], url_path="liberar-fondo")
    def liberar_fondo(self, request):
        S.liberar_fondo(self.negocio, _dec(request, "monto"), request.user,
                        a_caja=bool(request.data.get("a_caja", True)), nota=request.data.get("nota", ""))
        return Response({"saldo_fondo": S.saldo_fondo(self.negocio)}, status=201)

    @action(detail=False)
    def fondo(self, request):
        movs = ApartadoCredito.objects.filter(negocio=self.negocio).select_related("credito")[:200]
        return Response({
            "saldo": S.saldo_fondo(self.negocio),
            "movimientos": [{"fecha": m.fecha, "tipo": m.tipo, "monto": m.monto, "desde_caja": m.desde_caja,
                             "credito": m.credito.entidad if m.credito else None, "nota": m.nota} for m in movs],
        })

    @action(detail=True, methods=["post"])
    def cancelar(self, request, pk=None):
        """Marca como cancelado un crédito registrado por error (si no tiene pagos)."""
        cr = self.get_object()
        if cr.pagos.exists():
            raise ValidationError("Tiene pagos registrados; no se puede cancelar.")
        cr.estado = Credito.Estado.CANCELADO
        cr.save(update_fields=["estado"])
        return Response(CreditoSerializer(cr).data)


class TasaUsuraSerializer(serializers.ModelSerializer):
    class Meta:
        model = TasaUsura
        fields = ["id", "modalidad", "vigente_desde", "vigente_hasta", "tasa_ea", "fuente"]


class TasaUsuraViewSet(viewsets.ModelViewSet):
    """Lectura para todos; solo el Super Admin de CavaTech la carga cada mes."""
    queryset = TasaUsura.objects.all()
    serializer_class = TasaUsuraSerializer

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return super().get_permissions()
        return [EsSuperAdmin()]
