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
python manage.py test tests      # 16 pruebas end-to-end
```

## Deploy en Railway

El repo es un monorepo: el servicio del backend debe construir **solo esta carpeta**.

1. Servicio → **Settings → Source → Root Directory = `backend`** (si no, Railpack ve solo `backend/` y `frontend/` y falla con "could not determine how to build the app").
2. Agrega PostgreSQL al proyecto y en el servicio crea la variable `DATABASE_URL = ${{Postgres.DATABASE_URL}}`.
3. Variables: copia `.env.ejemplo` (`SECRET_KEY`, `DEBUG=False`, `ALLOWED_HOSTS`, `CORS_*`, `FRONTEND_URL`, `R2_*`).
4. Railpack detecta Python por `requirements.txt` y `.python-version`, y arranca con el `Procfile`: migra, recoge estáticos y levanta gunicorn.
5. **Settings → Networking → Generate Domain**. Health check: `/api/health/`.
6. Super Admin: `railway run python manage.py crear_demo` (demo + `cavatech`) o `createsuperuser` y luego `rol=SUPERADMIN` en `/admin`.

## Multi-tenant

Una base, cada tabla con `negocio_id`. `TenantMixin` filtra toda consulta por el negocio del usuario y asigna el negocio al crear; `TenantFKField` impide referenciar objetos de otro negocio. Los módulos se activan por negocio (`Negocio.modulos`; vacío = todos).

Roles: **SUPERADMIN** (CavaTech) · **ADMIN** (dueño) · **CAJERO** (vende, abre/cierra caja, registra gastos y fiados; no ve costos, reportes ni créditos).

## Reglas contables

- **Utilidad operativa** = ventas netas − costo de lo vendido − gastos operativos.
- **Utilidad neta** = operativa − intereses de créditos.
- Compras de mercancía **no** son gasto (pasan a costo cuando se venden; costo promedio ponderado).
- Desembolso de crédito **no** es ingreso; abono a capital **no** es gasto. Solo el interés resta.
- Todo el dinero pasa por un libro único (`MovimientoCaja`).
- **Caja opcional** (`Negocio.usa_caja`, por defecto apagada): sin caja registradora se vende directo y el dinero se revisa con el **cuadre diario** (`caja/dia/`, por medio de pago). Con caja: apertura con base, cierre con arqueo y diferencia.

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
| Caja | `caja/dia/?fecha=` (cuadre diario), `caja/actual/`, `caja/abrir/`, `caja/movimiento/`, `caja/cerrar/`, `caja/{id}/movimientos/` |
| Reportes | `reportes/resumen/`, `reportes/diario/`, `reportes/top-productos/`, `reportes/exportar/?tipo=ventas\|gastos` |
| Créditos | `creditos/preview/`, `creditos/`, `creditos/tablero/`, `creditos/{id}/pagar/`, `creditos/{id}/abonar-capital/`, `creditos/{id}/simular/`, `creditos/{id}/plan/`, `creditos/estrategia/`, `creditos/apartar/`, `creditos/liberar-fondo/`, `creditos/fondo/` |
| Pedidos | `pedidos/` (cola), `pedidos/?estado=entregados`, `pedidos/{id}/entregar/`, `pedidos/{id}/deshacer/` |
| Fotos | `productos/{id}/foto/` (POST multipart / DELETE; se normaliza a WebP ≤900px y va a Cloudflare R2) |
| Público | `public/recibo/{token}/`, `public/menu/{slug}/` (menú del QR) |
| Super Admin | `saas/negocios/`, `saas/negocios/{id}/suspender/`, `.../reactivar/`, `saas/negocios/metricas/`, `tasas-usura/` |

Filtros de fecha: `?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` (hora de Bogotá).

## Fotos en Cloudflare R2

Define `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` y `R2_PUBLIC_URL` (bucket público o dominio propio). Sin ellas, en desarrollo las fotos se guardan en `media/`.

## Pendiente (siguiente entrega)

- Frontend React/Vite (POS, tablero de créditos, reportes).
- Agente de impresión consumiendo `ventas/{id}/ticket/`.
- Fuera del MVP: recetas/insumos, mesas, catálogo online, multi-sede, facturación electrónica DIAN.
