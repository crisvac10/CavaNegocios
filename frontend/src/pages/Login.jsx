import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useSesion } from "../context/Sesion";

export default function Login() {
  const { entrar } = useSesion();
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setError("");
    setEnviando(true);
    try {
      await entrar(usuario.trim(), clave);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="grid min-h-dvh md:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-tinta p-12 text-white md:flex md:flex-col md:justify-between">
        <p className="font-display text-2xl font-bold">CavaNegocios</p>
        <div className="max-w-md">
          {/* Etiqueta de precio: el gesto visual de la marca */}
          <div className="mb-8 inline-flex -rotate-3 items-center gap-3 rounded-md bg-precio px-5 py-3 text-tinta shadow-[4px_4px_0_0_rgba(0,0,0,0.25)]">
            <span className="h-3 w-3 rounded-full bg-tinta" aria-hidden />
            <span className="font-display text-3xl font-extrabold num">$2.500</span>
          </div>
          <h1 className="font-display text-5xl font-extrabold leading-[1.05]">
            Cada tinto vendido, cada gasto y cada cuota, en un solo lugar.
          </h1>
          <p className="mt-5 max-w-sm text-lg text-white/70">
            Vende rápido, cuadra el día sin cuaderno y paga tus créditos con un plan que sale de lo que de verdad ganas.
          </p>
        </div>
        <p className="text-sm text-white/40">Hecho en Bogotá por CavaTech Solutions</p>
      </section>

      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <p className="font-display text-2xl font-bold text-tinta md:hidden">CavaNegocios</p>
          <h2 className="mt-6 font-display text-3xl font-bold text-tinta md:mt-0">Entra a tu negocio</h2>
          <p className="mt-2 text-suave">Usa el usuario que te dio el administrador.</p>

          <form onSubmit={enviar} className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">Usuario</span>
              <input
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                required
                className="w-full rounded-lg border border-linea bg-papel px-4 py-3 outline-none focus:border-tinta"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">Contraseña</span>
              <div className="relative">
                <input
                  type={verClave ? "text" : "password"}
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="w-full rounded-lg border border-linea bg-papel px-4 py-3 pr-12 outline-none focus:border-tinta"
                />
                <button
                  type="button"
                  onClick={() => setVerClave((v) => !v)}
                  className="absolute inset-y-0 right-0 px-3 text-suave"
                  aria-label={verClave ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {verClave ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </label>
            {error && <p className="rounded-lg bg-alerta-claro px-4 py-3 text-sm text-alerta" role="alert">{error}</p>}
            <button
              disabled={enviando}
              className="w-full rounded-lg bg-tinta py-3.5 font-semibold text-white transition-colors hover:bg-tinta-2 disabled:opacity-60"
            >
              {enviando ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
