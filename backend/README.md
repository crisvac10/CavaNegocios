# CavaNegocios — Backend

Plataforma web multi-tenant de CavaTech Solutions para cafeterías, restaurantes y pequeños negocios que no facturan: POS, inventario, fiados, gastos y compras, caja, reportes y **créditos con plan de pago**.

Stack: Django 6 + DRF, PostgreSQL (Railway) / SQLite (local), token auth.

## Correr local

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py crear_demo      # cavatech/cavatech123 · demo/demo1234 · cajero/demo1234
python manage.py runserver
python manage.py test tests      # 11 pruebas end-to-end
```

## Deploy en Railway

1. Sube el repo, crea un servicio + plugin PostgreSQL (Railway inyecta `DATABASE_URL`).
2. Variables: copia `.env.ejemplo` (`SECRET_KEY`, `DEBUG=False`, `ALLOWED_HOSTS`, `CORS_*`, `FRONTEND_URL`).
3. El `Procfile` corre migraciones y gunicorn. Crea el Super Admin con `python manage.py createsuperuser` y ponle `rol=SUPERADMIN` desde `/admin`.

## Multi-tenant

Una base, cada tabla con `negocio_id`. `TenantMixin` filtra toda consulta por el negocio del usuario y asigna el negocio al crear; `TenantFKField` impide referenciar objetos de otro negocio. Los módulos se activan por negocio (`Negocio.modulos`; vacío = todos).

Roles: **SUPERADMIN** (CavaTech) · **ADMIN** (dueño) · **CAJERO** (vende, abre/cierra caja, registra gastos y fiados; no ve costos, reportes ni créditos).

## Reglas contables

- **Utilidad operativa** = ventas netas − costo de lo vendido − gastos operativos.
- **Utilidad neta** = operativa − intereses de créditos.
- Compras de mercancía **no** son gasto (pasan a costo cuando se venden; costo promedio ponderado).
- Desembolso de crédito **no** es ingreso; abono a capital **no** es gasto. Solo el interés resta.
- Todo el dinero pasa por un libro único (`MovimientoCaja`): el cierre de caja es su suma.

## Créditos y plan de pago

- Registro: entidad, monto, tasa (E.A. o mensual), frecuencia (diaria/semanal/quincenal/mensual), cuotas.
  - **FRANCES**: cuota fija (bancos, cooperativas).
  - **PLANO**: interés sobre el monto inicial todo el plazo (prestamistas, "gota a gota"; mes = 30 días).
- Calcula el **costo real E.A. (TIR)** y alerta si supera la **tasa de usura** vigente (la carga el Super Admin en `/api/tasas-usura/` cada mes desde la Superfinanciera; no viene precargada).
- **Meta diaria**: cuota convertida a valor diario ("hoy aparta $X"), contra la utilidad operativa del día → semáforo VERDE (≥1.5x), AMARILLO (≥1x), ROJO (<1x).
- **Fondo apartado**: alcancía para cuotas; se alimenta desde caja (incluso al cerrar caja con `apartar_credito`) y se usa para pagar (`origen_fondos=FONDO`).
- **Plan**: con la utilidad promedio de 30 días calcula el excedente, recomienda un abono extra sostenible (por defecto 50% del excedente) y muestra cuotas menos e intereses ahorrados, con escenarios 25/50/75%.
- **Abono a capital**: reduce plazo o reduce cuota; recalcula las cuotas futuras al peso. En PLANO no se permite (el interés no baja salvo acuerdo con el prestamista).
- **Varios créditos**: avalancha (mayor tasa primero) vs bola de nieve (menor saldo primero).
- Alertas: cuotas vencidas, cuota próxima (≤3 días), usura, días sin cubrir la cuota, fondo insuficiente, crédito por terminar.

## Endpoints principales (`/api/`)

| Área | Rutas |
|---|---|
| Auth | `login/`, `logout/`, `yo/`, `mi-negocio/`, `usuarios/`, `sistema/` |
| Catálogo | `categorias/`, `productos/` (POST acepta `stock_inicial`) |
| Inventario | `inventario/` (kardex + ajustes), `inventario/resumen/` |
| POS | `ventas/`, `ventas/{id}/anular/`, `ventas/{id}/recibo/`, `ventas/{id}/ticket/?ancho=80` |
| Fiados | `clientes/`, `clientes/deudores/`, `clientes/{id}/abonar/`, `.../estado_cuenta/`, `.../recordatorio/` |
| Gastos | `proveedores/`, `categorias-gasto/`, `gastos/`, `gastos/{id}/anular/`, `compras/` |
| Caja | `caja/actual/`, `caja/abrir/`, `caja/movimiento/`, `caja/cerrar/`, `caja/{id}/movimientos/` |
| Reportes | `reportes/resumen/`, `reportes/diario/`, `reportes/top-productos/`, `reportes/exportar/?tipo=ventas\|gastos` |
| Créditos | `creditos/preview/`, `creditos/`, `creditos/tablero/`, `creditos/{id}/pagar/`, `creditos/{id}/abonar-capital/`, `creditos/{id}/simular/`, `creditos/{id}/plan/`, `creditos/estrategia/`, `creditos/apartar/`, `creditos/liberar-fondo/`, `creditos/fondo/` |
| Público | `public/recibo/{token}/` (recibo digital sin login) |
| Super Admin | `saas/negocios/`, `saas/negocios/{id}/suspender/`, `.../reactivar/`, `saas/negocios/metricas/`, `tasas-usura/` |

Filtros de fecha: `?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` (hora de Bogotá).

## Pendiente (siguiente entrega)

- Frontend React/Vite (POS, tablero de créditos, reportes).
- Agente de impresión consumiendo `ventas/{id}/ticket/`.
- Fuera del MVP: recetas/insumos, mesas, catálogo online, multi-sede, facturación electrónica DIAN.
