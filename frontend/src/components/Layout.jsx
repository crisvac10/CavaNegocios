import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, Boxes, CalendarCheck, ChefHat, HandCoins, Landmark, LogOut, Menu, Receipt, Settings, ShoppingBasket, X,
} from "lucide-react";
import { api } from "../lib/api";
import { useSesion } from "../context/Sesion";

const NAV = [
  { a: "/vender", texto: "Vender", Icono: ShoppingBasket, modulo: "pos" },
  { a: "/pedidos", texto: "Pedidos", Icono: ChefHat, modulo: "pedidos", cola: true },
  { a: "/hoy", texto: "Hoy", Icono: CalendarCheck, modulo: "caja" },
  { a: "/fiados", texto: "Fiados", Icono: HandCoins, modulo: "fiados" },
  { a: "/gastos", texto: "Gastos", Icono: Receipt, modulo: "gastos" },
  { a: "/productos", texto: "Productos", Icono: Boxes, modulo: "catalogo", admin: true },
  { a: "/reportes", texto: "Reportes", Icono: BarChart3, modulo: "reportes", admin: true },
  { a: "/creditos", texto: "Créditos", Icono: Landmark, modulo: "creditos", admin: true },
  { a: "/ajustes", texto: "Ajustes", Icono: Settings, admin: true },
];

/** Contenido del menú: el mismo en la barra lateral (PC) y en el menú hamburguesa (celular). */
function Navegacion({ items, pendientes, negocio, usuario, onSalir, onIr }) {
  return (
    <>
      <div className="px-5 pb-6 pt-6">
        <p className="font-display text-xl font-bold leading-tight">{negocio?.nombre}</p>
        <p className="mt-1 text-sm text-white/60">{usuario?.nombre}</p>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3" aria-label="Principal">
        {items.map(({ a, texto, Icono }) => (
          <NavLink
            key={a}
            to={a}
            onClick={onIr}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] font-medium transition-colors md:py-2.5 ${
                isActive ? "bg-white text-tinta" : "text-white/80 hover:bg-white/10 hover:text-white"
              }`
            }
          >
            <Icono size={19} strokeWidth={2} aria-hidden />
            {texto}
            {a === "/pedidos" && pendientes > 0 && (
              <span className="ml-auto rounded-full bg-precio px-2 py-0.5 text-xs font-bold text-tinta num">{pendientes}</span>
            )}
          </NavLink>
        ))}
      </nav>
      <button
        onClick={onSalir}
        className="m-3 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
      >
        <LogOut size={18} aria-hidden /> Cerrar sesión
      </button>
      <p className="px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] text-xs text-white/40">CavaNegocios · CavaTech</p>
    </>
  );
}

export default function Layout() {
  const { usuario, negocio, esAdmin, tieneModulo, salir } = useSesion();
  const { pathname } = useLocation();
  const [abierto, setAbierto] = useState(false);

  const usaCola = tieneModulo("pedidos") && negocio?.usa_cola_pedidos;
  const items = NAV.filter(
    (i) => (!i.modulo || tieneModulo(i.modulo)) && (!i.admin || esAdmin) && (!i.cola || usaCola)
  );
  const actual = items.find((i) => pathname.startsWith(i.a));

  // Pedidos pendientes para el contador (la página de Pedidos refresca más seguido)
  const { data: lista = [] } = useQuery({
    queryKey: ["pedidos", "pendientes"],
    queryFn: () => api("/pedidos/"),
    enabled: Boolean(usaCola),
    refetchInterval: 15_000,
  });
  const pendientes = lista.length;

  // El menú se cierra al cambiar de página, con Escape, y bloquea el scroll del fondo mientras está abierto
  useEffect(() => setAbierto(false), [pathname]);
  useEffect(() => {
    if (!abierto) return;
    const tecla = (e) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("keydown", tecla);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", tecla);
      document.body.style.overflow = "";
    };
  }, [abierto]);

  const props = { items, pendientes, negocio, usuario, onSalir: () => salir() };

  return (
    <div className="min-h-dvh md:pl-56">
      {/* Barra lateral fija (tablet / PC) */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col bg-tinta text-white md:flex">
        <Navegacion {...props} />
      </aside>

      {/* Barra superior con menú hamburguesa (celular) */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-1 bg-tinta px-2 pt-[env(safe-area-inset-top)] text-white md:hidden">
        <button
          onClick={() => setAbierto(true)}
          className="grid h-11 w-11 place-items-center rounded-lg hover:bg-white/10"
          aria-label="Abrir menú"
          aria-expanded={abierto}
          aria-controls="menu-movil"
        >
          <Menu size={24} aria-hidden />
        </button>
        <p className="min-w-0 flex-1 truncate font-display text-lg font-bold">{actual?.texto || negocio?.nombre}</p>
        {usaCola && (
          <Link
            to="/pedidos"
            className="relative grid h-11 w-11 place-items-center rounded-lg hover:bg-white/10"
            aria-label={`Pedidos por entregar: ${pendientes}`}
          >
            <ChefHat size={22} aria-hidden />
            {pendientes > 0 && (
              <span className="absolute right-0.5 top-1 grid h-5 min-w-5 place-items-center rounded-full bg-precio px-1 text-[11px] font-bold text-tinta num">
                {pendientes}
              </span>
            )}
          </Link>
        )}
      </header>

      {/* Menú hamburguesa: cajón que sale por la izquierda */}
      <div className={`fixed inset-0 z-50 md:hidden ${abierto ? "" : "pointer-events-none"}`} aria-hidden={!abierto}>
        <button
          className={`absolute inset-0 bg-tinta/50 transition-opacity duration-200 ${abierto ? "opacity-100" : "opacity-0"}`}
          onClick={() => setAbierto(false)}
          aria-label="Cerrar menú"
          tabIndex={abierto ? 0 : -1}
        />
        <div
          id="menu-movil"
          role="dialog"
          aria-modal="true"
          aria-label="Menú"
          className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-tinta pt-[env(safe-area-inset-top)] text-white shadow-2xl transition-transform duration-200 ${
            abierto ? "translate-x-0" : "-translate-x-full"
          }`}
          inert={!abierto}
        >
          <button
            onClick={() => setAbierto(false)}
            className="absolute right-2 top-[calc(0.5rem+env(safe-area-inset-top))] grid h-11 w-11 place-items-center rounded-lg text-white/80 hover:bg-white/10"
            aria-label="Cerrar menú"
          >
            <X size={22} aria-hidden />
          </button>
          <Navegacion {...props} onIr={() => setAbierto(false)} />
        </div>
      </div>

      <main>
        <Outlet />
      </main>
    </div>
  );
}
