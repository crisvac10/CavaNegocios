import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useSesion } from "./Sesion";

/*
 * El pedido que se está armando en Vender vive aquí y no dentro de la página:
 * si el cajero cambia de pestaña (Pedidos, Hoy…) o recarga, el pedido sigue ahí.
 * Se guarda también en el navegador, por negocio (el localStorage puede fallar en
 * modo privado: entonces solo dura mientras la app esté abierta).
 */
const Ctx = createContext(null);
const VACIO = { carrito: {}, descuento: 0, nota: "", entregarYa: false, mesa: "" };

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
    vaciar: () => setEstado(VACIO),
  }), [estado]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export const useCarrito = () => useContext(Ctx);
