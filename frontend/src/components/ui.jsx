import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/** Hoja modal: en celular sube desde abajo, en pantallas grandes queda centrada. */
export function Hoja({ titulo, onCerrar, children, ancho = "max-w-lg" }) {
  const ref = useRef(null);
  useEffect(() => {
    const tecla = (e) => e.key === "Escape" && onCerrar();
    document.addEventListener("keydown", tecla);
    ref.current?.querySelector("input, button[data-autofocus]")?.focus();
    return () => document.removeEventListener("keydown", tecla);
  }, [onCerrar]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={titulo}>
      <button className="absolute inset-0 bg-tinta/45" onClick={onCerrar} aria-label="Cerrar" tabIndex={-1} />
      <div
        ref={ref}
        className={`relative max-h-[92dvh] w-full ${ancho} overflow-y-auto rounded-t-2xl bg-papel p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-2xl`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold text-tinta">{titulo}</h2>
          <button onClick={onCerrar} className="rounded-full p-2 text-suave hover:bg-fondo" aria-label="Cerrar">
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Aviso({ tipo = "error", children }) {
  const estilos = {
    error: "bg-alerta-claro text-alerta",
    ok: "bg-ok-claro text-ok",
    info: "bg-precio-claro text-tinta",
  };
  return (
    <p className={`rounded-lg px-4 py-3 text-sm ${estilos[tipo]}`} role={tipo === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

export function Boton({ variante = "primario", className = "", ...props }) {
  const v = {
    primario: "bg-tinta text-white hover:bg-tinta-2",
    ok: "bg-ok text-white hover:brightness-110",
    suave: "bg-fondo text-tinta hover:bg-linea",
    borde: "border border-linea bg-papel text-tinta hover:bg-fondo",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${v[variante]} ${className}`}
      {...props}
    />
  );
}

/** Input de dinero: muestra 12.500 mientras se escribe y entrega el número. */
export function InputPesos({ valor, onCambio, className = "", ...props }) {
  return (
    <div className={`flex items-center rounded-lg border border-linea bg-papel focus-within:border-tinta ${className}`}>
      <span className="pl-3 text-suave">$</span>
      <input
        inputMode="numeric"
        value={valor ? new Intl.NumberFormat("es-CO").format(valor) : ""}
        onChange={(e) => onCambio(Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
        className="w-full bg-transparent px-2 py-3 text-right font-semibold num outline-none"
        {...props}
      />
    </div>
  );
}
