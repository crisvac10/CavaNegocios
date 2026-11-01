import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, Minus, Plus, Search, Share2, ShoppingBasket, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { numero, pesos } from "../lib/formato";
import { useSesion } from "../context/Sesion";
import Cobro from "../components/Cobro";
import { Aviso, Boton, Hoja, InputPesos } from "../components/ui";

/* ---------- Producto como etiqueta de precio ---------- */
function Etiqueta({ p, cantidad, onAgregar, conFotos }) {
  const agotado = p.controla_stock && Number(p.stock) <= 0;
  return (
    <button
      onClick={() => onAgregar(p)}
      className={`group relative flex min-h-28 flex-col justify-between rounded-xl border bg-papel p-3 text-left transition active:scale-[0.97] ${
        cantidad ? "border-tinta ring-2 ring-tinta" : "border-linea hover:border-tinta/40"
      }`}
    >
      {p.foto_url ? (
        <img src={p.foto_url} alt="" loading="lazy" className="-mx-3 -mt-3 mb-2.5 h-24 w-[calc(100%+1.5rem)] max-w-none rounded-t-[11px] object-cover" />
      ) : conFotos ? (
        // Si otros productos tienen foto, este conserva la misma altura con sus iniciales
        <span className="-mx-3 -mt-3 mb-2.5 grid h-24 w-[calc(100%+1.5rem)] place-items-center rounded-t-[11px] bg-fondo font-display text-3xl font-extrabold text-tinta/25" aria-hidden>
          {p.nombre.split(" ").filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
        </span>
      ) : null}
      <span className="line-clamp-2 pr-6 font-semibold leading-snug">{p.nombre}</span>
      <span className="mt-3 flex items-end justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-precio px-2 py-1 font-display text-[15px] font-bold text-tinta num">
          <span className="h-1.5 w-1.5 rounded-full bg-tinta/70" aria-hidden />
          {pesos(p.precio)}
        </span>
        {p.controla_stock && (
          <span className={`text-xs num ${agotado ? "font-semibold text-alerta" : p.stock_bajo ? "text-alerta" : "text-suave"}`}>
            {agotado ? "Agotado" : `${numero(p.stock)} ${p.unidad}`}
          </span>
        )}
      </span>
      {cantidad > 0 && (
        <span className="absolute right-2 top-2 grid h-7 min-w-7 place-items-center rounded-full bg-tinta px-1.5 text-sm font-bold text-white num">
          {numero(cantidad)}
        </span>
      )}
    </button>
  );
}

/* ---------- La cuenta, con forma de recibo ---------- */
function Cuenta({
  lineas, subtotal, descuento, total, onCantidad, onQuitar, onDescuento, onVaciar, onCobrar, puedeVender,
  nota, onNota, usaCola, entregarYa, onEntregarYa,
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 rounded-t-xl bg-papel px-4 pt-4 shadow-[0_1px_0_var(--color-linea)]">
        <div className="flex items-baseline justify-between border-b border-dashed border-linea pb-3">
          <h2 className="font-display text-lg font-bold text-tinta">Cuenta</h2>
          {lineas.length > 0 && (
            <button onClick={onVaciar} className="text-sm text-suave hover:text-alerta">Vaciar</button>
          )}
        </div>
        {lineas.length === 0 ? (
          <div className="py-10 text-center text-suave">
            <ShoppingBasket size={30} className="mx-auto mb-2 opacity-50" aria-hidden />
            <p>Toca un producto para agregarlo.</p>
          </div>
        ) : (
          <ul className="divide-y divide-dashed divide-linea">
            {lineas.map(({ p, cantidad }) => (
              <li key={p.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium leading-snug">{p.nombre}</span>
                  <span className="font-semibold num">{pesos(p.precio * cantidad)}</span>
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <button
                    onClick={() => onCantidad(p.id, cantidad - 1)}
                    className="grid h-9 w-9 place-items-center rounded-lg bg-fondo"
                    aria-label={`Quitar uno de ${p.nombre}`}
                  >
                    <Minus size={16} />
                  </button>
                  <span className="w-10 text-center font-semibold num">{numero(cantidad)}</span>
                  <button
                    onClick={() => onCantidad(p.id, cantidad + 1)}
                    className="grid h-9 w-9 place-items-center rounded-lg bg-fondo"
                    aria-label={`Agregar uno de ${p.nombre}`}
                  >
                    <Plus size={16} />
                  </button>
                  <span className="ml-2 text-sm text-suave num">× {pesos(p.precio)}</span>
                  <button
                    onClick={() => onQuitar(p.id)}
                    className="ml-auto grid h-9 w-9 place-items-center rounded-lg text-suave hover:text-alerta"
                    aria-label={`Eliminar ${p.nombre}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-papel px-4 pb-4">
        {lineas.length > 0 && (
          <div className="space-y-2 border-t border-dashed border-linea pt-3 text-sm">
            <input
              value={nota}
              onChange={(e) => onNota(e.target.value)}
              maxLength={200}
              placeholder="Nota del pedido (ej. sin azúcar, para llevar)"
              className="w-full rounded-lg border border-linea px-3 py-2.5 outline-none focus:border-tinta"
              aria-label="Nota del pedido"
            />
            {usaCola && (
              <label className="flex items-center gap-2.5 py-1 text-texto">
                <input type="checkbox" checked={entregarYa} onChange={(e) => onEntregarYa(e.target.checked)} className="h-4 w-4 accent-tinta" />
                Se entrega de una vez (no pasa a la cola)
              </label>
            )}
            <div className="flex justify-between text-suave"><span>Subtotal</span><span className="num">{pesos(subtotal)}</span></div>
            <label className="flex items-center justify-between gap-3 text-suave">
              <span>Descuento</span>
              <InputPesos className="w-36" valor={descuento} onCambio={onDescuento} aria-label="Descuento" />
            </label>
          </div>
        )}
        <div className="mt-3 flex items-baseline justify-between border-t-2 border-tinta pt-3">
          <span className="font-display text-lg font-bold text-tinta">Total</span>
          <span className="font-display text-3xl font-extrabold text-tinta num">{pesos(total)}</span>
        </div>
        <Boton
          variante="ok"
          className="mt-4 w-full py-4 text-lg"
          disabled={!lineas.length || total < 0 || !puedeVender}
          onClick={onCobrar}
        >
          Cobrar
        </Boton>
      </div>
      <div className="filo-recibo" aria-hidden />
    </div>
  );
}

/* ---------- Abrir caja (solo negocios con caja registradora) ---------- */
function AbrirCaja({ onCerrar }) {
  const qc = useQueryClient();
  const [base, setBase] = useState(0);
  const abrir = useMutation({
    mutationFn: () => api("/caja/abrir/", { method: "POST", body: { base_inicial: base } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["caja"] }); onCerrar(); },
  });
  return (
    <Hoja titulo="Abrir caja" onCerrar={onCerrar}>
      <p className="mb-3 text-suave">¿Con cuánto efectivo empieza la caja?</p>
      <InputPesos valor={base} onCambio={setBase} aria-label="Base inicial" />
      {abrir.error && <div className="mt-3"><Aviso>{abrir.error.message}</Aviso></div>}
      <Boton className="mt-4 w-full" onClick={() => abrir.mutate()} disabled={abrir.isPending}>Abrir caja</Boton>
    </Hoja>
  );
}

/* ---------- Venta registrada ---------- */
function VentaLista({ venta, onNueva }) {
  return (
    <Hoja titulo="Venta registrada" onCerrar={onNueva}>
      <div className="text-center">
        <CheckCircle2 size={44} className="mx-auto text-ok" aria-hidden />
        {venta.turno && !venta.entregado_en ? (
          <p className="mx-auto mt-3 w-fit rounded-xl bg-precio px-5 py-2 text-tinta">
            Turno <span className="font-display text-3xl font-extrabold num">{venta.turno}</span>
          </p>
        ) : null}
        <p className="mt-2 text-suave">Recibo #{venta.numero}</p>
        <p className="font-display text-4xl font-extrabold text-tinta num">{pesos(venta.total)}</p>
        {Number(venta.cambio) > 0 && (
          <p className="mx-auto mt-4 max-w-xs rounded-xl bg-ok-claro px-4 py-3 text-ok">
            Devuelve <span className="font-display text-2xl font-extrabold num">{pesos(venta.cambio)}</span>
          </p>
        )}
        {Number(venta.saldo_pendiente) > 0 && (
          <p className="mx-auto mt-4 max-w-xs rounded-xl bg-precio-claro px-4 py-3 text-tinta">
            {venta.cliente_nombre} queda debiendo <strong className="num">{pesos(venta.saldo_pendiente)}</strong>
          </p>
        )}
      </div>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <a href={venta.whatsapp_recibo} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg border border-linea py-3 font-semibold text-tinta hover:bg-fondo">
          <Share2 size={18} aria-hidden /> Enviar recibo
        </a>
        <Boton onClick={onNueva} data-autofocus>Nueva venta</Boton>
      </div>
    </Hoja>
  );
}

/* ---------- Página ---------- */
export default function Vender() {
  const { negocio, esAdmin, tieneModulo } = useSesion();
  const qc = useQueryClient();
  const [categoria, setCategoria] = useState("todas");
  const [busqueda, setBusqueda] = useState("");
  const [carrito, setCarrito] = useState({}); // id -> cantidad
  const [descuento, setDescuento] = useState(0);
  const [nota, setNota] = useState("");
  const [entregarYa, setEntregarYa] = useState(false);
  const [cobrando, setCobrando] = useState(false);
  const [cuentaMovil, setCuentaMovil] = useState(false);
  const [abrirCaja, setAbrirCaja] = useState(false);
  const [ventaLista, setVentaLista] = useState(null);

  const { data: categorias = [] } = useQuery({ queryKey: ["categorias"], queryFn: () => api("/categorias/") });
  const { data: productos = [], isLoading, error } = useQuery({
    queryKey: ["productos", "pos"],
    queryFn: () => api("/productos/", { query: { activos: 1 } }),
  });
  const { data: caja } = useQuery({
    queryKey: ["caja", "actual"],
    queryFn: () => api("/caja/actual/"),
    enabled: Boolean(negocio?.usa_caja),
  });
  const cajaCerrada = negocio?.usa_caja && caja && !caja.abierta;

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter(
      (p) =>
        (categoria === "todas" || p.categoria === categoria) &&
        (!q || p.nombre.toLowerCase().includes(q) || p.codigo?.toLowerCase() === q)
    );
  }, [productos, categoria, busqueda]);

  const conFotos = visibles.some((p) => p.foto_url);
  const lineas = Object.entries(carrito)
    .map(([id, cantidad]) => ({ p: productos.find((x) => x.id === Number(id)), cantidad }))
    .filter((l) => l.p);
  const subtotal = lineas.reduce((s, l) => s + l.p.precio * l.cantidad, 0);
  const total = Math.max(subtotal - descuento, 0);
  const unidades = lineas.reduce((s, l) => s + l.cantidad, 0);

  const agregar = (p) => setCarrito((c) => ({ ...c, [p.id]: (c[p.id] || 0) + 1 }));
  const fijarCantidad = (id, n) =>
    setCarrito((c) => {
      const copia = { ...c };
      if (n <= 0) delete copia[id];
      else copia[id] = n;
      return copia;
    });
  const vaciar = () => { setCarrito({}); setDescuento(0); setNota(""); setEntregarYa(false); };
  const usaCola = tieneModulo("pedidos") && negocio?.usa_cola_pedidos;

  const alVender = (venta) => {
    setCobrando(false);
    setCuentaMovil(false);
    setVentaLista(venta);
    vaciar();
    qc.invalidateQueries({ queryKey: ["productos"] });
    qc.invalidateQueries({ queryKey: ["caja"] });
    qc.invalidateQueries({ queryKey: ["clientes"] });
    qc.invalidateQueries({ queryKey: ["pedidos"] });
  };

  const propsCuenta = {
    lineas, subtotal, descuento, total,
    onCantidad: fijarCantidad,
    onQuitar: (id) => fijarCantidad(id, 0),
    onDescuento: (v) => setDescuento(Math.min(v, subtotal)),
    onVaciar: vaciar,
    onCobrar: () => setCobrando(true),
    puedeVender: !cajaCerrada,
    nota, onNota: setNota, usaCola, entregarYa, onEntregarYa: setEntregarYa,
  };

  return (
    <div className="lg:grid lg:h-dvh lg:grid-cols-[1fr_380px]">
      {/* Catálogo */}
      <section className="min-w-0 px-4 pt-4 lg:overflow-y-auto lg:px-6 lg:pt-6">
        {cajaCerrada && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-precio-claro px-4 py-3">
            <p className="font-medium">La caja está cerrada. Ábrela para empezar a vender.</p>
            <Boton onClick={() => setAbrirCaja(true)} className="py-2">Abrir caja</Boton>
          </div>
        )}

        <div className="sticky top-14 z-10 md:top-0 -mx-4 bg-fondo/95 px-4 pb-3 pt-1 backdrop-blur lg:-mx-6 lg:px-6">
          <div className="flex items-center gap-2 rounded-xl border border-linea bg-papel px-3 focus-within:border-tinta">
            <Search size={19} className="text-suave" aria-hidden />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar producto o código"
              className="w-full bg-transparent py-3 outline-none"
              aria-label="Buscar producto"
            />
          </div>
          {categorias.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Categorías">
              {[{ id: "todas", nombre: "Todo" }, ...categorias.filter((c) => c.activa)].map((c) => (
                <button
                  key={c.id}
                  role="tab"
                  aria-selected={categoria === c.id}
                  onClick={() => setCategoria(c.id)}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
                    categoria === c.id ? "bg-tinta text-white" : "bg-papel text-tinta"
                  }`}
                >
                  {c.nombre}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <Aviso>{error.message}</Aviso>}
        {isLoading ? (
          <p className="py-10 text-center text-suave">Cargando productos…</p>
        ) : productos.length === 0 ? (
          <div className="py-12 text-center">
            <p className="font-display text-xl font-bold text-tinta">Aún no hay productos</p>
            <p className="mt-1 text-suave">Crea tu menú para empezar a vender.</p>
            {esAdmin && (
              <Link to="/productos" className="mt-4 inline-block rounded-lg bg-tinta px-5 py-3 font-semibold text-white">
                Crear productos
              </Link>
            )}
          </div>
        ) : visibles.length === 0 ? (
          <p className="py-10 text-center text-suave">Nada coincide con “{busqueda}”.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 pb-28 sm:grid-cols-3 xl:grid-cols-4 lg:pb-6">
            {visibles.map((p) => (
              <Etiqueta key={p.id} p={p} cantidad={carrito[p.id] || 0} onAgregar={agregar} conFotos={conFotos} />
            ))}
          </div>
        )}
      </section>

      {/* Cuenta fija (pantallas grandes) */}
      <aside className="hidden border-l border-linea bg-fondo p-4 lg:block lg:overflow-y-auto">
        <Cuenta {...propsCuenta} />
      </aside>

      {/* Barra de cuenta (celular / tablet) */}
      {lineas.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:pl-[calc(14rem+0.75rem)] lg:hidden">
          <button
            onClick={() => setCuentaMovil(true)}
            className="flex w-full items-center justify-between rounded-xl bg-tinta px-5 py-4 text-white shadow-lg"
          >
            <span className="font-semibold">Ver cuenta · {numero(unidades)} {unidades === 1 ? "producto" : "productos"}</span>
            <span className="font-display text-xl font-extrabold num">{pesos(total)}</span>
          </button>
        </div>
      )}
      {cuentaMovil && (
        <Hoja titulo="Revisar venta" onCerrar={() => setCuentaMovil(false)}>
          <div className="-mx-5 -mb-5 bg-fondo px-3 pb-3 pt-1">
            <Cuenta {...propsCuenta} />
          </div>
        </Hoja>
      )}

      {cobrando && (
        <Cobro
          total={total}
          descuento={descuento}
          negocio={negocio}
          items={lineas.map(({ p, cantidad }) => ({ producto: p.id, cantidad }))}
          extra={{ nota, entregar_ya: entregarYa }}
          onListo={alVender}
          onCerrar={() => setCobrando(false)}
        />
      )}
      {abrirCaja && <AbrirCaja onCerrar={() => setAbrirCaja(false)} />}
      {ventaLista && <VentaLista venta={ventaLista} onNueva={() => setVentaLista(null)} />}
    </div>
  );
}
