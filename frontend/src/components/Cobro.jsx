import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, HandCoins, Search, UserPlus } from "lucide-react";
import { api } from "../lib/api";
import { MEDIOS, pesos } from "../lib/formato";
import { Aviso, Boton, Hoja, InputPesos } from "./ui";

/** Billetes para "pagó con…": el siguiente redondo por encima del total y los billetes comunes. */
function sugerenciasBillete(total) {
  const billetes = [2000, 5000, 10000, 20000, 50000, 100000];
  const opciones = new Set([total]);
  for (const b of billetes) {
    const redondo = Math.ceil(total / b) * b;
    if (redondo > total) opciones.add(redondo);
  }
  return [...opciones].sort((a, b) => a - b).slice(0, 5);
}

function SelectorCliente({ cliente, onElegir }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [nuevo, setNuevo] = useState(null);
  const { data: clientes = [] } = useQuery({
    queryKey: ["clientes", q],
    queryFn: () => api("/clientes/", { query: { q } }),
  });
  const crear = useMutation({
    mutationFn: (c) => api("/clientes/", { method: "POST", body: c }),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ["clientes"] }); onElegir(c); setNuevo(null); },
  });

  if (cliente) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-tinta bg-precio-claro px-4 py-3">
        <div>
          <p className="font-semibold">{cliente.nombre}</p>
          <p className="text-sm text-suave">
            {Number(cliente.saldo_pendiente) > 0 ? `Ya debe ${pesos(cliente.saldo_pendiente)}` : "Sin deudas"}
          </p>
        </div>
        <button onClick={() => onElegir(null)} className="text-sm font-semibold text-tinta underline">Cambiar</button>
      </div>
    );
  }

  if (nuevo) {
    return (
      <form
        className="space-y-2 rounded-lg border border-linea p-3"
        onSubmit={(e) => { e.preventDefault(); crear.mutate(nuevo); }}
      >
        <input
          autoFocus
          required
          placeholder="Nombre"
          value={nuevo.nombre}
          onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
          className="w-full rounded-lg border border-linea px-3 py-2.5 outline-none focus:border-tinta"
        />
        <input
          placeholder="Celular (para recordarle por WhatsApp)"
          inputMode="tel"
          value={nuevo.telefono}
          onChange={(e) => setNuevo({ ...nuevo, telefono: e.target.value })}
          className="w-full rounded-lg border border-linea px-3 py-2.5 outline-none focus:border-tinta"
        />
        {crear.error && <Aviso>{crear.error.message}</Aviso>}
        <div className="flex gap-2">
          <Boton type="button" variante="suave" className="flex-1" onClick={() => setNuevo(null)}>Cancelar</Boton>
          <Boton className="flex-1" disabled={crear.isPending}>Guardar cliente</Boton>
        </div>
      </form>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg border border-linea px-3 focus-within:border-tinta">
        <Search size={18} className="text-suave" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar cliente por nombre o celular"
          className="w-full bg-transparent py-2.5 outline-none"
        />
      </div>
      <ul className="mt-2 max-h-44 divide-y divide-linea overflow-y-auto">
        {clientes.filter((c) => c.activo).slice(0, 8).map((c) => (
          <li key={c.id}>
            <button onClick={() => onElegir(c)} className="flex w-full items-center justify-between px-1 py-2.5 text-left hover:bg-fondo">
              <span className="font-medium">{c.nombre}</span>
              {Number(c.saldo_pendiente) > 0 && <span className="text-sm text-alerta num">debe {pesos(c.saldo_pendiente)}</span>}
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={() => setNuevo({ nombre: q, telefono: "" })}
        className="mt-2 flex items-center gap-2 text-sm font-semibold text-tinta"
      >
        <UserPlus size={17} aria-hidden /> Nuevo cliente{q ? `: ${q}` : ""}
      </button>
    </div>
  );
}

export default function Cobro({ total, items, descuento, negocio, onListo, onCerrar }) {
  const medios = negocio.medios_pago_activos;
  const [modo, setModo] = useState("pago"); // pago | fiar
  const [medio, setMedio] = useState(medios.includes("EFECTIVO") ? "EFECTIVO" : medios[0]);
  const [recibido, setRecibido] = useState(0);
  const [dividir, setDividir] = useState(false);
  const [montos, setMontos] = useState({});
  const [cliente, setCliente] = useState(null);
  const [abono, setAbono] = useState(0);

  const pagos = useMemo(() => {
    if (modo === "fiar") return abono > 0 ? [{ medio, monto: abono }] : [];
    if (dividir) return Object.entries(montos).filter(([, m]) => m > 0).map(([medio, monto]) => ({ medio, monto }));
    return [{ medio, monto: total }];
  }, [modo, abono, medio, dividir, montos, total]);

  const pagado = pagos.reduce((s, p) => s + p.monto, 0);
  const efectivo = pagos.filter((p) => p.medio === "EFECTIVO").reduce((s, p) => s + p.monto, 0);
  const cambio = recibido > efectivo ? recibido - efectivo : 0;
  const falta = total - pagado;

  const problema =
    modo === "fiar"
      ? !cliente ? "Elige a quién le fías." : abono > total ? "El abono no puede ser mayor al total." : null
      : dividir && falta !== 0 ? (falta > 0 ? `Faltan ${pesos(falta)} por repartir.` : `Te pasaste ${pesos(-falta)}.`) : null;
  const recibidoCorto = efectivo > 0 && recibido > 0 && recibido < efectivo;

  const vender = useMutation({
    mutationFn: () =>
      api("/ventas/", {
        method: "POST",
        body: {
          items,
          pagos,
          descuento,
          cliente: modo === "fiar" ? cliente.id : null,
          efectivo_recibido: efectivo > 0 && recibido > 0 ? recibido : null,
        },
      }),
    onSuccess: onListo,
  });

  return (
    <Hoja titulo={`Cobrar ${pesos(total)}`} onCerrar={onCerrar}>
      {negocio.permitir_fiado && (
        <div className="mb-5 grid grid-cols-2 rounded-lg bg-fondo p-1 text-sm font-semibold" role="tablist">
          {[["pago", "Paga ahora"], ["fiar", "Fiar"]].map(([v, t]) => (
            <button
              key={v}
              role="tab"
              aria-selected={modo === v}
              onClick={() => setModo(v)}
              className={`rounded-md py-2.5 ${modo === v ? "bg-papel text-tinta shadow-sm" : "text-suave"}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {modo === "pago" && (
        <>
          {!dividir ? (
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">¿Cómo paga?</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {medios.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMedio(m)}
                    aria-pressed={medio === m}
                    className={`rounded-lg border-2 py-3 font-semibold ${
                      medio === m ? "border-tinta bg-tinta text-white" : "border-linea text-tinta hover:border-tinta/40"
                    }`}
                  >
                    {MEDIOS[m]}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-semibold">Reparte el pago</legend>
              {medios.map((m) => (
                <label key={m} className="flex items-center gap-3">
                  <span className="w-28 text-sm font-medium">{MEDIOS[m]}</span>
                  <InputPesos
                    className="flex-1"
                    valor={montos[m] || 0}
                    onCambio={(v) => setMontos({ ...montos, [m]: v })}
                    aria-label={`Monto en ${MEDIOS[m]}`}
                  />
                </label>
              ))}
              <p className={`text-right text-sm font-semibold num ${falta === 0 ? "text-ok" : "text-alerta"}`}>
                {falta === 0 ? "Completo" : falta > 0 ? `Faltan ${pesos(falta)}` : `Sobran ${pesos(-falta)}`}
              </p>
            </fieldset>
          )}
          <button
            onClick={() => { setDividir(!dividir); setMontos({}); }}
            className="mt-3 text-sm font-semibold text-tinta underline"
          >
            {dividir ? "Pagar con un solo medio" : "Paga con dos medios (ej. efectivo + Nequi)"}
          </button>
        </>
      )}

      {modo === "fiar" && (
        <div className="space-y-4">
          <SelectorCliente cliente={cliente} onElegir={setCliente} />
          <div>
            <p className="mb-2 text-sm font-semibold">¿Deja algo abonado? <span className="font-normal text-suave">(opcional)</span></p>
            <div className="flex gap-2">
              <InputPesos className="flex-1" valor={abono} onCambio={setAbono} aria-label="Abono inicial" />
              <select
                value={medio}
                onChange={(e) => setMedio(e.target.value)}
                className="rounded-lg border border-linea bg-papel px-3"
                aria-label="Medio del abono"
              >
                {medios.map((m) => <option key={m} value={m}>{MEDIOS[m]}</option>)}
              </select>
            </div>
            <p className="mt-2 text-sm text-suave num">Queda debiendo {pesos(Math.max(total - abono, 0))}</p>
          </div>
        </div>
      )}

      {efectivo > 0 && (
        <div className="mt-5 rounded-xl bg-fondo p-4">
          <p className="mb-2 text-sm font-semibold">¿Con cuánto paga en efectivo?</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {sugerenciasBillete(efectivo).map((b) => (
              <button
                key={b}
                onClick={() => setRecibido(b)}
                className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold num ${
                  recibido === b ? "border-tinta bg-tinta text-white" : "border-linea bg-papel"
                }`}
              >
                {b === efectivo ? "Exacto" : pesos(b)}
              </button>
            ))}
          </div>
          <InputPesos valor={recibido} onCambio={setRecibido} aria-label="Efectivo recibido" />
          {recibido > 0 && (
            <p className="mt-3 flex items-baseline justify-between">
              <span className="font-semibold">Devuelve</span>
              <span className={`font-display text-3xl font-extrabold num ${recibidoCorto ? "text-alerta" : "text-ok"}`}>
                {recibidoCorto ? `Faltan ${pesos(efectivo - recibido)}` : pesos(cambio)}
              </span>
            </p>
          )}
        </div>
      )}

      <div className="mt-5 space-y-3">
        {problema && <Aviso tipo="info">{problema}</Aviso>}
        {vender.error && <Aviso>{vender.error.message}</Aviso>}
        <Boton
          variante={modo === "fiar" ? "primario" : "ok"}
          className="w-full py-4 text-lg"
          disabled={Boolean(problema) || recibidoCorto || vender.isPending}
          onClick={() => vender.mutate()}
          data-autofocus
        >
          {modo === "fiar" ? <HandCoins size={22} aria-hidden /> : <Check size={22} aria-hidden />}
          {vender.isPending ? "Registrando…" : modo === "fiar" ? "Registrar fiado" : "Registrar venta"}
        </Boton>
      </div>
    </Hoja>
  );
}
