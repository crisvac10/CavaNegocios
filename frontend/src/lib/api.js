const BASE = (import.meta.env.VITE_API_URL || "http://localhost:8000/api").replace(/\/$/, "");
const CLAVE_TOKEN = "cn_token";

export const token = {
  leer: () => { try { return localStorage.getItem(CLAVE_TOKEN); } catch { return null; } },
  guardar: (t) => { try { localStorage.setItem(CLAVE_TOKEN, t); } catch { /* modo privado */ } },
  borrar: () => { try { localStorage.removeItem(CLAVE_TOKEN); } catch { /* modo privado */ } },
};

export class ErrorApi extends Error {
  constructor(mensaje, estado, datos) {
    super(mensaje);
    this.estado = estado;
    this.datos = datos;
  }
}

/** Convierte las respuestas de error de DRF en una frase legible. */
function mensajeDeError(datos, estado) {
  if (!datos) return estado >= 500 ? "El servidor tuvo un problema. Intenta de nuevo." : "No se pudo completar la acción.";
  if (typeof datos === "string") {
    // Una página HTML en vez de JSON = la URL de la API está mal configurada (VITE_API_URL)
    if (/<html|<!doctype/i.test(datos)) {
      return estado === 404
        ? `No se encontró la API en ${BASE}. Revisa que VITE_API_URL termine en /api.`
        : "El servidor respondió algo inesperado. Intenta de nuevo en un momento.";
    }
    return datos;
  }
  if (Array.isArray(datos)) return datos.join(" ");
  if (datos.detail) return datos.detail;
  return Object.entries(datos)
    .map(([campo, v]) => {
      const texto = Array.isArray(v) ? v.join(" ") : typeof v === "object" ? JSON.stringify(v) : v;
      return campo === "non_field_errors" ? texto : `${campo}: ${texto}`;
    })
    .join(" · ");
}

let alExpirar = () => {};
export const configurarSesion = ({ onExpirada }) => { alExpirar = onExpirada; };

export async function api(ruta, { method = "GET", body, query } = {}) {
  const url = new URL(BASE + ruta);
  if (query) Object.entries(query).forEach(([k, v]) => v !== undefined && v !== "" && url.searchParams.set(k, v));
  const headers = { Accept: "application/json" };
  const t = token.leer();
  if (t) headers.Authorization = `Token ${t}`;
  const esForm = body instanceof FormData;
  if (body !== undefined && !esForm) headers["Content-Type"] = "application/json";

  let resp;
  try {
    resp = await fetch(url, { method, headers, body: body === undefined ? undefined : esForm ? body : JSON.stringify(body) });
  } catch {
    throw new ErrorApi("Sin conexión con el servidor. Revisa el internet.", 0);
  }
  if (resp.status === 204) return null;
  const tipo = resp.headers.get("content-type") || "";
  const datos = tipo.includes("json") ? await resp.json().catch(() => null) : await resp.text();
  if (!resp.ok) {
    if (resp.status === 401) alExpirar();
    throw new ErrorApi(mensajeDeError(datos, resp.status), resp.status, datos);
  }
  return datos;
}

/** Descarga un archivo protegido (CSV de reportes) usando el token de la sesión. */
export async function descargar(ruta, query, nombre) {
  const url = new URL(BASE + ruta);
  Object.entries(query || {}).forEach(([k, v]) => v !== undefined && v !== "" && url.searchParams.set(k, v));
  const resp = await fetch(url, { headers: { Authorization: `Token ${token.leer()}` } });
  if (!resp.ok) throw new ErrorApi("No se pudo descargar el archivo.", resp.status);
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(await resp.blob());
  enlace.download = nombre;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
}
