# CavaNegocios — Frontend

React 19 + Vite + Tailwind 4 + TanStack Query. PWA instalable (pensada para celular, tablet y PC de caja).

```bash
cp .env.ejemplo .env      # VITE_API_URL=http://localhost:8000/api
npm install
npm run dev               # http://localhost:5173
```

Deploy en **Cloudflare Pages**: root `frontend`, build `npm run build`, salida `dist`, variable `VITE_API_URL=https://<tu-api>.railway.app/api`. El archivo `public/_redirects` deja funcionar las rutas del SPA.

Hecho: login, layout por rol y módulo, **Vender** (POS con pago mixto, cambio, fiado con abono, descuento, recibo por WhatsApp), **Hoy** (cuadre diario por medio de pago, abrir/cerrar caja si el negocio la usa), **Pedidos** (cola con turno del día, nota y tiempo de espera; se marca Entregado con un toque), **Productos** (fotos, categorías, ajustes de inventario, **Menú QR** con cartel para imprimir), recibo público `/r/:token` y menú público `/m/:slug`.
Siguiente: fiados, gastos y compras, reportes, créditos, ajustes, Super Admin.
