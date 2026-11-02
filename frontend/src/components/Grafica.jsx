import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fechaCorta, pesos, pesosCorto } from "../lib/formato";

/*
 * Gráfica diaria en SVG propio (sin librerías): barras para una serie y, opcional,
 * una línea para otra en la MISMA escala de pesos (nunca dos ejes) y una línea de
 * referencia punteada (ej. la cuota diaria del crédito). Colores de la paleta
 * categórica validada (azul / naranja); el texto siempre en tokens de texto.
 */
const AZUL = "#2a78d6";
const NARANJA = "#eb6834";

function pasosEje(max, min) {
  const rango = Math.max(max - Math.min(min, 0), 1);
  const bruto = rango / 4;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto);
  const ini = Math.floor(Math.min(min, 0) / paso) * paso;
  const fin = Math.ceil(max / paso) * paso || paso;
  const pasos = [];
  for (let v = ini; v <= fin + paso / 2; v += paso) pasos.push(v);
  return pasos;
}

export default function GraficaDias({
  datos,               // [{fecha, ...valores}]
  barra,               // {clave, nombre}
  linea,               // {clave, nombre} opcional
  referencia,          // {valor, nombre} opcional
  alto = 240,
  resumenAccesible,
}) {
  const id = useId();
  const [activo, setActivo] = useState(null);
  // Se dibuja al ancho real del contenedor: el texto queda en 12px reales también en celular
  const caja = useRef(null);
  const [ancho, setAncho] = useState(720);
  useEffect(() => {
    if (!caja.current) return;
    const ro = new ResizeObserver(([e]) => setAncho(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(caja.current);
    return () => ro.disconnect();
  }, []);
  const W = ancho, H = alto, m = { izq: 72, der: 12, arr: 16, aba: 30 };
  const iw = W - m.izq - m.der, ih = H - m.arr - m.aba;

  const { y, ticks } = useMemo(() => {
    const vals = datos.flatMap((d) => [Number(d[barra.clave]) || 0, linea ? Number(d[linea.clave]) || 0 : 0]);
    if (referencia) vals.push(Number(referencia.valor) || 0);
    const t = pasosEje(Math.max(...vals, 1), Math.min(...vals, 0));
    const lo = t[0], hi = t.at(-1);
    return { ticks: t, y: (v) => m.arr + ih - ((v - lo) / (hi - lo)) * ih };
  }, [datos, barra, linea, referencia, ih, m.arr]);

  const n = datos.length;
  const banda = iw / Math.max(n, 1);
  const anchoBarra = Math.max(Math.min(banda - 2, 28), 3);
  const x = (i) => m.izq + banda * i + banda / 2;
  const cada = Math.ceil(n / Math.max(2, Math.floor(iw / 64))); // etiquetas del eje x sin amontonarse
  const cero = y(0);
  const d = activo != null ? datos[activo] : null;

  return (
    <figure className="m-0">
      <div className="relative" ref={caja}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full"
          role="img"
          aria-labelledby={`${id}-t`}
          onMouseLeave={() => setActivo(null)}
        >
          <title id={`${id}-t`}>{resumenAccesible}</title>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.izq} x2={W - m.der} y1={y(t)} y2={y(t)} stroke="var(--color-linea)" strokeWidth={t === 0 ? 1.25 : 1} />
              <text x={m.izq - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--color-suave)">{pesosCorto(t)}</text>
            </g>
          ))}
          {datos.map((p, i) => {
            const v = Number(p[barra.clave]) || 0;
            const top = Math.min(y(v), cero), h = Math.max(Math.abs(y(v) - cero), v ? 1.5 : 0);
            return (
              <g key={p.fecha}>
                <rect
                  x={x(i) - anchoBarra / 2}
                  y={top}
                  width={anchoBarra}
                  height={h}
                  rx={Math.min(4, anchoBarra / 2)}
                  fill={AZUL}
                  opacity={activo == null || activo === i ? 1 : 0.45}
                />
                {i % cada === 0 && (
                  <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--color-suave)">
                    {fechaCorta(p.fecha)}
                  </text>
                )}
              </g>
            );
          })}
          {referencia && (
            <g>
              <line x1={m.izq} x2={W - m.der} y1={y(referencia.valor)} y2={y(referencia.valor)} stroke="var(--color-texto)" strokeWidth="1.5" strokeDasharray="5 4" />
            </g>
          )}
          {linea && n > 1 && (
            <polyline
              fill="none"
              stroke={NARANJA}
              strokeWidth="2"
              strokeLinejoin="round"
              points={datos.map((p, i) => `${x(i)},${y(Number(p[linea.clave]) || 0)}`).join(" ")}
            />
          )}
          {linea && datos.map((p, i) => (
            (activo === i || n <= 14) && (
              <circle key={p.fecha} cx={x(i)} cy={y(Number(p[linea.clave]) || 0)} r={activo === i ? 5 : 3.5} fill={NARANJA} stroke="var(--color-papel)" strokeWidth="2" />
            )
          ))}
          {/* Zonas de hover más grandes que las marcas */}
          {datos.map((p, i) => (
            <rect
              key={`h-${p.fecha}`}
              x={m.izq + banda * i}
              y={m.arr}
              width={banda}
              height={ih}
              fill="transparent"
              onMouseEnter={() => setActivo(i)}
              onClick={() => setActivo(i)}
            />
          ))}
          {d && <line x1={x(activo)} x2={x(activo)} y1={m.arr} y2={m.arr + ih} stroke="var(--color-suave)" strokeWidth="1" opacity="0.4" pointerEvents="none" />}
        </svg>
        {d && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-linea bg-papel px-3 py-2 text-sm shadow-lg"
            style={{ left: `${(x(activo) / W) * 100}%`, transform: `translateX(${x(activo) > W * 0.6 ? "-105%" : "8%"})` }}
          >
            <p className="font-semibold">{((t) => t.charAt(0).toUpperCase() + t.slice(1))(fechaCorta(d.fecha, { dia: true }))}</p>
            <p className="mt-1 flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: AZUL }} />{barra.nombre}</span>
              <span className="font-semibold num">{pesos(d[barra.clave])}</span>
            </p>
            {linea && (
              <p className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-3" style={{ background: NARANJA }} />{linea.nombre}</span>
                <span className="font-semibold num">{pesos(d[linea.clave])}</span>
              </p>
            )}
            {referencia && (
              <p className="flex items-center justify-between gap-4 text-suave">
                <span>{referencia.nombre}</span>
                <span className="num">{pesos(referencia.valor)}</span>
              </p>
            )}
          </div>
        )}
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-suave">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: AZUL }} aria-hidden />{barra.nombre}</span>
        {linea && <span className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: NARANJA }} aria-hidden />{linea.nombre}</span>}
        {referencia && (
          <span className="flex items-center gap-1.5">
            <svg width="18" height="4" aria-hidden><line x1="0" x2="18" y1="2" y2="2" stroke="var(--color-texto)" strokeWidth="1.5" strokeDasharray="5 4" /></svg>
            {referencia.nombre} ({pesos(referencia.valor)})
          </span>
        )}
      </figcaption>
    </figure>
  );
}
