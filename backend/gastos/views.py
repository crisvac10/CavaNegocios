from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from caja import servicios as caja
from caja.models import MovimientoCaja
from catalogo.models import Categoria, Producto
from inventario.models import MovimientoInventario
from inventario.servicios import mover_stock
from negocios.mixins import PERMISOS_TENANT, TenantMixin, TenantModelViewSet
from negocios.models import Consecutivo
from negocios.permisos import EsAdmin
from negocios.serializers_base import TenantFKField
from negocios.utils import CERO, hoy, leer_rango, momento_en

from .models import CATEGORIAS_GASTO_DEFECTO, CategoriaGasto, Compra, DetalleCompra, Gasto, Proveedor

Origen = MovimientoCaja.Origen


class ProveedorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Proveedor
        fields = ["id", "nombre", "telefono", "nit", "notas", "activo"]


class CategoriaGastoSerializer(serializers.ModelSerializer):
    class Meta:
        model = CategoriaGasto
        fields = ["id", "nombre"]


class GastoSerializer(serializers.ModelSerializer):
    categoria = TenantFKField(queryset=CategoriaGasto.objects.all())
    proveedor = TenantFKField(queryset=Proveedor.objects.all(), allow_null=True, required=False)
    categoria_nombre = serializers.CharField(source="categoria.nombre", read_only=True)
    proveedor_nombre = serializers.CharField(source="proveedor.nombre", read_only=True, default=None)
    fecha = serializers.DateField(required=False)

    class Meta:
        model = Gasto
        fields = ["id", "categoria", "categoria_nombre", "proveedor", "proveedor_nombre", "descripcion",
                  "monto", "fecha", "medio", "pagado_de_caja", "anulado", "creado"]
        read_only_fields = ["anulado"]

    def validate_monto(self, v):
        if v <= 0:
            raise serializers.ValidationError("Debe ser mayor a cero.")
        return v


class NuevoProductoEntrada(serializers.Serializer):
    """Producto que se compra por primera vez: se crea en el catálogo con la compra."""
    nombre = serializers.CharField(max_length=120)
    precio = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0)  # precio de venta
    categoria = serializers.IntegerField(required=False, allow_null=True)


class DetalleCompraEntrada(serializers.Serializer):
    """
    Se manda el valor TOTAL pagado por la línea (lo natural en una factura) o el costo unitario.
    Producto del catálogo (entra al inventario) o solo `nombre` para algo que no se vende (insumos: es gasto).
    """
    producto = serializers.IntegerField(required=False, allow_null=True)
    nombre = serializers.CharField(max_length=120, required=False, allow_blank=True)
    nuevo = NuevoProductoEntrada(required=False)
    cantidad = serializers.DecimalField(max_digits=14, decimal_places=3)
    total = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)
    costo_unitario = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)

    def validate(self, d):
        if d.get("total") is None and d.get("costo_unitario") is None:
            raise serializers.ValidationError("Envía el total de la línea o el costo unitario.")
        if not d.get("producto") and not d.get("nuevo") and not (d.get("nombre") or "").strip():
            raise serializers.ValidationError("Elige el producto o escribe qué compraste.")
        return d


class CompraSerializer(serializers.ModelSerializer):
    proveedor = TenantFKField(queryset=Proveedor.objects.all(), allow_null=True, required=False)
    proveedor_nombre = serializers.CharField(source="proveedor.nombre", read_only=True, default=None)
    detalles = serializers.SerializerMethodField()
    items = DetalleCompraEntrada(many=True, write_only=True)
    fecha = serializers.DateField(required=False)

    class Meta:
        model = Compra
        fields = ["id", "numero", "proveedor", "proveedor_nombre", "fecha", "total", "medio",
                  "pagado_de_caja", "nota", "detalles", "items", "creado", "anulada", "editada_en", "total_insumos"]
        read_only_fields = ["numero", "total", "anulada", "editada_en"]

    total_insumos = serializers.SerializerMethodField()

    def get_detalles(self, c):
        return [{"producto": d.producto_id, "nombre": d.producto.nombre if d.producto else d.nombre,
                 "insumo": d.producto_id is None, "cantidad": d.cantidad,
                 "costo_unitario": d.costo_unitario, "subtotal": d.subtotal}
                for d in c.detalles.select_related("producto")]

    def get_total_insumos(self, c):
        return sum((d.subtotal for d in c.detalles.all() if d.producto_id is None), CERO)


class ProveedorViewSet(TenantModelViewSet):
    queryset = Proveedor.objects.all()
    serializer_class = ProveedorSerializer
    modulo = "gastos"


class CategoriaGastoViewSet(TenantModelViewSet):
    queryset = CategoriaGasto.objects.all()
    serializer_class = CategoriaGastoSerializer
    modulo = "gastos"

    def list(self, request, *args, **kwargs):
        if not self.get_queryset().exists():  # crea las categorías por defecto la primera vez
            CategoriaGasto.objects.bulk_create(
                [CategoriaGasto(negocio=self.negocio, nombre=n) for n in CATEGORIAS_GASTO_DEFECTO])
        return super().list(request, *args, **kwargs)


class GastoViewSet(TenantMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                   mixins.CreateModelMixin, viewsets.GenericViewSet):
    """Cajero puede registrar gastos pagados de caja (ej. hielo, domicilio). Solo admin anula."""
    queryset = Gasto.objects.select_related("categoria", "proveedor")
    serializer_class = GastoSerializer
    modulo = "gastos"

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list":
            desde, hasta = leer_rango(self.request, dias_defecto=30)
            qs = qs.filter(fecha__range=(desde, hasta))
        return qs

    @transaction.atomic
    def perform_create(self, serializer):
        fecha = serializer.validated_data.get("fecha") or hoy()
        momento = momento_en(fecha)  # gasto de un día anterior: su dinero sale del cuadre de ESE día
        g = serializer.save(negocio=self.negocio, usuario=self.request.user, fecha=fecha)
        if g.pagado_de_caja:
            caja.registrar(self.negocio, Origen.GASTO, -g.monto, medio=g.medio, concepto=g.descripcion,
                           referencia=f"gasto:{g.id}", usuario=self.request.user, momento=momento)

    @action(detail=True, methods=["post"], permission_classes=PERMISOS_TENANT + [EsAdmin])
    @transaction.atomic
    def anular(self, request, pk=None):
        g = self.get_object()
        if g.anulado:
            raise ValidationError("Ya está anulado.")
        g.anulado = True
        g.save(update_fields=["anulado", "actualizado"])
        if g.pagado_de_caja:
            # Un gasto registrado por error se borra del cuadre de su día (sin caja registradora o caja abierta)
            from caja.models import MovimientoCaja
            movs = MovimientoCaja.objects.filter(negocio=self.negocio, referencia=f"gasto:{g.id}")
            if all(m.sesion_id is None or m.sesion.estado == "ABIERTA" for m in movs):
                movs.delete()
            else:  # su caja ya se cerró: el dinero vuelve en la caja de hoy
                caja.registrar(self.negocio, Origen.GASTO, g.monto, medio=g.medio,
                               concepto=f"Anula gasto: {g.descripcion}", referencia=f"gasto:{g.id}",
                               usuario=request.user)
        return Response(GastoSerializer(g, context=self.get_serializer_context()).data)


class CompraViewSet(TenantMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                    mixins.CreateModelMixin, viewsets.GenericViewSet):
    """
    Compra a proveedor. Productos del catálogo: entra stock y actualiza costo promedio.
    Líneas sin producto (insumos que no se venden): no tocan inventario y cuentan como gasto.
    POST /compras/{id}/editar/    {items, proveedor, fecha, medio, pagado_de_caja, nota}
    POST /compras/{id}/eliminar/  se ingresó por error: devuelve inventario y plata
    """
    queryset = Compra.objects.select_related("proveedor").prefetch_related("detalles__producto")
    serializer_class = CompraSerializer
    permission_classes = PERMISOS_TENANT + [EsAdmin]
    modulo = "gastos"

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list" and self.request.query_params.get("anuladas") != "1":
            qs = qs.filter(anulada=False)
        return qs

    # --- inventario ---
    def _crear_producto(self, nuevo):
        nombre = nuevo["nombre"].strip()
        if not nombre:
            raise ValidationError("Escribe el nombre del producto nuevo.")
        if Producto.objects.filter(negocio=self.negocio, nombre__iexact=nombre).exists():
            raise ValidationError(f"Ya tienes un producto llamado «{nombre}»: elígelo en la lista.")
        categoria = None
        if nuevo.get("categoria"):
            categoria = Categoria.objects.filter(negocio=self.negocio, pk=nuevo["categoria"]).first()
            if categoria is None:
                raise ValidationError("Esa categoría no existe.")
        return Producto.objects.create(negocio=self.negocio, nombre=nombre, precio=nuevo["precio"],
                                       categoria=categoria, controla_stock=True)

    def _aplicar(self, compra, items):
        for it in items:  # productos nuevos: se crean primero y quedan como cualquier otro
            if it.get("nuevo") and not it.get("producto"):
                it["producto"] = self._crear_producto(it["nuevo"]).id
        ids = [i["producto"] for i in items if i.get("producto")]
        productos = {p.id: p for p in Producto.objects.filter(negocio=self.negocio, id__in=ids)}
        total = CERO
        for it in items:
            p = None
            if it.get("producto"):
                p = productos.get(it["producto"])
                if not p:
                    raise ValidationError(f"Producto {it['producto']} no existe.")
            if it["cantidad"] <= 0:
                raise ValidationError("Cantidad inválida.")
            if it.get("total") is not None:  # lo pagado por la línea manda; el unitario sale de dividir
                sub = it["total"]
                it["costo_unitario"] = (sub / it["cantidad"]).quantize(Decimal("0.01"))
            else:
                sub = (it["cantidad"] * it["costo_unitario"]).quantize(Decimal("0.01"))
            if sub < 0:
                raise ValidationError("Valor inválido.")
            DetalleCompra.objects.create(compra=compra, producto=p, nombre="" if p else it["nombre"].strip(),
                                         cantidad=it["cantidad"], costo_unitario=it["costo_unitario"], subtotal=sub)
            total += sub
            if p is None:
                continue  # insumo: no entra al inventario
            if p.controla_stock:
                mover_stock(p, it["cantidad"], MovimientoInventario.Tipo.COMPRA, usuario=self.request.user,
                            referencia=f"Compra #{compra.numero}", costo_unitario=it["costo_unitario"])
            else:
                p.costo = it["costo_unitario"]
                p.save(update_fields=["costo"])
        compra.total = total
        compra.save(update_fields=["total", "actualizado"])

    def _revertir(self, compra, motivo):
        """Saca del inventario lo que entró con la compra y deshace su efecto en el costo promedio."""
        for d in compra.detalles.select_related("producto"):
            p = d.producto
            if p is None or not p.controla_stock:
                continue
            p.refresh_from_db()
            stock_antes, costo_antes = p.stock, p.costo
            mover_stock(p, d.cantidad, MovimientoInventario.Tipo.ANULACION_COMPRA, usuario=self.request.user,
                        referencia=f"Compra #{compra.numero}", nota=motivo)
            resto = stock_antes - d.cantidad
            if resto > 0:
                costo = ((stock_antes * costo_antes) - (d.cantidad * d.costo_unitario)) / resto
                if costo > 0:
                    Producto.objects.filter(pk=p.pk).update(costo=costo.quantize(Decimal("0.01")))
        compra.detalles.all().delete()

    # --- plata ---
    def _sacar_plata(self, compra):
        nombre = compra.proveedor.nombre if compra.proveedor else "proveedor"
        caja.registrar(self.negocio, Origen.COMPRA, -compra.total, medio=compra.medio,
                       concepto=f"Compra #{compra.numero} a {nombre}", referencia=f"compra:{compra.id}",
                       usuario=self.request.user, momento=momento_en(compra.fecha))

    def _devolver_plata(self, compra, concepto):
        """Si su caja sigue abierta (o no hay caja registradora) se borra del cuadre de su día; si no, vuelve hoy."""
        from caja.models import MovimientoCaja
        movs = MovimientoCaja.objects.filter(negocio=self.negocio, referencia=f"compra:{compra.id}")
        if all(m.sesion_id is None or m.sesion.estado == "ABIERTA" for m in movs):
            movs.delete()
        else:
            neto = -sum((m.monto for m in movs), CERO)  # lo que salió y no se ha devuelto
            if neto > 0:
                caja.registrar(self.negocio, Origen.COMPRA, neto, medio=compra.medio, concepto=concepto,
                               referencia=f"compra:{compra.id}", usuario=self.request.user)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        items = d.pop("items")
        if not items:
            raise ValidationError("La compra no tiene productos.")
        compra = Compra.objects.create(negocio=self.negocio, numero=Consecutivo.siguiente(self.negocio, "compra"),
                                       usuario=request.user, fecha=d.pop("fecha", None) or hoy(), **d)
        momento_en(compra.fecha)  # valida la fecha
        self._aplicar(compra, items)
        if compra.pagado_de_caja:
            self._sacar_plata(compra)
        return Response(CompraSerializer(compra, context=self.get_serializer_context()).data, status=201)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def editar(self, request, pk=None):
        compra = Compra.objects.select_for_update().get(pk=self.get_object().pk)
        if compra.anulada:
            raise ValidationError("Esta compra ya se eliminó.")
        s = self.get_serializer(compra, data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        items = d.pop("items")
        if not items:
            raise ValidationError("La compra no tiene productos.")
        # Se deshace la compra como estaba y se vuelve a aplicar como quedó
        if compra.pagado_de_caja:
            self._devolver_plata(compra, f"Corrige compra #{compra.numero}")
        self._revertir(compra, "Compra corregida")
        for k in ("proveedor", "medio", "pagado_de_caja", "nota"):
            if k in d:
                setattr(compra, k, d[k])
        compra.fecha = d.get("fecha") or compra.fecha
        momento_en(compra.fecha)
        compra.editada_en = timezone.now()
        compra.save()
        self._aplicar(compra, items)
        if compra.pagado_de_caja:
            self._sacar_plata(compra)
        return Response(CompraSerializer(compra, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def eliminar(self, request, pk=None):
        compra = Compra.objects.select_for_update().get(pk=self.get_object().pk)
        if compra.anulada:
            raise ValidationError("Esta compra ya se eliminó.")
        if compra.pagado_de_caja:
            self._devolver_plata(compra, f"Elimina compra #{compra.numero}")
        # Se guarda lo que tenía antes de revertir (para el historial)
        lineas = [(d.producto_id, d.nombre, d.cantidad, d.costo_unitario, d.subtotal) for d in compra.detalles.all()]
        self._revertir(compra, (request.data.get("motivo") or "Compra eliminada")[:200])
        for prod, nombre, cant, cu, sub in lineas:
            DetalleCompra.objects.create(compra=compra, producto_id=prod, nombre=nombre, cantidad=cant,
                                         costo_unitario=cu, subtotal=sub)
        compra.anulada = True
        compra.save(update_fields=["anulada", "actualizado"])
        return Response({"eliminada": True, "numero": compra.numero})
