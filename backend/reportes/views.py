import csv

from django.db.models import Count, F, Sum
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from negocios.mixins import PERMISOS_TENANT, TenantMixin
from negocios.permisos import EsAdmin
from negocios.utils import leer_rango

from . import servicios


class ReportesViewSet(TenantMixin, viewsets.ViewSet):
    """
    GET /reportes/resumen/?desde&hasta        estado de resultados del periodo
    GET /reportes/diario/?desde&hasta         serie por día (para gráficas)
    GET /reportes/top-productos/?desde&hasta
    GET /reportes/exportar/?tipo=ventas|gastos&desde&hasta   CSV
    """
    permission_classes = PERMISOS_TENANT + [EsAdmin]
    modulo = "reportes"

    @action(detail=False)
    def resumen(self, request):
        return Response(servicios.resumen(self.negocio, *leer_rango(request)))

    @action(detail=False)
    def diario(self, request):
        desde, hasta = leer_rango(request, dias_defecto=29)
        if (hasta - desde).days > 400:
            raise ValidationError("Máximo 400 días.")
        return Response(servicios.serie_diaria(self.negocio, desde, hasta))

    @action(detail=False, url_path="top-productos")
    def top_productos(self, request):
        from ventas.models import DetalleVenta
        desde, hasta = leer_rango(request, dias_defecto=29)
        ventas = servicios.ventas_validas(self.negocio, desde, hasta)
        filas = (DetalleVenta.objects.filter(venta__in=ventas)
                 .values("producto_id", "nombre")
                 .annotate(unidades=Sum("cantidad"), vendido=Sum("subtotal"),
                           costo=Sum(F("costo_unitario") * F("cantidad")), veces=Count("id"))
                 .order_by("-vendido")[:int(request.query_params.get("limite", 20))])
        return Response([{"producto_id": f["producto_id"], "nombre": f["nombre"], "cantidad": f["unidades"],
                          "vendido": f["vendido"], "costo": f["costo"], "veces": f["veces"],
                          "utilidad": f["vendido"] - (f["costo"] or 0)} for f in filas])

    @action(detail=False)
    def exportar(self, request):
        desde, hasta = leer_rango(request, dias_defecto=29)
        tipo = request.query_params.get("tipo", "ventas")
        resp = HttpResponse(content_type="text/csv; charset=utf-8")
        resp["Content-Disposition"] = f'attachment; filename="{tipo}_{desde}_{hasta}.csv"'
        resp.write("﻿")  # BOM para que Excel abra bien las tildes
        w = csv.writer(resp, delimiter=";")
        if tipo == "ventas":
            w.writerow(["Número", "Fecha", "Estado", "Cliente", "Subtotal", "Descuento", "Total", "Costo",
                        "Utilidad", "Saldo pendiente", "Cajero"])
            for v in servicios.ventas_validas(self.negocio, desde, hasta).select_related("cliente", "usuario").order_by("creado"):
                w.writerow([v.numero, timezone.localtime(v.creado).strftime("%Y-%m-%d %H:%M"), v.estado,
                            v.cliente.nombre if v.cliente else "", v.subtotal, v.descuento, v.total, v.costo_total,
                            v.utilidad, v.saldo_pendiente, v.usuario.username])
        elif tipo == "gastos":
            from gastos.models import Gasto
            w.writerow(["Fecha", "Categoría", "Descripción", "Proveedor", "Monto", "Medio"])
            for g in (Gasto.objects.filter(negocio=self.negocio, anulado=False, fecha__range=(desde, hasta))
                      .select_related("categoria", "proveedor").order_by("fecha")):
                w.writerow([g.fecha, g.categoria.nombre, g.descripcion, g.proveedor.nombre if g.proveedor else "",
                            g.monto, g.medio])
        else:
            raise ValidationError("tipo debe ser ventas o gastos.")
        return resp
