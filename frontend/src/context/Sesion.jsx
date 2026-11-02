import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, configurarSesion, token } from "../lib/api";
import { aplicarMarca } from "../lib/marca";

const Ctx = createContext(null);

export function SesionProvider({ children }) {
  const qc = useQueryClient();
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(Boolean(token.leer()));

  const salir = useCallback(async ({ avisarServidor = true } = {}) => {
    if (avisarServidor && token.leer()) api("/logout/", { method: "POST" }).catch(() => {});
    token.borrar();
    setUsuario(null);
    qc.clear();
  }, [qc]);

  useEffect(() => {
    configurarSesion({ onExpirada: () => salir({ avisarServidor: false }) });
    if (!token.leer()) return;
    api("/yo/").then(setUsuario).catch(() => token.borrar()).finally(() => setCargando(false));
  }, [salir]);

  const entrar = async (username, password) => {
    const r = await api("/login/", { method: "POST", body: { username, password } });
    token.guardar(r.token);
    setUsuario(r.usuario);
    return r.usuario;
  };

  const refrescar = async () => setUsuario(await api("/yo/"));
  /** Actualiza el negocio en la sesión sin pedir /yo/ de nuevo (tras guardar Ajustes). */
  const actualizarNegocio = (n) => setUsuario((u) => (u ? { ...u, negocio: n } : u));

  const negocio = usuario?.negocio;
  // Los colores del negocio se aplican a toda la app; sin sesión vuelve la marca CavaNegocios
  useEffect(() => aplicarMarca(negocio), [negocio?.color_primario, negocio?.color_acento]); // eslint-disable-line
  const valor = {
    usuario,
    negocio,
    cargando,
    entrar,
    salir,
    refrescar,
    actualizarNegocio,
    esAdmin: usuario?.rol === "ADMIN",
    tieneModulo: (m) => Boolean(negocio?.modulos_activos?.includes(m)),
  };
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export const useSesion = () => useContext(Ctx);
