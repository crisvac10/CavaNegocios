import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MessageSquareText, Pencil, Undo2 } from "lucide-react";
import { api } from "../lib/api";
import { numero, pesos } from "../lib/formato";
import { useSesion } from "../context/Sesion";
import { cobraDeUna } from "../lib/tipos";
import Cobro from "../components/Cobro";
import EditorVenta from "../components/EditorVenta";
import { Aviso } from "../components/ui";

const PAGO = {
  ABIERTA: ["Por cobrar", "bg-precio-claro text-texto"],
  PAGADA: ["Pagado", "bg-ok-claro text-ok"],
  FIADO: ["Fiado", "bg-fondo text-suave"],
};
const donde = (mesa) => (mesa === "LLEVAR" ? "Para llevar" : mesa ? `Mesa ${mesa}` : null);

/**
 * Una cuenta dividida queda en varias ventas con el mismo turno: en la cola se ven como un solo pedido.
 * Cobrar/Editar actúan sobre la parte que sigue por cobrar.
 */
function agrupar(lista = []) {
  const grupos = [];
  const porTurno = new Map();
  for (const v of lista) {
    const g = v.turno ? porTurno.get(v.turno) : null;
    if (!g) {
      const nuevo = { ...v, partes: [v] };
      grupos.push(nuevo);
      if (v.turno) porTurno.set(v.turno, nuevo);
      continue;
    }
    g.partes.push(v);
  }
  return grupos.map((g) => {
    if (g.partes.length === 1) return g;
    const abierta = g.partes.find((v) => v.estado_pago === "ABIERTA");
    const base = abierta || g.partes[0];
    return {
      ...base,
      creado: g.partes.reduce((m, v) => (v.creado < m ? v.creado : m), g.creado),
      entregado_en: g.partes.every((v) => v.entregado_en) ? base.entregado_en : null,
      // Lo mismo repartido entre varias personas se ve junto (ej. 2× Agua, no 1× Agua dos veces)
      items: Object.values(g.partes.flatMap((v) => v.items).reduce((acc, it) => {
        const k = `${it.producto ?? it.nombre}|${it.precio_unitario}`;
        acc[k] = acc[k] ? { ...acc[k], cantidad: Number(acc[k].cantidad) + Number(it.cantidad) } : { ...it };
        return acc;
      }, {})),
      total: g.partes.reduce((s, v) => s + Number(v.total), 0),
      estado_pago: abierta ? "ABIERTA" : g.partes.some((v) => v.estado_pago === "FIADO") ? "FIADO" : "PAGADA",
      partes: g.partes,
      abierta,
    };
  });
}

const ESPERA_LARGA = 10; // minutos: a partir de aquí el pedido se marca en rojo

const minutosDesde = (iso, ahora) => Math.max(0, Math.floor((ahora - new Date(iso).getTime()) / 60000));
const textoEspera = (min) => (min < 1 ? "Recién" : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);

function Tarjeta({ p, ahora, onEntregar, onCobrar, onEditar, enviando }) {
  const min = minutosDesde(p.creado, ahora);
  const porCobrar = p.estado_pago === "ABIERTA";
  const entregado = Boolean(p.entregado_en);
  const tarde = !entregado && min >= ESPERA_LARGA;
  const [etq, cls] = PAGO[p.estado_pago] || PAGO.PAGADA;
  return (
    <article className={`flex flex-col rounded-2xl border-2 bg-papel ${tarde ? "border-alerta" : "border-transparent"}`}>
      <header className="flex items-start justify-between gap-2 px-4 pt-4">
        <div>
          <p className="text-sm text-suave">Turno</p>
          <p className="font-display text-5xl font-extrabold leading-none text-tinta num">{p.turno}</p>
          {donde(p.mesa) && <p className="mt-1.5 inline-block rounded-md bg-tinta px-2 py-0.5 text-sm font-semibold text-white">{donde(p.mesa)}</p>}
        </div>
        <div className="text-right">
          <p className={`font-semibold num ${tarde ? "text-alerta" : "text-suave"}`}>{entregado ? "Entregado" : textoEspera(min)}</p>
          {p.cliente && <p className="mt-0.5 text-sm font-medium">{p.cliente}</p>}
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{etq}</span>
          {p.partes?.length > 1 && (
            <p className="mt-1 text-xs text-suave">
              Cuenta dividida · {p.partes.filter((v) => v.estado_pago !== "ABIERTA").length} de {p.partes.length} cobradas
            </p>
          )}
        </div>
      </header>
      <ul className="flex-1 space-y-1.5 px-4 py-4">
        {p.items.map((it, i) => (
          <li key={i} className="flex gap-3 text-[17px]">
            <span className="w-8 shrink-0 text-right font-bold text-tinta num">{numero(it.cantidad)}×</span>
            <span className="font-medium">{it.nombre}</span>
          </li>
        ))}
      </ul>
      {p.nota && (
        <p className="mx-4 mb-3 flex gap-2 rounded-lg bg-precio-claro px-3 py-2 text-sm font-medium">
          <MessageSquareText size={17} className="mt-0.5 shrink-0" aria-hidden />
          {p.nota}
        </p>
      )}
      <p className="flex items-baseline justify-between border-t border-dashed border-linea px-4 py-2.5">
        <span className="text-sm text-suave">Total</span>
        <span className="font-display text-xl font-extrabold text-tinta num">{pesos(p.total)}</span>
      </p>
      {p.partes?.length > 1 && p.abierta && (
        <p className="-mt-1 flex justify-between px-4 pb-2.5 text-sm font-semibold">
          <span>Falta por cobrar</span>
          <span className="num">{pesos(p.abierta.total)}</span>
        </p>
      )}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-2xl bg-linea">
        <button onClick={() => onEditar(p.abierta || p.partes?.[0] || p)} className={`flex items-center justify-center gap-1.5 bg-papel py-3.5 font-semibold text-tinta hover:bg-fondo ${porCobrar ? "" : "col-span-2"}`}>
          <Pencil size={17} aria-hidden /> Editar
        </button>
        {porCobrar && (
          <button onClick={() => onCobrar(p.abierta || p)} className="bg-tinta py-3.5 font-semibold text-white hover:bg-tinta-2">
            Cobrar
          </button>
        )}
        {!entregado && (
          <button
            onClick={() => onEntregar(p)}
            disabled={enviando}
            className="col-span-2 flex items-center justify-center gap-2 bg-ok py-3.5 text-lg font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            <Check size={22} aria-hidden /> Entregado
          </button>
        )}
      </div>
    </article>
  );
}

const hora = (iso) => new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });

/** Tiendas: lo que se entregó hoy, cada pedido con todo lo que llevó. */
function VendidosHoy({ lista = [], cargando }) {
  if (cargando) return <p className="py-10 text-suave">Cargando…</p>;
  if (!lista.length)
    return (
      <div className="mt-10 text-center">
        <p className="font-display text-2xl font-bold text-tinta">Aún no se ha entregado nada hoy</p>
        <p className="mt-1 text-suave">Cada venta y cada encargo que entregues aparece aquí con lo que llevó.</p>
      </div>
    );
  const total = lista.reduce((s, p) => s + Number(p.total), 0);
  return (
    <>
      <p className="mt-3 text-suave">
        {lista.length} {lista.length === 1 ? "pedido entregado" : "pedidos entregados"} · <b className="text-texto num">{pesos(total)}</b>
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {lista.map((p) => {
          const [etq, cls] = PAGO[p.estado_pago] || PAGO.PAGADA;
          return (
            <article key={p.id} className="rounded-2xl bg-papel p-4">
              <header className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-lg font-bold text-tinta">
                    {p.origen === "ENCARGO" ? "Encargo" : "Venta"} #{p.numero}
                  </p>
                  <p className="text-sm text-suave">
                    Entregado {hora(p.entregado_en)}{p.cliente ? ` · ${p.cliente}` : ""}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{etq}</span>
              </header>
              <ul className="mt-3 space-y-1">
                {p.items.map((it, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-7 shrink-0 text-right font-bold text-tinta num">{numero(it.cantidad)}×</span>
                    <span className="flex-1">{it.nombre}</span>
                    <span className="text-suave num">{pesos(it.subtotal)}</span>
                  </li>
                ))}
              </ul>
              {p.nota && <p className="mt-2 rounded-lg bg-fondo px-3 py-1.5 text-sm">{p.nota}</p>}
              <p className="mt-3 flex items-baseline justify-between border-t border-dashed border-linea pt-2">
                <span className="text-sm text-suave">Total</span>
                <span className="font-display text-lg font-extrabold text-tinta num">{pesos(p.total)}</span>
              </p>
            </article>
          );
        })}
      </div>
    </>
  );
}

export default function Pedidos() {
  const qc = useQueryClient();
  const { negocio } = useSesion();
  const [cobrando, setCobrando] = useState(null);
  const [editando, setEditando] = useState(null);
  // Tiendas: no hay cola, Pedidos muestra lo vendido y entregado en el día
  const tienda = cobraDeUna(negocio);
  const [vista, setVista] = useState(tienda ? "entregados" : "pendientes");
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const pendientes = useQuery({
    queryKey: ["pedidos", "pendientes"],
    queryFn: () => api("/pedidos/"),
    enabled: !tienda,
    refetchInterval: 5_000,
  });
  const entregados = useQuery({
    queryKey: ["pedidos", "entregados"],
    queryFn: () => api("/pedidos/", { query: { estado: "entregados" } }),
    enabled: vista === "entregados",
    refetchInterval: tienda ? 30_000 : 15_000,
  });

  const refrescar = () => qc.invalidateQueries({ queryKey: ["pedidos"] });
  const [errorEditar, setErrorEditar] = useState(null);
  // Lo ya cobrado se edita con sus pagos, así que se trae la venta completa antes de abrir el editor
  const abrirEditor = async (p) => {
    setErrorEditar(null);
    if (p.estado_pago === "ABIERTA") return setEditando(p);
    try {
      setEditando(await api(`/ventas/${p.id}/`));
    } catch (e) {
      setErrorEditar(e);
    }
  };
  const entregar = useMutation({
    mutationFn: (p) => api(`/pedidos/${p.id}/entregar/`, { method: "POST" }),
    // Lo quitamos de la pantalla de una: el toque se siente inmediato aunque el internet esté lento
    onMutate: async (p) => {
      await qc.cancelQueries({ queryKey: ["pedidos", "pendientes"] });
      const antes = qc.getQueryData(["pedidos", "pendientes"]);
      // Si falta cobrarlo se queda en la cola como "entregado, por cobrar"
      const ids = new Set((p.partes || [p]).map((x) => x.id));
      qc.setQueryData(["pedidos", "pendientes"], (lista = []) =>
        lista.flatMap((x) => (!ids.has(x.id) ? [x] : x.estado_pago === "ABIERTA" ? [{ ...x, entregado_en: new Date().toISOString() }] : [])));
      return { antes };
    },
    onError: (_e, _p, ctx) => qc.setQueryData(["pedidos", "pendientes"], ctx.antes),
    onSettled: refrescar,
  });
  const deshacer = useMutation({
    mutationFn: (p) => api(`/pedidos/${p.id}/deshacer/`, { method: "POST" }),
    onSettled: refrescar,
  });

  const lista = agrupar(pendientes.data);
  const error = pendientes.error || entregar.error || deshacer.error || errorEditar;

  return (
    <div className="px-4 py-5 lg:px-6 lg:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-bold text-tinta">Pedidos</h1>
        <div className="flex rounded-lg bg-papel p-1 text-sm font-semibold" role="tablist">
          {[
            !tienda && ["pendientes", `Pendientes${lista.length ? ` (${lista.length})` : ""}`],
            ["entregados", tienda ? `Entregados hoy${entregados.data?.length ? ` (${entregados.data.length})` : ""}` : "Entregados hoy"],
          ].filter(Boolean).map(([v, t]) => (
            <button
              key={v}
              role="tab"
              aria-selected={vista === v}
              onClick={() => setVista(v)}
              className={`rounded-md px-4 py-2 ${vista === v ? "bg-tinta text-white" : "text-suave"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mt-4"><Aviso>{error.message}</Aviso></div>}

      {vista === "pendientes" ? (
        pendientes.isLoading ? (
          <p className="py-10 text-suave">Cargando pedidos…</p>
        ) : lista.length === 0 ? (
          <div className="mt-10 text-center">
            <p className="font-display text-2xl font-bold text-tinta">Todo entregado y cobrado</p>
            <p className="mt-1 text-suave">Los pedidos que registres en Vender aparecen aquí para entregarlos y cobrarlos.</p>
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {lista.map((p) => (
              <Tarjeta key={p.id} p={p} ahora={ahora} onEntregar={entregar.mutate} onCobrar={setCobrando} onEditar={abrirEditor}
                enviando={entregar.isPending && entregar.variables?.id === p.id} />
            ))}
          </div>
        )
      ) : (
        tienda ? (
          <VendidosHoy lista={entregados.data} cargando={entregados.isLoading} />
        ) : (
        <ul className="mt-5 max-w-2xl divide-y divide-linea rounded-xl bg-papel">
          {(entregados.data || []).length === 0 && <li className="p-4 text-suave">Aún no se ha entregado nada hoy.</li>}
          {agrupar(entregados.data).map((p) => (
            <li key={p.id} className="flex items-center gap-4 px-4 py-3">
              <span className="w-12 font-display text-2xl font-extrabold text-tinta num">{p.turno}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.items.map((i) => `${numero(i.cantidad)} ${i.nombre}`).join(", ")}</p>
                <p className="text-sm text-suave">
                  Entregado {new Date(p.entregado_en).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" })}
                </p>
              </div>
              <button
                onClick={() => deshacer.mutate(p)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-tinta hover:bg-fondo"
              >
                <Undo2 size={16} aria-hidden /> Deshacer
              </button>
            </li>
          ))}
        </ul>
        )
      )}
      {cobrando && (
        <Cobro
          ventaId={cobrando.id}
          total={Number(cobrando.total)}
          detalle={cobrando.items}
          titulo={`Cobrar turno ${cobrando.turno}${donde(cobrando.mesa) ? ` · ${donde(cobrando.mesa)}` : ""}`}
          negocio={negocio}
          onParte={() => { refrescar(); qc.invalidateQueries({ queryKey: ["caja"] }); }}
          onListo={() => { setCobrando(null); refrescar(); qc.invalidateQueries({ queryKey: ["caja"] }); }}
          onCerrar={() => setCobrando(null)}
        />
      )}
      {editando && <EditorVenta venta={editando} onCerrar={() => setEditando(null)} />}
    </div>
  );
}
