import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, Share2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { hoyISO, MEDIOS, numero, pesos } from "../lib/formato";
import { useSesion } from "../context/Sesion";
import Cobro from "../components/Cobro";
import EditorVenta from "../components/EditorVenta";
import { Aviso, Boton, Hoja, InputPesos } from "../components/ui";

const ESTADO = {
  ABIERTA: ["Por cobrar", "bg-precio-claro text-texto"],
  FIADO: ["Fiado", "bg-precio-claro text-texto"],
  ANULADA: ["Eliminada", "bg-fondo text-suave"],
  ENCARGO: ["Encargo pagado · por entregar", "bg-precio-claro text-texto"],
};

/** Una venta del día: una línea resumida que se despliega con todo lo que se vendió. */
function FilaVenta({ v, negocio, esAdmin, abierta, onAbrir, onEditar, onCobrar }) {
  const anulada = v.estado === "ANULADA";
  const saldoAnterior = v.origen === "SALDO_ANTERIOR";
  const [etq, cls] = saldoAnterior ? ["Deuda anterior", "bg-fondo text-suave"] : ESTADO[v.estado] || [];
  const hora = new Date(v.creado).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
  // Un encargo pagado que aún no se entrega se maneja desde Encargos
  const puedeEditar = !anulada && !saldoAnterior && v.estado !== "ENCARGO" && (esAdmin || v.estado === "ABIERTA");
  const pagos = v.pagos.filter((p) => !p.es_abono);
  const abonos = v.pagos.filter((p) => p.es_abono);
  const resumen = saldoAnterior ? v.nota : v.detalles.map((d) => `${numero(d.cantidad)} ${d.nombre}`).join(", ");
  return (
    <li className={anulada ? "opacity-60" : ""}>
      <button onClick={onAbrir} aria-expanded={abierta} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-fondo/60">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            #{v.numero} <span className="text-sm font-normal text-suave">{hora}{v.turno ? ` · turno ${v.turno}` : ""}{v.mesa ? ` · ${v.mesa === "LLEVAR" ? "para llevar" : `mesa ${v.mesa}`}` : ""}</span>
          </p>
          <p className={`text-sm text-suave ${abierta ? "" : "truncate"}`}>{anulada ? `Eliminada: ${v.motivo_anulacion}` : resumen}</p>
        </div>
        {etq && <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{etq}</span>}
        <span className="shrink-0 font-semibold num">{pesos(v.total)}</span>
        <ChevronDown size={18} className={`shrink-0 text-suave transition-transform ${abierta ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {abierta && (
        <div className="border-t border-dashed border-linea bg-fondo/50 px-4 pb-4 pt-3 text-sm">
          {v.detalles.length > 0 && (
            <table className="w-full">
              <tbody>
                {v.detalles.map((d, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-2 align-top font-semibold num">{numero(d.cantidad)}×</td>
                    <td className="w-full py-1">{d.nombre} <span className="text-suave num">({pesos(d.precio_unitario)} c/u)</span></td>
                    <td className="py-1 text-right num">{pesos(d.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-2 space-y-1 border-t border-linea pt-2">
            {Number(v.descuento) > 0 && <p className="flex justify-between text-suave"><span>Descuento</span><span className="num">−{pesos(v.descuento)}</span></p>}
            <p className="flex justify-between font-semibold"><span>Total</span><span className="num">{pesos(v.total)}</span></p>
            {pagos.map((p, i) => <p key={i} className="flex justify-between text-suave"><span>{MEDIOS[p.medio]}</span><span className="num">{pesos(p.monto)}</span></p>)}
            {abonos.length > 0 && <p className="flex justify-between text-suave"><span>Abonos de fiado</span><span className="num">{pesos(abonos.reduce((s, p) => s + Number(p.monto), 0))}</span></p>}
            {Number(v.cambio) > 0 && <p className="flex justify-between text-suave"><span>Cambio</span><span className="num">{pesos(v.cambio)}</span></p>}
            {Number(v.saldo_pendiente) > 0 && v.estado !== "ABIERTA" && <p className="flex justify-between font-semibold text-alerta"><span>Debe</span><span className="num">{pesos(v.saldo_pendiente)}</span></p>}
          </div>
          <p className="mt-2 text-suave">
            {v.cliente_nombre ? `Cliente: ${v.cliente_nombre} · ` : ""}Registró: {v.usuario}{v.editada_en ? " · editada" : ""}
          </p>
          {v.nota && !saldoAnterior && <p className="mt-1 rounded-lg bg-precio-claro px-3 py-2">{v.nota}</p>}
          {!anulada && (
            <div className="mt-3 flex flex-wrap gap-2">
              {v.estado === "ABIERTA" && <Boton variante="ok" className="py-2 text-sm" onClick={onCobrar}>Cobrar</Boton>}
              {puedeEditar && <Boton variante="borde" className="py-2 text-sm" onClick={onEditar}><Pencil size={15} aria-hidden /> Editar o eliminar</Boton>}
              {!saldoAnterior && (
                <a href={`https://wa.me/?text=${encodeURIComponent(`Recibo #${v.numero} de ${negocio.nombre}: ${window.location.origin}/r/${v.token_publico}`)}`}
                  target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-linea bg-papel px-3 py-2 font-semibold text-tinta hover:bg-fondo">
                  <Share2 size={15} aria-hidden /> Enviar recibo
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

const ORIGENES = {
  VENTA: "Ventas",
  ABONO_FIADO: "Abonos de fiados",
  ABONO_ENCARGO: "Abonos de encargos",
  ANULACION: "Ventas anuladas",
  GASTO: "Gastos",
  COMPRA: "Compras a proveedores",
  PAGO_CREDITO: "Cuotas de créditos",
  APARTADO_CREDITO: "Apartado para créditos",
  DESEMBOLSO_CREDITO: "Desembolsos de crédito",
  ENTRADA_MANUAL: "Entradas manuales",
  SALIDA_MANUAL: "Retiros",
};

const moverFecha = (iso, dias) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
};

const etiquetaFecha = (iso) => {
  if (iso === hoyISO()) return "Hoy";
  if (iso === moverFecha(hoyISO(), -1)) return "Ayer";
  return new Date(`${iso}T12:00:00`).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
};

function CerrarCaja({ resumen, onCerrar }) {
  const qc = useQueryClient();
  const { esAdmin } = useSesion();
  const [contado, setContado] = useState(0);
  const [apartar, setApartar] = useState(0);
  const esperado = Number(resumen.efectivo_esperado) - apartar;
  const diferencia = contado - esperado;
  const cerrar = useMutation({
    mutationFn: () => api("/caja/cerrar/", { method: "POST", body: { efectivo_contado: contado, apartar_credito: apartar } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["caja"] }); onCerrar(); },
  });
  return (
    <Hoja titulo="Cerrar caja" onCerrar={onCerrar}>
      <p className="text-suave">Debería haber en efectivo</p>
      <p className="font-display text-3xl font-extrabold text-tinta num">{pesos(esperado)}</p>
      {esAdmin && (
        <label className="mt-5 block">
          <span className="mb-1.5 block text-sm font-semibold">Apartar para créditos (sale de la caja)</span>
          <InputPesos valor={apartar} onCambio={setApartar} />
        </label>
      )}
      <label className="mt-4 block">
        <span className="mb-1.5 block text-sm font-semibold">¿Cuánto efectivo hay contado?</span>
        <InputPesos valor={contado} onCambio={setContado} />
      </label>
      {contado > 0 && (
        <p className={`mt-3 font-semibold num ${diferencia === 0 ? "text-ok" : "text-alerta"}`}>
          {diferencia === 0 ? "Cuadra exacto." : diferencia > 0 ? `Sobran ${pesos(diferencia)}` : `Faltan ${pesos(-diferencia)}`}
        </p>
      )}
      {cerrar.error && <div className="mt-3"><Aviso>{cerrar.error.message}</Aviso></div>}
      <Boton className="mt-5 w-full" onClick={() => cerrar.mutate()} disabled={cerrar.isPending}>Cerrar caja</Boton>
    </Hoja>
  );
}

export default function Hoy() {
  const { negocio, esAdmin } = useSesion();
  const [fecha, setFecha] = useState(hoyISO());
  const [cerrando, setCerrando] = useState(false);
  const [abierta, setAbierta] = useState(null);
  const [editando, setEditando] = useState(null);
  const [cobrando, setCobrando] = useState(null);
  const qc = useQueryClient();

  const { data: dia, isLoading, error } = useQuery({
    queryKey: ["caja", "dia", fecha],
    queryFn: () => api("/caja/dia/", { query: { fecha } }),
  });
  const { data: ventas = [] } = useQuery({
    queryKey: ["ventas", fecha],
    queryFn: () => api("/ventas/", { query: { desde: fecha, hasta: fecha } }),
  });
  const { data: caja } = useQuery({
    queryKey: ["caja", "actual"],
    queryFn: () => api("/caja/actual/"),
    enabled: Boolean(negocio?.usa_caja),
  });

  const validas = ventas.filter((v) => v.estado !== "ANULADA" && v.origen !== "SALDO_ANTERIOR");
  const vendido = validas.reduce((s, v) => s + Number(v.total), 0);
  const medios = dia ? Object.entries(dia.total_por_medio).filter(([, v]) => Number(v) !== 0) : [];
  const origenes = dia ? Object.entries(dia.detalle_por_origen) : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 lg:px-6 lg:py-8">
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => setFecha(moverFecha(fecha, -1))} className="rounded-full p-2 hover:bg-papel" aria-label="Día anterior">
          <ChevronLeft size={24} />
        </button>
        <h1 className="font-display text-2xl font-bold capitalize text-tinta sm:text-3xl">{etiquetaFecha(fecha)}</h1>
        <button
          onClick={() => setFecha(moverFecha(fecha, 1))}
          disabled={fecha >= hoyISO()}
          className="rounded-full p-2 hover:bg-papel disabled:opacity-30"
          aria-label="Día siguiente"
        >
          <ChevronRight size={24} />
        </button>
      </div>

      {error && <div className="mt-4"><Aviso>{error.message}</Aviso></div>}

      {/* Lo vendido: la cifra que el dueño mira primero */}
      <section className="mt-6 rounded-2xl bg-tinta p-6 text-white">
        <p className="text-white/70">Vendido</p>
        <p className="font-display text-5xl font-extrabold num">{pesos(vendido)}</p>
        <p className="mt-1 text-white/70">{validas.length} {validas.length === 1 ? "venta" : "ventas"}</p>
      </section>

      {negocio?.usa_caja && fecha === hoyISO() && caja?.abierta && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-papel p-4">
          <p>Caja abierta con base de <strong className="num">{pesos(caja.sesion.base_inicial)}</strong></p>
          <Boton variante="borde" className="py-2" onClick={() => setCerrando(true)}>Cerrar caja</Boton>
        </div>
      )}

      <section className="mt-6">
        <h2 className="font-display text-lg font-bold text-tinta">La plata del día</h2>
        <p className="text-sm text-suave">Lo que entró menos lo que salió, por cada medio de pago.</p>
        {isLoading ? (
          <p className="py-6 text-suave">Cargando…</p>
        ) : medios.length === 0 ? (
          <p className="mt-3 rounded-xl bg-papel p-4 text-suave">No hubo movimientos de dinero este día.</p>
        ) : (
          <ul className="mt-3 divide-y divide-linea rounded-xl bg-papel">
            {medios.map(([m, v]) => (
              <li key={m} className="flex items-center justify-between px-4 py-3">
                <span className="font-medium">{MEDIOS[m]}</span>
                <span className={`font-display text-xl font-bold num ${Number(v) < 0 ? "text-alerta" : "text-tinta"}`}>{pesos(v)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between bg-fondo/60 px-4 py-3 text-sm">
              <span className="text-suave">Entró {pesos(dia.entradas)} · salió {pesos(dia.salidas)}</span>
              <span className="font-semibold num">Neto {pesos(dia.neto)}</span>
            </li>
          </ul>
        )}
      </section>

      {esAdmin && origenes.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-lg font-bold text-tinta">De dónde vino y a dónde fue</h2>
          <ul className="mt-3 divide-y divide-linea rounded-xl bg-papel">
            {origenes.map(([o, porMedio]) => {
              const t = Object.values(porMedio).reduce((s, v) => s + Number(v), 0);
              return (
                <li key={o} className="flex items-center justify-between px-4 py-3">
                  <span>{ORIGENES[o] || o}</span>
                  <span className={`font-semibold num ${t < 0 ? "text-alerta" : ""}`}>{pesos(t)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-tinta">Ventas</h2>
          {esAdmin && fecha < hoyISO() && (
            <Link to={`/vender?fecha=${fecha}`} className="inline-flex items-center gap-1.5 rounded-lg bg-tinta px-3 py-2 text-sm font-semibold text-white">
              <Plus size={16} aria-hidden /> Registrar venta de este día
            </Link>
          )}
        </div>
        {ventas.length === 0 ? (
          <p className="mt-3 rounded-xl bg-papel p-4 text-suave">No hay ventas registradas este día.</p>
        ) : (
          <ul className="mt-3 divide-y divide-linea overflow-hidden rounded-xl bg-papel">
            {ventas.map((v) => (
              <FilaVenta key={v.id} v={v} negocio={negocio} esAdmin={esAdmin} abierta={abierta === v.id}
                onAbrir={() => setAbierta(abierta === v.id ? null : v.id)}
                onEditar={() => setEditando(v)} onCobrar={() => setCobrando(v)} />
            ))}
          </ul>
        )}
      </section>

      {editando && <EditorVenta venta={editando} onCerrar={() => setEditando(null)} />}
      {cobrando && (
        <Cobro ventaId={cobrando.id} total={Number(cobrando.total)} detalle={cobrando.detalles} negocio={negocio}
          titulo={`Cobrar #${cobrando.numero}`}
          onParte={() => ["ventas", "caja", "pedidos"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))}
          onListo={() => { setCobrando(null); ["ventas", "caja", "pedidos"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }}
          onCerrar={() => setCobrando(null)} />
      )}
      {cerrando && caja?.resumen && <CerrarCaja resumen={caja.resumen} onCerrar={() => setCerrando(false)} />}
    </div>
  );
}
