from django.contrib.auth import authenticate
from rest_framework import serializers, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from negocios.mixins import PERMISOS_TENANT
from negocios.models import MODULOS_BASE, MedioPago, Negocio
from negocios.permisos import EsAdmin

from .models import Usuario


class NegocioSerializer(serializers.ModelSerializer):
    modulos_activos = serializers.ListField(read_only=True)
    medios_pago_activos = serializers.ListField(read_only=True)

    class Meta:
        model = Negocio
        fields = [
            "id", "nombre", "slug", "tipo", "plan", "nit", "telefono", "direccion", "logo_url",
            "medios_pago", "usa_caja", "bloquear_sin_stock", "permitir_fiado", "mensaje_recibo",
            "modulos_activos", "medios_pago_activos", "activo",
        ]
        read_only_fields = ["slug", "plan", "activo"]

    def validate_medios_pago(self, valor):
        validos = {m.value for m in MedioPago}
        malos = [m for m in valor if m not in validos]
        if malos:
            raise serializers.ValidationError(f"Medios inválidos: {malos}")
        return valor


class UsuarioSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, min_length=6)

    class Meta:
        model = Usuario
        fields = ["id", "username", "first_name", "last_name", "telefono", "rol", "is_active", "password"]

    def validate_rol(self, rol):
        if rol not in (Usuario.Rol.ADMIN, Usuario.Rol.CAJERO):
            raise serializers.ValidationError("Rol no permitido.")
        return rol

    def create(self, data):
        password = data.pop("password", None)
        if not password:
            raise serializers.ValidationError({"password": "Requerida."})
        u = Usuario(**data)
        u.set_password(password)
        u.save()
        return u

    def update(self, instancia, data):
        password = data.pop("password", None)
        for k, v in data.items():
            setattr(instancia, k, v)
        if password:
            instancia.set_password(password)
        instancia.save()
        if not instancia.is_active:
            Token.objects.filter(user=instancia).delete()
        return instancia


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def login(request):
    user = authenticate(username=request.data.get("username"), password=request.data.get("password"))
    if not user:
        return Response({"detail": "Usuario o contraseña incorrectos."}, status=status.HTTP_400_BAD_REQUEST)
    if not user.es_superadmin and not (user.negocio_id and user.negocio.activo):
        return Response({"detail": "El negocio está suspendido. Comunícate con CavaTech."}, status=status.HTTP_403_FORBIDDEN)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key, "usuario": _perfil(user)})


@api_view(["POST"])
def logout(request):
    Token.objects.filter(user=request.user).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


def _perfil(u):
    return {
        "id": u.id,
        "username": u.username,
        "nombre": u.get_full_name() or u.username,
        "rol": u.rol,
        "es_superadmin": u.es_superadmin,
        "negocio": NegocioSerializer(u.negocio).data if u.negocio_id else None,
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def yo(request):
    return Response(_perfil(request.user))


class MiNegocioView(APIView):
    """GET: cualquiera del negocio. PATCH: solo admin (config, medios de pago, stock, fiado)."""
    permission_classes = PERMISOS_TENANT

    def get(self, request):
        return Response(NegocioSerializer(request.user.negocio).data)

    def patch(self, request):
        if request.user.rol != Usuario.Rol.ADMIN:
            return Response({"detail": "Solo el administrador."}, status=403)
        s = NegocioSerializer(request.user.negocio, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)


class UsuariosNegocioViewSet(viewsets.ModelViewSet):
    """El dueño gestiona sus cajeros."""
    serializer_class = UsuarioSerializer
    permission_classes = PERMISOS_TENANT + [EsAdmin]

    def get_queryset(self):
        return Usuario.objects.filter(negocio=self.request.user.negocio).order_by("username")

    def perform_create(self, serializer):
        serializer.save(negocio=self.request.user.negocio)

    def perform_destroy(self, instancia):
        if instancia == self.request.user:
            raise serializers.ValidationError("No puedes eliminar tu propio usuario.")
        instancia.is_active = False  # se desactiva, no se borra (trazabilidad de ventas)
        instancia.save()
        Token.objects.filter(user=instancia).delete()


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def catalogos_sistema(request):
    """Listas fijas para el frontend (medios de pago, módulos)."""
    return Response({
        "medios_pago": [{"valor": m.value, "nombre": m.label} for m in MedioPago],
        "modulos": MODULOS_BASE,
        "tipos_negocio": [{"valor": t.value, "nombre": t.label} for t in Negocio.Tipo],
    })
