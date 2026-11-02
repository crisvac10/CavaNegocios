import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Plus, Search, UserRound } from "lucide-react";
import { api } from "../lib/api";
import { MEDIOS, numero, pesos } from "../lib/formato";
import { useSesion } from "../context/Sesion";
import { Aviso, Boton, Hoja, InputPesos } from "../components/ui";

const campo = "w-full rounded-lg border border-linea bg-papel px-3 py-2.5 outline-none focus:border-tinta";

function EditorCliente({ cliente, onCerrar }) {
  const qc = useQueryClient();
  const nuevo = !cliente?.id;
  const [f, setF] = useState({ nombre: "", telefono: "", documento: "", notas: "", cupo_fiado: 0, ...cliente });
  const guardar = useMutation({
    mutationFn: () =>
      nuevo
        ? api("/clientes/", { method: "POST", body: f })
        : api(`/clientes/${cliente.id}/`, { method: "PATCH", body: f }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["clientes"] }); qc.invalidateQueries({ queryKey: ["fiados"] }); onCerrar(); },
  });
  return (
    <Hoja titulo={nuevo ? "Nuevo cliente" : "Editar cliente"} onCerrar={onCerrar}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); guardar.mutate(); }}>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Nombre</span>
          <input required value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} className={campo} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Celular</span>
            <input inputMode="tel" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} className={campo} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Cédula <span className="font-normal text-suave">(opcional)</span></span>
            <input value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} className={campo} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Cupo máximo de fiado</span>
          <InputPesos valor={Number(f.cupo_fiado)} onCambio={(v) => setF({ ...f, cupo_fiado: v })} />
          <span className="mt-1 block text-sm text-suave">En 0, sin límite.</span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Notas</span>
          <input value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} className={campo} placeholder="Ej. paga los viernes" />
        </label>
        {guardar.error && <Aviso>{guardar.error.message}</Aviso>}
        <Boton className="w-full" disabled={guardar.isPending}>{nuevo ? "Crear cliente" : "Guardar cambios"}</Boton>
      </form>
    </Hoja>
  );
}

function Cuenta({ clienteId, onCerrar, onEditar }) {
  const qc = useQueryClient();
  const { negocio, esAdmin } = useSesion();
  const medios = negocio.medios_pago_activos;
  const [monto, setMonto] = useState(0);
  const [medio, setMedio] = useState(medios.includes("EFECTIVO") ? "EFECTIVO" : medios[0]);
  const [ok, setOk] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["fiados", "cuenta", clienteId],
    queryFn: () => api(`/clientes/${clienteId}/estado_cuenta/`),
  });
  const { data: rec } = useQuery({
    queryKey: ["fiados", "recordatorio", clienteId],
    queryFn: () => api(`/clientes/${clienteId}/recordatorio/`),
  });
  const abonar = useMutation({
    mutationFn: () => api(`/clientes/${clienteId}/abonar/`, { method: "POST", body: { monto, medio } }),
    onSuccess: (r) => {
      setOk(`Abono de ${pesos(r.abonado)} registrado. Queda debiendo ${pesos(r.saldo_cliente)}.`);
      setMonto(0);
      qc.invalidateQueries({ queryKey: ["fiados"] });
      qc.invalidateQueries({ queryKey: ["clientes"] });
      qc.invalidateQueries({ queryKey: ["caja"] });
    },
  });

  const c = data?.cliente;
  const saldo = Number(c?.saldo_pendiente || 0);
  const pendientes = (data?.ventas || []).filter((v) => Number(v.saldo_pendiente) > 0);
  const pagadas = (data?.ventas || []).filter((v) => Number(v.saldo_pendiente) === 0).slice(0, 10);

  return (
    <Hoja titulo={c?.nombre || "Cliente"} onCerrar={onCerrar} ancho="max-w-xl">
      {isLoading && <p className="text-suave">Cargando…</p>}
      {error && <Aviso>{error.message}</Aviso>}
      {c && (
        <>
          <div className="flex items-end justify-between gap-3 rounded-xl bg-tinta p-5 text-white">
            <div>
              <p className="text-white/70">Debe</p>
              <p className="font-display text-4xl font-extrabold num">{pesos(saldo)}</p>
              {Number(c.cupo_fiado) > 0 && <p className="mt-1 text-sm text-white/70">Cupo {pesos(c.cupo_fiado)}</p>}
            </div>
            {c.telefono && saldo > 0 && rec?.whatsapp && (
              <a href={rec.whatsapp} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2.5 text-sm font-semibold text-tinta">
                <MessageCircle size={17} aria-hidden /> Recordar
              </a>
            )}
          </div>
          {!c.telefono && saldo > 0 && (
            <p className="mt-2 text-sm text-suave">Agrega su celular para recordarle por WhatsApp.</p>
          )}

          {saldo > 0 && (
            <form className="mt-5 rounded-xl bg-fondo p-4" onSubmit={(e) => { e.preventDefault(); setOk(""); abonar.mutate(); }}>
              <p className="mb-2 font-semibold">Registrar abono</p>
              <div className="flex flex-wrap gap-2">
                <InputPesos className="min-w-40 flex-1" valor={monto} onCambio={setMonto} aria-label="Monto del abono" />
                <select value={medio} onChange={(e) => setMedio(e.target.value)} className="rounded-lg border border-linea bg-papel px-3" aria-label="Medio">
                  {medios.map((m) => <option key={m} value={m}>{MEDIOS[m]}</option>)}
                </select>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => setMonto(saldo)} className="rounded-full border border-linea bg-papel px-3 py-1.5 text-sm font-semibold">
                  Paga todo ({pesos(saldo)})
                </button>
              </div>
              {abonar.error && <div className="mt-3"><Aviso>{abonar.error.message}</Aviso></div>}
              <Boton variante="ok" className="mt-3 w-full" disabled={!monto || monto > saldo || abonar.isPending}>
                {abonar.isPending ? "Registrando…" : `Registrar abono${monto ? ` de ${pesos(monto)}` : ""}`}
              </Boton>
            </form>
          )}
          {ok && <div className="mt-3"><Aviso tipo="ok">{ok}</Aviso></div>}

          <h3 className="mt-6 font-display text-lg font-bold text-tinta">Lo que debe</h3>
          {pendientes.length === 0 ? (
            <p className="mt-2 text-suave">No tiene compras pendientes.</p>
          ) : (
            <ul className="mt-2 divide-y divide-linea rounded-xl border border-linea">
              {pendientes.map((v) => (
                <li key={v.id} className="px-4 py-3">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium">
                      #{v.numero} · {new Date(v.creado).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}
                    </span>
                    <span className="font-semibold text-alerta num">{pesos(v.saldo_pendiente)}</span>
                  </div>
                  <p className="truncate text-sm text-suave">
                    {v.detalles.map((d) => `${numero(d.cantidad)} ${d.nombre}`).join(", ")} · total {pesos(v.total)}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {pagadas.length > 0 && (
            <>
              <h3 className="mt-6 font-display text-lg font-bold text-tinta">Ya pagado</h3>
              <ul className="mt-2 divide-y divide-linea rounded-xl border border-linea text-sm">
                {pagadas.map((v) => (
                  <li key={v.id} className="flex justify-between gap-3 px-4 py-2.5 text-suave">
                    <span>#{v.numero} · {new Date(v.creado).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}</span>
                    <span className="num">{pesos(v.total)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {esAdmin && (
            <button onClick={() => onEditar(c)} className="mt-5 text-sm font-semibold text-tinta underline">Editar datos del cliente</button>
          )}
        </>
      )}
    </Hoja>
  );
}

export default function Fiados() {
  const [q, setQ] = useState("");
  const [vista, setVista] = useState("deben");
  const [abierto, setAbierto] = useState(null);
  const [editando, setEditando] = useState(null);

  const deudores = useQuery({ queryKey: ["fiados", "deudores"], queryFn: () => api("/clientes/deudores/") });
  const clientes = useQuery({ queryKey: ["clientes", ""], queryFn: () => api("/clientes/"), enabled: vista === "todos" });

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = vista === "deben"
      ? (deudores.data?.clientes || []).map((c) => ({ ...c, saldo_pendiente: c.saldo }))
      : (clientes.data || []).filter((c) => c.activo);
    return base.filter((c) => !t || c.nombre.toLowerCase().includes(t) || (c.telefono || "").includes(t));
  }, [q, vista, deudores.data, clientes.data]);

  const total = deudores.data?.total_cartera || 0;
  const cuantos = deudores.data?.clientes.length || 0;
  const cargando = vista === "deben" ? deudores.isLoading : clientes.isLoading;
  const error = deudores.error || clientes.error;

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 lg:px-6 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold text-tinta">Fiados</h1>
        <Boton onClick={() => setEditando({})}><Plus size={18} aria-hidden /> Nuevo cliente</Boton>
      </div>

      <section className="mt-5 rounded-2xl bg-tinta p-6 text-white">
        <p className="text-white/70">Te deben en total</p>
        <p className="font-display text-5xl font-extrabold num">{pesos(total)}</p>
        <p className="mt-1 text-white/70">{cuantos} {cuantos === 1 ? "cliente" : "clientes"} con saldo pendiente</p>
      </section>

      <div className="mt-5 flex flex-wrap gap-2">
        <div className="flex min-w-56 flex-1 items-center gap-2 rounded-lg border border-linea bg-papel px-3 focus-within:border-tinta">
          <Search size={18} className="text-suave" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o celular" className="w-full bg-transparent py-2.5 outline-none" aria-label="Buscar cliente" />
        </div>
        {[["deben", "Con deuda"], ["todos", "Todos los clientes"]].map(([v, t]) => (
          <button key={v} onClick={() => setVista(v)} className={`rounded-full px-4 py-2 text-sm font-semibold ${vista === v ? "bg-tinta text-white" : "bg-papel text-tinta"}`}>
            {t}
          </button>
        ))}
      </div>

      {error && <div className="mt-4"><Aviso>{error.message}</Aviso></div>}
      {cargando ? (
        <p className="py-10 text-suave">Cargando…</p>
      ) : lista.length === 0 ? (
        <div className="py-12 text-center">
          <p className="font-display text-xl font-bold text-tinta">{vista === "deben" && !q ? "Nadie te debe" : "Sin resultados"}</p>
          <p className="mt-1 text-suave">
            {vista === "deben" && !q ? "Cuando fíes una venta desde Vender, el cliente aparece aquí." : "Prueba con otro nombre o número."}
          </p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-linea overflow-hidden rounded-xl bg-papel">
          {lista.map((c) => (
            <li key={c.id}>
              <button onClick={() => setAbierto(c.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-fondo/70">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-fondo text-suave"><UserRound size={20} aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.nombre}</span>
                  <span className="block text-sm text-suave">{c.telefono || "Sin celular"}</span>
                </span>
                <span className={`font-display text-lg font-bold num ${Number(c.saldo_pendiente) > 0 ? "text-alerta" : "text-suave"}`}>
                  {Number(c.saldo_pendiente) > 0 ? pesos(c.saldo_pendiente) : "Al día"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {abierto && <Cuenta clienteId={abierto} onCerrar={() => setAbierto(null)} onEditar={(c) => { setAbierto(null); setEditando(c); }} />}
      {editando && <EditorCliente cliente={editando.id ? editando : null} onCerrar={() => setEditando(null)} />}
    </div>
  );
}
