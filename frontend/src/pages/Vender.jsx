import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, CheckCircle2, Gift, Minus, PenLine, Plus, Search, Share2, ShoppingBasket, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { MEDIOS, fechaCorta, hoyISO, numero, pesos } from "../lib/formato";
import { useSesion } from "../context/Sesion";
import { useCarrito } from "../context/Carrito";
import Cobro, { SelectorCliente } from "../components/Cobro";
import { Aviso, Boton, Hoja, InputPesos } from "../components/ui";

/* ---------- Venta de un día anterior ---------- */
const FECHA_MINIMA = "2020-01-01";
const ayerISO = () => new Date(new Date(hoyISO()).getTime() - 86_400_000).toISOString().slice(0, 10);
const fechaValida = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f) && f >= FECHA_MINIMA && f < hoyISO();

/* ---------- Producto como etiqueta de precio ---------- */
function Etiqueta({ p, cantidad, onAgregar, conFotos }) {
  const agotado = p.controla_stock && Number(p.stock) <= 0;
  return (
    <button
      onClick={() => onAgregar(p)}
      className={`group relative flex min-h-28 flex-col justify-between rounded-xl border bg-papel p-3 text-left transition active:scale-[0.97] ${
        cantidad ? "border-tinta ring-2 ring-tinta" : "border-linea hover:border-tinta/40"
      }`}
    >
      {p.foto_url ? (
        <img src={p.foto_url} alt="" loading="lazy" className="-mx-3 -mt-3 mb-2.5 h-24 w-[calc(100%+1.5rem)] max-w-none rounded-t-[11px] object-cover" />
      ) : conFotos ? (
        // Si otros productos tienen foto, este conserva la misma altura con sus iniciales
        <span className="-mx-3 -mt-3 mb-2.5 grid h-24 w-[calc(100%+1.5rem)] place-items-center rounded-t-[11px] bg-fondo font-display text-3xl font-extrabold text-tinta/25" aria-hidden>
          {p.nombre.split(" ").filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
        </span>
      ) : null}
      <span className="line-clamp-2 pr-6 font-semibold leading-snug">{p.nombre}</span>
      <span className="mt-3 flex items-end justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-precio px-2 py-1 font-display text-[15px] font-bold text-tinta num">
          <span className="h-1.5 w-1.5 rounded-full bg-tinta/70" aria-hidden />
          {pesos(p.precio)}
        </span>
        {p.controla_stock && (
          <span className={`text-xs num ${agotado ? "font-semibold text-alerta" : p.stock_bajo ? "text-alerta" : "text-suave"}`}>
            {agotado ? "Agotado" : `${numero(p.stock)} ${p.unidad}`}
          </span>
        )}
      </span>
      {cantidad > 0 && (
        <span className="absolute right-2 top-2 grid h-7 min-w-7 place-items-center rounded-full bg-tinta px-1.5 text-sm font-bold text-white num">
          {numero(cantidad)}
        </span>
      )}
    </button>
  );
}

/* ---------- La cuenta, con forma de recibo ---------- */
function Cuenta({
  lineas, subtotal, descuento, total, onCantidad, onQuitar, onDescuento, onVaciar, onAccion, textoAccion, puedeVender,
  nota, onNota, usaCola, entregarYa, onEntregarYa, numMesas, mesa, onMesa, enviando,
  arriba, campos, titulo = "Cuenta", aviso,
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 rounded-t-xl bg-papel px-4 pt-4 shadow-[0_1px_0_var(--color-linea)]">
        {arriba}
        <div className="flex items-baseline justify-between border-b border-dashed border-linea pb-3">
          <h2 className="font-display text-lg font-bold text-tinta">{titulo}</h2>
          {lineas.length > 0 && (
            <button onClick={onVaciar} className="text-sm text-suave hover:text-alerta">Vaciar</button>
          )}
        </div>
        {lineas.length === 0 ? (
          <div className="py-10 text-center text-suave">
            <ShoppingBasket size={30} className="mx-auto mb-2 opacity-50" aria-hidden />
            <p>Toca un producto para agregarlo.</p>
          </div>
        ) : (
          <ul className="divide-y divide-dashed divide-linea">
            {lineas.map(({ p, cantidad }) => (
              <li key={p.id} className="py-3">
                {p.personalizado && <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-suave">Personalizado</p>}
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium leading-snug">{p.nombre}</span>
                  <span className="font-semibold num">{pesos(p.precio * cantidad)}</span>
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <button
                    onClick={() => onCantidad(p.id, cantidad - 1)}
                    className="grid h-9 w-9 place-items-center rounded-lg bg-fondo"
                    aria-label={`Quitar uno de ${p.nombre}`}
                  >
                    <Minus size={16} />
                  </button>
                  <span className="w-10 text-center font-semibold num">{numero(cantidad)}</span>
                  <button
                    onClick={() => onCantidad(p.id, cantidad + 1)}
                    className="grid h-9 w-9 place-items-center rounded-lg bg-fondo"
                    aria-label={`Agregar uno de ${p.nombre}`}
                  >
                    <Plus size={16} />
                  </button>
                  <span className="ml-2 text-sm text-suave num">× {pesos(p.precio)}</span>
                  <button
                    onClick={() => onQuitar(p.id)}
                    className="ml-auto grid h-9 w-9 place-items-center rounded-lg text-suave hover:text-alerta"
                    aria-label={`Eliminar ${p.nombre}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-papel px-4 pb-4">
        {lineas.length > 0 && (
          <div className="space-y-2 border-t border-dashed border-linea pt-3 text-sm">
            {campos}
            {usaCola && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dónde se entrega">
                {[["LLEVAR", "Para llevar"], ...Array.from({ length: numMesas }, (_, i) => [String(i + 1), `Mesa ${i + 1}`])].map(([v, t]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => onMesa(mesa === v ? "" : v)}
                    aria-pressed={mesa === v}
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${mesa === v ? "border-tinta bg-tinta text-white" : "border-linea bg-papel text-tinta"}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
            <input
              value={nota}
              onChange={(e) => onNota(e.target.value)}
              maxLength={200}
              placeholder="Nota del pedido (ej. sin azúcar)"
              className="w-full rounded-lg border border-linea px-3 py-2.5 outline-none focus:border-tinta"
              aria-label="Nota del pedido"
            />
            {usaCola && (
              <label className="flex items-center gap-2.5 py-1 text-texto">
                <input type="checkbox" checked={entregarYa} onChange={(e) => onEntregarYa(e.target.checked)} className="h-4 w-4 accent-tinta" />
                Se entrega de una vez (no pasa a la cola)
              </label>
            )}
            <div className="flex justify-between text-suave"><span>Subtotal</span><span className="num">{pesos(subtotal)}</span></div>
            <label className="flex items-center justify-between gap-3 text-suave">
              <span>Descuento</span>
              <InputPesos className="w-36" valor={descuento} onCambio={onDescuento} aria-label="Descuento" />
            </label>
          </div>
        )}
        <div className="mt-3 flex items-baseline justify-between border-t-2 border-tinta pt-3">
          <span className="font-display text-lg font-bold text-tinta">Total</span>
          <span className="font-display text-3xl font-extrabold text-tinta num">{pesos(total)}</span>
        </div>
        {aviso && lineas.length > 0 && <p className="mt-3 text-sm text-suave">{aviso}</p>}
        <Boton
          variante="ok"
          className="mt-4 w-full py-4 text-lg"
          disabled={!lineas.length || total < 0 || !puedeVender || enviando}
          onClick={onAccion}
        >
          {enviando ? "Registrando…" : textoAccion}
        </Boton>
      </div>
      <div className="filo-recibo" aria-hidden />
    </div>
  );
}

/* ---------- Abrir caja (solo negocios con caja registradora) ---------- */
function AbrirCaja({ onCerrar }) {
  const qc = useQueryClient();
  const [base, setBase] = useState(0);
  const abrir = useMutation({
    mutationFn: () => api("/caja/abrir/", { method: "POST", body: { base_inicial: base } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["caja"] }); onCerrar(); },
  });
  return (
    <Hoja titulo="Abrir caja" onCerrar={onCerrar}>
      <p className="mb-3 text-suave">¿Con cuánto efectivo empieza la caja?</p>
      <InputPesos valor={base} onCambio={setBase} aria-label="Base inicial" />
      {abrir.error && <div className="mt-3"><Aviso>{abrir.error.message}</Aviso></div>}
      <Boton className="mt-4 w-full" onClick={() => abrir.mutate()} disabled={abrir.isPending}>Abrir caja</Boton>
    </Hoja>
  );
}

/* ---------- Algo personalizado (no está en el catálogo) ---------- */
function Personalizado({ onAgregar, onCerrar }) {
  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState(0);
  const [cantidad, setCantidad] = useState(1);
  return (
    <Hoja titulo="Agregar algo personalizado" onCerrar={onCerrar}>
      <form
        className="space-y-3"
        onSubmit={(e) => { e.preventDefault(); onAgregar({ nombre: nombre.trim(), precio, cantidad }); }}
      >
        <label className="block text-sm font-semibold">
          ¿Qué es?
          <input
            autoFocus
            required
            maxLength={120}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej. Ancheta con foto y globos"
            className="mt-1 w-full rounded-lg border border-linea px-3 py-2.5 font-normal outline-none focus:border-tinta"
          />
        </label>
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <label className="block text-sm font-semibold">
            Precio
            <InputPesos className="mt-1" valor={precio} onCambio={setPrecio} aria-label="Precio" />
          </label>
          <label className="block text-sm font-semibold">
            Cantidad
            <input
              type="number"
              min={1}
              value={cantidad}
              onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))}
              className="mt-1 w-full rounded-lg border border-linea px-3 py-2.5 font-normal num outline-none focus:border-tinta"
            />
          </label>
        </div>
        <Boton className="w-full" disabled={!nombre.trim() || precio <= 0}>Agregar a la cuenta</Boton>
      </form>
    </Hoja>
  );
}

/* ---------- Datos del encargo: cliente, fecha de entrega y abono ---------- */
function CamposEncargo({ encargo, setEncargo, total, medios }) {
  return (
    <div className="space-y-3 pb-1">
      <div>
        <p className="mb-1.5 font-semibold text-texto">Cliente</p>
        <SelectorCliente cliente={encargo.cliente} onElegir={(c) => setEncargo({ cliente: c })} />
      </div>
      <label className="flex items-center justify-between gap-3 font-semibold text-texto">
        Fecha de entrega
        <input
          type="date"
          min={hoyISO()}
          value={encargo.fecha}
          onChange={(e) => setEncargo({ fecha: e.target.value })}
          className="rounded-lg border border-linea bg-papel px-3 py-2 font-normal"
        />
      </label>
      <div>
        <p className="mb-1.5 font-semibold text-texto">Abono <span className="font-normal text-suave">(opcional)</span></p>
        <div className="flex gap-2">
          <InputPesos className="flex-1" valor={encargo.abono} onCambio={(v) => setEncargo({ abono: v })} aria-label="Abono del encargo" />
          <select
            value={encargo.medio}
            onChange={(e) => setEncargo({ medio: e.target.value })}
            className="rounded-lg border border-linea bg-papel px-3"
            aria-label="Medio del abono"
          >
            {medios.map((m) => <option key={m} value={m}>{MEDIOS[m]}</option>)}
          </select>
        </div>
        {total > 0 && <p className="mt-1.5 text-suave num">Falta {pesos(Math.max(total - encargo.abono, 0))} para la entrega</p>}
      </div>
    </div>
  );
}

/* ---------- Venta registrada ---------- */
function VentaLista({ venta, onNueva, onCobrar }) {
  if (venta.estado === "ENCARGO") {
    const abonado = Number(venta.total) - Number(venta.saldo_pendiente);
    return (
      <Hoja titulo="Encargo guardado" onCerrar={onNueva}>
        <div className="text-center">
          <Gift size={44} className="mx-auto text-ok" aria-hidden />
          <p className="mt-2 text-lg font-semibold">{venta.cliente_nombre}</p>
          <p className="text-suave">Entrega el <strong className="capitalize text-texto">{fechaCorta(venta.fecha_entrega, { dia: true })}</strong></p>
          <p className="mt-2 font-display text-3xl font-extrabold text-tinta num">{pesos(venta.total)}</p>
          <p className="mx-auto mt-3 max-w-xs rounded-xl bg-precio-claro px-4 py-3 text-tinta">
            {abonado > 0 ? <>Abonó <strong className="num">{pesos(abonado)}</strong> · </> : null}
            Falta <strong className="num">{pesos(venta.saldo_pendiente)}</strong>
          </p>
        </div>
        <div className="mt-6 grid gap-2 sm:grid-cols-3">
          {venta.whatsapp_recibo && (
            <a href={venta.whatsapp_recibo} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg border border-linea py-3 font-semibold text-tinta hover:bg-fondo">
              <Share2 size={18} aria-hidden /> Comprobante
            </a>
          )}
          <Link to="/encargos" className="inline-flex items-center justify-center rounded-lg border border-linea py-3 font-semibold text-tinta hover:bg-fondo">Ver encargos</Link>
          <Boton onClick={onNueva} data-autofocus>Nuevo</Boton>
        </div>
      </Hoja>
    );
  }
  if (venta.estado === "ABIERTA") {
    return (
      <Hoja titulo="Pedido registrado" onCerrar={onNueva}>
        <div className="text-center">
          <CheckCircle2 size={44} className="mx-auto text-ok" aria-hidden />
          <p className="mx-auto mt-3 w-fit rounded-xl bg-precio px-5 py-2 text-tinta">
            Turno <span className="font-display text-3xl font-extrabold num">{venta.turno}</span>
          </p>
          {venta.mesa && <p className="mt-2 font-semibold">{venta.mesa === "LLEVAR" ? "Para llevar" : `Mesa ${venta.mesa}`}</p>}
          <p className="mt-1 font-display text-3xl font-extrabold text-tinta num">{pesos(venta.total)}</p>
          <p className="mt-1 text-suave">Quedó en Pedidos. Lo puedes cobrar ahora o cuando el cliente pague.</p>
        </div>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Boton variante="borde" onClick={onNueva} data-autofocus>Nuevo pedido</Boton>
          <Boton variante="ok" onClick={onCobrar}>Cobrar ahora</Boton>
        </div>
      </Hoja>
    );
  }
  return (
    <Hoja titulo="Venta registrada" onCerrar={onNueva}>
      <div className="text-center">
        <CheckCircle2 size={44} className="mx-auto text-ok" aria-hidden />
        {venta.turno && !venta.entregado_en ? (
          <p className="mx-auto mt-3 w-fit rounded-xl bg-precio px-5 py-2 text-tinta">
            Turno <span className="font-display text-3xl font-extrabold num">{venta.turno}</span>
          </p>
        ) : null}
        <p className="mt-2 text-suave">Recibo #{venta.numero}</p>
        <p className="font-display text-4xl font-extrabold text-tinta num">{pesos(venta.total)}</p>
        {Number(venta.cambio) > 0 && (
          <p className="mx-auto mt-4 max-w-xs rounded-xl bg-ok-claro px-4 py-3 text-ok">
            Devuelve <span className="font-display text-2xl font-extrabold num">{pesos(venta.cambio)}</span>
          </p>
        )}
        {Number(venta.saldo_pendiente) > 0 && (
          <p className="mx-auto mt-4 max-w-xs rounded-xl bg-precio-claro px-4 py-3 text-tinta">
            {venta.cliente_nombre} queda debiendo <strong className="num">{pesos(venta.saldo_pendiente)}</strong>
          </p>
        )}
      </div>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <a href={venta.whatsapp_recibo} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg border border-linea py-3 font-semibold text-tinta hover:bg-fondo">
          <Share2 size={18} aria-hidden /> Enviar recibo
        </a>
        <Boton onClick={onNueva} data-autofocus>Nueva venta</Boton>
      </div>
    </Hoja>
  );
}

/* ---------- Página ---------- */
export default function Vender() {
  const { negocio, esAdmin, tieneModulo } = useSesion();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [categoria, setCategoria] = useState("todas");
  const [busqueda, setBusqueda] = useState("");
  // El pedido en curso vive en el contexto: no se pierde al cambiar de pestaña ni al recargar
  const {
    carrito, setCarrito, extras = [], setExtras, descuento, setDescuento, nota, setNota, entregarYa, setEntregarYa,
    mesa, setMesa, modo, setModo, encargo, setEncargo, vaciar,
  } = useCarrito();
  const [personalizando, setPersonalizando] = useState(false);
  const [cobrando, setCobrando] = useState(false);
  const [cobrandoPedido, setCobrandoPedido] = useState(null);
  // Venta de un día anterior (solo el dueño): /vender?fecha=2026-10-30
  const fechaParam = params.get("fecha") || "";
  const fecha = esAdmin && fechaValida(fechaParam) ? fechaParam : null;
  const [cuentaMovil, setCuentaMovil] = useState(false);
  const [abrirCaja, setAbrirCaja] = useState(false);
  const [ventaLista, setVentaLista] = useState(null);

  const { data: categorias = [] } = useQuery({ queryKey: ["categorias"], queryFn: () => api("/categorias/") });
  const { data: productos = [], isLoading, error } = useQuery({
    queryKey: ["productos", "pos"],
    queryFn: () => api("/productos/", { query: { activos: 1 } }),
  });
  const { data: caja } = useQuery({
    queryKey: ["caja", "actual"],
    queryFn: () => api("/caja/actual/"),
    enabled: Boolean(negocio?.usa_caja),
  });
  const cajaCerrada = negocio?.usa_caja && caja && !caja.abierta;

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter(
      (p) =>
        (categoria === "todas" || p.categoria === categoria) &&
        (!q || p.nombre.toLowerCase().includes(q) || p.codigo?.toLowerCase() === q)
    );
  }, [productos, categoria, busqueda]);

  const conFotos = visibles.some((p) => p.foto_url);
  const lineas = [
    ...Object.entries(carrito)
      .map(([id, cantidad]) => ({ p: productos.find((x) => x.id === Number(id)), cantidad }))
      .filter((l) => l.p),
    ...extras.map((x) => ({ p: { id: `x${x.id}`, nombre: x.nombre, precio: x.precio, personalizado: true }, cantidad: x.cantidad })),
  ];
  const subtotal = lineas.reduce((s, l) => s + l.p.precio * l.cantidad, 0);
  const total = Math.max(subtotal - descuento, 0);
  const unidades = lineas.reduce((s, l) => s + l.cantidad, 0);

  const agregar = (p) => setCarrito((c) => ({ ...c, [p.id]: (c[p.id] || 0) + 1 }));
  const fijarCantidad = (id, n) =>
    String(id).startsWith("x")
      ? setExtras((xs) => xs.flatMap((x) => (`x${x.id}` !== id ? [x] : n <= 0 ? [] : [{ ...x, cantidad: n }])))
      : setCarrito((c) => {
      const copia = { ...c };
      if (n <= 0) delete copia[id];
      else copia[id] = n;
      return copia;
    });
  // Cada tipo de negocio vende a su manera:
  // - Cafetería / restaurante (tiene Pedidos): se registra el pedido y se cobra después.
  // - Tienda / tienda de regalos: se cobra de una vez. La de regalos además toma encargos.
  // Una venta de un día anterior siempre se cobra de una, porque ese día ya pasó.
  const usaCola = tieneModulo("pedidos") && negocio?.usa_cola_pedidos;
  const registrarPrimero = !fecha && tieneModulo("pedidos");
  const conEncargos = tieneModulo("encargos") && !fecha;
  const enEncargo = conEncargos && modo === "encargo";
  const [otroDia, setOtroDia] = useState(false);
  const [diaElegido, setDiaElegido] = useState("");

  const refrescar = () => ["productos", "caja", "clientes", "pedidos", "ventas", "reportes"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const alVender = (venta) => {
    setCobrando(false);
    setCobrandoPedido(null);
    setCuentaMovil(false);
    setVentaLista(venta);
    vaciar();
    refrescar();
  };
  const itemsPedido = () => lineas.map(({ p, cantidad }) =>
    p.personalizado ? { nombre: p.nombre, precio: p.precio, cantidad } : { producto: p.id, cantidad });
  const registrar = useMutation({
    mutationFn: () => api("/ventas/", {
      method: "POST",
      body: { items: itemsPedido(), registrar: true, descuento, nota, mesa, entregar_ya: entregarYa },
    }),
    onSuccess: alVender,
  });
  const guardarEncargo = useMutation({
    mutationFn: () => api("/encargos/", {
      method: "POST",
      body: {
        items: itemsPedido(), cliente: encargo.cliente?.id, fecha_entrega: encargo.fecha, descuento, nota,
        pagos: encargo.abono > 0 ? [{ medio: encargo.medio, monto: encargo.abono }] : [],
      },
    }),
    onSuccess: alVender,
  });
  const faltaEncargo = !encargo?.cliente ? "Elige el cliente del encargo."
    : !encargo.fecha || encargo.fecha < hoyISO() ? "Pon la fecha de entrega."
    : encargo.abono > total ? "El abono no puede ser mayor al total."
    : cajaCerrada && encargo.abono > 0 ? "Abre la caja para recibir el abono." : null;

  const selectorModo = conEncargos ? (
    <div className="mb-3 grid grid-cols-2 rounded-lg bg-fondo p-1 text-sm font-semibold" role="tablist" aria-label="Tipo de venta">
      {[["venta", "Venta ahora"], ["encargo", "Encargo"]].map(([v, t]) => (
        <button
          key={v}
          role="tab"
          aria-selected={modo === v}
          onClick={() => setModo(v)}
          className={`flex items-center justify-center gap-1.5 rounded-md py-2 ${modo === v ? "bg-papel text-tinta shadow-sm" : "text-suave"}`}
        >
          {v === "encargo" && <Gift size={15} aria-hidden />} {t}
        </button>
      ))}
    </div>
  ) : null;

  const propsCuenta = {
    lineas, subtotal, descuento, total,
    onCantidad: fijarCantidad,
    onQuitar: (id) => fijarCantidad(id, 0),
    onDescuento: (v) => setDescuento(Math.min(v, subtotal)),
    onVaciar: vaciar,
    onAccion: () => (enEncargo ? guardarEncargo.mutate() : registrarPrimero ? registrar.mutate() : setCobrando(true)),
    textoAccion: enEncargo ? "Guardar encargo" : registrarPrimero ? "Registrar pedido" : fecha ? `Cobrar venta del ${fechaCorta(fecha)}` : "Cobrar",
    enviando: registrar.isPending || guardarEncargo.isPending,
    puedeVender: enEncargo ? !faltaEncargo : registrarPrimero || Boolean(fecha) || !cajaCerrada,
    aviso: enEncargo ? faltaEncargo : null,
    arriba: selectorModo,
    titulo: enEncargo ? "Encargo" : "Cuenta",
    campos: enEncargo ? <CamposEncargo encargo={encargo} setEncargo={setEncargo} total={total} medios={negocio?.medios_pago_activos || []} /> : null,
    nota, onNota: setNota, usaCola: usaCola && registrarPrimero && !enEncargo, entregarYa, onEntregarYa: setEntregarYa,
    numMesas: negocio?.num_mesas || 0, mesa, onMesa: setMesa,
  };

  return (
    <div className="lg:grid lg:h-dvh lg:grid-cols-[1fr_380px]">
      {/* Catálogo */}
      <section className="min-w-0 px-4 pt-4 lg:overflow-y-auto lg:px-6 lg:pt-6">
        {fecha && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-precio-claro px-4 py-3">
            <p className="font-medium">
              Estás registrando una venta del <strong className="capitalize">{fechaCorta(fecha, { dia: true, anio: true })}</strong>. Su dinero queda en el cuadre de ese día.
            </p>
            <Boton variante="borde" onClick={() => setParams({})} className="py-2">Volver a hoy</Boton>
          </div>
        )}
        {esAdmin && !fecha && (
          <div className="mb-3 flex flex-wrap items-center justify-end gap-2 text-sm">
            {otroDia ? (
              <>
                <label htmlFor="otro-dia" className="font-medium">¿De qué día es la venta?</label>
                <input
                  id="otro-dia"
                  type="date"
                  min={FECHA_MINIMA}
                  max={ayerISO()}
                  value={diaElegido}
                  // Solo se guarda lo escrito: mientras se teclea el año el valor pasa por fechas como 0002-10-01
                  onChange={(e) => setDiaElegido(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && fechaValida(diaElegido) && setParams({ fecha: diaElegido })}
                  className="rounded-lg border border-linea bg-papel px-3 py-2"
                />
                <Boton onClick={() => setParams({ fecha: diaElegido })} disabled={!fechaValida(diaElegido)} className="py-2">
                  Continuar
                </Boton>
                <button onClick={() => setOtroDia(false)} className="px-2 py-2 font-semibold text-suave">Cancelar</button>
              </>
            ) : (
              <button onClick={() => setOtroDia(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 font-semibold text-tinta hover:bg-papel">
                <CalendarDays size={17} aria-hidden /> Registrar venta de otro día
              </button>
            )}
          </div>
        )}
        {(registrar.error || guardarEncargo.error) && <div className="mb-4"><Aviso>{(registrar.error || guardarEncargo.error).message}</Aviso></div>}
        {cajaCerrada && !registrarPrimero && !enEncargo && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-precio-claro px-4 py-3">
            <p className="font-medium">La caja está cerrada. Ábrela para empezar a vender.</p>
            <Boton onClick={() => setAbrirCaja(true)} className="py-2">Abrir caja</Boton>
          </div>
        )}

        <div className="sticky top-14 z-10 md:top-0 -mx-4 bg-fondo/95 px-4 pb-3 pt-1 backdrop-blur lg:-mx-6 lg:px-6">
          <div className="flex items-center gap-2 rounded-xl border border-linea bg-papel px-3 focus-within:border-tinta">
            <Search size={19} className="text-suave" aria-hidden />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar producto o código"
              className="w-full bg-transparent py-3 outline-none"
              aria-label="Buscar producto"
            />
            {conEncargos && (
              <button
                onClick={() => setPersonalizando(true)}
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold text-tinta hover:bg-fondo"
              >
                <PenLine size={16} aria-hidden /> <span className="hidden sm:inline">Personalizado</span>
              </button>
            )}
          </div>
          {categorias.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Categorías">
              {[{ id: "todas", nombre: "Todo" }, ...categorias.filter((c) => c.activa)].map((c) => (
                <button
                  key={c.id}
                  role="tab"
                  aria-selected={categoria === c.id}
                  onClick={() => setCategoria(c.id)}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
                    categoria === c.id ? "bg-tinta text-white" : "bg-papel text-tinta"
                  }`}
                >
                  {c.nombre}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <Aviso>{error.message}</Aviso>}
        {isLoading ? (
          <p className="py-10 text-center text-suave">Cargando productos…</p>
        ) : productos.length === 0 ? (
          <div className="py-12 text-center">
            <p className="font-display text-xl font-bold text-tinta">Aún no hay productos</p>
            <p className="mt-1 text-suave">Crea tu menú para empezar a vender.</p>
            {esAdmin && (
              <Link to="/productos" className="mt-4 inline-block rounded-lg bg-tinta px-5 py-3 font-semibold text-white">
                Crear productos
              </Link>
            )}
          </div>
        ) : visibles.length === 0 ? (
          <p className="py-10 text-center text-suave">Nada coincide con “{busqueda}”.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 pb-28 sm:grid-cols-3 xl:grid-cols-4 lg:pb-6">
            {visibles.map((p) => (
              <Etiqueta key={p.id} p={p} cantidad={carrito[p.id] || 0} onAgregar={agregar} conFotos={conFotos} />
            ))}
          </div>
        )}
      </section>

      {/* Cuenta fija (pantallas grandes) */}
      <aside className="hidden border-l border-linea bg-fondo p-4 lg:block lg:overflow-y-auto">
        <Cuenta {...propsCuenta} />
      </aside>

      {/* Barra de cuenta (celular / tablet) */}
      {lineas.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:pl-[calc(14rem+0.75rem)] lg:hidden">
          <button
            onClick={() => setCuentaMovil(true)}
            className="flex w-full items-center justify-between rounded-xl bg-tinta px-5 py-4 text-white shadow-lg"
          >
            <span className="font-semibold">Ver cuenta · {numero(unidades)} {unidades === 1 ? "producto" : "productos"}</span>
            <span className="font-display text-xl font-extrabold num">{pesos(total)}</span>
          </button>
        </div>
      )}
      {cuentaMovil && (
        <Hoja titulo={enEncargo ? "Revisar encargo" : registrarPrimero ? "Revisar pedido" : "Revisar venta"} onCerrar={() => setCuentaMovil(false)}>
          <div className="-mx-5 -mb-5 bg-fondo px-3 pb-3 pt-1">
            <Cuenta {...propsCuenta} />
          </div>
        </Hoja>
      )}

      {cobrando && (
        <Cobro
          total={total}
          descuento={descuento}
          negocio={negocio}
          items={itemsPedido()}
          extra={{ nota, entregar_ya: entregarYa, mesa, ...(fecha ? { fecha } : {}) }}
          onListo={alVender}
          onCerrar={() => setCobrando(false)}
        />
      )}
      {cobrandoPedido && (
        <Cobro
          ventaId={cobrandoPedido.id}
          total={Number(cobrandoPedido.total)}
          detalle={cobrandoPedido.detalles}
          titulo={`Cobrar turno ${cobrandoPedido.turno}`}
          negocio={negocio}
          onListo={alVender}
          onCerrar={() => setCobrandoPedido(null)}
        />
      )}
      {abrirCaja && <AbrirCaja onCerrar={() => setAbrirCaja(false)} />}
      {personalizando && (
        <Personalizado
          onCerrar={() => setPersonalizando(false)}
          onAgregar={(x) => { setExtras((xs) => [...xs, { ...x, id: Date.now() }]); setPersonalizando(false); }}
        />
      )}
      {ventaLista && (
        <VentaLista
          venta={ventaLista}
          onNueva={() => setVentaLista(null)}
          onCobrar={() => { setCobrandoPedido(ventaLista); setVentaLista(null); }}
        />
      )}
    </div>
  );
}
