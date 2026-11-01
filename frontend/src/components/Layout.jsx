import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  BarChart3, Boxes, CalendarCheck, HandCoins, Landmark, LogOut, Menu, Receipt, Settings, ShoppingBasket, X,
} from "lucide-react";
import { useSesion } from "../context/Sesion";

const NAV = [
  { a: "/vender", texto: "Vender", Icono: ShoppingBasket, modulo: "pos" },
  { a: "/hoy", texto: "Hoy", Icono: CalendarCheck, modulo: "caja" },
  { a: "/fiados", texto: "Fiados", Icono: HandCoins, modulo: "fiados" },
  { a: "/gastos", texto: "Gastos", Icono: Receipt, modulo: "gastos" },
  { a: "/productos", texto: "Productos", Icono: Boxes, modulo: "catalogo", admin: true },
  { a: "/reportes", texto: "Reportes", Icono: BarChart3, modulo: "reportes", admin: true },
  { a: "/creditos", texto: "Créditos", Icono: Landmark, modulo: "creditos", admin: true },
  { a: "/ajustes", texto: "Ajustes", Icono: Settings, admin: true },
];

export default function Layout() {
  const { usuario, negocio, esAdmin, tieneModulo, salir } = useSesion();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const items = NAV.filter((i) => (!i.modulo || tieneModulo(i.modulo)) && (!i.admin || esAdmin));
  const principales = items.slice(0, 3);

  return (
    <div className="min-h-dvh md:pl-56">
      {/* Barra lateral (tablet / PC) */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col bg-tinta text-white md:flex">
        <div className="px-5 pb-6 pt-6">
          <p className="font-display text-xl font-bold leading-tight">{negocio?.nombre}</p>
          <p className="mt-1 text-sm text-white/60">{usuario?.nombre}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Principal">
          {items.map(({ a, texto, Icono }) => (
            <NavLink
              key={a}
              to={a}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium transition-colors ${
                  isActive ? "bg-white text-tinta" : "text-white/80 hover:bg-white/10 hover:text-white"
                }`
              }
            >
              <Icono size={19} strokeWidth={2} aria-hidden />
              {texto}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => salir()}
          className="m-3 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
        >
          <LogOut size={18} aria-hidden /> Cerrar sesión
        </button>
        <p className="px-5 pb-4 text-xs text-white/40">CavaNegocios · CavaTech</p>
      </aside>

      <main className="pb-20 md:pb-0">
        <Outlet />
      </main>

      {/* Barra inferior (celular) */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-linea bg-papel pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Principal"
      >
        {principales.map(({ a, texto, Icono }) => (
          <NavLink
            key={a}
            to={a}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-semibold ${isActive ? "text-tinta" : "text-suave"}`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`rounded-full px-4 py-1 ${isActive ? "bg-precio-claro" : ""}`}>
                  <Icono size={21} aria-hidden />
                </span>
                {texto}
              </>
            )}
          </NavLink>
        ))}
        <button
          onClick={() => setMenuAbierto(true)}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-semibold text-suave"
        >
          <span className="px-4 py-1"><Menu size={21} aria-hidden /></span>
          Más
        </button>
      </nav>

      {menuAbierto && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button className="absolute inset-0 bg-tinta/40" onClick={() => setMenuAbierto(false)} aria-label="Cerrar menú" />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-papel p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-display text-lg font-bold text-tinta">{negocio?.nombre}</p>
                <p className="text-sm text-suave">{usuario?.nombre}</p>
              </div>
              <button onClick={() => setMenuAbierto(false)} className="rounded-full p-2 hover:bg-fondo" aria-label="Cerrar">
                <X size={22} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {items.slice(3).map(({ a, texto, Icono }) => (
                <NavLink
                  key={a}
                  to={a}
                  onClick={() => setMenuAbierto(false)}
                  className="flex flex-col items-center gap-1.5 rounded-xl bg-fondo py-4 text-sm font-semibold text-tinta"
                >
                  <Icono size={22} aria-hidden />
                  {texto}
                </NavLink>
              ))}
            </div>
            <button
              onClick={() => salir()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-alerta"
            >
              <LogOut size={18} aria-hidden /> Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
