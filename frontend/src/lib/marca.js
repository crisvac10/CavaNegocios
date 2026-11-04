/**
 * Marca del negocio: el color principal y el de acento reemplazan los tokens de
 * Tailwind (--color-tinta, --color-precio…), así toda la app toma los colores del
 * negocio sin tocar componentes. Las reglas de contraste son las mismas del backend.
 */
export const MARCA_BASE = { primario: "#16324F", acento: "#F4B400" };

export const PALETAS = [
  { nombre: "Azul tinta", primario: "#16324F", acento: "#F4B400" },
  { nombre: "Café", primario: "#4A2C1D", acento: "#E9B872" },
  { nombre: "Bosque", primario: "#1F4D3A", acento: "#F2C14E" },
  { nombre: "Vino", primario: "#6B1E2E", acento: "#F6C28B" },
  { nombre: "Carbón", primario: "#1F2328", acento: "#F97316" },
  { nombre: "Uva", primario: "#3B2A63", acento: "#FFD166" },
  { nombre: "Terracota", primario: "#8A3B12", acento: "#FFE3B3" },
  { nombre: "Petróleo", primario: "#0F4C5C", acento: "#F4A259" },
  // Fondo rosado muy suave con tarjetas blancas; el principal es un rosa profundo para que el texto blanco se lea
  { nombre: "Rosa pastel", primario: "#9E3A63", acento: "#FFD6E5", fondo: "#FDF1F6", linea: "#F3D9E4" },
];

const FONDO_BASE = { fondo: "#f3f5f8", linea: "#dfe4ea" };

const HEX = /^#[0-9a-f]{6}$/i;

function luminancia(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Problema de legibilidad en palabras del dueño, o null si la combinación sirve. */
export function problemaMarca(primario, acento) {
  if (!HEX.test(primario) || !HEX.test(acento)) return "Usa colores en formato #RRGGBB.";
  if (contraste("#FFFFFF", primario) < 4.5)
    return "El color principal es muy claro: el texto blanco de menús y botones no se leería.";
  if (contraste(primario, acento) < 4.5)
    return "El color de acento no contrasta con el principal: los precios no se leerían.";
  return null;
}

export function aplicarMarca(colores) {
  const primario = colores?.color_primario || colores?.primario || MARCA_BASE.primario;
  const acento = colores?.color_acento || colores?.acento || MARCA_BASE.acento;
  if (problemaMarca(primario, acento)) return aplicarMarca(null);
  const raiz = document.documentElement.style;
  raiz.setProperty("--color-tinta", primario);
  raiz.setProperty("--color-tinta-2", `color-mix(in oklab, ${primario} 82%, white)`);
  raiz.setProperty("--color-precio", acento);
  raiz.setProperty("--color-precio-claro", `color-mix(in oklab, ${acento} 22%, white)`);
  const paleta = PALETAS.find((p) => p.primario.toLowerCase() === primario.toLowerCase() && p.acento.toLowerCase() === acento.toLowerCase());
  raiz.setProperty("--color-fondo", paleta?.fondo || FONDO_BASE.fondo);
  raiz.setProperty("--color-linea", paleta?.linea || FONDO_BASE.linea);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", primario);
}
