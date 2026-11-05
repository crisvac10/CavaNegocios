import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarClock, Gift, MessageSquareText, Minus, PackageSearch, PenLine, Phone, Plus, Search, Share2, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { MEDIOS, fechaCorta, hoyISO, numero, pesos, sumarDias } from "../lib/formato";
import { useSesion } from "../context/Sesion";
import Cobro from "../components/Cobro";
import { Aviso, Boton, Hoja, InputPesos } from "../components/ui";

const abonado = (e) => Number(e.total) - Number(e.saldo_pendiente);

/** Cuándo se entrega, en palabras: "Atrasado 2 días", "Hoy", "Mañana", "vie 14 nov". */
function cuando(fecha) {
  const hoy = hoyISO();
  if (fecha < hoy) {
    const dias = Math.round((new Date(`${hoy}T12:00`) - new Date(`${fecha}T12:00`)) / 86_400_000);
    return { texto: `Atrasado ${dias} ${dias === 1 ? "día" : "días"}`, grupo: "atrasados", tono: "bg-alerta text-white" };
  }
  if (fecha === hoy) return { texto: "Hoy", grupo: "hoy", tono: "bg-tinta text-white" };
  if (fecha === sumarDias(hoy, 1)) return { texto: "Mañana", grupo: "proximos", tono: "bg-precio text-tinta" };
  const f = fechaCorta(fecha, { dia: true });
  return { texto: f.charAt(0).toUpperCase() + f.slice(1), grupo: "proximos", tono: "bg-fondo text-tinta" };
}

const GRUPOS = [
  ["atrasados", "Atrasados"],
  ["hoy", "Para entregar hoy"],
  ["proximos", "Próximos"],
];

function Tarjeta({ e, onAbonar, onEntregar, onEditar, onCancelar }) {
  const c = cuando(e.fecha_entrega);
  const pagado = abonado(e);
  const pct = Number(e.total) > 0 ? Math.min(100, (pagado / Number(e.total)) * 100) : 0;
  const faltan = e.detalles.filter((d) => Number(d.por_conseguir) > 0);
  return (
    <article className={`flex flex-col overflow-hidden rounded-2xl border-2 bg-papel ${c.grupo === "atrasados" ? "border-alerta" : "border-transparent"}`}>
      <header className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{e.cliente_nombre}</p>
          {e.cliente_telefono && (
            <a href={`tel:${e.cliente_telefono}`} className="inline-flex items-center gap-1 text-sm text-suave hover:text-tinta">
              <Phone size={13} aria-hidden /> {e.cliente_telefono}
            </a>
          )}
        </div>
        <div className="shrink-0 text-right">
          <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-sm font-semibold ${c.tono}`}>
            <CalendarClock size={14} aria-hidden /> {c.texto}
          </span>
          <p className="mt-1 text-xs text-suave">Encargo #{e.numero}</p>
        </div>
      </header>

      <ul className="flex-1 space-y-1.5 px-4 py-3">
        {e.detalles.map((d, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="w-7 shrink-0 text-right font-bold text-tinta num">{numero(d.cantidad)}×</span>
            <span className="min-w-0 flex-1">
              {d.nombre}
              {!d.producto && <span className="ml-1.5 rounded bg-fondo px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-suave">Personalizado</span>}
            </span>
            <span className="text-sm text-suave num">{pesos(d.subtotal)}</span>
          </li>
        ))}
      </ul>

      {faltan.length > 0 && (
        <p className="mx-4 mb-3 flex gap-2 rounded-lg bg-alerta-claro px-3 py-2 text-sm font-medium text-alerta">
          <PackageSearch size={17} className="mt-0.5 shrink-0" aria-hidden />
          <span>Falta conseguir: {faltan.map((d) => `${numero(d.por_conseguir)} ${d.nombre}`).join(", ")}</span>
        </p>
      )}
      {e.nota && (
        <p className="mx-4 mb-3 flex gap-2 rounded-lg bg-precio-claro px-3 py-2 text-sm font-medium">
          <MessageSquareText size={17} className="mt-0.5 shrink-0" aria-hidden /> {e.nota}
        </p>
      )}

      <div className="border-t border-dashed border-linea px-4 py-3">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 text-suave">Abonado <strong className="text-texto num">{pesos(pagado)}</strong> de <span className="num">{pesos(e.total)}</span></span>
          <span className="shrink-0 whitespace-nowrap font-display text-xl font-extrabold text-tinta num">
            {Number(e.saldo_pendiente) > 0 ? `Falta ${pesos(e.saldo_pendiente)}` : "Pagado"}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-fondo" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Cuánto lleva pagado">
          <div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 text-sm font-semibold">
        <button onClick={() => onEditar(e)} className="flex items-center gap-1 text-tinta hover:underline"><PenLine size={15} aria-hidden /> Editar</button>
        <a href={e.whatsapp_recibo} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-tinta hover:underline"><Share2 size={15} aria-hidden /> Comprobante</a>
        <button onClick={() => onCancelar(e)} className="ml-auto text-suave hover:text-alerta">Cancelar</button>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-2xl bg-linea">
        <button
          onClick={() => onAbonar(e)}
          disabled={Number(e.saldo_pendiente) <= 0}
          className="bg-papel py-3.5 font-semibold text-tinta hover:bg-fondo disabled:text-suave"
        >
          Abonar
        </button>
        <button onClick={() => onEntregar(e)} className="flex items-center justify-center gap-1.5 bg-ok py-3.5 font-semibold text-white hover:brightness-110">
          <Gift size={18} aria-hidden /> Entregar
        </button>
      </div>
    </article>
  );
}

function Abonar({ e, negocio, onCerrar, onListo }) {
  const medios = negocio.medios_pago_activos;
  const [monto, setMonto] = useState(0);
  const [medio, setMedio] = useState(medios.includes("EFECTIVO") ? "EFECTIVO" : medios[0]);
  const falta = Number(e.saldo_pendiente);
  const m = useMutation({
    mutationFn: () => api(`/encargos/${e.id}/abonar/`, { method: "POST", body: { pagos: [{ medio, monto }] } }),
    onSuccess: onListo,
  });
  return (
    <Hoja titulo={`Abono de ${e.cliente_nombre}`} onCerrar={onCerrar}>
      <p className="mb-3 text-suave">Falta <strong className="text-texto num">{pesos(falta)}</strong> del encargo.</p>
      <InputPesos valor={monto} onCambio={setMonto} aria-label="Monto del abono" />
      <div className="mt-2 flex flex-wrap gap-2">
        {[falta, Math.round(falta / 2 / 1000) * 1000].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v) => (
          <button key={v} onClick={() => setMonto(v)} className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold num ${monto === v ? "border-tinta bg-tinta text-white" : "border-linea"}`}>
            {v === falta ? `Todo (${pesos(v)})` : `Mitad (${pesos(v)})`}
          </button>
        ))}
      </div>
      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-semibold">¿Cómo paga?</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {medios.map((x) => (
            <button key={x} onClick={() => setMedio(x)} aria-pressed={medio === x}
              className={`rounded-lg border-2 py-2.5 font-semibold ${medio === x ? "border-tinta bg-tinta text-white" : "border-linea text-tinta"}`}>
              {MEDIOS[x]}
            </button>
          ))}
        </div>
      </fieldset>
      {monto > falta && <div className="mt-3"><Aviso tipo="info">El abono no puede ser mayor a lo que falta.</Aviso></div>}
      {m.error && <div className="mt-3"><Aviso>{m.error.message}</Aviso></div>}
      <Boton variante="ok" className="mt-4 w-full py-3.5" disabled={monto <= 0 || monto > falta || m.isPending} onClick={() => m.mutate()}>
        {m.isPending ? "Guardando…" : `Registrar abono${monto > 0 ? ` de ${pesos(monto)}` : ""}`}
      </Boton>
    </Hoja>
  );
}

/** Entregar un encargo que ya está pagado completo. */
function EntregarPagado({ e, onCerrar, onListo }) {
  const m = useMutation({ mutationFn: () => api(`/encargos/${e.id}/entregar/`, { method: "POST", body: { pagos: [] } }), onSuccess: onListo });
  return (
    <Hoja titulo="Entregar encargo" onCerrar={onCerrar}>
      <p>El encargo de <strong>{e.cliente_nombre}</strong> ya está pagado ({pesos(e.total)}). Al entregarlo cuenta como venta de hoy.</p>
      {m.error && <div className="mt-3"><Aviso>{m.error.message}</Aviso></div>}
      <Boton variante="ok" className="mt-5 w-full py-3.5" onClick={() => m.mutate()} disabled={m.isPending} data-autofocus>
        <Gift size={19} aria-hidden /> {m.isPending ? "Entregando…" : "Marcar entregado"}
      </Boton>
    </Hoja>
  );
}

function Editar({ e, onCerrar, onListo }) {
  const [lineas, setLineas] = useState(() => e.detalles.map((d) => ({
    producto: d.producto, nombre: d.nombre, cantidad: Number(d.cantidad), precio: Number(d.precio_unitario),
  })));
  const [fecha, setFecha] = useState(e.fecha_entrega);
  const [nota, setNota] = useState(e.nota || "");
  const [q, setQ] = useState("");
  const [nuevo, setNuevo] = useState(null);
  const { data: productos = [] } = useQuery({ queryKey: ["productos", "pos"], queryFn: () => api("/productos/", { query: { activos: 1 } }) });
  const sugeridos = q.trim() ? productos.filter((p) => p.nombre.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : [];
  const total = lineas.reduce((s, l) => s + l.cantidad * l.precio, 0) - Number(e.descuento || 0);
  const ya = abonado(e);

  const cambiar = (i, n) => setLineas((ls) => (n <= 0 ? ls.filter((_, j) => j !== i) : ls.map((l, j) => (j === i ? { ...l, cantidad: n } : l))));
  const agregar = (p) => {
    setQ("");
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.producto === p.id);
      return i >= 0 ? ls.map((l, j) => (j === i ? { ...l, cantidad: l.cantidad + 1 } : l))
        : [...ls, { producto: p.id, nombre: p.nombre, cantidad: 1, precio: Number(p.precio) }];
    });
  };
  const m = useMutation({
    mutationFn: () => api(`/encargos/${e.id}/editar/`, {
      method: "POST",
      body: {
        fecha_entrega: fecha, nota,
        items: lineas.map((l) => (l.producto ? { producto: l.producto, cantidad: l.cantidad, precio: l.precio }
          : { nombre: l.nombre, precio: l.precio, cantidad: l.cantidad })),
      },
    }),
    onSuccess: onListo,
  });
  const problema = !lineas.length ? "El encargo necesita al menos un producto."
    : total < ya ? `Ya abonaron ${pesos(ya)}: el encargo no puede quedar en menos.`
    : !fecha || fecha < hoyISO() ? "Pon una fecha de entrega de hoy en adelante." : null;

  return (
    <Hoja titulo={`Editar encargo #${e.numero}`} onCerrar={onCerrar} ancho="max-w-xl">
      <div className="space-y-4">
        <ul className="divide-y divide-linea rounded-xl border border-linea">
          {lineas.map((l, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              <span className="min-w-0 flex-1 font-medium">{l.nombre}</span>
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => cambiar(i, l.cantidad - 1)} className="grid h-9 w-9 place-items-center rounded-lg bg-fondo" aria-label={`Quitar uno de ${l.nombre}`}><Minus size={16} /></button>
                <span className="w-9 text-center font-semibold num">{numero(l.cantidad)}</span>
                <button type="button" onClick={() => cambiar(i, l.cantidad + 1)} className="grid h-9 w-9 place-items-center rounded-lg bg-fondo" aria-label={`Agregar uno de ${l.nombre}`}><Plus size={16} /></button>
              </span>
              <span className="w-24 text-right font-semibold num">{pesos(l.cantidad * l.precio)}</span>
              <button type="button" onClick={() => cambiar(i, 0)} className="grid h-9 w-9 place-items-center rounded-lg text-suave hover:text-alerta" aria-label={`Eliminar ${l.nombre}`}><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>

        <div className="relative">
          <div className="flex items-center gap-2 rounded-lg border border-linea bg-papel px-3 focus-within:border-tinta">
            <Search size={18} className="text-suave" aria-hidden />
            <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Agregar un producto" className="w-full bg-transparent py-2.5 outline-none" aria-label="Agregar producto" />
            <button type="button" onClick={() => setNuevo({ nombre: "", precio: 0 })} className="flex shrink-0 items-center gap-1 text-sm font-semibold text-tinta">
              <PenLine size={15} aria-hidden /> Personalizado
            </button>
          </div>
          {sugeridos.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1 divide-y divide-linea overflow-hidden rounded-lg border border-linea bg-papel shadow-lg">
              {sugeridos.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => agregar(p)} className="flex w-full justify-between px-3 py-2.5 text-left hover:bg-fondo">
                    <span>{p.nombre}</span><span className="text-suave num">{pesos(p.precio)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {nuevo && (
          <div className="flex flex-wrap gap-2 rounded-lg bg-fondo p-3">
            <input autoFocus value={nuevo.nombre} onChange={(ev) => setNuevo({ ...nuevo, nombre: ev.target.value })} placeholder="¿Qué es?"
              className="min-w-40 flex-1 rounded-lg border border-linea bg-papel px-3 py-2.5 outline-none focus:border-tinta" aria-label="Descripción" />
            <InputPesos className="w-36" valor={nuevo.precio} onCambio={(v) => setNuevo({ ...nuevo, precio: v })} aria-label="Precio" />
            <Boton type="button" className="py-2.5" disabled={!nuevo.nombre.trim() || nuevo.precio <= 0}
              onClick={() => { setLineas((ls) => [...ls, { producto: null, nombre: nuevo.nombre.trim(), precio: nuevo.precio, cantidad: 1 }]); setNuevo(null); }}>
              Agregar
            </Boton>
          </div>
        )}

        <label className="flex items-center justify-between gap-3 font-semibold">
          Fecha de entrega
          <input type="date" min={hoyISO()} value={fecha} onChange={(ev) => setFecha(ev.target.value)} className="rounded-lg border border-linea bg-papel px-3 py-2 font-normal" />
        </label>
        <input value={nota} onChange={(ev) => setNota(ev.target.value)} maxLength={200} placeholder="Nota (ej. tarjeta con el nombre de Laura)"
          className="w-full rounded-lg border border-linea bg-papel px-3 py-2.5 outline-none focus:border-tinta" aria-label="Nota" />

        <div className="flex items-baseline justify-between border-t-2 border-tinta pt-3">
          <span className="font-display text-lg font-bold text-tinta">Total</span>
          <span className="font-display text-2xl font-extrabold text-tinta num">{pesos(total)}</span>
        </div>
        {ya > 0 && <p className="-mt-2 text-right text-sm text-suave num">Abonado {pesos(ya)} · falta {pesos(Math.max(total - ya, 0))}</p>}
        {problema && <Aviso tipo="info">{problema}</Aviso>}
        {m.error && <Aviso>{m.error.message}</Aviso>}
        <Boton className="w-full py-3.5" disabled={Boolean(problema) || m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? "Guardando…" : "Guardar cambios"}
        </Boton>
      </div>
    </Hoja>
  );
}

function Cancelar({ e, esAdmin, onCerrar, onListo }) {
  const ya = abonado(e);
  const [devolver, setDevolver] = useState(true);
  const [motivo, setMotivo] = useState("");
  const m = useMutation({
    mutationFn: () => api(`/encargos/${e.id}/cancelar/`, { method: "POST", body: { devolver_abonos: devolver, motivo } }),
    onSuccess: onListo,
  });
  const bloqueado = ya > 0 && !esAdmin;
  return (
    <Hoja titulo={`Cancelar encargo de ${e.cliente_nombre}`} onCerrar={onCerrar}>
      <p className="text-suave">Lo que se apartó del inventario vuelve a estar disponible.</p>
      {ya > 0 && (
        <fieldset className="mt-4 space-y-2">
          <legend className="mb-1 font-semibold">Ya abonó {pesos(ya)}. ¿Qué pasa con esa plata?</legend>
          {[[true, "Se le devuelve", "Sale hoy de la caja."], [false, "Se queda en el negocio", "El cliente pierde el abono."]].map(([v, t, d]) => (
            <label key={String(v)} className={`flex cursor-pointer gap-3 rounded-lg border-2 p-3 ${devolver === v ? "border-tinta" : "border-linea"}`}>
              <input type="radio" name="devolver" checked={devolver === v} onChange={() => setDevolver(v)} className="mt-1 accent-tinta" />
              <span><span className="font-semibold">{t}</span><span className="block text-sm text-suave">{d}</span></span>
            </label>
          ))}
        </fieldset>
      )}
      <input value={motivo} onChange={(ev) => setMotivo(ev.target.value)} maxLength={150} placeholder="Motivo (opcional)"
        className="mt-4 w-full rounded-lg border border-linea px-3 py-2.5 outline-none focus:border-tinta" aria-label="Motivo" />
      {bloqueado && <div className="mt-3"><Aviso tipo="info">Un encargo con abonos solo lo cancela el administrador.</Aviso></div>}
      {m.error && <div className="mt-3"><Aviso>{m.error.message}</Aviso></div>}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Boton variante="borde" onClick={onCerrar}>Volver</Boton>
        <button onClick={() => m.mutate()} disabled={bloqueado || m.isPending}
          className="rounded-lg bg-alerta px-4 py-3 font-semibold text-white disabled:opacity-50">
          {m.isPending ? "Cancelando…" : "Cancelar encargo"}
        </button>
      </div>
    </Hoja>
  );
}

export default function Encargos() {
  const qc = useQueryClient();
  const { negocio, esAdmin } = useSesion();
  const [vista, setVista] = useState("pendientes");
  const [accion, setAccion] = useState(null); // {tipo, e}

  const pendientes = useQuery({ queryKey: ["encargos", "pendientes"], queryFn: () => api("/encargos/"), refetchInterval: 30_000 });
  const otros = useQuery({
    queryKey: ["encargos", vista],
    queryFn: () => api("/encargos/", { query: { estado: vista } }),
    enabled: vista !== "pendientes",
  });
  const lista = pendientes.data || [];
  const grupos = useMemo(() => GRUPOS.map(([g, t]) => [t, lista.filter((e) => cuando(e.fecha_entrega).grupo === g)]).filter(([, l]) => l.length), [lista]);
  const porCobrar = lista.reduce((s, e) => s + Number(e.saldo_pendiente), 0);

  const listo = () => {
    setAccion(null);
    ["encargos", "caja", "ventas", "reportes", "productos", "clientes"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const cerrar = () => setAccion(null);
  const entregar = (e) => setAccion({ tipo: Number(e.saldo_pendiente) > 0 ? "entregar" : "entregarPagado", e });

  return (
    <div className="px-4 py-5 lg:px-6 lg:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-tinta">Encargos</h1>
          {lista.length > 0 && (
            <p className="mt-1 text-suave">{lista.length} por entregar · faltan <strong className="text-texto num">{pesos(porCobrar)}</strong> por cobrar</p>
          )}
        </div>
        <div className="flex rounded-lg bg-papel p-1 text-sm font-semibold" role="tablist">
          {[["pendientes", `Por entregar${lista.length ? ` (${lista.length})` : ""}`], ["entregados", "Entregados"], ["cancelados", "Cancelados"]].map(([v, t]) => (
            <button key={v} role="tab" aria-selected={vista === v} onClick={() => setVista(v)}
              className={`rounded-md px-3.5 py-2 ${vista === v ? "bg-tinta text-white" : "text-suave"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {(pendientes.error || otros.error) && <div className="mt-4"><Aviso>{(pendientes.error || otros.error).message}</Aviso></div>}

      {vista === "pendientes" ? (
        pendientes.isLoading ? (
          <p className="py-10 text-suave">Cargando encargos…</p>
        ) : lista.length === 0 ? (
          <div className="mt-12 text-center">
            <Gift size={36} className="mx-auto text-suave" aria-hidden />
            <p className="mt-2 font-display text-2xl font-bold text-tinta">No hay encargos pendientes</p>
            <p className="mt-1 text-suave">Para tomar uno, ve a Vender, arma la cuenta y elige <strong>Encargo</strong>.</p>
            <Link to="/vender" className="mt-4 inline-block rounded-lg bg-tinta px-5 py-3 font-semibold text-white">Tomar un encargo</Link>
          </div>
        ) : (
          grupos.map(([titulo, l]) => (
            <section key={titulo} className="mt-6">
              <h2 className="mb-2.5 font-display text-lg font-bold text-tinta">{titulo} <span className="font-normal text-suave">({l.length})</span></h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {l.map((e) => (
                  <Tarjeta key={e.id} e={e}
                    onAbonar={(x) => setAccion({ tipo: "abonar", e: x })}
                    onEntregar={entregar}
                    onEditar={(x) => setAccion({ tipo: "editar", e: x })}
                    onCancelar={(x) => setAccion({ tipo: "cancelar", e: x })} />
                ))}
              </div>
            </section>
          ))
        )
      ) : (
        <ul className="mt-5 max-w-3xl divide-y divide-linea rounded-xl bg-papel">
          {otros.isLoading && <li className="p-4 text-suave">Cargando…</li>}
          {!otros.isLoading && (otros.data || []).length === 0 && <li className="p-4 text-suave">Nada por aquí todavía.</li>}
          {(otros.data || []).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{e.cliente_nombre} <span className="font-normal text-suave">· #{e.numero}</span></p>
                <p className="truncate text-sm text-suave">{e.detalles.map((d) => `${numero(d.cantidad)} ${d.nombre}`).join(", ")}</p>
                <p className="text-sm text-suave">
                  {vista === "entregados"
                    ? `Entregado ${new Date(e.entregado_en).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}`
                    : e.motivo_anulacion}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-lg font-extrabold text-tinta num">{pesos(e.total)}</p>
                {e.estado === "FIADO" && <p className="text-sm text-alerta num">Debe {pesos(e.saldo_pendiente)}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {accion?.tipo === "abonar" && <Abonar e={accion.e} negocio={negocio} onCerrar={cerrar} onListo={listo} />}
      {accion?.tipo === "editar" && <Editar e={accion.e} onCerrar={cerrar} onListo={listo} />}
      {accion?.tipo === "cancelar" && <Cancelar e={accion.e} esAdmin={esAdmin} onCerrar={cerrar} onListo={listo} />}
      {accion?.tipo === "entregarPagado" && <EntregarPagado e={accion.e} onCerrar={cerrar} onListo={listo} />}
      {accion?.tipo === "entregar" && (
        <Cobro
          url={`/encargos/${accion.e.id}/entregar/`}
          total={Number(accion.e.saldo_pendiente)}
          detalle={accion.e.detalles}
          titulo={`Entregar a ${accion.e.cliente_nombre} · falta ${pesos(accion.e.saldo_pendiente)}`}
          clienteInicial={{ id: accion.e.cliente, nombre: accion.e.cliente_nombre }}
          negocio={negocio}
          textoBoton="Cobrar y entregar"
          etiquetaTotal={`Falta por pagar (ya abonó ${pesos(abonado(accion.e))})`}
          onListo={listo}
          onCerrar={cerrar}
        />
      )}
    </div>
  );
}
