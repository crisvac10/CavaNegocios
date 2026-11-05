import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useSesion } from "./Sesion";

/*
 * El pedido que se está armando en Vender vive aquí y no dentro de la página:
 * si el cajero cambia de pestaña (Pedidos, Hoy…) o recarga, el pedido sigue ahí.
 * Se guarda también en el navegador, por negocio (el localStorage puede fallar en
 * modo privado: entonces solo dura mientras la app esté abierta).
 */
const Ctx = createContext(null);
// extras: cosas personalizadas que no están en el catálogo [{id, nombre, precio, cantidad}]
// modo "encargo": se guarda para una fecha con cliente y abono (tienda de regalos)
const VACIO = {
  carrito: {}, extras: [], descuento: 0, nota: "", entregarYa: false, mesa: "",
  modo: "venta", encargo: { cliente: null, fecha: "", abono: 0, medio: "EFECTIVO" },
};

const clave = (negocioId) => `cn_pedido_${negocioId}`;
function leer(negocioId) {
  try {
    const v = JSON.parse(localStorage.getItem(clave(negocioId)) || "null");
    return v && typeof v === "object" ? { ...VACIO, ...v } : VACIO;
  } catch {
    return VACIO;
  }
}

export function CarritoProvider({ children }) {
  const { negocio } = useSesion();
  const id = negocio?.id;
  const [estado, setEstado] = useState(() => (id ? leer(id) : VACIO));

  useEffect(() => { if (id) setEstado(leer(id)); }, [id]);
  useEffect(() => {
    if (!id) return;
    try { localStorage.setItem(clave(id), JSON.stringify(estado)); } catch { /* sin almacenamiento */ }
  }, [id, estado]);

  const valor = useMemo(() => ({
    ...estado,
    setCarrito: (f) => setEstado((e) => ({ ...e, carrito: typeof f === "function" ? f(e.carrito) : f })),
    setDescuento: (v) => setEstado((e) => ({ ...e, descuento: v })),
    setNota: (v) => setEstado((e) => ({ ...e, nota: v })),
    setEntregarYa: (v) => setEstado((e) => ({ ...e, entregarYa: v })),
    setMesa: (v) => setEstado((e) => ({ ...e, mesa: v })),
    setExtras: (f) => setEstado((e) => ({ ...e, extras: typeof f === "function" ? f(e.extras) : f })),
    setModo: (v) => setEstado((e) => ({ ...e, modo: v })),
    setEncargo: (cambios) => setEstado((e) => ({ ...e, encargo: { ...e.encargo, ...cambios } })),
    vaciar: () => setEstado(VACIO),
  }), [estado]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export const useCarrito = () => useContext(Ctx);
