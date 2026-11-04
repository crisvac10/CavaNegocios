import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Search, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { hoyISO, MEDIOS, numero, pesos } from "../lib/formato";
import { useSesion } from "../context/Sesion";
import { Aviso, Boton, Hoja, InputPesos } from "./ui";

const fechaLocal = (iso) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/**
 * Edita un pedido por cobrar (productos, mesa, nota) o, para el dueño, una venta ya cobrada
 * de cualquier día (también cómo se pagó y su fecha). También la elimina si fue un error.
 */
export default function EditorVenta({ venta, onCerrar, onListo }) {
  const qc = useQueryClient();
  const { negocio, esAdmin, tieneModulo } = useSesion();
  const abierta = venta.estado === "ABIERTA" || venta.estado_pago === "ABIERTA";
  const lineasIniciales = (venta.detalles || venta.items || []).map((d) => ({
    producto: d.producto, nombre: d.nombre, cantidad: Number(d.cantidad), precio: Number(d.precio_unitario),
  }));
  const [lineas, setLineas] = useState(lineasIniciales);
  const [descuento, setDescuento] = useState(Number(venta.descuento || 0));
  const [nota, setNota] = useState(venta.nota || "");
  const [mesa, setMesa] = useState(venta.mesa || "");
  const [fecha, setFecha] = useState(fechaLocal(venta.creado));
  const pagosIniciales = (venta.pagos || []).filter((p) => !p.es_abono);
  const [montos, setMontos] = useState(() => {
    const m = {};
    pagosIniciales.forEach((p) => { m[p.medio] = (m[p.medio] || 0) + Number(p.monto); });
    return m;
  });
  const [q, setQ] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [motivo, setMotivo] = useState("");

  const { data: productos = [] } = useQuery({ queryKey: ["productos", "pos"], queryFn: () => api("/productos/", { query: { activos: 1 } }) });
  const sugeridos = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return productos.filter((p) => p.nombre.toLowerCase().includes(t)).slice(0, 6);
  }, [q, productos]);

  const subtotal = lineas.reduce((s, l) => s + l.cantidad * l.precio, 0);
  const total = Math.max(subtotal - descuento, 0);
  const pagado = Object.values(montos).reduce((s, v) => s + (Number(v) || 0), 0);
  const editaPagos = !abierta && esAdmin;
  const unSoloMedio = Object.keys(montos).length <= 1 && Number(venta.saldo_pendiente || 0) === 0;
  // Con un solo medio y sin fiado, el pago sigue al total automáticamente
  const pagosFinales = editaPagos
    ? unSoloMedio && Object.keys(montos).length === 1
      ? [{ medio: Object.keys(montos)[0], monto: total }]
      : Object.entries(montos).filter(([, v]) => v > 0).map(([medio, monto]) => ({ medio, monto }))
    : null;
  const pagadoFinal = pagosFinales ? pagosFinales.reduce((s, p) => s + p.monto, 0) : 0;
  const saldo = editaPagos ? total - pagadoFinal : 0;

  const cambiar = (i, n) => setLineas((ls) => (n <= 0 ? ls.filter((_, j) => j !== i) : ls.map((l, j) => (j === i ? { ...l, cantidad: n } : l))));
  const agregar = (p) => {
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.producto === p.id);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, cantidad: l.cantidad + 1 } : l));
      return [...ls, { producto: p.id, nombre: p.nombre, cantidad: 1, precio: Number(p.precio) }];
    });
    setQ("");
  };

  const refrescar = () => ["pedidos", "ventas", "caja", "productos", "reportes", "clientes", "fiados"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const guardar = useMutation({
    mutationFn: () => api(`/ventas/${venta.id}/editar/`, {
      method: "POST",
      body: {
        items: lineas.map((l) => ({ producto: l.producto, cantidad: l.cantidad, precio: l.precio })),
        descuento, nota, mesa,
        ...(editaPagos ? { pagos: pagosFinales, fecha } : {}),
      },
    }),
    onSuccess: (v) => { refrescar(); onListo?.(v); onCerrar(); },
  });
  const eliminar = useMutation({
    mutationFn: () => api(`/ventas/${venta.id}/eliminar/`, { method: "POST", body: { motivo } }),
    onSuccess: () => { refrescar(); onCerrar(); },
  });

  const usaCola = tieneModulo("pedidos") && negocio.usa_cola_pedidos;
  const numMesas = negocio.num_mesas || 0;
  const problema = !lineas.length
    ? "Agrega al menos un producto."
    : editaPagos && saldo < 0
      ? `Los pagos suman ${pesos(-saldo)} más que el total.`
      : editaPagos && saldo > 0 && !venta.cliente
        ? `Faltan ${pesos(saldo)} por repartir en los pagos.`
        : null;

  return (
    <Hoja titulo={abierta ? `Editar pedido${venta.turno ? ` · turno ${venta.turno}` : ""}` : `Editar venta #${venta.numero}`} onCerrar={onCerrar} ancho="max-w-xl">
      <div className="space-y-4">
        <ul className="divide-y divide-linea rounded-xl border border-linea">
          {lineas.map((l, i) => (
            <li key={`${l.producto}-${i}`} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
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
          {lineas.length === 0 && <li className="px-3 py-4 text-suave">Sin productos.</li>}
        </ul>

        <div className="relative">
          <div className="flex items-center gap-2 rounded-lg border border-linea bg-papel px-3 focus-within:border-tinta">
            <Search size={18} className="text-suave" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Agregar otro producto" className="w-full bg-transparent py-2.5 outline-none" aria-label="Agregar producto" />
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

        {usaCola && (abierta || venta.mesa) && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dónde se entrega">
            {[["LLEVAR", "Para llevar"], ...Array.from({ length: numMesas }, (_, i) => [String(i + 1), `Mesa ${i + 1}`])].map(([v, t]) => (
              <button key={v} type="button" onClick={() => setMesa(mesa === v ? "" : v)} aria-pressed={mesa === v}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${mesa === v ? "border-tinta bg-tinta text-white" : "border-linea bg-papel text-tinta"}`}>{t}</button>
            ))}
          </div>
        )}
        <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={200} placeholder="Nota (ej. sin azúcar)"
          className="w-full rounded-lg border border-linea bg-papel px-3 py-2.5 outline-none focus:border-tinta" aria-label="Nota" />
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Descuento</span>
          <InputPesos className="w-40" valor={descuento} onCambio={(v) => setDescuento(Math.min(v, subtotal))} aria-label="Descuento" />
        </label>

        {editaPagos && (
          <section className="space-y-3 rounded-xl bg-fondo p-4">
            <label className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
              Fecha de la venta
              <input type="date" value={fecha} max={hoyISO()} onChange={(e) => setFecha(e.target.value)} className="rounded-lg border border-linea bg-papel px-2 py-1.5 font-normal" />
            </label>
            <div>
              <p className="mb-2 text-sm font-semibold">Cómo se pagó</p>
              {unSoloMedio && Object.keys(montos).length === 1 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select value={Object.keys(montos)[0]} onChange={(e) => setMontos({ [e.target.value]: total })} className="rounded-lg border border-linea bg-papel px-3 py-2" aria-label="Medio de pago">
                    {Object.entries(MEDIOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                  </select>
                  <span className="text-sm text-suave">por el total: <strong className="num">{pesos(total)}</strong></span>
                  <button type="button" onClick={() => setMontos({ ...montos, __dividir: 0 })} className="text-sm font-semibold text-tinta underline">Repartir en varios medios</button>
                </div>
              ) : (
                <div className="space-y-2">
                  {Object.keys(MEDIOS).map((m) => (
                    <label key={m} className="flex items-center gap-3 text-sm">
                      <span className="w-28">{MEDIOS[m]}</span>
                      <InputPesos className="flex-1" valor={montos[m] || 0} onCambio={(v) => setMontos((x) => { const y = { ...x, [m]: v }; delete y.__dividir; return y; })} aria-label={`Pagado en ${MEDIOS[m]}`} />
                    </label>
                  ))}
                  <p className={`text-right text-sm font-semibold num ${saldo === 0 ? "text-ok" : "text-alerta"}`}>
                    {saldo === 0 ? "Cuadra con el total" : saldo > 0 ? `Faltan ${pesos(saldo)}${venta.cliente ? " (queda fiado)" : ""}` : `Sobran ${pesos(-saldo)}`}
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        <div className="flex items-baseline justify-between border-t-2 border-tinta pt-3">
          <span className="font-display text-lg font-bold text-tinta">Total</span>
          <span className="font-display text-2xl font-extrabold text-tinta num">{pesos(total)}</span>
        </div>
        {problema && <Aviso tipo="info">{problema}</Aviso>}
        {guardar.error && <Aviso>{guardar.error.message}</Aviso>}
        <Boton className="w-full" disabled={Boolean(problema) || guardar.isPending} onClick={() => guardar.mutate()}>
          {guardar.isPending ? "Guardando…" : "Guardar cambios"}
        </Boton>

        <div className="border-t border-linea pt-4">
          {!confirmar ? (
            <button type="button" onClick={() => setConfirmar(true)} className="inline-flex items-center gap-2 text-sm font-semibold text-alerta hover:underline">
              <Trash2 size={16} aria-hidden /> {abierta ? "Cancelar pedido" : "Eliminar venta"}
            </button>
          ) : (
            <div className="rounded-xl bg-alerta-claro p-4" role="alertdialog" aria-label="Confirmar">
              <p className="font-semibold text-alerta">{abierta ? "¿Cancelar este pedido?" : "¿Eliminar esta venta?"}</p>
              <p className="mt-1 text-sm">
                Los productos vuelven al inventario{abierta ? "." : " y su dinero sale del cuadre del día en que se vendió."} Queda en el historial como eliminada.
              </p>
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional)" className="mt-3 w-full rounded-lg border border-linea bg-papel px-3 py-2 text-sm outline-none focus:border-tinta" />
              {eliminar.error && <div className="mt-2"><Aviso>{eliminar.error.message}</Aviso></div>}
              <div className="mt-3 flex gap-2">
                <Boton variante="borde" className="flex-1 py-2.5" onClick={() => setConfirmar(false)}>No</Boton>
                <button type="button" onClick={() => eliminar.mutate()} disabled={eliminar.isPending}
                  className="flex-1 rounded-lg bg-alerta py-2.5 font-semibold text-white disabled:opacity-60">
                  {eliminar.isPending ? "Eliminando…" : abierta ? "Sí, cancelar" : "Sí, eliminar"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Hoja>
  );
}
