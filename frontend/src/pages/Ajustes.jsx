import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, ImagePlus, Store } from "lucide-react";
import { api } from "../lib/api";
import { MEDIOS, pesos } from "../lib/formato";
import { PALETAS, problemaMarca } from "../lib/marca";
import { useSesion } from "../context/Sesion";
import { Aviso, Boton } from "../components/ui";

const campo = "w-full rounded-lg border border-linea bg-papel px-3 py-2.5 outline-none focus:border-tinta";

function Seccion({ titulo, descripcion, children }) {
  return (
    <section className="grid gap-4 border-t border-linea py-8 lg:grid-cols-[260px_1fr] lg:gap-10">
      <div>
        <h2 className="font-display text-lg font-bold text-tinta">{titulo}</h2>
        {descripcion && <p className="mt-1 text-sm text-suave">{descripcion}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** Mini POS pintado con los colores elegidos (inline: no cambia la app hasta guardar). */
function VistaPrevia({ nombre, logo, primario, acento }) {
  return (
    <div className="overflow-hidden rounded-xl border border-linea bg-fondo" aria-label="Vista previa de la marca">
      <div className="flex items-center gap-2.5 px-4 py-3 text-white" style={{ background: primario }}>
        {logo ? (
          <img src={logo} alt="" className="h-8 w-8 rounded-full bg-white object-cover" />
        ) : (
          <Store size={20} aria-hidden />
        )}
        <span className="truncate font-display font-bold">{nombre || "Tu negocio"}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3">
        {[["Capuchino", 5500], ["Pan de bono", 2500]].map(([n, p]) => (
          <div key={n} className="rounded-lg border border-linea bg-papel p-2.5">
            <p className="text-sm font-semibold">{n}</p>
            <span
              className="mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-display text-sm font-bold num"
              style={{ background: acento, color: primario }}
            >
              {pesos(p)}
            </span>
          </div>
        ))}
      </div>
      <div className="px-3 pb-3">
        <div className="rounded-lg py-2.5 text-center text-sm font-semibold text-white" style={{ background: primario }}>
          Ver menú
        </div>
      </div>
    </div>
  );
}

function SelectorColor({ etiqueta, valor, onCambio }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{etiqueta}</span>
      <span className="flex items-center gap-2 rounded-lg border border-linea bg-papel p-1.5 pr-3 focus-within:border-tinta">
        <input
          type="color"
          value={valor}
          onChange={(e) => onCambio(e.target.value.toUpperCase())}
          className="h-9 w-12 cursor-pointer rounded-md border-0 bg-transparent p-0"
          aria-label={`${etiqueta}: selector`}
        />
        <input
          value={valor}
          onChange={(e) => onCambio(e.target.value.toUpperCase())}
          maxLength={7}
          className="w-full bg-transparent font-mono text-sm uppercase outline-none"
          aria-label={`${etiqueta}: código`}
        />
      </span>
    </label>
  );
}

function Logo({ negocio, onListo }) {
  const input = useRef(null);
  const subir = useMutation({
    mutationFn: (archivo) => {
      const f = new FormData();
      f.append("logo", archivo);
      return api("/mi-negocio/logo/", { method: "POST", body: f });
    },
    onSuccess: onListo,
  });
  const quitar = useMutation({ mutationFn: () => api("/mi-negocio/logo/", { method: "DELETE" }), onSuccess: onListo });
  const error = subir.error || quitar.error;
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-dashed border-linea bg-fondo text-suave hover:border-tinta"
        aria-label="Elegir logo"
      >
        {negocio.logo_url ? <img src={negocio.logo_url} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={24} aria-hidden />}
      </button>
      <div className="space-y-1.5 text-sm">
        <button type="button" onClick={() => input.current?.click()} disabled={subir.isPending} className="block font-semibold text-tinta underline">
          {subir.isPending ? "Subiendo…" : negocio.logo_url ? "Cambiar logo" : "Subir logo"}
        </button>
        {negocio.logo_url && (
          <button type="button" onClick={() => quitar.mutate()} className="block text-suave hover:text-alerta">Quitar logo</button>
        )}
        <p className="text-suave">Sale en el menú QR, los recibos y la barra de la app. Mejor cuadrado.</p>
        {error && <Aviso>{error.message}</Aviso>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { e.target.files?.[0] && subir.mutate(e.target.files[0]); e.target.value = ""; }}
      />
    </div>
  );
}

export default function Ajustes() {
  const { negocio, actualizarNegocio } = useSesion();
  const [f, setF] = useState(() => ({
    nombre: negocio.nombre,
    nit: negocio.nit || "",
    telefono: negocio.telefono || "",
    direccion: negocio.direccion || "",
    mensaje_recibo: negocio.mensaje_recibo || "",
    color_primario: negocio.color_primario,
    color_acento: negocio.color_acento,
    medios_pago: negocio.medios_pago_activos,
    usa_caja: negocio.usa_caja,
    usa_cola_pedidos: negocio.usa_cola_pedidos,
    permitir_fiado: negocio.permitir_fiado,
    bloquear_sin_stock: negocio.bloquear_sin_stock,
  }));
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? (v.target.type === "checkbox" ? v.target.checked : v.target.value) : v }));
  const problema = problemaMarca(f.color_primario, f.color_acento);
  const paletaActual = PALETAS.find((p) => p.primario === f.color_primario && p.acento === f.color_acento);
  const toggleMedio = (m) =>
    setF((x) => ({ ...x, medios_pago: x.medios_pago.includes(m) ? x.medios_pago.filter((y) => y !== m) : [...x.medios_pago, m] }));

  const guardar = useMutation({
    mutationFn: () => api("/mi-negocio/", { method: "PATCH", body: { ...f, nombre: f.nombre.trim() } }),
    onSuccess: actualizarNegocio,
  });
  const sinMedios = f.medios_pago.length === 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 lg:px-8 lg:py-8">
      <h1 className="font-display text-3xl font-bold text-tinta">Ajustes</h1>
      <p className="mt-1 text-suave">Así se ve y así funciona {negocio.nombre}.</p>

      <form onSubmit={(e) => { e.preventDefault(); guardar.mutate(); }} className="mt-6">
        <Seccion titulo="Marca" descripcion="Tu logo y tus colores aparecen en la app, en el menú QR y en los recibos que envías.">
          <div className="space-y-6">
            <Logo negocio={negocio} onListo={actualizarNegocio} />

            <div>
              <p className="mb-2 text-sm font-semibold">Paletas listas</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PALETAS.map((p) => {
                  const activa = paletaActual?.nombre === p.nombre;
                  return (
                    <button
                      type="button"
                      key={p.nombre}
                      onClick={() => setF((x) => ({ ...x, color_primario: p.primario, color_acento: p.acento }))}
                      aria-pressed={activa}
                      className={`flex items-center gap-2.5 rounded-lg border-2 bg-papel p-2 text-left text-sm font-medium ${
                        activa ? "border-tinta" : "border-linea hover:border-tinta/40"
                      }`}
                    >
                      <span className="flex shrink-0 overflow-hidden rounded-md" aria-hidden>
                        <span className="h-8 w-5" style={{ background: p.primario }} />
                        <span className="h-8 w-5" style={{ background: p.acento }} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{p.nombre}</span>
                      {activa && <Check size={16} className="shrink-0 text-tinta" aria-hidden />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-[1fr_260px]">
              <div className="space-y-3">
                <p className="text-sm font-semibold">O usa tus propios colores</p>
                <SelectorColor etiqueta="Color principal (menús y botones)" valor={f.color_primario} onCambio={set("color_primario")} />
                <SelectorColor etiqueta="Color de acento (precios)" valor={f.color_acento} onCambio={set("color_acento")} />
                {problema ? (
                  <Aviso tipo="info">{problema}</Aviso>
                ) : (
                  <p className="text-sm text-ok">Se lee bien: el texto tiene buen contraste.</p>
                )}
              </div>
              <VistaPrevia nombre={f.nombre} logo={negocio.logo_url} primario={problema ? negocio.color_primario : f.color_primario} acento={problema ? negocio.color_acento : f.color_acento} />
            </div>
          </div>
        </Seccion>

        <Seccion titulo="Datos del negocio" descripcion="Salen en los recibos y en el menú QR.">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-semibold">Nombre</span>
              <input required value={f.nombre} onChange={set("nombre")} className={campo} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">Teléfono o WhatsApp</span>
              <input value={f.telefono} onChange={set("telefono")} inputMode="tel" className={campo} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">NIT <span className="font-normal text-suave">(opcional)</span></span>
              <input value={f.nit} onChange={set("nit")} className={campo} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-semibold">Dirección</span>
              <input value={f.direccion} onChange={set("direccion")} className={campo} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-semibold">Mensaje al final del recibo</span>
              <input value={f.mensaje_recibo} onChange={set("mensaje_recibo")} maxLength={200} className={campo} />
            </label>
          </div>
        </Seccion>

        <Seccion titulo="Cómo cobras" descripcion="Los medios que aparecen al cobrar en el POS.">
          <div className="flex flex-wrap gap-2">
            {Object.entries(MEDIOS).map(([m, t]) => {
              const on = f.medios_pago.includes(m);
              return (
                <button
                  type="button"
                  key={m}
                  onClick={() => toggleMedio(m)}
                  aria-pressed={on}
                  className={`inline-flex items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-semibold ${
                    on ? "border-tinta bg-tinta text-white" : "border-linea bg-papel text-suave"
                  }`}
                >
                  {on && <Check size={15} aria-hidden />} {t}
                </button>
              );
            })}
          </div>
          {sinMedios && <p className="mt-2 text-sm text-alerta">Deja al menos un medio de pago.</p>}
        </Seccion>

        <Seccion titulo="Cómo trabaja el negocio">
          <div className="space-y-2">
            {[
              ["usa_cola_pedidos", "Cola de pedidos", "Cada venta entra a Pedidos con su turno hasta marcarla entregada."],
              ["permitir_fiado", "Fiar a clientes", "Permite vender a crédito a clientes registrados."],
              ["usa_caja", "Caja registradora", "Abrir la caja con una base y cerrarla contando el efectivo. Apagado: se cuadra por día."],
              ["bloquear_sin_stock", "No vender sin inventario", "Impide vender un producto cuando su inventario llega a cero."],
            ].map(([k, t, d]) => (
              <label key={k} className="flex cursor-pointer items-start gap-3 rounded-xl border border-linea bg-papel p-4">
                <input type="checkbox" checked={f[k]} onChange={set(k)} className="mt-0.5 h-5 w-5 shrink-0 accent-tinta" />
                <span>
                  <span className="block font-semibold">{t}</span>
                  <span className="block text-sm text-suave">{d}</span>
                </span>
              </label>
            ))}
          </div>
        </Seccion>

        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-linea bg-fondo/95 px-4 py-4 backdrop-blur lg:-mx-8 lg:px-8">
          {guardar.error && <div className="flex-1"><Aviso>{guardar.error.message}</Aviso></div>}
          {guardar.isSuccess && !guardar.isPending && <p className="text-sm font-semibold text-ok">Cambios guardados.</p>}
          <Boton disabled={guardar.isPending || Boolean(problema) || sinMedios || !f.nombre.trim()}>
            {guardar.isPending ? "Guardando…" : "Guardar cambios"}
          </Boton>
        </div>
      </form>
    </div>
  );
}
