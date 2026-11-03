import datetime as dt
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from catalogo.models import Categoria, Producto
from creditos import calculos as C
from creditos.models import Credito, TasaUsura
from negocios.models import Negocio
from negocios.utils import hoy
from usuarios.models import Usuario


class Base(TestCase):
    def setUp(self):
        self.neg = Negocio.objects.create(nombre="Café Aroma", usa_caja=True)
        self.otro = Negocio.objects.create(nombre="Tienda Don Luis", tipo="TIENDA")
        self.admin = self._u("dueno", "ADMIN", self.neg)
        self.cajero = self._u("cajero", "CAJERO", self.neg)
        self.admin_otro = self._u("luis", "ADMIN", self.otro)
        self.sa = self._u("cavatech", "SUPERADMIN", None)
        self.cat = Categoria.objects.create(negocio=self.neg, nombre="Bebidas")
        self.cafe = Producto.objects.create(negocio=self.neg, categoria=self.cat, nombre="Tinto", precio=2000, costo=500, stock=0)
        self.pan = Producto.objects.create(negocio=self.neg, nombre="Pan de bono", precio=3000, costo=1000, stock=0)
        self.c = APIClient()

    def _u(self, username, rol, negocio):
        return Usuario.objects.create_user(username, password="clave123", rol=rol, negocio=negocio)

    def login(self, username):
        r = self.c.post("/api/login/", {"username": username, "password": "clave123"})
        self.assertEqual(r.status_code, 200, r.content)
        self.c.credentials(HTTP_AUTHORIZATION="Token " + r.json()["token"])

    def ok(self, r, code=200):
        self.assertEqual(r.status_code, code, r.content)
        return r.json() if r.get("Content-Type", "").startswith("application/json") else r

    def stock(self, p, cantidad):
        self.ok(self.c.post("/api/inventario/", {"producto": p.id, "tipo": "AJUSTE_ENTRADA", "cantidad": cantidad}, format="json"), 201)

    def abrir_caja(self, base=50000):
        return self.ok(self.c.post("/api/caja/abrir/", {"base_inicial": base}, format="json"), 201)


class TenantYPermisos(Base):
    def test_aislamiento_entre_negocios(self):
        Producto.objects.create(negocio=self.otro, nombre="Arroz", precio=4000)
        self.login("luis")
        nombres = [p["nombre"] for p in self.ok(self.c.get("/api/productos/"))]
        self.assertEqual(nombres, ["Arroz"])
        # No puede usar una categoría de otro negocio
        r = self.c.post("/api/productos/", {"nombre": "X", "precio": 1, "categoria": self.cat.id}, format="json")
        self.assertEqual(r.status_code, 400)
        # Ni ver un producto ajeno por id
        self.assertEqual(self.c.get(f"/api/productos/{self.cafe.id}/").status_code, 404)

    def test_cajero_no_ve_creditos_ni_reportes(self):
        self.login("cajero")
        self.assertEqual(self.c.get("/api/creditos/").status_code, 403)
        self.assertEqual(self.c.get("/api/reportes/resumen/").status_code, 403)
        self.assertEqual(self.c.post("/api/productos/", {"nombre": "x", "precio": 1}).status_code, 403)

    def test_modulo_desactivado(self):
        self.neg.modulos = ["catalogo", "pos", "caja"]
        self.neg.save()
        self.login("dueno")
        self.assertEqual(self.c.get("/api/creditos/").status_code, 403)
        self.ok(self.c.get("/api/productos/"))

    def test_superadmin_suspende_y_corta_sesion(self):
        self.login("dueno")
        token_dueno = self.c._credentials["HTTP_AUTHORIZATION"]
        self.login("cavatech")
        n = self.ok(self.c.post("/api/saas/negocios/", {"nombre": "Panadería Sol", "admin_username": "sol",
                                                        "admin_password": "clave123"}, format="json"), 201)
        self.ok(self.c.post(f"/api/saas/negocios/{self.neg.id}/suspender/"))
        self.c.credentials(HTTP_AUTHORIZATION=token_dueno)
        self.assertEqual(self.c.get("/api/productos/").status_code, 401)  # token borrado
        self.assertEqual(self.c.post("/api/login/", {"username": "dueno", "password": "clave123"}).status_code, 403)
        self.login("sol")
        self.assertEqual(self.ok(self.c.get("/api/yo/"))["negocio"]["id"], n["id"])


class VentasCajaInventario(Base):
    def test_flujo_completo_dia(self):
        self.login("dueno")
        self.stock(self.cafe, 100)
        self.stock(self.pan, 20)
        self.assertEqual(self.c.post("/api/ventas/", {"items": [{"producto": self.cafe.id}]}, format="json").status_code, 400)  # sin caja
        self.abrir_caja(50000)

        # Venta mixta con cambio
        v = self.ok(self.c.post("/api/ventas/", {
            "items": [{"producto": self.cafe.id, "cantidad": 2}, {"producto": self.pan.id, "cantidad": 1}],
            "pagos": [{"medio": "EFECTIVO", "monto": 5000}, {"medio": "NEQUI", "monto": 2000}],
            "efectivo_recibido": 10000}, format="json"), 201)
        self.assertEqual(v["total"], 7000)
        self.assertEqual(v["cambio"], 5000)
        self.assertEqual(v["estado"], "PAGADA")
        self.assertIn("wa.me", v["whatsapp_recibo"])
        self.cafe.refresh_from_db()
        self.assertEqual(self.cafe.stock, 98)

        # Pagos mayores al total -> error
        r = self.c.post("/api/ventas/", {"items": [{"producto": self.cafe.id}], "pagos": [{"medio": "EFECTIVO", "monto": 9000}]}, format="json")
        self.assertEqual(r.status_code, 400)
        # Fiado sin cliente -> error; con cliente -> ok
        r = self.c.post("/api/ventas/", {"items": [{"producto": self.pan.id, "cantidad": 2}]}, format="json")
        self.assertEqual(r.status_code, 400)
        cli = self.ok(self.c.post("/api/clientes/", {"nombre": "Doña Marta", "telefono": "3001234567"}, format="json"), 201)
        f = self.ok(self.c.post("/api/ventas/", {"items": [{"producto": self.pan.id, "cantidad": 2}], "cliente": cli["id"],
                                                 "pagos": [{"medio": "EFECTIVO", "monto": 1000}]}, format="json"), 201)
        self.assertEqual(f["estado"], "FIADO")
        self.assertEqual(f["saldo_pendiente"], 5000)
        deud = self.ok(self.c.get("/api/clientes/deudores/"))
        self.assertEqual(deud["total_cartera"], 5000)
        ab = self.ok(self.c.post(f"/api/clientes/{cli['id']}/abonar/", {"monto": 5000, "medio": "DAVIPLATA"}, format="json"), 201)
        self.assertEqual(ab["saldo_cliente"], 0)
        self.assertIn("57300", self.ok(self.c.get(f"/api/clientes/{cli['id']}/recordatorio/"))["whatsapp"])

        # Gasto pagado de caja
        cats = self.ok(self.c.get("/api/categorias-gasto/"))
        self.ok(self.c.post("/api/gastos/", {"categoria": cats[0]["id"], "descripcion": "Bolsa de hielo", "monto": 3000}, format="json"), 201)

        # Compra: costo promedio ponderado (98 tintos a 500 + 2 a 1500 -> 520)
        self.ok(self.c.post("/api/compras/", {"items": [{"producto": self.cafe.id, "cantidad": 2, "costo_unitario": 1500}],
                                              "pagado_de_caja": False}, format="json"), 201)
        self.cafe.refresh_from_db()
        self.assertEqual(self.cafe.stock, 100)
        self.assertEqual(self.cafe.costo, Decimal("520.00"))

        # Anular la primera venta: devuelve stock y dinero
        self.ok(self.c.post(f"/api/ventas/{v['id']}/anular/", {"motivo": "Error de digitación"}, format="json"))
        self.cafe.refresh_from_db()
        self.assertEqual(self.cafe.stock, 102)

        actual = self.ok(self.c.get("/api/caja/actual/"))["resumen"]
        # efectivo: 50000 base + 5000 venta + 1000 fiado - 3000 hielo - 5000 anulación = 48000
        self.assertEqual(actual["efectivo_esperado"], 48000)
        self.assertEqual(actual["total_por_medio"]["DAVIPLATA"], 5000)
        cierre = self.ok(self.c.post("/api/caja/cerrar/", {"efectivo_contado": 47000}, format="json"))
        self.assertEqual(cierre["diferencia"], -1000)
        self.assertIn("Faltan", cierre["alerta"])

        # Reporte: venta anulada fuera; fiado sí cuenta como venta
        res = self.ok(self.c.get("/api/reportes/resumen/"))
        self.assertEqual(res["ventas_netas"], 6000)
        self.assertEqual(res["costo_ventas"], 2000)
        self.assertEqual(res["gastos_operativos"], 3000)
        self.assertEqual(res["utilidad_operativa"], 1000)
        self.assertEqual(self.c.get("/api/reportes/exportar/?tipo=ventas").status_code, 200)
        self.assertEqual(self.c.get("/api/reportes/exportar/?tipo=gastos").status_code, 200)
        top = self.ok(self.c.get("/api/reportes/top-productos/"))
        self.assertEqual(top[0]["nombre"], "Pan de bono")
        self.assertEqual((top[0]["cantidad"], top[0]["vendido"], top[0]["utilidad"]), (2, 6000, 4000))
        dias = self.ok(self.c.get("/api/reportes/diario/"))
        self.assertEqual(len(dias), 30)
        self.assertEqual(dias[-1]["ventas"], 6000)

        # Recibo público sin login
        venta = self.ok(self.c.get(f"/api/ventas/{f['id']}/"))
        anon = APIClient()
        self.ok(anon.get(f"/api/public/recibo/{venta['token_publico']}/"))

    def test_bloqueo_sin_stock(self):
        self.neg.bloquear_sin_stock = True
        self.neg.save()
        self.login("dueno")
        self.abrir_caja()
        r = self.c.post("/api/ventas/", {"items": [{"producto": self.cafe.id}], "pagos": [{"medio": "EFECTIVO", "monto": 2000}]}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("Stock insuficiente", str(r.content.decode()))


class MotorFinanciero(TestCase):
    def test_tabla_francesa_cuadra(self):
        i = C.ea_a_periodica(C.a_ea(24, "EA"), "MENSUAL")
        filas = C.tabla_francesa(1_000_000, i, n=12)
        self.assertEqual(len(filas), 12)
        self.assertEqual(sum(f["capital"] for f in filas), 1_000_000)
        self.assertEqual(filas[-1]["saldo_final"], 0)
        tir = C.periodica_a_ea(C.tir_periodica(1_000_000, [f["valor"] for f in filas]), "MENSUAL")
        self.assertAlmostEqual(tir, 0.24, places=3)

    def test_interes_plano_es_mas_caro(self):
        # "gota a gota": 20% mensual, 30 cuotas diarias -> costo real muy por encima
        filas = C.tabla_plana(100_000, 0.20, 30, "DIARIA")
        self.assertEqual(sum(f["valor"] for f in filas), 120_000)
        ea_real = C.periodica_a_ea(C.tir_periodica(100_000, [f["valor"] for f in filas]), "DIARIA")
        self.assertGreater(ea_real, (1.20 ** 12) - 1)


class Creditos(Base):
    def crear(self, **extra):
        datos = {"entidad": "Bancamía", "monto": 6_000_000, "tasa": 30, "tipo_tasa": "EA", "frecuencia": "MENSUAL",
                 "num_cuotas": 12, "fecha_desembolso": str(hoy()),
                 "fecha_primera_cuota": str(hoy() + dt.timedelta(days=30))}
        datos.update(extra)
        return self.ok(self.c.post("/api/creditos/", datos, format="json"), 201)

    def test_credito_completo(self):
        self.login("dueno")
        TasaUsura.objects.create(modalidad="CONSUMO", vigente_desde=hoy() - dt.timedelta(days=10), tasa_ea=Decimal("25"))
        prev = self.ok(self.c.post("/api/creditos/preview/", {"monto": 6_000_000, "tasa": 30, "num_cuotas": 12}, format="json"))
        self.assertTrue(prev["supera_usura"])
        self.assertEqual(len(prev["tabla"]), 12)

        self.stock(self.cafe, 1000)
        self.abrir_caja(100000)
        cr = self.crear(desembolso_a_caja=True, medio_desembolso="EFECTIVO")
        self.assertEqual(len(cr["cuotas"]), 12)
        self.assertEqual(sum(Decimal(str(q["capital"])) for q in cr["cuotas"]), 6_000_000)
        cuota = Decimal(str(cr["cuota_valor"]))

        # Desembolso entra a caja pero NO es utilidad
        res = self.ok(self.c.get("/api/reportes/resumen/"))
        self.assertEqual(res["utilidad_operativa"], 0)
        self.assertEqual(res["no_operativo"]["desembolsos_credito"], 6_000_000)

        # Ventas del día para que exista utilidad
        for _ in range(5):
            self.ok(self.c.post("/api/ventas/", {"items": [{"producto": self.cafe.id, "cantidad": 100}],
                                                 "pagos": [{"medio": "EFECTIVO", "monto": 200000}]}, format="json"), 201)

        # Tablero: meta del día, semáforo, alerta de usura
        t = self.ok(self.c.get("/api/creditos/tablero/"))
        self.assertEqual(t["creditos_activos"], 1)
        self.assertGreater(t["meta_dia"]["apartar_hoy"], 0)
        self.assertEqual(t["meta_dia"]["utilidad_operativa_hoy"], 750000)
        self.assertEqual(t["meta_dia"]["semaforo_hoy"], "VERDE")
        self.assertTrue(any("usura" in a["mensaje"] for a in t["alertas"]))

        # Apartar desde la caja: sale efectivo y entra al fondo
        self.ok(self.c.post("/api/creditos/apartar/", {"monto": 700000, "credito": cr["id"]}, format="json"), 201)
        caja = self.ok(self.c.get("/api/caja/actual/"))["resumen"]
        self.assertEqual(caja["efectivo_esperado"], 100000 + 6_000_000 + 1_000_000 - 700000)

        # Pagar la primera cuota desde el fondo
        pago = self.ok(self.c.post(f"/api/creditos/{cr['id']}/pagar/",
                                   {"monto": str(cuota), "origen_fondos": "FONDO"}, format="json"), 201)
        self.assertEqual(Decimal(str(pago["aplicado_capital"])) + Decimal(str(pago["aplicado_interes"])), cuota)
        self.assertEqual(self.ok(self.c.get("/api/creditos/fondo/"))["saldo"], 700000 - cuota)
        # Fondo insuficiente -> error claro
        r = self.c.post(f"/api/creditos/{cr['id']}/pagar/", {"monto": str(cuota), "origen_fondos": "FONDO"}, format="json")
        self.assertEqual(r.status_code, 400)

        # Interés pagado sí resta a la utilidad neta
        res = self.ok(self.c.get("/api/reportes/resumen/"))
        self.assertEqual(res["intereses_creditos"], pago["aplicado_interes"])
        self.assertEqual(res["utilidad_neta"], res["utilidad_operativa"] - pago["aplicado_interes"])

        # Simulación y plan recomendado
        sim = self.ok(self.c.post(f"/api/creditos/{cr['id']}/simular/", {"abono_extra_periodico": 200000}, format="json"))
        self.assertGreater(sim["periodos_menos"], 0)
        self.assertGreater(sim["intereses_ahorrados"], 0)
        plan = self.ok(self.c.get(f"/api/creditos/{cr['id']}/plan/?porcentaje=50"))
        self.assertGreater(plan["abono_extra_por_cuota"], 0)
        self.assertIn("antes", plan["mensaje"])
        self.assertEqual(len(plan["escenarios"]), 3)

        # Abono a capital reduciendo plazo: termina antes y ahorra intereses
        ab = self.ok(self.c.post(f"/api/creditos/{cr['id']}/abonar-capital/",
                                 {"monto": 1_500_000, "estrategia": "REDUCIR_PLAZO", "origen_fondos": "CAJA"}, format="json"), 201)
        self.assertGreater(ab["efecto"]["cuotas_menos"], 0)
        self.assertGreater(ab["efecto"]["intereses_ahorrados"], 0)
        det = self.ok(self.c.get(f"/api/creditos/{cr['id']}/"))
        self.assertEqual(Decimal(str(det["cuota_valor"])), cuota)  # misma cuota
        capital_total = sum(Decimal(str(q["capital"])) for q in det["cuotas"]) + Decimal(1_500_000)
        self.assertEqual(capital_total, 6_000_000)  # todo cuadra al peso

        # Abono reduciendo cuota: mismo número de cuotas, cuota menor
        antes = len([q for q in det["cuotas"] if q["estado"] == "PENDIENTE"])
        ab2 = self.ok(self.c.post(f"/api/creditos/{cr['id']}/abonar-capital/",
                                  {"monto": 500_000, "estrategia": "REDUCIR_CUOTA", "origen_fondos": "EXTERNO"}, format="json"), 201)
        self.assertEqual(ab2["efecto"]["cuotas_menos"], 0)
        self.assertLess(Decimal(str(ab2["efecto"]["despues"]["cuota"])), cuota)
        det = self.ok(self.c.get(f"/api/creditos/{cr['id']}/"))
        self.assertEqual(len([q for q in det["cuotas"] if q["estado"] == "PENDIENTE"]), antes)

        # Pagar todo lo pendiente -> crédito PAGADO
        pend = det["resumen"]["deuda_pendiente_cuotas"]
        self.ok(self.c.post(f"/api/creditos/{cr['id']}/pagar/", {"monto": pend, "origen_fondos": "EXTERNO"}, format="json"), 201)
        self.assertEqual(Credito.objects.get(pk=cr["id"]).estado, "PAGADO")

    def test_plano_no_permite_abono_y_estrategias(self):
        self.login("dueno")
        plano = self.crear(entidad="Don Pedro", tipo_entidad="PRESTAMISTA", sistema="PLANO", monto=1_000_000,
                           tasa=10, tipo_tasa="MENSUAL", frecuencia="DIARIA", num_cuotas=60)
        self.assertGreater(Decimal(str(plano["tasa_ea_real"])), Decimal("213"))  # 10% mensual ≈ 213.8% EA
        r = self.c.post(f"/api/creditos/{plano['id']}/abonar-capital/", {"monto": 100000}, format="json")
        self.assertEqual(r.status_code, 400)
        sim = self.ok(self.c.post(f"/api/creditos/{plano['id']}/simular/", {"abono_unico": 300000}, format="json"))
        self.assertEqual(sim["intereses_ahorrados"], 0)
        self.assertIn("Negócialo", sim["nota"])

        self.crear(entidad="Banco", monto=3_000_000, tasa=25, num_cuotas=24)
        est = self.ok(self.c.get("/api/creditos/estrategia/?extra_mensual=300000"))
        self.assertTrue(est["avalancha"]["orden_pago"][0].startswith("Don Pedro"))  # el más caro primero
        self.assertLessEqual(est["avalancha"]["interes_total"], est["bola_de_nieve"]["interes_total"])
        self.assertGreater(est["ahorro_vs_sin_extra"], 0)

    def test_cierre_de_caja_aparta_para_credito(self):
        self.login("dueno")
        cr = self.crear()
        self.abrir_caja(20000)
        cierre = self.ok(self.c.post("/api/caja/cerrar/", {"efectivo_contado": 10000, "apartar_credito": 10000,
                                                           "credito": cr["id"]}, format="json"))
        self.assertEqual(cierre["efectivo_esperado"], 10000)
        self.assertEqual(cierre["diferencia"], 0)
        self.assertEqual(self.ok(self.c.get("/api/creditos/fondo/"))["saldo"], 10000)


class SinCajaRegistradora(Base):
    """Cafetería sin caja registradora: vende directo y cuadra por día."""

    def setUp(self):
        super().setUp()
        self.neg.usa_caja = False
        self.neg.save()

    def test_vende_sin_abrir_caja_y_cuadra_el_dia(self):
        self.login("dueno")
        self.stock(self.cafe, 50)
        self.assertEqual(self.c.post("/api/caja/abrir/", {"base_inicial": 0}, format="json").status_code, 400)
        self.ok(self.c.post("/api/ventas/", {"items": [{"producto": self.cafe.id, "cantidad": 3}],
                                             "pagos": [{"medio": "EFECTIVO", "monto": 6000}]}, format="json"), 201)
        self.ok(self.c.post("/api/ventas/", {"items": [{"producto": self.cafe.id, "cantidad": 1}],
                                             "pagos": [{"medio": "NEQUI", "monto": 2000}]}, format="json"), 201)
        cats = self.ok(self.c.get("/api/categorias-gasto/"))
        self.ok(self.c.post("/api/gastos/", {"categoria": cats[0]["id"], "descripcion": "Leche", "monto": 2500}, format="json"), 201)

        dia = self.ok(self.c.get("/api/caja/dia/"))
        self.assertFalse(dia["usa_caja"])
        self.assertEqual(dia["total_por_medio"]["EFECTIVO"], 3500)
        self.assertEqual(dia["total_por_medio"]["NEQUI"], 2000)
        self.assertEqual(dia["entradas"], 8000)
        self.assertEqual(dia["salidas"], 2500)
        self.assertFalse(self.ok(self.c.get("/api/caja/actual/"))["usa_caja"])

        # Créditos: apartar y pagar también funcionan sin caja
        cr = self.ok(self.c.post("/api/creditos/", {"entidad": "Coop", "monto": 1_000_000, "tasa": 24, "num_cuotas": 6,
                     "fecha_desembolso": str(hoy()), "fecha_primera_cuota": str(hoy() + dt.timedelta(days=30))},
                                 format="json"), 201)
        self.ok(self.c.post("/api/creditos/apartar/", {"monto": 3000}, format="json"), 201)
        self.ok(self.c.post(f"/api/creditos/{cr['id']}/pagar/", {"monto": 3000, "origen_fondos": "FONDO"}, format="json"), 201)
        self.assertEqual(self.ok(self.c.get("/api/caja/dia/"))["total_por_medio"]["EFECTIVO"], 500)


class FotosMenuPedidos(Base):
    def test_foto_producto_se_normaliza(self):
        import io
        import tempfile
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings
        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGBA", (2000, 1500), (200, 120, 40, 255)).save(buf, "PNG")
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp, R2_BUCKET="", DEBUG=True):
            self.login("dueno")
            r = self.c.post(f"/api/productos/{self.cafe.id}/foto/",
                            {"foto": SimpleUploadedFile("tinto.png", buf.getvalue(), "image/png")}, format="multipart")
            self.assertEqual(r.status_code, 200, r.content)
            url = r.json()["foto_url"]
            self.assertTrue(url.endswith(".webp"))
            ruta = tmp + "/" + url.split("/media/", 1)[1]
            self.assertLessEqual(max(Image.open(ruta).size), 900)
            # Archivo que no es imagen -> error claro
            r = self.c.post(f"/api/productos/{self.cafe.id}/foto/",
                            {"foto": SimpleUploadedFile("x.png", b"no soy imagen", "image/png")}, format="multipart")
            self.assertEqual(r.status_code, 400)
            self.ok(self.c.delete(f"/api/productos/{self.cafe.id}/foto/"))
            self.cafe.refresh_from_db()
            self.assertEqual(self.cafe.foto_url, "")
        # El cajero no puede cambiar fotos
        self.login("cajero")
        self.assertEqual(self.c.delete(f"/api/productos/{self.cafe.id}/foto/").status_code, 403)

    def test_foto_sin_r2_en_produccion_da_error_claro(self):
        import io
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings
        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (50, 50)).save(buf, "PNG")
        self.login("dueno")
        foto = lambda: {"foto": SimpleUploadedFile("a.png", buf.getvalue(), "image/png")}
        with override_settings(DEBUG=False, R2_BUCKET="", R2_PUBLIC_URL=""):
            r = self.c.post(f"/api/productos/{self.cafe.id}/foto/", foto(), format="multipart")
            self.assertEqual(r.status_code, 400)
            self.assertIn("R2", r.content.decode())
        with override_settings(R2_BUCKET="b", R2_PUBLIC_URL="https://abc.r2.cloudflarestorage.com/b"):
            r = self.c.post(f"/api/productos/{self.cafe.id}/foto/", foto(), format="multipart")
            self.assertEqual(r.status_code, 400)
            self.assertIn("pública", r.content.decode())

    def test_menu_publico(self):
        Producto.objects.filter(pk=self.pan.pk).update(en_menu=False)
        anon = APIClient()
        m = self.ok(anon.get(f"/api/public/menu/{self.neg.slug}/"))
        nombres = [p["nombre"] for c in m["categorias"] for p in c["productos"]]
        self.assertEqual(nombres, ["Tinto"])
        self.assertTrue(m["categorias"][0]["productos"][0]["agotado"])  # stock 0
        self.assertNotIn("costo", m["categorias"][0]["productos"][0])
        self.neg.modulos = ["pos"]
        self.neg.save()
        self.assertEqual(anon.get(f"/api/public/menu/{self.neg.slug}/").status_code, 404)

    def test_cola_de_pedidos(self):
        self.login("cajero")
        self.abrir_caja()
        v1 = self.ok(self.c.post("/api/ventas/", {"items": [{"producto": self.cafe.id}], "nota": "sin azúcar",
                                                  "pagos": [{"medio": "EFECTIVO", "monto": 2000}]}, format="json"), 201)
        v2 = self.ok(self.c.post("/api/ventas/", {"items": [{"producto": self.pan.id}], "entregar_ya": True,
                                                  "pagos": [{"medio": "NEQUI", "monto": 3000}]}, format="json"), 201)
        self.assertEqual((v1["turno"], v2["turno"]), (1, 2))
        cola = self.ok(self.c.get("/api/pedidos/"))
        self.assertEqual([p["turno"] for p in cola], [1])  # el 2 se entregó de una vez
        self.assertEqual(cola[0]["nota"], "sin azúcar")
        self.ok(self.c.post(f"/api/pedidos/{v1['id']}/entregar/"))
        self.assertEqual(self.ok(self.c.get("/api/pedidos/")), [])
        self.assertEqual(len(self.ok(self.c.get("/api/pedidos/?estado=entregados"))), 2)
        self.ok(self.c.post(f"/api/pedidos/{v1['id']}/deshacer/"))
        self.assertEqual(len(self.ok(self.c.get("/api/pedidos/"))), 1)
        # Otro negocio no ve ni toca la cola
        self.login("luis")
        self.assertEqual(self.ok(self.c.get("/api/pedidos/")), [])
        self.assertEqual(self.c.post(f"/api/pedidos/{v1['id']}/entregar/").status_code, 404)

    def test_sin_cola_se_entrega_de_una(self):
        self.neg.usa_cola_pedidos = False
        self.neg.save()
        self.login("dueno")
        self.abrir_caja()
        self.ok(self.c.post("/api/ventas/", {"items": [{"producto": self.cafe.id}],
                                             "pagos": [{"medio": "EFECTIVO", "monto": 2000}]}, format="json"), 201)
        self.assertEqual(self.ok(self.c.get("/api/pedidos/")), [])


class MarcaYAjustes(Base):
    def test_colores_validan_contraste(self):
        self.login("dueno")
        ok = self.ok(self.c.patch("/api/mi-negocio/", {"color_primario": "#4a2c1d", "color_acento": "#E9B872"}, format="json"))
        self.assertEqual((ok["color_primario"], ok["color_acento"]), ("#4A2C1D", "#E9B872"))
        # Primario claro: el texto blanco no se leería
        r = self.c.patch("/api/mi-negocio/", {"color_primario": "#F5F5F5"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("color_primario", r.json())
        # Acento oscuro sobre primario oscuro: precios ilegibles
        r = self.c.patch("/api/mi-negocio/", {"color_acento": "#333333"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("color_acento", r.json())
        r = self.c.patch("/api/mi-negocio/", {"color_primario": "rojo"}, format="json")
        self.assertEqual(r.status_code, 400)
        # El menú y el recibo públicos llevan la marca
        m = self.ok(APIClient().get(f"/api/public/menu/{self.neg.slug}/"))
        self.assertEqual(m["negocio"]["color_primario"], "#4A2C1D")
        # El cajero no cambia ajustes ni logo
        self.login("cajero")
        self.assertEqual(self.c.patch("/api/mi-negocio/", {"nombre": "X"}, format="json").status_code, 403)
        self.assertEqual(self.c.delete("/api/mi-negocio/logo/").status_code, 403)

    def test_logo(self):
        import io
        import tempfile
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings
        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (1200, 1200), (20, 50, 80)).save(buf, "PNG")
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp, R2_BUCKET="", DEBUG=True):
            self.login("dueno")
            r = self.ok(self.c.post("/api/mi-negocio/logo/", {"logo": SimpleUploadedFile("l.png", buf.getvalue(), "image/png")},
                                    format="multipart"))
            self.assertIn("/marca/", r["logo_url"])
            self.assertEqual(self.ok(self.c.delete("/api/mi-negocio/logo/"))["logo_url"], "")

    def test_eliminar_producto(self):
        self.login("dueno")
        # Sin ventas: se borra
        self.assertEqual(self.c.delete(f"/api/productos/{self.pan.id}/").status_code, 204)
        self.assertFalse(Producto.objects.filter(pk=self.pan.pk).exists())
        # Con ventas: queda inactivo (no aparece en el POS ni en el menú) para no romper el historial
        self.abrir_caja()
        self.stock(self.cafe, 5)
        self.ok(self.c.post("/api/ventas/", {"items": [{"producto": self.cafe.id}],
                                             "pagos": [{"medio": "EFECTIVO", "monto": 2000}]}, format="json"), 201)
        self.assertEqual(self.c.delete(f"/api/productos/{self.cafe.id}/").status_code, 204)
        self.cafe.refresh_from_db()
        self.assertFalse(self.cafe.activo)
        m = self.ok(APIClient().get(f"/api/public/menu/{self.neg.slug}/"))
        self.assertEqual(m["categorias"], [])


class BorrarNegocio(Base):
    def test_borra_todo_lo_del_negocio_y_nada_mas(self):
        import io
        import tempfile
        from pathlib import Path
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings
        from PIL import Image
        from negocios.borrado import borrar_negocio
        from ventas.models import Cliente, Venta

        buf = io.BytesIO()
        Image.new("RGB", (60, 60)).save(buf, "PNG")
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp, R2_BUCKET="", DEBUG=True):
            self.login("dueno")
            self.ok(self.c.post(f"/api/productos/{self.cafe.id}/foto/", {"foto": SimpleUploadedFile("a.png", buf.getvalue(), "image/png")}, format="multipart"))
            self.abrir_caja()
            self.stock(self.cafe, 10)
            cli = self.ok(self.c.post("/api/clientes/", {"nombre": "Ana"}, format="json"), 201)
            self.ok(self.c.post("/api/ventas/", {"items": [{"producto": self.cafe.id}], "cliente": cli["id"]}, format="json"), 201)
            self.ok(self.c.post("/api/creditos/", {"entidad": "Banco", "monto": 500000, "tasa": 20, "num_cuotas": 3,
                    "fecha_desembolso": str(hoy()), "fecha_primera_cuota": str(hoy() + dt.timedelta(days=30))}, format="json"), 201)
            cats = self.ok(self.c.get("/api/categorias-gasto/"))
            self.ok(self.c.post("/api/gastos/", {"categoria": cats[0]["id"], "descripcion": "x", "monto": 100}, format="json"), 201)
            # El otro negocio también tiene datos y no debe tocarse
            Producto.objects.create(negocio=self.otro, nombre="Arroz", precio=4000)
            carpeta = Path(tmp) / f"negocios/{self.neg.id}"
            self.assertTrue(any(carpeta.rglob("*.webp")))

            with self.captureOnCommitCallbacks(execute=True):
                detalle = borrar_negocio(self.neg)
            self.assertIn("ventas", dict(detalle))
            self.assertFalse(Negocio.objects.filter(pk=self.neg.pk).exists())
            self.assertFalse(Usuario.objects.filter(username__in=["dueno", "cajero"]).exists())
            self.assertEqual(Venta.objects.count(), 0)
            self.assertEqual(Cliente.objects.count(), 0)
            self.assertFalse(carpeta.exists())
            self.assertTrue(Negocio.objects.filter(pk=self.otro.pk).exists())
            self.assertEqual(Producto.objects.filter(negocio=self.otro).count(), 1)
            self.assertTrue(Usuario.objects.filter(username="luis").exists())

    def test_admin_borra_con_confirmacion(self):
        from django.test import override_settings
        self.login("dueno")
        self.abrir_caja()
        self.stock(self.cafe, 5)
        self.ok(self.c.post("/api/ventas/", {"items": [{"producto": self.cafe.id}], "pagos": [{"medio": "EFECTIVO", "monto": 2000}]}, format="json"), 201)
        from django.test import Client
        self.sa.is_staff = self.sa.is_superuser = True  # como lo crea asegurar_superadmin
        self.sa.save()
        web = Client()
        web.force_login(self.sa)
        estaticos = {"default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
                     "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}}
        with override_settings(ALLOWED_HOSTS=["testserver"], STORAGES=estaticos):
            r = web.get(f"/admin/negocios/negocio/{self.neg.id}/delete/")
            self.assertEqual(r.status_code, 200)
            self.assertIn("1 ventas", r.content.decode())
            r = web.post(f"/admin/negocios/negocio/{self.neg.id}/delete/", {"post": "yes"})
            self.assertEqual(r.status_code, 302)
        self.assertFalse(Negocio.objects.filter(pk=self.neg.pk).exists())


class AportesExtra(Base):
    def crear(self, **extra):
        datos = {"entidad": "Bancamía", "monto": 6_000_000, "tasa": 30, "num_cuotas": 12,
                 "fecha_desembolso": str(hoy()), "fecha_primera_cuota": str(hoy() + dt.timedelta(days=30))}
        datos.update(extra)
        return self.ok(self.c.post("/api/creditos/", datos, format="json"), 201)

    def test_pagar_de_mas_va_a_capital(self):
        self.login("dueno")
        cr = self.crear()
        cuota = Decimal(str(cr["cuota_valor"]))
        r = self.ok(self.c.post(f"/api/creditos/{cr['id']}/pagar/", {"monto": str(cuota + 300000), "origen_fondos": "EXTERNO"}, format="json"), 201)
        ex = r["excedente"]
        self.assertEqual(Decimal(str(ex["cuota"])), cuota)
        self.assertEqual(Decimal(str(ex["a_capital"])), 300000)
        self.assertGreater(Decimal(str(ex["intereses_ahorrados"])), 0)
        det = self.ok(self.c.get(f"/api/creditos/{cr['id']}/"))
        self.assertEqual(det["resumen"]["aportado_extra"], 300000)
        self.assertGreater(det["resumen"]["intereses_ahorrados_por_aportes"], 0)
        # Todo cuadra: capital pagado + capital en cuotas = monto
        capital = sum(Decimal(str(q["capital"])) for q in det["cuotas"])
        self.assertEqual(capital + Decimal(300000), 6_000_000)
        # Adelantar en vez de capital: no hay abono
        r = self.ok(self.c.post(f"/api/creditos/{cr['id']}/pagar/", {"monto": str(cuota * 2), "origen_fondos": "EXTERNO",
                                                                   "excedente": "ADELANTAR"}, format="json"), 201)
        self.assertIsNone(r["excedente"])

    def test_pagar_todo_liquida_sin_intereses_futuros(self):
        self.login("dueno")
        cr = self.crear()
        det = self.ok(self.c.get(f"/api/creditos/{cr['id']}/"))
        con_intereses = Decimal(str(det["resumen"]["deuda_pendiente_cuotas"]))
        r = self.ok(self.c.post(f"/api/creditos/{cr['id']}/pagar/", {"monto": str(con_intereses), "origen_fondos": "EXTERNO"}, format="json"), 201)
        self.assertTrue(r["excedente"]["liquidado"])
        self.assertGreater(Decimal(str(r["excedente"]["no_cobrado"])), 0)  # intereses futuros que no se cobran
        self.assertEqual(Credito.objects.get(pk=cr["id"]).estado, "PAGADO")

    def test_aporte_fijo_suma_a_la_meta_y_proyecta(self):
        self.login("dueno")
        cr = self.crear()
        base = self.ok(self.c.get("/api/creditos/tablero/"))["meta_dia"]
        det = self.ok(self.c.post(f"/api/creditos/{cr['id']}/aporte/", {"aporte_extra": 200000, "estrategia": "REDUCIR_PLAZO"}, format="json"))
        self.assertEqual(det["aporte_extra"], 200000)
        pro = det["resumen"]["proyeccion_con_aporte"]
        self.assertGreater(pro["periodos_menos"], 0)
        self.assertGreater(pro["intereses_ahorrados"], 0)
        meta = self.ok(self.c.get("/api/creditos/tablero/"))["meta_dia"]
        self.assertEqual(meta["cuota_obligatoria_dia"], base["cuota_obligatoria_dia"])
        self.assertEqual(meta["aporte_extra_dia"], round(200000 * 12 / 365))
        self.assertEqual(meta["apartar_hoy"], meta["cuota_obligatoria_dia"] + meta["aporte_extra_dia"])
        # Interés plano no acepta aporte
        plano = self.crear(entidad="Don Pedro", sistema="PLANO", tasa=10, tipo_tasa="MENSUAL", frecuencia="DIARIA", num_cuotas=30, monto=300000)
        r = self.c.post(f"/api/creditos/{plano['id']}/aporte/", {"aporte_extra": 1000}, format="json")
        self.assertEqual(r.status_code, 400)
