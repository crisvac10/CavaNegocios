"""Panel del Super Admin de CavaTech: crear negocios, suspender/reactivar, métricas."""
from django.db import transaction
from django.db.models import Count, Max, Sum
from rest_framework import serializers, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action
from rest_framework.response import Response

from negocios.models import MODULOS_BASE, Negocio
from negocios.permisos import EsSuperAdmin
from usuarios.models import Usuario


class NegocioSaasSerializer(serializers.ModelSerializer):
    admin_username = serializers.CharField(write_only=True, required=False)
    admin_password = serializers.CharField(write_only=True, required=False, min_length=6)
    admin_nombre = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Negocio
        fields = ["id", "nombre", "slug", "tipo", "plan", "nit", "telefono", "direccion", "logo_url",
                  "modulos", "activo", "creado", "admin_username", "admin_password", "admin_nombre"]
        read_only_fields = ["slug", "activo", "creado"]

    def validate_modulos(self, v):
        malos = [m for m in v if m not in MODULOS_BASE]
        if malos:
            raise serializers.ValidationError(f"Módulos inválidos: {malos}")
        return v

    def validate(self, data):
        if self.instance is None:
            if not data.get("admin_username") or not data.get("admin_password"):
                raise serializers.ValidationError("Para crear el negocio envía admin_username y admin_password.")
            if Usuario.objects.filter(username=data["admin_username"]).exists():
                raise serializers.ValidationError({"admin_username": "Ya existe."})
        return data

    @transaction.atomic
    def create(self, data):
        username, password = data.pop("admin_username"), data.pop("admin_password")
        nombre = data.pop("admin_nombre", "")
        negocio = Negocio.objects.create(**data)
        u = Usuario(username=username, first_name=nombre, rol=Usuario.Rol.ADMIN, negocio=negocio)
        u.set_password(password)
        u.save()
        return negocio

    def update(self, inst, data):
        for k in ("admin_username", "admin_password", "admin_nombre"):
            data.pop(k, None)
        return super().update(inst, data)


class NegociosSaasViewSet(viewsets.ModelViewSet):
    queryset = Negocio.objects.all()
    serializer_class = NegocioSaasSerializer
    permission_classes = [EsSuperAdmin]
    http_method_names = ["get", "post", "patch", "head", "options"]

    @action(detail=True, methods=["post"])
    def suspender(self, request, pk=None):
        n = self.get_object()
        n.activo = False
        n.save(update_fields=["activo"])
        borrados, _ = Token.objects.filter(user__negocio=n).delete()  # corta sesiones activas ya
        return Response({"activo": False, "sesiones_cerradas": borrados})

    @action(detail=True, methods=["post"])
    def reactivar(self, request, pk=None):
        n = self.get_object()
        n.activo = True
        n.save(update_fields=["activo"])
        return Response({"activo": True})

    @action(detail=False)
    def metricas(self, request):
        from ventas.models import Venta
        filas = (Venta.objects.exclude(estado=Venta.Estado.ANULADA).values("negocio_id")
                 .annotate(ventas=Sum("total"), num=Count("id"), ultima=Max("creado")))
        por_negocio = {f["negocio_id"]: f for f in filas}
        data = []
        for n in Negocio.objects.annotate(num_usuarios=Count("usuarios")):
            f = por_negocio.get(n.id, {})
            data.append({"id": n.id, "nombre": n.nombre, "tipo": n.tipo, "plan": n.plan, "activo": n.activo,
                         "usuarios": n.num_usuarios, "ventas_total": f.get("ventas", 0),
                         "num_ventas": f.get("num", 0), "ultima_venta": f.get("ultima")})
        return Response({"negocios": len(data), "activos": sum(1 for d in data if d["activo"]), "detalle": data})
