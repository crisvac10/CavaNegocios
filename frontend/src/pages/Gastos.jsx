import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackagePlus, Plus, Trash2, Truck } from "lucide-react";
import { api } from "../lib/api";
import { fechaCorta, hoyISO, MEDIOS, numero, periodo, pesos } from "../lib/formato";
import { useSesion } from "../context/Sesion";
import { Aviso, Boton, Hoja, InputPesos } from "../components/ui";

const campo = "w-full rounded-lg border border-linea bg-papel px-3 py-2.5 outline-none focus:border-tinta";

const PERIODOS = [["hoy", "Hoy"], ["7d", "7 días"], ["mes", "Este mes"], ["mes_pasado", "Mes pasado"]];

function SelectorPeriodo({ valor, onCambio }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Periodo">
      {PERIODOS.map(([v, t]) => (
        <button key={v} onClick={() => onCambio(v)} aria-pressed={valor === v}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${valor === v ? "bg-tinta text-white" : "bg-papel text-tinta"}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

/* ---------- Gasto ---------- */
function NuevoGasto({ onCerrar }) {
  const qc = useQueryClient();
  const { negocio } = useSesion();
  const medios = negocio.medios_pago_activos;
  const { data: categorias = [] } = useQuery({ queryKey: ["categorias-gasto"], queryFn: () => api("/categorias-gasto/") });
  const [f, setF] = useState({ categoria: "", descripcion: "", monto: 0, medio: medios.includes("EFECTIVO") ? "EFECTIVO" : medios[0], fecha: hoyISO(), pagado_de_caja: true });
  const categoria = f.categoria || categorias[0]?.id || "";
  const guardar = useMutation({
    mutationFn: () => api("/gastos/", { method: "POST", body: { ...f, categoria } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["gastos"] }); qc.invalidateQueries({ queryKey: ["caja"] }); onCerrar(); },
  });
  return (
    <Hoja titulo="Nuevo gasto" onCerrar={onCerrar}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); guardar.mutate(); }}>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">¿En qué se gastó?</span>
          <input required autoFocus value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} className={campo} placeholder="Ej. Bolsa de hielo, recibo de la luz" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Valor</span>
            <InputPesos valor={f.monto} onCambio={(v) => setF({ ...f, monto: v })} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Categoría</span>
            <select value={categoria} onChange={(e) => setF({ ...f, categoria: Number(e.target.value) })} className={campo}>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Pagado con</span>
            <select value={f.medio} onChange={(e) => setF({ ...f, medio: e.target.value })} className={campo}>
              {Object.entries(MEDIOS).map(([m, t]) => <option key={m} value={m}>{t}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Fecha</span>
            <input type="date" max={hoyISO()} value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} className={campo} />
          </label>
        </div>
        <label className="flex items-start gap-3 rounded-lg bg-fondo p-3 text-sm">
          <input type="checkbox" checked={f.pagado_de_caja} onChange={(e) => setF({ ...f, pagado_de_caja: e.target.checked })} className="mt-0.5 h-4 w-4 accent-tinta" />
          <span><strong>Salió de la plata del negocio hoy.</strong> Se descuenta en el cuadre del día. Desmárcalo si lo pagaste de tu bolsillo o de otra cuenta.</span>
        </label>
        {guardar.error && <Aviso>{guardar.error.message}</Aviso>}
        <Boton className="w-full" disabled={!f.monto || !f.descripcion.trim() || !categoria || guardar.isPending}>
          {guardar.isPending ? "Guardando…" : `Registrar gasto${f.monto ? ` de ${pesos(f.monto)}` : ""}`}
        </Boton>
      </form>
    </Hoja>
  );
}

function ListaGastos({ per }) {
  const qc = useQueryClient();
  const { esAdmin } = useSesion();
  const [nuevo, setNuevo] = useState(false);
  const [anulando, setAnulando] = useState(null);
  const { desde, hasta } = periodo(per);
  const { data: gastos = [], isLoading, error } = useQuery({ queryKey: ["gastos", desde, hasta], queryFn: () => api("/gastos/", { query: { desde, hasta } }) });
  const anular = useMutation({
    mutationFn: (g) => api(`/gastos/${g.id}/anular/`, { method: "POST" }),
    onSuccess: () => { setAnulando(null); qc.invalidateQueries({ queryKey: ["gastos"] }); qc.invalidateQueries({ queryKey: ["caja"] }); },
  });
  const validos = gastos.filter((g) => !g.anulado);
  const total = validos.reduce((s, g) => s + Number(g.monto), 0);
  const porCategoria = useMemo(() => {
    const m = {};
    validos.forEach((g) => { m[g.categoria_nombre] = (m[g.categoria_nombre] || 0) + Number(g.monto); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [validos]);

  return (
    <>
      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="rounded-2xl bg-tinta p-5 text-white">
          <p className="text-white/70">Gastado en el periodo</p>
          <p className="font-display text-4xl font-extrabold num">{pesos(total)}</p>
          <p className="mt-1 text-sm text-white/70">{validos.length} {validos.length === 1 ? "gasto" : "gastos"} · {fechaCorta(desde)} a {fechaCorta(hasta)}</p>
        </div>
        <Boton onClick={() => setNuevo(true)}><Plus size={18} aria-hidden /> Nuevo gasto</Boton>
      </div>

      {porCategoria.length > 0 && (
        <ul className="mt-4 space-y-2 rounded-xl bg-papel p-4" aria-label="Gasto por categoría">
          {porCategoria.map(([cat, v]) => (
            <li key={cat} className="grid grid-cols-[8rem_1fr_6rem] items-center gap-3 text-sm sm:grid-cols-[10rem_1fr_7rem]">
              <span className="truncate font-medium">{cat}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-fondo" aria-hidden>
                <span className="block h-full rounded-full bg-tinta" style={{ width: `${(v / porCategoria[0][1]) * 100}%` }} />
              </span>
              <span className="text-right font-semibold num">{pesos(v)}</span>
            </li>
          ))}
        </ul>
      )}

      {error && <div className="mt-4"><Aviso>{error.message}</Aviso></div>}
      {isLoading ? <p className="py-8 text-suave">Cargando…</p> : gastos.length === 0 ? (
        <div className="py-12 text-center">
          <p className="font-display text-xl font-bold text-tinta">Sin gastos en este periodo</p>
          <p className="mt-1 text-suave">Registra arriendo, servicios, hielo, domicilios… para conocer tu ganancia real.</p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-linea overflow-hidden rounded-xl bg-papel">
          {gastos.map((g) => (
            <li key={g.id} className={`flex items-center gap-3 px-4 py-3 ${g.anulado ? "opacity-50" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{g.descripcion}</p>
                <p className="text-sm text-suave">
                  {fechaCorta(g.fecha)} · {g.categoria_nombre} · {MEDIOS[g.medio]}{g.anulado ? " · anulado" : ""}
                </p>
              </div>
              <span className="font-semibold num">{pesos(g.monto)}</span>
              {esAdmin && !g.anulado && (
                anulando === g.id ? (
                  <span className="flex gap-1">
                    <button onClick={() => anular.mutate(g)} className="rounded-lg bg-alerta px-2.5 py-1.5 text-xs font-semibold text-white">Anular</button>
                    <button onClick={() => setAnulando(null)} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-suave">No</button>
                  </span>
                ) : (
                  <button onClick={() => setAnulando(g.id)} className="rounded-lg p-2 text-suave hover:text-alerta" aria-label={`Anular gasto ${g.descripcion}`}>
                    <Trash2 size={17} />
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {anular.error && <div className="mt-3"><Aviso>{anular.error.message}</Aviso></div>}
      {nuevo && <NuevoGasto onCerrar={() => setNuevo(false)} />}
    </>
  );
}

/* ---------- Compras ---------- */
function NuevaCompra({ proveedores, onCerrar }) {
  const qc = useQueryClient();
  const { negocio } = useSesion();
  const medios = negocio.medios_pago_activos;
  const { data: productos = [] } = useQuery({ queryKey: ["productos", "admin"], queryFn: () => api("/productos/") });
  const activos = productos.filter((p) => p.activo);
  const [items, setItems] = useState([{ producto: "", cantidad: "", costo_unitario: 0 }]);
  const [f, setF] = useState({ proveedor: "", medio: medios.includes("EFECTIVO") ? "EFECTIVO" : medios[0], pagado_de_caja: true, nota: "" });
  const total = items.reduce((s, it) => s + (Number(it.cantidad) || 0) * (it.costo_unitario || 0), 0);
  const setItem = (i, k, v) => setItems((xs) => xs.map((x, j) => {
    if (j !== i) return x;
    const nuevo = { ...x, [k]: v };
    if (k === "producto") nuevo.costo_unitario = Number(productos.find((p) => p.id === Number(v))?.costo) || 0;
    return nuevo;
  }));
  const validos = items.filter((it) => it.producto && Number(it.cantidad) > 0);
  const guardar = useMutation({
    mutationFn: () => api("/compras/", {
      method: "POST",
      body: { ...f, proveedor: f.proveedor || null, items: validos.map((it) => ({ producto: Number(it.producto), cantidad: Number(it.cantidad), costo_unitario: it.costo_unitario })) },
    }),
    onSuccess: () => { ["compras", "productos", "caja"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); onCerrar(); },
  });

  return (
    <Hoja titulo="Nueva compra de mercancía" onCerrar={onCerrar} ancho="max-w-2xl">
      <p className="-mt-2 mb-4 text-sm text-suave">Suma al inventario y actualiza el costo de cada producto. No cuenta como gasto: se vuelve costo cuando lo vendes.</p>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); guardar.mutate(); }}>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_5.5rem] gap-2 rounded-lg border border-linea p-2 sm:grid-cols-[1fr_6rem_9rem_2.5rem] sm:border-0 sm:p-0">
              <select value={it.producto} onChange={(e) => setItem(i, "producto", e.target.value)} className={`${campo} col-span-2 sm:col-span-1`} aria-label="Producto">
                <option value="">Producto…</option>
                {activos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              <input inputMode="decimal" placeholder="Cant." value={it.cantidad} onChange={(e) => setItem(i, "cantidad", e.target.value)} className={campo} aria-label="Cantidad" />
              <InputPesos valor={it.costo_unitario} onCambio={(v) => setItem(i, "costo_unitario", v)} aria-label="Costo unitario" />
              <button type="button" onClick={() => setItems((xs) => xs.length > 1 ? xs.filter((_, j) => j !== i) : xs)} className="hidden place-items-center rounded-lg text-suave hover:text-alerta sm:grid" aria-label="Quitar línea">
                <Trash2 size={17} />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setItems((xs) => [...xs, { producto: "", cantidad: "", costo_unitario: 0 }])} className="flex items-center gap-1.5 text-sm font-semibold text-tinta">
            <Plus size={16} aria-hidden /> Agregar producto
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Proveedor <span className="font-normal text-suave">(opcional)</span></span>
            <select value={f.proveedor} onChange={(e) => setF({ ...f, proveedor: e.target.value ? Number(e.target.value) : "" })} className={campo}>
              <option value="">Sin proveedor</option>
              {proveedores.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Pagado con</span>
            <select value={f.medio} onChange={(e) => setF({ ...f, medio: e.target.value })} className={campo}>
              {Object.entries(MEDIOS).map(([m, t]) => <option key={m} value={m}>{t}</option>)}
            </select>
          </label>
        </div>
        <label className="flex items-start gap-3 rounded-lg bg-fondo p-3 text-sm">
          <input type="checkbox" checked={f.pagado_de_caja} onChange={(e) => setF({ ...f, pagado_de_caja: e.target.checked })} className="mt-0.5 h-4 w-4 accent-tinta" />
          <span><strong>Salió de la plata del negocio hoy.</strong> Se descuenta en el cuadre del día.</span>
        </label>
        <div className="flex items-baseline justify-between border-t-2 border-tinta pt-3">
          <span className="font-display text-lg font-bold text-tinta">Total compra</span>
          <span className="font-display text-2xl font-extrabold text-tinta num">{pesos(total)}</span>
        </div>
        {guardar.error && <Aviso>{guardar.error.message}</Aviso>}
        <Boton className="w-full" disabled={!validos.length || guardar.isPending}>
          <PackagePlus size={18} aria-hidden /> {guardar.isPending ? "Guardando…" : "Registrar compra"}
        </Boton>
      </form>
    </Hoja>
  );
}

function ListaCompras({ per, proveedores }) {
  const [nueva, setNueva] = useState(false);
  const { desde, hasta } = periodo(per);
  const { data: compras = [], isLoading, error } = useQuery({ queryKey: ["compras"], queryFn: () => api("/compras/") });
  const enPeriodo = compras.filter((c) => c.fecha >= desde && c.fecha <= hasta);
  const total = enPeriodo.reduce((s, c) => s + Number(c.total), 0);
  return (
    <>
      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="rounded-2xl bg-papel p-5">
          <p className="text-suave">Compras de mercancía en el periodo</p>
          <p className="font-display text-4xl font-extrabold text-tinta num">{pesos(total)}</p>
        </div>
        <Boton onClick={() => setNueva(true)}><Plus size={18} aria-hidden /> Nueva compra</Boton>
      </div>
      {error && <div className="mt-4"><Aviso>{error.message}</Aviso></div>}
      {isLoading ? <p className="py-8 text-suave">Cargando…</p> : enPeriodo.length === 0 ? (
        <p className="py-12 text-center text-suave">Sin compras en este periodo. Registra lo que le compras a tus proveedores para que el inventario y el costo queden al día.</p>
      ) : (
        <ul className="mt-4 divide-y divide-linea overflow-hidden rounded-xl bg-papel">
          {enPeriodo.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <div className="flex justify-between gap-3">
                <span className="font-medium">#{c.numero} · {fechaCorta(c.fecha)}{c.proveedor_nombre ? ` · ${c.proveedor_nombre}` : ""}</span>
                <span className="font-semibold num">{pesos(c.total)}</span>
              </div>
              <p className="truncate text-sm text-suave">{c.detalles.map((d) => `${numero(d.cantidad)} ${d.nombre}`).join(", ")}</p>
            </li>
          ))}
        </ul>
      )}
      {nueva && <NuevaCompra proveedores={proveedores} onCerrar={() => setNueva(false)} />}
    </>
  );
}

/* ---------- Proveedores ---------- */
function Proveedores({ proveedores }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ nombre: "", telefono: "", nit: "" });
  const crear = useMutation({
    mutationFn: () => api("/proveedores/", { method: "POST", body: f }),
    onSuccess: () => { setF({ nombre: "", telefono: "", nit: "" }); qc.invalidateQueries({ queryKey: ["proveedores"] }); },
  });
  return (
    <div className="mt-5 max-w-2xl">
      <form className="grid gap-2 rounded-xl bg-papel p-4 sm:grid-cols-[1fr_10rem_auto]" onSubmit={(e) => { e.preventDefault(); crear.mutate(); }}>
        <input required value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Nombre del proveedor" className={campo} />
        <input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} placeholder="Teléfono" inputMode="tel" className={campo} />
        <Boton disabled={!f.nombre.trim() || crear.isPending}><Plus size={18} aria-hidden /> Agregar</Boton>
      </form>
      {crear.error && <div className="mt-3"><Aviso>{crear.error.message}</Aviso></div>}
      <ul className="mt-4 divide-y divide-linea overflow-hidden rounded-xl bg-papel">
        {proveedores.length === 0 && <li className="p-4 text-suave">Aún no tienes proveedores. Agrégalos para saber a quién le compras.</li>}
        {proveedores.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-3">
            <Truck size={18} className="text-suave" aria-hidden />
            <span className="flex-1 font-medium">{p.nombre}</span>
            {p.telefono && <a href={`tel:${p.telefono}`} className="text-sm text-tinta underline">{p.telefono}</a>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Gastos() {
  const { esAdmin } = useSesion();
  const [tab, setTab] = useState("gastos");
  const [per, setPer] = useState("mes");
  const { data: proveedores = [] } = useQuery({ queryKey: ["proveedores"], queryFn: () => api("/proveedores/"), enabled: esAdmin });
  const tabs = [["gastos", "Gastos"], ...(esAdmin ? [["compras", "Compras de mercancía"], ["proveedores", "Proveedores"]] : [])];

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 lg:px-6 lg:py-8">
      <h1 className="font-display text-3xl font-bold text-tinta">Gastos</h1>
      {tabs.length > 1 && (
        <div className="mt-4 flex gap-1 overflow-x-auto border-b border-linea" role="tablist">
          {tabs.map(([v, t]) => (
            <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)}
              className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 font-semibold ${tab === v ? "border-tinta text-tinta" : "border-transparent text-suave"}`}>
              {t}
            </button>
          ))}
        </div>
      )}
      {tab !== "proveedores" && <div className="mt-5"><SelectorPeriodo valor={per} onCambio={setPer} /></div>}
      {tab === "gastos" && <ListaGastos per={per} />}
      {tab === "compras" && <ListaCompras per={per} proveedores={proveedores} />}
      {tab === "proveedores" && <Proveedores proveedores={proveedores} />}
    </div>
  );
}
