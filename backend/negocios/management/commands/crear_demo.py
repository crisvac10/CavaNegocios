"""python manage.py crear_demo  -> Super Admin + cafetería demo con productos, ventas y un crédito."""
import datetime as dt

from django.core.management.base import BaseCommand
from django.db import transaction

from caja.models import SesionCaja
from catalogo.models import Categoria, Producto
from creditos.servicios import crear_credito
from inventario.models import MovimientoInventario
from inventario.servicios import mover_stock
from negocios.models import Negocio
from negocios.utils import hoy
from usuarios.models import Usuario
from ventas.servicios import crear_venta


class Command(BaseCommand):
    help = "Crea datos de demostración"

    @transaction.atomic
    def handle(self, *args, **opts):
        if not Usuario.objects.filter(username="cavatech").exists():
            Usuario.objects.create_superuser("cavatech", password="cavatech123", rol=Usuario.Rol.SUPERADMIN)
        if Negocio.objects.filter(slug="cafe-demo").exists():
            self.stdout.write("El demo ya existe.")
            return
        n = Negocio.objects.create(nombre="Café Demo", slug="cafe-demo", tipo=Negocio.Tipo.CAFETERIA)
        dueno = Usuario.objects.create_user("demo", password="demo1234", rol=Usuario.Rol.ADMIN, negocio=n)
        Usuario.objects.create_user("cajero", password="demo1234", rol=Usuario.Rol.CAJERO, negocio=n)

        menu = {
            "Bebidas calientes": [("Tinto", 1500, 400), ("Café con leche", 3000, 900), ("Capuchino", 5500, 1700),
                                  ("Chocolate", 4000, 1200)],
            "Panadería": [("Pan de bono", 2500, 900), ("Almojábana", 2500, 900), ("Croissant", 4500, 1800),
                          ("Empanada", 3000, 1100)],
            "Bebidas frías": [("Jugo natural", 5000, 1800), ("Gaseosa", 3500, 1900), ("Agua", 2500, 1100)],
        }
        prods = []
        for orden, (cat, items) in enumerate(menu.items()):
            c = Categoria.objects.create(negocio=n, nombre=cat, orden=orden)
            for nombre, precio, costo in items:
                p = Producto.objects.create(negocio=n, categoria=c, nombre=nombre, precio=precio, costo=costo,
                                            stock_minimo=10)
                mover_stock(p, 300, MovimientoInventario.Tipo.AJUSTE_ENTRADA, usuario=dueno, nota="Stock inicial")
                prods.append(p)

        SesionCaja.objects.create(negocio=n, usuario_apertura=dueno, base_inicial=100000)
        for k in range(25):
            p1, p2 = prods[k % len(prods)], prods[(k * 3 + 1) % len(prods)]
            total = p1.precio * 2 + p2.precio
            crear_venta(n, dueno, [{"producto": p1.id, "cantidad": 2}, {"producto": p2.id, "cantidad": 1}],
                        [{"medio": "EFECTIVO" if k % 3 else "NEQUI", "monto": total}])

        crear_credito(n, dueno, {
            "entidad": "Bancamía", "tipo_entidad": "BANCO", "destino": "EQUIPO", "descripcion": "Máquina espresso",
            "monto": 4_000_000, "tasa": 28, "tipo_tasa": "EA", "sistema": "FRANCES", "frecuencia": "MENSUAL",
            "num_cuotas": 12, "fecha_desembolso": hoy(), "fecha_primera_cuota": hoy() + dt.timedelta(days=30),
        })
        self.stdout.write(self.style.SUCCESS(
            "Listo. Super Admin: cavatech/cavatech123 | Dueño: demo/demo1234 | Cajero: cajero/demo1234"))
