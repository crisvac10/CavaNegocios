"""python manage.py crear_demo  -> Super Admin + cafetería demo con productos, ventas y un crédito."""
import datetime as dt

from django.core.management.base import BaseCommand
from django.db import transaction

from catalogo.models import Categoria, Producto
from creditos.servicios import crear_credito
from inventario.models import MovimientoInventario
from inventario.servicios import mover_stock
from negocios.models import Negocio
from negocios.utils import hoy
from usuarios.models import Usuario
from ventas.servicios import crear_venta


DESCRIPCIONES = {
    "Capuchino": "Espresso doble con leche espumada y canela",
    "Tinto": "Café de origen huilense, recién colado",
    "Pan de bono": "Horneado cada mañana, con queso costeño",
    "Jugo natural": "En agua o en leche: mora, lulo o maracuyá",
    "Croissant": "De mantequilla, hojaldrado",
}


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
                                            stock_minimo=10, descripcion=DESCRIPCIONES.get(nombre, ""))
                mover_stock(p, 300, MovimientoInventario.Tipo.AJUSTE_ENTRADA, usuario=dueno, nota="Stock inicial")
                prods.append(p)

        for k in range(25):
            p1, p2 = prods[k % len(prods)], prods[(k * 3 + 1) % len(prods)]
            total = p1.precio * 2 + p2.precio
            crear_venta(n, dueno, [{"producto": p1.id, "cantidad": 2}, {"producto": p2.id, "cantidad": 1}],
                        [{"medio": "EFECTIVO" if k % 3 else "NEQUI", "monto": total}], entregar_ya=True)

        # Historial de 14 días para que reportes y créditos muestren tendencias
        import random
        from gastos.models import CategoriaGasto, CATEGORIAS_GASTO_DEFECTO, Gasto
        from ventas.models import Cliente

        rnd = random.Random(7)
        for dias in range(1, 14):
            for _ in range(rnd.randint(14, 26)):
                p1, p2 = rnd.choice(prods), rnd.choice(prods)
                total = p1.precio * 2 + p2.precio
                crear_venta(n, dueno, [{"producto": p1.id, "cantidad": 2}, {"producto": p2.id, "cantidad": 1}],
                            [{"medio": rnd.choice(["EFECTIVO", "EFECTIVO", "NEQUI", "DAVIPLATA"]), "monto": total}],
                            fecha=hoy() - dt.timedelta(days=dias))
        cats = {c.nombre: c for c in CategoriaGasto.objects.bulk_create(
            [CategoriaGasto(negocio=n, nombre=x) for x in CATEGORIAS_GASTO_DEFECTO])}
        for dias, cat, desc, monto in [(12, "Arriendo", "Arriendo del local", 900000), (9, "Servicios públicos", "Luz y agua", 180000),
                                       (5, "Transporte", "Domicilios de insumos", 35000), (2, "Aseo", "Productos de aseo", 42000)]:
            fecha_gasto = hoy() - dt.timedelta(days=dias)
            g = Gasto.objects.create(negocio=n, categoria=cats[cat], descripcion=desc, monto=monto, usuario=dueno,
                                     fecha=fecha_gasto, medio="EFECTIVO")
            from caja import servicios as caja_srv
            from negocios.utils import momento_en
            caja_srv.registrar(n, "GASTO", -g.monto, concepto=desc, referencia=f"gasto:{g.id}", usuario=dueno,
                               momento=momento_en(fecha_gasto))
        marta = Cliente.objects.create(negocio=n, nombre="Doña Marta", telefono="3001234567")
        crear_venta(n, dueno, [{"producto": prods[1].id, "cantidad": 3}, {"producto": prods[4].id, "cantidad": 2}],
                    [], cliente=marta, entregar_ya=True)

        crear_credito(n, dueno, {
            "entidad": "Bancamía", "tipo_entidad": "BANCO", "destino": "EQUIPO", "descripcion": "Máquina espresso",
            "monto": 4_000_000, "tasa": 28, "tipo_tasa": "EA", "sistema": "FRANCES", "frecuencia": "MENSUAL",
            "num_cuotas": 12, "fecha_desembolso": hoy(), "fecha_primera_cuota": hoy() + dt.timedelta(days=30),
        })
        self.stdout.write(self.style.SUCCESS(
            "Listo. Super Admin: cavatech/cavatech123 | Dueño: demo/demo1234 | Cajero: cajero/demo1234"))
