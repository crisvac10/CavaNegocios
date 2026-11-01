import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MessageSquareText, Undo2 } from "lucide-react";
import { api } from "../lib/api";
import { numero } from "../lib/formato";
import { Aviso } from "../components/ui";

const ESPERA_LARGA = 10; // minutos: a partir de aquí el pedido se marca en rojo

const minutosDesde = (iso, ahora) => Math.max(0, Math.floor((ahora - new Date(iso).getTime()) / 60000));
const textoEspera = (min) => (min < 1 ? "Recién" : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);

function Tarjeta({ p, ahora, onEntregar, enviando }) {
  const min = minutosDesde(p.creado, ahora);
  const tarde = min >= ESPERA_LARGA;
  return (
    <article className={`flex flex-col rounded-2xl border-2 bg-papel ${tarde ? "border-alerta" : "border-transparent"}`}>
      <header className="flex items-start justify-between gap-2 px-4 pt-4">
        <div>
          <p className="text-sm text-suave">Turno</p>
          <p className="font-display text-5xl font-extrabold leading-none text-tinta num">{p.turno}</p>
        </div>
        <div className="text-right">
          <p className={`font-semibold num ${tarde ? "text-alerta" : "text-suave"}`}>{textoEspera(min)}</p>
          {p.cliente && <p className="mt-0.5 text-sm font-medium">{p.cliente}</p>}
          {p.estado_pago === "FIADO" && (
            <span className="mt-1 inline-block rounded-full bg-precio-claro px-2 py-0.5 text-xs font-semibold">Fiado</span>
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
        <p className="mx-4 mb-4 flex gap-2 rounded-lg bg-precio-claro px-3 py-2 text-sm font-medium">
          <MessageSquareText size={17} className="mt-0.5 shrink-0" aria-hidden />
          {p.nota}
        </p>
      )}
      <button
        onClick={() => onEntregar(p)}
        disabled={enviando}
        className="flex items-center justify-center gap-2 rounded-b-2xl bg-ok py-4 text-lg font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
      >
        <Check size={22} aria-hidden /> Entregado
      </button>
    </article>
  );
}

export default function Pedidos() {
  const qc = useQueryClient();
  const [vista, setVista] = useState("pendientes");
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const pendientes = useQuery({
    queryKey: ["pedidos", "pendientes"],
    queryFn: () => api("/pedidos/"),
    refetchInterval: 5_000,
  });
  const entregados = useQuery({
    queryKey: ["pedidos", "entregados"],
    queryFn: () => api("/pedidos/", { query: { estado: "entregados" } }),
    enabled: vista === "entregados",
    refetchInterval: 15_000,
  });

  const refrescar = () => qc.invalidateQueries({ queryKey: ["pedidos"] });
  const entregar = useMutation({
    mutationFn: (p) => api(`/pedidos/${p.id}/entregar/`, { method: "POST" }),
    // Lo quitamos de la pantalla de una: el toque se siente inmediato aunque el internet esté lento
    onMutate: async (p) => {
      await qc.cancelQueries({ queryKey: ["pedidos", "pendientes"] });
      const antes = qc.getQueryData(["pedidos", "pendientes"]);
      qc.setQueryData(["pedidos", "pendientes"], (lista = []) => lista.filter((x) => x.id !== p.id));
      return { antes };
    },
    onError: (_e, _p, ctx) => qc.setQueryData(["pedidos", "pendientes"], ctx.antes),
    onSettled: refrescar,
  });
  const deshacer = useMutation({
    mutationFn: (p) => api(`/pedidos/${p.id}/deshacer/`, { method: "POST" }),
    onSettled: refrescar,
  });

  const lista = pendientes.data || [];
  const error = pendientes.error || entregar.error || deshacer.error;

  return (
    <div className="px-4 py-5 lg:px-6 lg:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-bold text-tinta">Pedidos</h1>
        <div className="flex rounded-lg bg-papel p-1 text-sm font-semibold" role="tablist">
          {[
            ["pendientes", `Por entregar${lista.length ? ` (${lista.length})` : ""}`],
            ["entregados", "Entregados hoy"],
          ].map(([v, t]) => (
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
            <p className="font-display text-2xl font-bold text-tinta">Todo entregado</p>
            <p className="mt-1 text-suave">Los pedidos nuevos aparecen aquí solos al vender.</p>
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {lista.map((p) => (
              <Tarjeta key={p.id} p={p} ahora={ahora} onEntregar={entregar.mutate} enviando={entregar.isPending && entregar.variables?.id === p.id} />
            ))}
          </div>
        )
      ) : (
        <ul className="mt-5 max-w-2xl divide-y divide-linea rounded-xl bg-papel">
          {(entregados.data || []).length === 0 && <li className="p-4 text-suave">Aún no se ha entregado nada hoy.</li>}
          {(entregados.data || []).map((p) => (
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
      )}
    </div>
  );
}
