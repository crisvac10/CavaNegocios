import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Camera, Copy, Download, ExternalLink, ImageOff, PackagePlus, Plus, Search, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { numero, pesos } from "../lib/formato";
import { useSesion } from "../context/Sesion";
import { Aviso, Boton, Hoja, InputPesos } from "../components/ui";

const campo = "w-full rounded-lg border border-linea bg-papel px-3 py-2.5 outline-none focus:border-tinta";

const AJUSTES = {
  AJUSTE_ENTRADA: "Entró mercancía",
  MERMA: "Se dañó o venció",
  CONSUMO_INTERNO: "Consumo interno",
  AJUSTE_SALIDA: "Corrección: sobra en el sistema",
};

/* ---------- Foto ---------- */
function Foto({ url, onElegir, onQuitar }) {
  const input = useRef(null);
  const [rota, setRota] = useState(false);
  useEffect(() => setRota(false), [url]);
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-xl border-2 border-dashed border-linea bg-fondo text-suave hover:border-tinta"
        aria-label="Elegir foto"
      >
        {url && !rota ? (
          <img src={url} alt="" className="h-full w-full object-cover" onError={() => setRota(true)} />
        ) : (
          <Camera size={28} aria-hidden />
        )}
      </button>
      <div className="space-y-2 text-sm">
        <button type="button" onClick={() => input.current?.click()} className="block font-semibold text-tinta underline">
          {url ? "Cambiar foto" : "Agregar foto"}
        </button>
        {url && (
          <button type="button" onClick={onQuitar} className="block text-suave hover:text-alerta">Quitar foto</button>
        )}
        {rota ? (
          <p className="font-medium text-alerta">La foto guardada no carga. Súbela de nuevo.</p>
        ) : (
          <p className="text-suave">Una foto cuadrada y con buena luz se ve mejor en el menú.</p>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onElegir(e.target.files[0])}
      />
    </div>
  );
}

/* ---------- Editor de producto ---------- */
function EditorProducto({ producto, categorias, onCerrar }) {
  const qc = useQueryClient();
  const nuevo = !producto?.id;
  const [f, setF] = useState(() => ({
    nombre: "", categoria: categorias[0]?.id ?? null, precio: 0, costo: 0, descripcion: "", codigo: "",
    controla_stock: true, stock_minimo: 0, unidad: "und", favorito: false, en_menu: true, activo: true,
    stock_inicial: 0,
    ...producto,
  }));
  const [archivo, setArchivo] = useState(null);
  const [vista, setVista] = useState(producto?.foto_url || "");
  const [quitarFoto, setQuitarFoto] = useState(false);
  const [ajuste, setAjuste] = useState({ tipo: "AJUSTE_ENTRADA", cantidad: "", nota: "" });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? (v.target.type === "checkbox" ? v.target.checked : v.target.value) : v }));

  useEffect(() => () => archivo && URL.revokeObjectURL(vista), [archivo, vista]);

  const guardar = useMutation({
    mutationFn: async () => {
      const datos = {
        nombre: f.nombre.trim(), categoria: f.categoria || null, precio: f.precio, costo: f.costo,
        descripcion: f.descripcion, codigo: f.codigo, controla_stock: f.controla_stock,
        stock_minimo: Number(f.stock_minimo) || 0, unidad: f.unidad || "und",
        favorito: f.favorito, en_menu: f.en_menu, activo: f.activo,
      };
      if (nuevo && f.controla_stock && Number(f.stock_inicial) > 0) datos.stock_inicial = Number(f.stock_inicial);
      const p = nuevo
        ? await api("/productos/", { method: "POST", body: datos })
        : await api(`/productos/${producto.id}/`, { method: "PATCH", body: datos });
      if (archivo) {
        const form = new FormData();
        form.append("foto", archivo);
        await api(`/productos/${p.id}/foto/`, { method: "POST", body: form });
      } else if (quitarFoto) {
        await api(`/productos/${p.id}/foto/`, { method: "DELETE" });
      }
      return p;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["productos"] }); onCerrar(); },
  });

  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const eliminar = useMutation({
    mutationFn: () => api(`/productos/${producto.id}/`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["productos"] }); onCerrar(); },
  });

  const ajustar = useMutation({
    mutationFn: () => api("/inventario/", {
      method: "POST",
      body: { producto: producto.id, tipo: ajuste.tipo, cantidad: Number(ajuste.cantidad), nota: ajuste.nota },
    }),
    onSuccess: (mov) => {
      setF((x) => ({ ...x, stock: mov.stock_resultante }));
      setAjuste({ tipo: "AJUSTE_ENTRADA", cantidad: "", nota: "" });
      qc.invalidateQueries({ queryKey: ["productos"] });
    },
  });

  const margen = f.precio - f.costo;
  return (
    <Hoja titulo={nuevo ? "Nuevo producto" : f.nombre || "Producto"} onCerrar={onCerrar} ancho="max-w-xl">
      <form
        className="space-y-4"
        onSubmit={(e) => { e.preventDefault(); guardar.mutate(); }}
      >
        <Foto
          url={vista}
          onElegir={(file) => { setArchivo(file); setVista(URL.createObjectURL(file)); setQuitarFoto(false); }}
          onQuitar={() => { setArchivo(null); setVista(""); setQuitarFoto(true); }}
        />

        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Nombre</span>
          <input required value={f.nombre} onChange={set("nombre")} className={campo} placeholder="Ej. Capuchino" />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Categoría</span>
            <select value={f.categoria ?? ""} onChange={(e) => set("categoria")(e.target.value ? Number(e.target.value) : null)} className={campo}>
              <option value="">Sin categoría</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Código <span className="font-normal text-suave">(opcional)</span></span>
            <input value={f.codigo} onChange={set("codigo")} className={campo} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Precio de venta</span>
            <InputPesos valor={Number(f.precio)} onCambio={set("precio")} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Lo que te cuesta</span>
            <InputPesos valor={Number(f.costo)} onCambio={set("costo")} />
          </label>
        </div>
        {f.precio > 0 && (
          <p className={`text-sm ${margen < 0 ? "text-alerta" : "text-suave"}`}>
            Ganas <strong className="num">{pesos(margen)}</strong> por unidad
            {f.precio ? ` (${Math.round((margen / f.precio) * 100)}%)` : ""}
            {margen < 0 && ": lo estás vendiendo a pérdida"}.
          </p>
        )}

        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Descripción para el menú <span className="font-normal text-suave">(opcional)</span></span>
          <input value={f.descripcion} onChange={set("descripcion")} maxLength={160} className={campo} placeholder="Ej. Espresso con leche espumada" />
        </label>

        <fieldset className="rounded-xl bg-fondo p-4">
          <label className="flex items-center gap-3 font-semibold">
            <input type="checkbox" checked={f.controla_stock} onChange={set("controla_stock")} className="h-5 w-5 accent-tinta" />
            Llevar inventario de este producto
          </label>
          {f.controla_stock && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {nuevo ? (
                <label className="block">
                  <span className="mb-1.5 block text-sm">Hay ahora</span>
                  <input inputMode="decimal" value={f.stock_inicial} onChange={set("stock_inicial")} className={campo} />
                </label>
              ) : (
                <div>
                  <span className="mb-1.5 block text-sm">Hay ahora</span>
                  <p className="py-2.5 font-display text-xl font-bold num">{numero(f.stock)} {f.unidad}</p>
                </div>
              )}
              <label className="block">
                <span className="mb-1.5 block text-sm">Avisar cuando queden</span>
                <input inputMode="decimal" value={f.stock_minimo} onChange={set("stock_minimo")} className={campo} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm">Unidad</span>
                <input value={f.unidad} onChange={set("unidad")} className={campo} placeholder="und, kg, lt" />
              </label>
            </div>
          )}
        </fieldset>

        <div className="flex flex-wrap gap-2">
          {[["favorito", "Primero en el POS"], ["en_menu", "Mostrar en el menú"], ["activo", "Activo para vender"]].map(([k, t]) => (
            <label key={k} className="flex items-center gap-2.5 whitespace-nowrap rounded-lg border border-linea px-3 py-2.5 text-sm font-medium">
              <input type="checkbox" checked={f[k]} onChange={set(k)} className="h-4 w-4 accent-tinta" />
              {t}
            </label>
          ))}
        </div>

        {guardar.error && <Aviso>{guardar.error.message}</Aviso>}
        <Boton className="w-full py-3.5" disabled={guardar.isPending}>
          {guardar.isPending ? "Guardando…" : nuevo ? "Crear producto" : "Guardar cambios"}
        </Boton>
      </form>

      {!nuevo && f.controla_stock && (
        <section className="mt-6 border-t border-linea pt-5">
          <h3 className="font-display text-lg font-bold text-tinta">Ajustar inventario</h3>
          <p className="text-sm text-suave">Las ventas y compras descuentan y suman solas. Usa esto para lo demás.</p>
          <form
            className="mt-3 grid gap-2 sm:grid-cols-[1.4fr_0.8fr]"
            onSubmit={(e) => { e.preventDefault(); ajustar.mutate(); }}
          >
            <select value={ajuste.tipo} onChange={(e) => setAjuste({ ...ajuste, tipo: e.target.value })} className={campo}>
              {Object.entries(AJUSTES).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
            <input
              required
              inputMode="decimal"
              placeholder="Cantidad"
              value={ajuste.cantidad}
              onChange={(e) => setAjuste({ ...ajuste, cantidad: e.target.value })}
              className={campo}
            />
            <input
              placeholder="Nota (opcional)"
              value={ajuste.nota}
              onChange={(e) => setAjuste({ ...ajuste, nota: e.target.value })}
              className={`${campo} sm:col-span-2`}
            />
            {ajustar.error && <div className="sm:col-span-2"><Aviso>{ajustar.error.message}</Aviso></div>}
            <Boton variante="borde" className="sm:col-span-2" disabled={ajustar.isPending || !Number(ajuste.cantidad)}>
              <PackagePlus size={18} aria-hidden /> Registrar ajuste
            </Boton>
          </form>
        </section>
      )}

      {!nuevo && (
        <section className="mt-6 border-t border-linea pt-5">
          {!confirmarBorrado ? (
            <button
              type="button"
              onClick={() => setConfirmarBorrado(true)}
              className="inline-flex items-center gap-2 rounded-lg px-1 py-2 text-sm font-semibold text-alerta hover:underline"
            >
              <Trash2 size={17} aria-hidden /> Eliminar producto
            </button>
          ) : (
            <div className="rounded-xl bg-alerta-claro p-4" role="alertdialog" aria-label="Confirmar eliminación">
              <p className="font-semibold text-alerta">¿Eliminar {f.nombre}?</p>
              <p className="mt-1 text-sm text-texto">
                Sale del POS y del menú QR. Si ya tiene ventas, queda guardado como inactivo para no dañar tus reportes;
                lo puedes recuperar en el filtro Inactivos.
              </p>
              {eliminar.error && <div className="mt-3"><Aviso>{eliminar.error.message}</Aviso></div>}
              <div className="mt-3 flex gap-2">
                <Boton type="button" variante="borde" className="flex-1 py-2.5" onClick={() => setConfirmarBorrado(false)}>
                  Cancelar
                </Boton>
                <button
                  type="button"
                  onClick={() => eliminar.mutate()}
                  disabled={eliminar.isPending}
                  className="flex-1 rounded-lg bg-alerta py-2.5 font-semibold text-white hover:brightness-110 disabled:opacity-60"
                >
                  {eliminar.isPending ? "Eliminando…" : "Sí, eliminar"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </Hoja>
  );
}

/* ---------- Categorías ---------- */
function Categorias({ categorias, productos }) {
  const qc = useQueryClient();
  const [nueva, setNueva] = useState("");
  const refrescar = () => qc.invalidateQueries({ queryKey: ["categorias"] });
  const crear = useMutation({
    mutationFn: () => api("/categorias/", { method: "POST", body: { nombre: nueva.trim(), orden: categorias.length } }),
    onSuccess: () => { setNueva(""); refrescar(); },
  });
  const actualizar = useMutation({
    mutationFn: ({ id, ...datos }) => api(`/categorias/${id}/`, { method: "PATCH", body: datos }),
    onSuccess: refrescar,
  });
  const cuenta = (id) => productos.filter((p) => p.categoria === id).length;

  return (
    <div className="max-w-xl">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); nueva.trim() && crear.mutate(); }}>
        <input value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Nueva categoría, ej. Bebidas frías" className={campo} />
        <Boton disabled={!nueva.trim() || crear.isPending}><Plus size={18} aria-hidden /> Agregar</Boton>
      </form>
      {(crear.error || actualizar.error) && <div className="mt-3"><Aviso>{(crear.error || actualizar.error).message}</Aviso></div>}
      <ul className="mt-4 divide-y divide-linea rounded-xl bg-papel">
        {categorias.length === 0 && <li className="p-4 text-suave">Las categorías ordenan los botones del POS y las secciones del menú.</li>}
        {categorias.map((c) => (
          <li key={c.id} className={`flex items-center gap-3 px-4 py-3 ${c.activa ? "" : "opacity-50"}`}>
            <input
              defaultValue={c.nombre}
              onBlur={(e) => e.target.value.trim() && e.target.value !== c.nombre && actualizar.mutate({ id: c.id, nombre: e.target.value.trim() })}
              className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1.5 font-medium outline-none focus:bg-fondo"
              aria-label={`Nombre de la categoría ${c.nombre}`}
            />
            <span className="text-sm text-suave num">{cuenta(c.id)} productos</span>
            <button
              onClick={() => actualizar.mutate({ id: c.id, activa: !c.activa })}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-fondo"
            >
              {c.activa ? "Ocultar" : "Mostrar"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Menú QR ---------- */
function cargarImagen(src) {
  return new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = src; });
}

/** Cartel listo para imprimir y pegar en la mesa o el mostrador. */
async function cartelQR(negocio, url) {
  const W = 1200, H = 1600;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  x.fillStyle = "#16324F"; x.fillRect(0, 0, W, H);
  x.fillStyle = "#ffffff"; x.textAlign = "center";
  x.font = "800 92px 'Bricolage Grotesque', sans-serif";
  x.fillText(negocio.nombre, W / 2, 220, W - 120);
  x.fillStyle = "#F4B400";
  x.beginPath(); x.roundRect(170, 330, 860, 860, 48); x.fill();
  const qr = await cargarImagen(await QRCode.toDataURL(url, { width: 760, margin: 1, color: { dark: "#16324F", light: "#FFFFFF" } }));
  x.drawImage(qr, 220, 380, 760, 760);
  x.fillStyle = "#ffffff";
  x.font = "700 64px 'Figtree', sans-serif";
  x.fillText("Escanea y mira el menú", W / 2, 1330);
  x.font = "500 40px 'Figtree', sans-serif"; x.fillStyle = "rgba(255,255,255,0.7)";
  x.fillText("Con la cámara de tu celular", W / 2, 1400);
  return c.toDataURL("image/png");
}

function MenuQR({ negocio }) {
  const url = `${window.location.origin}/m/${negocio.slug}`;
  const [qr, setQr] = useState("");
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    QRCode.toDataURL(url, { width: 480, margin: 1, color: { dark: "#16324F", light: "#FFFFFF" } }).then(setQr);
  }, [url]);

  const descargar = async () => {
    const a = document.createElement("a");
    a.href = await cartelQR(negocio, url);
    a.download = `menu-qr-${negocio.slug}.png`;
    a.click();
  };
  const copiar = async () => {
    try { await navigator.clipboard.writeText(url); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sin permiso */ }
  };

  return (
    <div className="grid max-w-3xl gap-6 md:grid-cols-[280px_1fr]">
      <div className="rounded-2xl bg-tinta p-5 text-center text-white">
        <p className="font-display text-xl font-bold">{negocio.nombre}</p>
        <div className="mx-auto mt-4 rounded-xl bg-precio p-3">
          {qr && <img src={qr} alt={`Código QR del menú de ${negocio.nombre}`} className="w-full rounded-md" />}
        </div>
        <p className="mt-4 font-semibold">Escanea y mira el menú</p>
      </div>
      <div>
        <h2 className="font-display text-xl font-bold text-tinta">Tu menú digital</h2>
        <p className="mt-2 text-suave">
          Muestra tus productos activos con foto, descripción y precio. Se actualiza solo cuando cambias un producto,
          y marca como agotado lo que no tenga inventario. El cliente solo mira: el pedido se hace en caja.
        </p>
        <p className="mt-4 break-all rounded-lg bg-papel px-3 py-2.5 text-sm">{url}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Boton onClick={descargar}><Download size={18} aria-hidden /> Descargar cartel para imprimir</Boton>
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-linea bg-papel px-4 py-3 font-semibold text-tinta hover:bg-fondo">
            <ExternalLink size={18} aria-hidden /> Ver menú
          </a>
          <Boton variante="borde" onClick={copiar}><Copy size={18} aria-hidden /> {copiado ? "Link copiado" : "Copiar link"}</Boton>
        </div>
      </div>
    </div>
  );
}

/* ---------- Página ---------- */
export default function Productos() {
  const { negocio, tieneModulo } = useSesion();
  const [tab, setTab] = useState("productos");
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [editando, setEditando] = useState(null);

  const { data: productos = [], isLoading, error } = useQuery({ queryKey: ["productos", "admin"], queryFn: () => api("/productos/") });
  const { data: categorias = [] } = useQuery({ queryKey: ["categorias"], queryFn: () => api("/categorias/") });

  const bajos = productos.filter((p) => p.activo && p.stock_bajo).length;
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return productos.filter((p) =>
      (!t || p.nombre.toLowerCase().includes(t) || p.codigo?.toLowerCase() === t) &&
      (filtro === "todos" ? p.activo : filtro === "bajos" ? p.activo && p.stock_bajo : !p.activo)
    );
  }, [productos, q, filtro]);

  const tabs = [["productos", "Productos"], ["categorias", "Categorías"], ...(tieneModulo("menu") ? [["qr", "Menú QR"]] : [])];

  return (
    <div className="px-4 py-5 lg:px-6 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold text-tinta">Productos</h1>
        {tab === "productos" && <Boton onClick={() => setEditando({})}><Plus size={18} aria-hidden /> Nuevo producto</Boton>}
      </div>
      <div className="mt-4 flex gap-1 border-b border-linea" role="tablist">
        {tabs.map(([v, t]) => (
          <button
            key={v}
            role="tab"
            aria-selected={tab === v}
            onClick={() => setTab(v)}
            className={`-mb-px border-b-2 px-4 py-2.5 font-semibold ${tab === v ? "border-tinta text-tinta" : "border-transparent text-suave"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "categorias" && <Categorias categorias={categorias} productos={productos} />}
        {tab === "qr" && <MenuQR negocio={negocio} />}
        {tab === "productos" && (
          <>
            <div className="flex flex-wrap gap-2">
              <div className="flex min-w-60 flex-1 items-center gap-2 rounded-lg border border-linea bg-papel px-3 focus-within:border-tinta">
                <Search size={18} className="text-suave" aria-hidden />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" className="w-full bg-transparent py-2.5 outline-none" aria-label="Buscar producto" />
              </div>
              {[["todos", "Activos"], ["bajos", `Por acabarse${bajos ? ` (${bajos})` : ""}`], ["inactivos", "Inactivos"]].map(([v, t]) => (
                <button
                  key={v}
                  onClick={() => setFiltro(v)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${filtro === v ? "bg-tinta text-white" : "bg-papel text-tinta"}`}
                >
                  {t}
                </button>
              ))}
            </div>
            {error && <div className="mt-4"><Aviso>{error.message}</Aviso></div>}
            {isLoading ? (
              <p className="py-10 text-suave">Cargando…</p>
            ) : visibles.length === 0 ? (
              <div className="py-12 text-center">
                <p className="font-display text-xl font-bold text-tinta">{productos.length ? "Nada por aquí" : "Crea tu primer producto"}</p>
                <p className="mt-1 text-suave">{productos.length ? "Prueba con otro filtro o búsqueda." : "Con nombre y precio ya puedes empezar a vender."}</p>
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-linea overflow-hidden rounded-xl bg-papel">
                {visibles.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => setEditando(p)} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-fondo/70 sm:px-4">
                      <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-fondo text-suave">
                        {p.foto_url ? <img src={p.foto_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <ImageOff size={20} aria-hidden />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{p.nombre}</span>
                        <span className="block truncate text-sm text-suave">
                          {p.categoria_nombre || "Sin categoría"}
                          {!p.en_menu && " · fuera del menú"}
                        </span>
                      </span>
                      <span className="hidden w-28 text-right sm:block">
                        <span className="block text-xs text-suave">Ganancia</span>
                        <span className={`text-sm font-semibold num ${p.margen < 0 ? "text-alerta" : ""}`}>{pesos(p.margen)}</span>
                      </span>
                      <span className="w-24 text-right">
                        {p.controla_stock ? (
                          <span className={`text-sm num ${p.stock_bajo ? "font-semibold text-alerta" : "text-suave"}`}>
                            {numero(p.stock)} {p.unidad}
                          </span>
                        ) : (
                          <span className="text-sm text-suave">Sin inventario</span>
                        )}
                      </span>
                      <span className="w-24 text-right font-display text-lg font-bold text-tinta num">{pesos(p.precio)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {editando && (
        <EditorProducto
          key={editando.id || "nuevo"}
          producto={editando.id ? editando : null}
          categorias={categorias}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
}
