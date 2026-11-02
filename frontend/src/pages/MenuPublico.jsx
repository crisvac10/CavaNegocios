import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { MapPin, Phone } from "lucide-react";
import { api } from "../lib/api";
import { pesos } from "../lib/formato";
import { aplicarMarca } from "../lib/marca";

/** Menú digital público (QR). Solo lectura: el pedido se hace en caja. */
export default function MenuPublico() {
  const { slug } = useParams();
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState("");
  const [activa, setActiva] = useState(null);

  useEffect(() => {
    api(`/public/menu/${slug}/`)
      .then((m) => { aplicarMarca(m.negocio); setMenu(m); document.title = `Menú · ${m.negocio.nombre}`; })
      .catch((e) => setError(e.estado === 404 ? "Este menú no está disponible." : e.message));
  }, [slug]);

  if (error) return <p className="grid min-h-dvh place-items-center p-8 text-center text-suave">{error}</p>;
  if (!menu) return <p className="grid min-h-dvh place-items-center text-suave">Cargando menú…</p>;

  const { negocio, categorias } = menu;
  const ir = (id) => {
    setActiva(id);
    document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-dvh bg-fondo">
      <header className="bg-tinta px-5 pb-8 pt-10 text-white">
        <div className="mx-auto max-w-2xl">
          {negocio.logo_url && <img src={negocio.logo_url} alt="" className="mb-4 h-16 w-16 rounded-full border-2 border-white/30 object-cover" />}
          <h1 className="font-display text-4xl font-extrabold leading-tight">{negocio.nombre}</h1>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-white/75">
            {negocio.direccion && <span className="inline-flex items-center gap-1.5"><MapPin size={15} aria-hidden />{negocio.direccion}</span>}
            {negocio.telefono && (
              <a href={`tel:${negocio.telefono}`} className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline">
                <Phone size={15} aria-hidden />{negocio.telefono}
              </a>
            )}
          </div>
        </div>
      </header>

      {categorias.length > 1 && (
        <nav className="sticky top-0 z-10 border-b border-linea bg-papel/95 backdrop-blur" aria-label="Secciones del menú">
          <div className="mx-auto flex max-w-2xl gap-2 overflow-x-auto px-5 py-3">
            {categorias.map((c) => (
              <button
                key={c.id ?? "otros"}
                onClick={() => ir(c.id ?? "otros")}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
                  activa === (c.id ?? "otros") ? "bg-tinta text-white" : "bg-fondo text-tinta"
                }`}
              >
                {c.nombre}
              </button>
            ))}
          </div>
        </nav>
      )}

      <main className="mx-auto max-w-2xl px-5 pb-16">
        {categorias.length === 0 && <p className="py-16 text-center text-suave">El menú se está preparando. Pregunta en caja.</p>}
        {categorias.map((c) => (
          <section key={c.id ?? "otros"} id={`cat-${c.id ?? "otros"}`} className="scroll-mt-20 pt-8">
            <h2 className="font-display text-2xl font-bold text-tinta">{c.nombre}</h2>
            <ul className="mt-3 divide-y divide-linea rounded-2xl bg-papel">
              {c.productos.map((p) => (
                <li key={p.id} className={`flex gap-4 p-4 ${p.agotado ? "opacity-55" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[17px] font-semibold leading-snug">{p.nombre}</h3>
                    {p.descripcion && <p className="mt-1 text-sm leading-relaxed text-suave">{p.descripcion}</p>}
                    <p className="mt-2.5 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-precio px-2 py-0.5 font-display font-bold text-tinta num">
                        <span className="h-1.5 w-1.5 rounded-full bg-tinta/70" aria-hidden />
                        {pesos(p.precio)}
                      </span>
                      {p.agotado && <span className="text-sm font-semibold text-alerta">Agotado</span>}
                    </p>
                  </div>
                  {p.foto_url && (
                    <img src={p.foto_url} alt={p.nombre} loading="lazy" className="h-24 w-24 shrink-0 rounded-xl object-cover sm:h-28 sm:w-28" />
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="mt-10 text-center text-sm text-suave">{menu.nota}</p>
        <p className="mt-1 text-center text-xs text-suave/70">Menú digital con CavaNegocios</p>
      </main>
    </div>
  );
}
