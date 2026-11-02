import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { MEDIOS, numero, pesos } from "../lib/formato";
import { aplicarMarca } from "../lib/marca";

/** Recibo digital público: lo abre el cliente desde el link de WhatsApp. */
export default function Recibo() {
  const { token } = useParams();
  const [r, setR] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/public/recibo/${token}/`).then((x) => { aplicarMarca(x.negocio); setR(x); }).catch((e) => setError(e.message));
  }, [token]);

  if (error) return <p className="p-10 text-center text-suave">{error}</p>;
  if (!r) return <p className="p-10 text-center text-suave">Cargando recibo…</p>;
  return (
    <div className="min-h-dvh px-4 py-10">
      <article className="mx-auto max-w-sm">
        <div className="bg-papel px-6 pb-6 pt-8">
          <header className="text-center">
            {r.negocio.logo_url && <img src={r.negocio.logo_url} alt="" className="mx-auto mb-3 h-14 w-14 rounded-full object-cover" />}
            <h1 className="font-display text-2xl font-bold text-tinta">{r.negocio.nombre}</h1>
            {r.negocio.nit && <p className="text-sm text-suave">NIT {r.negocio.nit}</p>}
            {r.negocio.direccion && <p className="text-sm text-suave">{r.negocio.direccion}</p>}
          </header>
          <p className="mt-5 flex justify-between border-y border-dashed border-linea py-2 text-sm text-suave">
            <span>Recibo #{r.numero}{r.turno ? ` · Turno ${r.turno}` : ""}</span>
            <span>{new Date(r.fecha).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}</span>
          </p>
          {r.estado === "ANULADA" && <p className="mt-3 text-center font-semibold text-alerta">Venta anulada</p>}
          <ul className="mt-3 space-y-2">
            {r.detalles.map((d, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>{numero(d.cantidad)} × {d.nombre}</span>
                <span className="num">{pesos(d.subtotal)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-1 border-t border-dashed border-linea pt-3 text-sm">
            {Number(r.descuento) > 0 && (
              <>
                <p className="flex justify-between text-suave"><span>Subtotal</span><span className="num">{pesos(r.subtotal)}</span></p>
                <p className="flex justify-between text-suave"><span>Descuento</span><span className="num">-{pesos(r.descuento)}</span></p>
              </>
            )}
            <p className="flex items-baseline justify-between pt-1">
              <span className="font-display text-lg font-bold text-tinta">Total</span>
              <span className="font-display text-2xl font-extrabold text-tinta num">{pesos(r.total)}</span>
            </p>
            {r.pagos.map((p, i) => (
              <p key={i} className="flex justify-between text-suave"><span>{MEDIOS[p.medio]}</span><span className="num">{pesos(p.monto)}</span></p>
            ))}
            {Number(r.cambio) > 0 && <p className="flex justify-between text-suave"><span>Cambio</span><span className="num">{pesos(r.cambio)}</span></p>}
            {Number(r.saldo_pendiente) > 0 && (
              <p className="flex justify-between font-semibold text-alerta"><span>Saldo pendiente</span><span className="num">{pesos(r.saldo_pendiente)}</span></p>
            )}
          </div>
          {r.negocio.mensaje && <p className="mt-6 text-center font-medium">{r.negocio.mensaje}</p>}
          <p className="mt-2 text-center text-xs text-suave">{r.nota_legal}</p>
        </div>
        <div className="filo-recibo" aria-hidden />
      </article>
    </div>
  );
}
