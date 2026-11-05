import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api, descargar } from "../lib/api";
import { fechaCorta, hoyISO, MEDIOS, numero, periodo, pesos } from "../lib/formato";
import GraficaDias from "../components/Grafica";
import { Aviso, Boton } from "../components/ui";
import { useSesion } from "../context/Sesion";

const PERIODOS = [["hoy", "Hoy"], ["7d", "7 días"], ["30d", "30 días"], ["mes", "Este mes"], ["mes_pasado", "Mes pasado"]];

function Fila({ nombre, valor, fuerte, resta, nota }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2.5 ${fuerte ? "border-t-2 border-tinta font-semibold" : "border-t border-linea"}`}>
      <span className={fuerte ? "font-display text-lg text-tinta" : ""}>
        {nombre}
        {nota && <span className="block text-xs font-normal text-suave">{nota}</span>}
      </span>
      <span className={`num ${fuerte ? "font-display text-2xl font-extrabold text-tinta" : ""} ${Number(valor) < 0 ? "text-alerta" : ""}`}>
        {resta ? `${Number(valor) ? "−" : ""}${pesos(Math.abs(Number(valor)))}` : pesos(valor)}
      </span>
    </div>
  );
}

export default function Reportes() {
  const { tieneModulo } = useSesion();
  const [per, setPer] = useState("mes");
  const [rango, setRango] = useState(periodo("mes"));
  const [errorDescarga, setErrorDescarga] = useState("");
  const elegir = (v) => { setPer(v); setRango(periodo(v)); };
  const { desde, hasta } = rango;
  const unDia = desde === hasta;

  const resumen = useQuery({ queryKey: ["reportes", "resumen", desde, hasta], queryFn: () => api("/reportes/resumen/", { query: { desde, hasta } }) });
  const diario = useQuery({ queryKey: ["reportes", "diario", desde, hasta], queryFn: () => api("/reportes/diario/", { query: { desde, hasta } }), enabled: !unDia });
  const top = useQuery({ queryKey: ["reportes", "top", desde, hasta], queryFn: () => api("/reportes/top-productos/", { query: { desde, hasta, limite: 10 } }) });

  const r = resumen.data;
  const medios = r ? Object.entries(r.dinero_recibido_por_medio).filter(([, v]) => Number(v)) : [];
  const totalMedios = medios.reduce((s, [, v]) => s + Number(v), 0);
  const error = resumen.error || diario.error || top.error;

  const csv = async (tipo) => {
    setErrorDescarga("");
    try { await descargar("/reportes/exportar/", { tipo, desde, hasta }, `${tipo}_${desde}_${hasta}.csv`); }
    catch (e) { setErrorDescarga(e.message); }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-tinta">Reportes</h1>
          <p className="mt-1 text-suave">{unDia ? fechaCorta(desde, { dia: true, anio: true }) : `${fechaCorta(desde)} a ${fechaCorta(hasta, { anio: true })}`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Boton variante="borde" className="py-2 text-sm" onClick={() => csv("ventas")}><Download size={16} aria-hidden /> Ventas CSV</Boton>
          <Boton variante="borde" className="py-2 text-sm" onClick={() => csv("gastos")}><Download size={16} aria-hidden /> Gastos CSV</Boton>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {PERIODOS.map(([v, t]) => (
          <button key={v} onClick={() => elegir(v)} aria-pressed={per === v}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${per === v ? "bg-tinta text-white" : "bg-papel text-tinta"}`}>{t}</button>
        ))}
        <span className="flex items-center gap-1.5 text-sm">
          <input type="date" value={desde} max={hasta} onChange={(e) => { setPer("otro"); setRango({ desde: e.target.value, hasta }); }} className="rounded-lg border border-linea bg-papel px-2 py-1.5" aria-label="Desde" />
          a
          <input type="date" value={hasta} min={desde} max={hoyISO()} onChange={(e) => { setPer("otro"); setRango({ desde, hasta: e.target.value }); }} className="rounded-lg border border-linea bg-papel px-2 py-1.5" aria-label="Hasta" />
        </span>
      </div>

      {(error || errorDescarga) && <div className="mt-4"><Aviso>{error?.message || errorDescarga}</Aviso></div>}
      {resumen.isLoading && <p className="py-10 text-suave">Cargando…</p>}

      {r && (
        <>
          {/* La cifra que importa: la ganancia real del periodo */}
          <section className="mt-6 grid gap-3 md:grid-cols-[1.3fr_1fr_1fr]">
            <div className="rounded-2xl bg-tinta p-6 text-white">
              <p className="text-white/70">Ganancia del periodo</p>
              <p className="font-display text-5xl font-extrabold num">{pesos(r.utilidad_neta)}</p>
              <p className="mt-1 text-sm text-white/70">Ventas − costo de lo vendido − gastos − intereses de créditos</p>
            </div>
            <div className="rounded-2xl bg-papel p-5">
              <p className="text-suave">Vendido</p>
              <p className="font-display text-3xl font-extrabold text-tinta num">{pesos(r.ventas_netas)}</p>
              <p className="mt-1 text-sm text-suave">{numero(r.num_ventas)} ventas · ticket promedio {pesos(r.ticket_promedio)}</p>
            </div>
            <div className="rounded-2xl bg-papel p-5">
              <p className="text-suave">Margen sobre lo vendido</p>
              <p className="font-display text-3xl font-extrabold text-tinta num">{numero(r.margen_bruto_pct)}%</p>
              <p className="mt-1 text-sm text-suave">De cada $1.000 vendidos te quedan {pesos(Number(r.margen_bruto_pct) * 10)} antes de gastos</p>
            </div>
          </section>

          {!unDia && diario.data && (
            <section className="mt-6 rounded-2xl bg-papel p-5">
              <h2 className="font-display text-lg font-bold text-tinta">Ventas y ganancia por día</h2>
              <p className="mb-4 text-sm text-suave">Pasa el dedo o el mouse por un día para ver el detalle.</p>
              <GraficaDias
                datos={diario.data}
                barra={{ clave: "ventas", nombre: "Ventas" }}
                linea={{ clave: "utilidad_neta", nombre: "Ganancia" }}
                resumenAccesible={`Ventas y ganancia diarias entre ${desde} y ${hasta}`}
              />
            </section>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl bg-papel p-5">
              <h2 className="mb-2 font-display text-lg font-bold text-tinta">Cómo se llega a la ganancia</h2>
              <Fila nombre="Ventas" valor={r.ventas_netas} nota={Number(r.descuentos) ? `Ya descontados ${pesos(r.descuentos)} en descuentos` : null} />
              <Fila nombre="Costo de lo vendido" valor={r.costo_ventas} resta />
              <Fila nombre="Gastos del negocio" valor={r.gastos_operativos} resta />
              <Fila nombre="Ganancia de la operación" valor={r.utilidad_operativa} fuerte />
              <Fila nombre="Intereses de créditos" valor={r.intereses_creditos} resta />
              <Fila nombre="Ganancia final" valor={r.utilidad_neta} fuerte />
              <p className="mt-3 text-xs text-suave">
                Las compras de mercancía ({pesos(r.compras_mercancia)}) no se restan aquí: se vuelven costo cuando vendes.
                Tampoco cuentan como ganancia los desembolsos de créditos ({pesos(r.no_operativo.desembolsos_credito)})
                ni como gasto los abonos a capital ({pesos(r.no_operativo.abonos_a_capital_credito)}).
              </p>
            </section>

            <section className="rounded-2xl bg-papel p-5">
              <h2 className="mb-3 font-display text-lg font-bold text-tinta">Lo más vendido</h2>
              {(top.data || []).length === 0 ? <p className="text-suave">Sin ventas en el periodo.</p> : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-suave">
                      <th className="pb-2 font-medium">Producto</th>
                      <th className="pb-2 text-right font-medium">Cant.</th>
                      <th className="pb-2 text-right font-medium">Vendido</th>
                      <th className="pb-2 text-right font-medium">Ganancia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.data.map((p) => (
                      <tr key={p.producto_id} className="border-t border-linea">
                        <td className="py-2 font-medium">{p.nombre}</td>
                        <td className="py-2 text-right num">{numero(p.cantidad)}</td>
                        <td className="py-2 text-right num">{pesos(p.vendido)}</td>
                        <td className={`py-2 text-right font-semibold num ${p.utilidad < 0 ? "text-alerta" : ""}`}>{pesos(p.utilidad)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="rounded-2xl bg-papel p-5">
              <h2 className="mb-3 font-display text-lg font-bold text-tinta">Cómo te pagaron</h2>
              {medios.length === 0 ? <p className="text-suave">Sin pagos en el periodo.</p> : (
                <ul className="space-y-2.5">
                  {medios.sort((a, b) => b[1] - a[1]).map(([m, v]) => (
                    <li key={m} className="grid grid-cols-[7rem_1fr_6rem] items-center gap-3 text-sm">
                      <span className="font-medium">{MEDIOS[m]}</span>
                      <span className="h-2.5 overflow-hidden rounded-full bg-fondo" aria-hidden>
                        <span className="block h-full rounded-full bg-tinta" style={{ width: `${(Number(v) / totalMedios) * 100}%` }} />
                      </span>
                      <span className="text-right font-semibold num">{pesos(v)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-2xl bg-papel p-5">
              <h2 className="mb-3 font-display text-lg font-bold text-tinta">Fiados</h2>
              <Fila nombre="Fiado en el periodo, aún sin pagar" valor={r.fiado_otorgado_pendiente} />
              <Fila nombre="Abonos cobrados en el periodo" valor={r.abonos_fiado_cobrados} />
              <Fila nombre="Te deben hoy en total" valor={r.cartera_total} fuerte />
              {tieneModulo("encargos") && (
                <>
                  <h3 className="mb-2 mt-5 font-semibold">Encargos</h3>
                  <Fila nombre="Abonos recibidos en el periodo" valor={r.abonos_encargos} />
                  <Fila nombre={`Por entregar (${r.encargos_por_entregar.cantidad})`} valor={r.encargos_por_entregar.total} />
                  <Fila nombre="Falta por cobrar de esos encargos" valor={r.encargos_por_entregar.falta_por_cobrar} fuerte />
                  <p className="mt-2 text-xs text-suave">Un encargo cuenta como venta el día que se entrega.</p>
                </>
              )}
              {r.gastos_por_categoria.length > 0 && (
                <>
                  <h3 className="mb-2 mt-5 font-semibold">Gastos por categoría</h3>
                  {r.gastos_por_categoria.map((g) => (
                    <div key={g.categoria_nombre} className="flex justify-between border-t border-linea py-2 text-sm">
                      <span>{g.categoria_nombre}</span><span className="num">{pesos(g.total)}</span>
                    </div>
                  ))}
                </>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
