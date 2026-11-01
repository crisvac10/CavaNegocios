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
