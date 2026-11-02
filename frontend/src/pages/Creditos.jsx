import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleAlert, CircleHelp, Landmark, PiggyBank, Plus, TrendingDown } from "lucide-react";
import { api } from "../lib/api";
import { fechaCorta, hoyISO, MEDIOS, numero, pesos, sumarDias } from "../lib/formato";
import GraficaDias from "../components/Grafica";
import { Aviso, Boton, Hoja, InputPesos } from "../components/ui";

const campo = "w-full rounded-lg border border-linea bg-papel px-3 py-2.5 outline-none focus:border-tinta";
const FRECUENCIAS = { DIARIA: "Diaria", SEMANAL: "Semanal", QUINCENAL: "Quincenal", MENSUAL: "Mensual" };
const POR_FREC = { DIARIA: "día", SEMANAL: "semana", QUINCENAL: "quincena", MENSUAL: "mes" };
const ENTIDADES = { BANCO: "Banco", COOPERATIVA: "Cooperativa", FINTECH: "Fintech / app", PROVEEDOR: "Crédito de proveedor", PRESTAMISTA: "Prestamista particular", OTRO: "Otro" };
const DESTINOS = { INVENTARIO: "Mercancía", EQUIPO: "Equipos", CAPITAL_TRABAJO: "Capital de trabajo", LOCAL: "Adecuación del local", DEUDAS: "Pagar otras deudas", OTRO: "Otro" };
const ORIGEN = { CAJA: "De la plata del día", FONDO: "Del fondo apartado", EXTERNO: "De una cuenta o de mi bolsillo" };

/* Semáforo: color + ícono + palabra (nunca solo color) */
const SEMAFORO = {
  VERDE: { txt: "Cubre con holgura", Icono: CheckCircle2, cls: "bg-ok-claro text-ok" },
  AMARILLO: { txt: "Alcanza justo", Icono: AlertTriangle, cls: "bg-precio-claro text-[#7a5200]" },
  ROJO: { txt: "No alcanza", Icono: CircleAlert, cls: "bg-alerta-claro text-alerta" },
  SIN_DATOS: { txt: "Sin ventas aún", Icono: CircleHelp, cls: "bg-fondo text-suave" },
};
function Semaforo({ estado }) {
  const s = SEMAFORO[estado] || SEMAFORO.SIN_DATOS;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${s.cls}`}>
      <s.Icono size={16} aria-hidden /> {s.txt}
    </span>
  );
}

const ALERTA = { ROJO: "bg-alerta-claro text-alerta", AMARILLO: "bg-precio-claro text-texto", VERDE: "bg-ok-claro text-ok" };

/* ---------- Apartar al fondo ---------- */
function Apartar({ creditos, onCerrar }) {
  const qc = useQueryClient();
  const [monto, setMonto] = useState(0);
  const [credito, setCredito] = useState("");
  const [desdeCaja, setDesdeCaja] = useState(true);
  const m = useMutation({
    mutationFn: () => api("/creditos/apartar/", { method: "POST", body: { monto, credito: credito || null, desde_caja: desdeCaja } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["creditos"] }); qc.invalidateQueries({ queryKey: ["caja"] }); onCerrar(); },
  });
  return (
    <Hoja titulo="Apartar para los créditos" onCerrar={onCerrar}>
      <p className="mb-4 text-suave">Guarda una parte de lo que ganaste hoy en el fondo, para tener lista la próxima cuota.</p>
      <InputPesos valor={monto} onCambio={setMonto} aria-label="Monto a apartar" />
      <label className="mt-3 block">
        <span className="mb-1.5 block text-sm font-semibold">Para qué crédito <span className="font-normal text-suave">(opcional)</span></span>
        <select value={credito} onChange={(e) => setCredito(e.target.value)} className={campo}>
          <option value="">Para cualquiera</option>
          {creditos.map((c) => <option key={c.id} value={c.id}>{c.entidad}</option>)}
        </select>
      </label>
      <label className="mt-3 flex items-start gap-3 rounded-lg bg-fondo p-3 text-sm">
        <input type="checkbox" checked={desdeCaja} onChange={(e) => setDesdeCaja(e.target.checked)} className="mt-0.5 h-4 w-4 accent-tinta" />
        <span><strong>Sale de la plata del día.</strong> Se descuenta en el cuadre de hoy.</span>
      </label>
      {m.error && <div className="mt-3"><Aviso>{m.error.message}</Aviso></div>}
      <Boton className="mt-4 w-full" disabled={!monto || m.isPending} onClick={() => m.mutate()}>
        <PiggyBank size={18} aria-hidden /> {m.isPending ? "Guardando…" : `Apartar ${monto ? pesos(monto) : ""}`}
      </Boton>
    </Hoja>
  );
}

/* ---------- Nuevo crédito ---------- */
function NuevoCredito({ onCerrar, onCreado }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    entidad: "", tipo_entidad: "BANCO", destino: "CAPITAL_TRABAJO", descripcion: "", monto: 0, tasa: "", tipo_tasa: "EA",
    sistema: "FRANCES", modalidad: "CONSUMO", frecuencia: "MENSUAL", num_cuotas: 12, fecha_desembolso: hoyISO(),
    fecha_primera_cuota: sumarDias(hoyISO(), 30), desembolso_a_caja: false, medio_desembolso: "TRANSFERENCIA",
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e }));
  const listo = f.monto > 0 && f.tasa !== "" && Number(f.num_cuotas) > 0;
  const datosPreview = { monto: f.monto, tasa: Number(f.tasa), tipo_tasa: f.tipo_tasa, sistema: f.sistema, frecuencia: f.frecuencia, num_cuotas: Number(f.num_cuotas), fecha_primera_cuota: f.fecha_primera_cuota, modalidad: f.modalidad };
  const [debounced, setDebounced] = useState(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(listo ? JSON.stringify(datosPreview) : null), 400); return () => clearTimeout(t); }, [JSON.stringify(datosPreview), listo]); // eslint-disable-line
  const preview = useQuery({
    queryKey: ["creditos", "preview", debounced],
    queryFn: () => api("/creditos/preview/", { method: "POST", body: JSON.parse(debounced) }),
    enabled: Boolean(debounced),
    retry: false,
  });
  const crear = useMutation({
    mutationFn: () => api("/creditos/", { method: "POST", body: { ...f, tasa: Number(f.tasa), num_cuotas: Number(f.num_cuotas) } }),
    onSuccess: (cr) => { qc.invalidateQueries({ queryKey: ["creditos"] }); qc.invalidateQueries({ queryKey: ["caja"] }); onCreado(cr.id); },
  });
  const p = preview.data;

  return (
    <Hoja titulo="Registrar un crédito" onCerrar={onCerrar} ancho="max-w-2xl">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); crear.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm font-semibold">¿Quién te prestó?</span>
            <input required value={f.entidad} onChange={set("entidad")} className={campo} placeholder="Ej. Bancamía, Coopcentral, Don Pedro" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Tipo</span>
            <select value={f.tipo_entidad} onChange={(e) => {
              const v = e.target.value;
              setF((x) => ({ ...x, tipo_entidad: v, ...(v === "PRESTAMISTA" ? { sistema: "PLANO", tipo_tasa: "MENSUAL" } : {}) }));
            }} className={campo}>
              {Object.entries(ENTIDADES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Para qué fue</span>
            <select value={f.destino} onChange={set("destino")} className={campo}>
              {Object.entries(DESTINOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Cuánto te prestaron</span>
            <InputPesos valor={f.monto} onCambio={set("monto")} />
          </label>
          <div>
            <span className="mb-1.5 block text-sm font-semibold">Tasa de interés</span>
            <div className="flex gap-2">
              <span className="flex flex-1 items-center rounded-lg border border-linea bg-papel pr-3 focus-within:border-tinta">
                <input inputMode="decimal" value={f.tasa} onChange={(e) => set("tasa")(e.target.value.replace(",", "."))} className="w-full bg-transparent px-3 py-2.5 text-right outline-none" placeholder="28" aria-label="Tasa" />
                <span className="text-suave">%</span>
              </span>
              <select value={f.tipo_tasa} onChange={set("tipo_tasa")} className="rounded-lg border border-linea bg-papel px-2" aria-label="Tipo de tasa">
                <option value="EA">E.A. (anual)</option>
                <option value="MENSUAL">Mensual</option>
              </select>
            </div>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Pagas cada</span>
            <select value={f.frecuencia} onChange={set("frecuencia")} className={campo}>
              {Object.entries(POR_FREC).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Número de cuotas</span>
            <input inputMode="numeric" value={f.num_cuotas} onChange={(e) => set("num_cuotas")(e.target.value.replace(/\D/g, ""))} className={campo} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Fecha del desembolso</span>
            <input type="date" value={f.fecha_desembolso} onChange={set("fecha_desembolso")} className={campo} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Primera cuota</span>
            <input type="date" value={f.fecha_primera_cuota} min={f.fecha_desembolso} onChange={set("fecha_primera_cuota")} className={campo} />
          </label>
        </div>

        <fieldset className="rounded-xl bg-fondo p-4">
          <legend className="sr-only">Cómo se cobra el interés</legend>
          <p className="mb-2 text-sm font-semibold">¿Cómo te cobran el interés?</p>
          {[["FRANCES", "Cuota fija sobre lo que debes", "Bancos y cooperativas: el interés baja a medida que pagas."],
            ["PLANO", "Interés plano sobre todo el préstamo", "Prestamistas y gota a gota: cobran el mismo interés todo el plazo aunque ya debas menos."]].map(([v, t, d]) => (
            <label key={v} className="mt-1 flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-papel">
              <input type="radio" name="sistema" checked={f.sistema === v} onChange={() => set("sistema")(v)} className="mt-1 accent-tinta" />
              <span><span className="block font-medium">{t}</span><span className="block text-sm text-suave">{d}</span></span>
            </label>
          ))}
        </fieldset>

        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={f.desembolso_a_caja} onChange={set("desembolso_a_caja")} className="mt-0.5 h-4 w-4 accent-tinta" />
          <span>El dinero entró hoy a la plata del negocio (no a una cuenta del banco). Igual no cuenta como venta ni como ganancia.</span>
        </label>

        {/* Lo que va a costar, en vivo */}
        {listo && (
          <section className="rounded-xl border-2 border-tinta p-4" aria-live="polite">
            {preview.isFetching && !p && <p className="text-suave">Calculando…</p>}
            {preview.error && <Aviso>{preview.error.message}</Aviso>}
            {p && (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-sm text-suave">Cuota</p>
                    <p className="font-display text-2xl font-extrabold text-tinta num">{pesos(p.cuota)}</p>
                    <p className="text-xs text-suave">cada {POR_FREC[f.frecuencia]}</p>
                  </div>
                  <div>
                    <p className="text-sm text-suave">Pagas de intereses</p>
                    <p className="font-display text-2xl font-extrabold text-tinta num">{pesos(p.total_intereses)}</p>
                    <p className="text-xs text-suave">en total {pesos(p.total_a_pagar)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-suave">Hay que apartar</p>
                    <p className="font-display text-2xl font-extrabold text-tinta num">{pesos(p.cuota_diaria_equivalente)}</p>
                    <p className="text-xs text-suave">cada día</p>
                  </div>
                </div>
                <p className="mt-3 text-sm">
                  Costo real: <strong className="num">{numero(p.tasa_ea_real)}% efectivo anual</strong>
                  {f.sistema === "PLANO" && " (en interés plano siempre es mucho más alto que la tasa que te dicen)"}.
                </p>
                {p.supera_usura && (
                  <p className="mt-2 flex gap-2 rounded-lg bg-alerta-claro p-3 text-sm text-alerta">
                    <CircleAlert size={18} className="shrink-0" aria-hidden />
                    Supera la tasa de usura ({numero(p.tasa_usura_ea)}% E.A.). Cobrar por encima de la usura es ilegal en Colombia: revisa este crédito antes de aceptarlo.
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {crear.error && <Aviso>{crear.error.message}</Aviso>}
        <Boton className="w-full" disabled={!listo || !f.entidad.trim() || crear.isPending}>
          {crear.isPending ? "Registrando…" : "Registrar crédito"}
        </Boton>
      </form>
    </Hoja>
  );
}

/* ---------- Detalle ---------- */
function Pagar({ cr, onListo }) {
  const qc = useQueryClient();
  const prox = cr.resumen.proxima_cuota;
  const [tipo, setTipo] = useState("cuota");
  const [monto, setMonto] = useState(Number(prox?.valor || 0));
  const [origen, setOrigen] = useState("CAJA");
  const [medio, setMedio] = useState("EFECTIVO");
  const [estrategia, setEstrategia] = useState("REDUCIR_PLAZO");
  const [efecto, setEfecto] = useState(null);
  const m = useMutation({
    mutationFn: () => tipo === "cuota"
      ? api(`/creditos/${cr.id}/pagar/`, { method: "POST", body: { monto, origen_fondos: origen, medio } })
      : api(`/creditos/${cr.id}/abonar-capital/`, { method: "POST", body: { monto, origen_fondos: origen, medio, estrategia } }),
    onSuccess: (r) => {
      setEfecto(r.efecto || null);
      setMonto(0);
      qc.invalidateQueries({ queryKey: ["creditos"] });
      qc.invalidateQueries({ queryKey: ["caja"] });
      qc.invalidateQueries({ queryKey: ["reportes"] });
      onListo?.();
    },
  });
  const plano = cr.sistema === "PLANO";
  return (
    <section className="rounded-xl bg-fondo p-4">
      <div className="grid grid-cols-2 rounded-lg bg-papel p-1 text-sm font-semibold" role="tablist">
        {[["cuota", "Pagar cuota"], ["abono", "Abono extra a capital"]].map(([v, t]) => (
          <button key={v} type="button" role="tab" aria-selected={tipo === v} disabled={v === "abono" && plano}
            onClick={() => { setTipo(v); setEfecto(null); setMonto(v === "cuota" ? Number(prox?.valor || 0) : 0); }}
            className={`rounded-md py-2 disabled:opacity-40 ${tipo === v ? "bg-tinta text-white" : "text-suave"}`}>{t}</button>
        ))}
      </div>
      {plano && <p className="mt-2 text-xs text-suave">En interés plano el interés no baja con abonos extra: adelanta cuotas y negocia el descuento con el prestamista.</p>}
      <div className="mt-3 space-y-3">
        <InputPesos valor={monto} onCambio={setMonto} aria-label="Monto" />
        {tipo === "cuota" && prox && (
          <button type="button" onClick={() => setMonto(Number(prox.valor))} className="rounded-full border border-linea bg-papel px-3 py-1.5 text-sm font-semibold">
            Cuota {prox.numero}: {pesos(prox.valor)}
          </button>
        )}
        {tipo === "abono" && (
          <div className="grid gap-2 sm:grid-cols-2">
            {[["REDUCIR_PLAZO", "Terminar antes", "Misma cuota, menos cuotas. Ahorra más intereses."], ["REDUCIR_CUOTA", "Pagar menos cada vez", "Mismo plazo, cuota más baja. Más aire en la caja."]].map(([v, t, d]) => (
              <label key={v} className={`cursor-pointer rounded-lg border-2 bg-papel p-3 ${estrategia === v ? "border-tinta" : "border-linea"}`}>
                <input type="radio" className="sr-only" checked={estrategia === v} onChange={() => setEstrategia(v)} />
                <span className="block font-semibold">{t}</span>
                <span className="block text-sm text-suave">{d}</span>
              </label>
            ))}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={origen} onChange={(e) => setOrigen(e.target.value)} className={campo} aria-label="De dónde sale la plata">
            {Object.entries(ORIGEN).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          <select value={medio} onChange={(e) => setMedio(e.target.value)} className={campo} aria-label="Medio de pago">
            {Object.entries(MEDIOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </div>
        {m.error && <Aviso>{m.error.message}</Aviso>}
        {m.isSuccess && !efecto && <Aviso tipo="ok">Pago registrado.</Aviso>}
        {efecto && (
          <Aviso tipo="ok">
            Abono registrado: {efecto.cuotas_menos > 0 ? `${efecto.cuotas_menos} cuota(s) menos` : `cuota nueva de ${pesos(efecto.despues.cuota)}`} y te ahorras {pesos(efecto.intereses_ahorrados)} en intereses.
          </Aviso>
        )}
        <Boton variante="ok" className="w-full" disabled={!monto || m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? "Registrando…" : tipo === "cuota" ? `Registrar pago de ${pesos(monto)}` : `Abonar ${pesos(monto)} a capital`}
        </Boton>
      </div>
    </section>
  );
}

function Plan({ cr }) {
  const [pct, setPct] = useState(50);
  const { data: plan, error, isLoading } = useQuery({
    queryKey: ["creditos", "plan", cr.id, pct],
    queryFn: () => api(`/creditos/${cr.id}/plan/`, { query: { porcentaje: pct } }),
  });
  if (cr.sistema === "PLANO") return null;
  return (
    <section className="rounded-xl border border-linea p-4">
      <h3 className="flex items-center gap-2 font-display text-lg font-bold text-tinta"><TrendingDown size={20} aria-hidden /> Plan para pagarlo mejor</h3>
      {isLoading && <p className="mt-2 text-suave">Calculando con tus ventas…</p>}
      {error && <div className="mt-2"><Aviso>{error.message}</Aviso></div>}
      {plan && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Semaforo estado={plan.semaforo} />
            {plan.cobertura != null && <span className="text-sm text-suave">Tu ganancia diaria cubre {numero(plan.cobertura)} veces las cuotas</span>}
          </div>
          <p className="mt-3 leading-relaxed">{plan.mensaje}</p>
          {plan.excedente_diario > 0 && (
            <>
              <p className="mt-4 text-sm font-semibold">¿Qué parte de lo que te sobra cada día quieres usar para abonar?</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {plan.escenarios.map((e) => (
                  <button key={e.porcentaje_excedente} type="button" onClick={() => setPct(e.porcentaje_excedente)} aria-pressed={pct === e.porcentaje_excedente}
                    className={`rounded-lg border-2 p-3 text-left ${pct === e.porcentaje_excedente ? "border-tinta bg-papel" : "border-linea"}`}>
                    <span className="block font-display text-lg font-bold text-tinta">{e.porcentaje_excedente}%</span>
                    <span className="block text-sm">+{pesos(e.extra_por_cuota)} por cuota</span>
                    <span className="block text-sm text-suave">{e.cuotas_menos} cuotas menos · ahorras {pesos(e.intereses_ahorrados)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function Detalle({ id, onCerrar }) {
  const qc = useQueryClient();
  const { data: cr, error, isLoading } = useQuery({ queryKey: ["creditos", "detalle", id], queryFn: () => api(`/creditos/${id}/`) });
  const [verTodas, setVerTodas] = useState(false);
  const cancelar = useMutation({
    mutationFn: () => api(`/creditos/${id}/cancelar/`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["creditos"] }); onCerrar(); },
  });
  const r = cr?.resumen;
  const cuotas = cr ? (verTodas ? cr.cuotas : cr.cuotas.filter((c) => c.estado !== "PAGADA").slice(0, 6)) : [];

  return (
    <Hoja titulo={cr ? cr.entidad : "Crédito"} onCerrar={onCerrar} ancho="max-w-2xl">
      {isLoading && <p className="text-suave">Cargando…</p>}
      {error && <Aviso>{error.message}</Aviso>}
      {cr && (
        <div className="space-y-5">
          <section className="rounded-xl bg-tinta p-5 text-white">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-white/70">Debes de capital</p>
                <p className="font-display text-4xl font-extrabold num">{pesos(r.saldo_capital)}</p>
              </div>
              <p className="text-right text-sm text-white/70">
                de {pesos(cr.monto)} · cuota {pesos(cr.cuota_valor)} {FRECUENCIAS[cr.frecuencia].toLowerCase()}<br />
                costo real {numero(cr.tasa_ea_real)}% E.A.
              </p>
            </div>
            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-valuenow={r.progreso_pct} aria-valuemin={0} aria-valuemax={100} aria-label="Avance del pago">
              <div className="h-full rounded-full bg-precio" style={{ width: `${r.progreso_pct}%` }} />
            </div>
            <p className="mt-2 text-sm text-white/80">
              {numero(r.progreso_pct)}% pagado · {r.cuotas_pagadas} de {r.cuotas_pagadas + r.cuotas_restantes} cuotas
              {r.fecha_fin ? ` · terminas el ${fechaCorta(r.fecha_fin, { anio: true })}` : ""}
            </p>
          </section>

          {r.cuotas_vencidas > 0 && (
            <Aviso>Tienes {r.cuotas_vencidas} cuota(s) vencida(s) por {pesos(r.valor_vencido)}. Ponte al día antes de abonar extra.</Aviso>
          )}
          {r.usura.supera_usura && (
            <Aviso>El costo real ({numero(cr.tasa_ea_real)}% E.A.) supera la tasa de usura ({numero(r.usura.tasa_usura_ea)}% E.A.).</Aviso>
          )}

          {cr.estado === "ACTIVO" && <Pagar cr={cr} />}
          {cr.estado === "ACTIVO" && <Plan cr={cr} />}
          {cr.estado === "PAGADO" && <Aviso tipo="ok">¡Este crédito ya está pagado!</Aviso>}

          <section>
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-lg font-bold text-tinta">{verTodas ? "Todas las cuotas" : "Próximas cuotas"}</h3>
              <button onClick={() => setVerTodas(!verTodas)} className="text-sm font-semibold text-tinta underline">{verTodas ? "Ver solo pendientes" : "Ver todas"}</button>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="text-left text-suave">
                    <th className="py-2 font-medium">#</th><th className="py-2 font-medium">Vence</th>
                    <th className="py-2 text-right font-medium">Interés</th><th className="py-2 text-right font-medium">Capital</th>
                    <th className="py-2 text-right font-medium">Cuota</th><th className="py-2 text-right font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {cuotas.map((c) => {
                    const vencida = c.estado !== "PAGADA" && c.fecha_vencimiento < hoyISO();
                    return (
                      <tr key={c.numero} className={`border-t border-linea ${c.estado === "PAGADA" ? "text-suave" : ""}`}>
                        <td className="py-2 num">{c.numero}</td>
                        <td className="py-2">{fechaCorta(c.fecha_vencimiento, { anio: true })}</td>
                        <td className="py-2 text-right num">{pesos(c.interes)}</td>
                        <td className="py-2 text-right num">{pesos(c.capital)}</td>
                        <td className="py-2 text-right font-semibold num">{pesos(c.valor)}</td>
                        <td className={`py-2 text-right ${vencida ? "font-semibold text-alerta" : ""}`}>
                          {c.estado === "PAGADA" ? "Pagada" : vencida ? "Vencida" : c.estado === "PARCIAL" ? `Falta ${pesos(c.pendiente)}` : "Pendiente"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {cr.pagos.length > 0 && (
            <section>
              <h3 className="font-display text-lg font-bold text-tinta">Pagos hechos</h3>
              <ul className="mt-2 divide-y divide-linea rounded-xl border border-linea text-sm">
                {cr.pagos.map((p) => (
                  <li key={p.id} className="flex justify-between gap-3 px-4 py-2.5">
                    <span>{fechaCorta(p.fecha)} · {p.tipo === "CUOTA" ? "Cuota" : "Abono a capital"} <span className="text-suave">({ORIGEN[p.origen_fondos].toLowerCase()})</span></span>
                    <span className="font-semibold num">{pesos(p.monto)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {cr.pagos.length === 0 && cr.estado === "ACTIVO" && (
            <button onClick={() => cancelar.mutate()} className="text-sm font-semibold text-alerta hover:underline">
              Lo registré por error: quitar este crédito
            </button>
          )}
          {cancelar.error && <Aviso>{cancelar.error.message}</Aviso>}
        </div>
      )}
    </Hoja>
  );
}

/* ---------- Varios créditos: avalancha vs bola de nieve ---------- */
function Estrategia() {
  const [extra, setExtra] = useState(200000);
  const [valor, setValor] = useState(200000);
  useEffect(() => { const t = setTimeout(() => setValor(extra), 400); return () => clearTimeout(t); }, [extra]);
  const { data: e, error } = useQuery({
    queryKey: ["creditos", "estrategia", valor],
    queryFn: () => api("/creditos/estrategia/", { query: { extra_mensual: valor } }),
    enabled: valor > 0,
  });
  return (
    <section className="rounded-2xl bg-papel p-5">
      <h2 className="font-display text-lg font-bold text-tinta">¿Cuál crédito pagar primero?</h2>
      <p className="mt-1 text-sm text-suave">Si cada mes pones un extra, así terminas de pagarlos todos:</p>
      <label className="mt-3 flex flex-wrap items-center gap-3 text-sm font-semibold">
        Extra al mes <InputPesos className="w-44" valor={extra} onCambio={setExtra} aria-label="Extra mensual" />
      </label>
      {error && <div className="mt-3"><Aviso>{error.message}</Aviso></div>}
      {e && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {[["avalancha", "AVALANCHA", "Primero el más caro"], ["bola_de_nieve", "BOLA_NIEVE", "Primero el más pequeño"]].map(([k, clave, t]) => {
            const x = e[k], mejor = e.recomendada === clave;
            return (
              <div key={k} className={`rounded-xl border-2 p-4 ${mejor ? "border-tinta" : "border-linea"}`}>
                <p className="flex items-center justify-between gap-2 font-semibold">
                  {t} {mejor && <span className="rounded-full bg-tinta px-2.5 py-0.5 text-xs text-white">Recomendado</span>}
                </p>
                <p className="mt-1 text-sm text-suave">{x.descripcion}</p>
                <p className="mt-3 text-sm">Terminas en <strong>{x.meses_total} meses</strong> pagando <strong className="num">{pesos(x.interes_total)}</strong> de intereses.</p>
                <ol className="mt-2 list-decimal pl-5 text-sm text-suave">
                  {x.orden_pago.map((n) => <li key={n}>{n.replace(/ #\d+$/, "")}</li>)}
                </ol>
              </div>
            );
          })}
        </div>
      )}
      {e && e.ahorro_vs_sin_extra > 0 && (
        <p className="mt-3 text-sm">Frente a pagar solo las cuotas, te ahorras <strong className="num">{pesos(e.ahorro_vs_sin_extra)}</strong> en intereses.</p>
      )}
    </section>
  );
}

/* ---------- Página ---------- */
export default function Creditos() {
  const [nuevo, setNuevo] = useState(false);
  const [abierto, setAbierto] = useState(null);
  const [apartar, setApartar] = useState(false);
  const tablero = useQuery({ queryKey: ["creditos", "tablero"], queryFn: () => api("/creditos/tablero/") });
  const lista = useQuery({ queryKey: ["creditos", "lista"], queryFn: () => api("/creditos/") });
  const t = tablero.data;
  const activos = (lista.data || []).filter((c) => c.estado === "ACTIVO");
  const otros = (lista.data || []).filter((c) => c.estado === "PAGADO");
  const error = tablero.error || lista.error;

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold text-tinta">Créditos</h1>
        <div className="flex gap-2">
          {activos.length > 0 && <Boton variante="borde" onClick={() => setApartar(true)}><PiggyBank size={18} aria-hidden /> Apartar</Boton>}
          <Boton onClick={() => setNuevo(true)}><Plus size={18} aria-hidden /> Registrar crédito</Boton>
        </div>
      </div>
      {error && <div className="mt-4"><Aviso>{error.message}</Aviso></div>}
      {(tablero.isLoading || lista.isLoading) && <p className="py-10 text-suave">Cargando…</p>}

      {t && t.creditos_activos === 0 && !lista.isLoading && (
        <div className="mt-8 rounded-2xl bg-papel p-8 text-center">
          <Landmark size={36} className="mx-auto text-suave" aria-hidden />
          <p className="mt-3 font-display text-xl font-bold text-tinta">No tienes créditos activos</p>
          <p className="mx-auto mt-1 max-w-md text-suave">
            Si sacaste un préstamo para el negocio, regístralo: te decimos cuánto apartar cada día y cómo terminarlo antes pagando menos intereses.
          </p>
        </div>
      )}

      {t && t.creditos_activos > 0 && (
        <>
          {/* Meta de hoy: lo primero que el dueño necesita saber */}
          <section className="mt-6 grid gap-3 md:grid-cols-[1.3fr_1fr]">
            <div className="rounded-2xl bg-tinta p-6 text-white">
              <p className="text-white/70">Aparta hoy para tus créditos</p>
              <p className="font-display text-5xl font-extrabold num">{pesos(t.meta_dia.apartar_hoy)}</p>
              <p className="mt-2 text-sm text-white/80">
                {t.meta_dia.falta_hoy > 0
                  ? `Llevas ${pesos(t.meta_dia.apartado_hoy)} apartado hoy · faltan ${pesos(t.meta_dia.falta_hoy)}`
                  : "Ya apartaste lo de hoy."}
              </p>
              <div className="mt-4 rounded-xl bg-white/10 p-3">
                <p className="text-sm text-white/80">Hoy llevas de ganancia <strong className="text-white num">{pesos(t.meta_dia.utilidad_operativa_hoy)}</strong></p>
                <div className="mt-2"><Semaforo estado={t.meta_dia.semaforo_hoy} /></div>
              </div>
            </div>
            <div className="grid gap-3">
              <div className="rounded-2xl bg-papel p-5">
                <p className="text-suave">Fondo apartado</p>
                <p className="font-display text-3xl font-extrabold text-tinta num">{pesos(t.fondo_apartado)}</p>
                {t.proxima_cuota && (
                  <p className={`mt-1 text-sm ${t.fondo_cubre_proxima ? "text-ok" : "text-suave"}`}>
                    {t.fondo_cubre_proxima ? "Alcanza para" : "Próxima:"} cuota de {t.proxima_cuota.credito} por {pesos(t.proxima_cuota.valor)}, {t.proxima_cuota.dias === 0 ? "vence hoy" : t.proxima_cuota.dias < 0 ? "vencida" : `en ${t.proxima_cuota.dias} días`}
                  </p>
                )}
              </div>
              <div className="rounded-2xl bg-papel p-5">
                <p className="text-suave">Debes en total</p>
                <p className="font-display text-3xl font-extrabold text-tinta num">{pesos(t.deuda_total_cuotas)}</p>
                <p className="mt-1 text-sm text-suave">{pesos(t.deuda_total_capital)} de capital + intereses por pagar</p>
              </div>
            </div>
          </section>

          {t.alertas.length > 0 && (
            <ul className="mt-4 space-y-2">
              {t.alertas.map((a, i) => (
                <li key={i} className={`flex gap-2 rounded-xl px-4 py-3 text-sm font-medium ${ALERTA[a.nivel]}`}>
                  {a.nivel === "VERDE" ? <CheckCircle2 size={18} className="shrink-0" aria-hidden /> : <AlertTriangle size={18} className="shrink-0" aria-hidden />}
                  {a.mensaje}
                </li>
              ))}
            </ul>
          )}

          <section className="mt-6 rounded-2xl bg-papel p-5">
            <h2 className="font-display text-lg font-bold text-tinta">Últimos 7 días: ¿la ganancia cubrió la cuota?</h2>
            <p className="mb-4 text-sm text-suave">Cada barra es la ganancia del día. Por encima de la línea punteada, ese día alcanzó para la cuota.</p>
            <GraficaDias
              datos={t.ultimos_7_dias}
              barra={{ clave: "utilidad_operativa", nombre: "Ganancia del día" }}
              referencia={{ valor: t.meta_dia.apartar_hoy, nombre: "Cuota diaria" }}
              alto={220}
              resumenAccesible="Ganancia de los últimos 7 días frente a la cuota diaria de los créditos"
            />
            <p className="mt-3 text-sm">
              Últimos 30 días: ganas en promedio <strong className="num">{pesos(t.promedio_30_dias.utilidad_operativa_dia)}</strong> al día{" "}
              <span className="ml-1 inline-block align-middle"><Semaforo estado={t.promedio_30_dias.semaforo} /></span>
            </p>
          </section>
        </>
      )}

      {activos.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-lg font-bold text-tinta">Tus créditos</h2>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {activos.map((c) => {
              const res = t?.creditos.find((x) => x.id === c.id);
              return (
                <li key={c.id}>
                  <button onClick={() => setAbierto(c.id)} className="w-full rounded-2xl bg-papel p-5 text-left hover:ring-2 hover:ring-tinta/30">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-lg font-bold text-tinta">{c.entidad}</p>
                        <p className="text-sm text-suave">{ENTIDADES[c.tipo_entidad]} · {DESTINOS[c.destino]}</p>
                      </div>
                      <p className="text-right">
                        <span className="block font-display text-xl font-extrabold num">{pesos(res?.saldo_capital ?? c.monto)}</span>
                        <span className="text-xs text-suave">de {pesos(c.monto)}</span>
                      </p>
                    </div>
                    {res && (
                      <>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-fondo" aria-hidden>
                          <div className="h-full rounded-full bg-tinta" style={{ width: `${res.progreso_pct}%` }} />
                        </div>
                        <p className="mt-2 text-sm text-suave">
                          {res.cuotas_vencidas > 0
                            ? <span className="font-semibold text-alerta">{res.cuotas_vencidas} cuota(s) vencida(s)</span>
                            : res.proxima_cuota && `Próxima cuota ${pesos(res.proxima_cuota.valor)} el ${fechaCorta(res.proxima_cuota.fecha)}`}
                          {" · "}{res.cuotas_restantes} restantes
                        </p>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {activos.length > 1 && <div className="mt-6"><Estrategia /></div>}

      {otros.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-lg font-bold text-tinta">Ya pagados</h2>
          <ul className="mt-2 divide-y divide-linea rounded-xl bg-papel">
            {otros.map((c) => (
              <li key={c.id}>
                <button onClick={() => setAbierto(c.id)} className="flex w-full justify-between px-4 py-3 text-left text-sm">
                  <span className="font-medium">{c.entidad}</span><span className="text-suave num">{pesos(c.monto)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {nuevo && <NuevoCredito onCerrar={() => setNuevo(false)} onCreado={(id) => { setNuevo(false); setAbierto(id); }} />}
      {abierto && <Detalle id={abierto} onCerrar={() => setAbierto(null)} />}
      {apartar && <Apartar creditos={activos} onCerrar={() => setApartar(false)} />}
    </div>
  );
}
