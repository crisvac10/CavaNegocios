const fmtPesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

export const pesos = (v) => fmtPesos.format(Math.round(Number(v) || 0)).replace(/\s/g, "");
export const numero = (v) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(Number(v) || 0);

/** "12.500" -> 12500 (para inputs de dinero escritos a la colombiana). */
export const leerPesos = (texto) => Number(String(texto).replace(/[^\d]/g, "")) || 0;

export const MEDIOS = {
  EFECTIVO: "Efectivo",
  NEQUI: "Nequi",
  DAVIPLATA: "Daviplata",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
};

export const hoyISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** Fecha local YYYY-MM-DD de un Date. */
export const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export const sumarDias = (fechaIso, dias) => {
  const d = new Date(`${fechaIso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return iso(d);
};

/** "2026-11-02" -> "2 nov" (o "lun 2 nov" con dia=true). */
export const fechaCorta = (fechaIso, { dia = false, anio = false } = {}) =>
  new Date(`${fechaIso}T12:00:00`).toLocaleDateString("es-CO", {
    ...(dia ? { weekday: "short" } : {}),
    day: "numeric",
    month: "short",
    ...(anio ? { year: "numeric" } : {}),
  }).replace(".", "");

/** Pesos compactos para ejes: 1.2 M, 350 mil. */
export const pesosCorto = (v) => {
  const n = Math.abs(Number(v) || 0), s = Number(v) < 0 ? "-" : "";
  if (n >= 1e6) return `${s}$${(n / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;
  if (n >= 1e3) return `${s}$${Math.round(n / 1e3)} mil`;
  return `${s}$${Math.round(n)}`;
};

/** Periodos rápidos para reportes. */
export function periodo(clave) {
  const hoy = hoyISO();
  const d = new Date(`${hoy}T12:00:00`);
  const inicioMes = iso(new Date(d.getFullYear(), d.getMonth(), 1, 12));
  switch (clave) {
    case "hoy": return { desde: hoy, hasta: hoy };
    case "7d": return { desde: sumarDias(hoy, -6), hasta: hoy };
    case "30d": return { desde: sumarDias(hoy, -29), hasta: hoy };
    case "mes": return { desde: inicioMes, hasta: hoy };
    case "mes_pasado": {
      const ini = iso(new Date(d.getFullYear(), d.getMonth() - 1, 1, 12));
      return { desde: ini, hasta: sumarDias(inicioMes, -1) };
    }
    default: return { desde: hoy, hasta: hoy };
  }
}
