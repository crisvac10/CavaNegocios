import { Navigate, Route, Routes } from "react-router-dom";
import { useSesion } from "./context/Sesion";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Vender from "./pages/Vender";
import Hoy from "./pages/Hoy";
import Proximamente from "./pages/Proximamente";
import Recibo from "./pages/Recibo";

function Cargando() {
  return (
    <div className="grid min-h-dvh place-items-center text-suave">
      <p>Cargando…</p>
    </div>
  );
}

export default function App() {
  const { usuario, cargando } = useSesion();
  // El recibo digital es público: no requiere sesión
  if (window.location.pathname.startsWith("/r/")) {
    return (
      <Routes>
        <Route path="/r/:token" element={<Recibo />} />
      </Routes>
    );
  }
  if (cargando) return <Cargando />;
  if (!usuario) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/vender" replace />} />
        <Route path="/vender" element={<Vender />} />
        <Route path="/hoy" element={<Hoy />} />
        <Route path="/productos" element={<Proximamente titulo="Productos e inventario" />} />
        <Route path="/fiados" element={<Proximamente titulo="Fiados" />} />
        <Route path="/gastos" element={<Proximamente titulo="Gastos y compras" />} />
        <Route path="/reportes" element={<Proximamente titulo="Reportes" />} />
        <Route path="/creditos" element={<Proximamente titulo="Créditos" />} />
        <Route path="/ajustes" element={<Proximamente titulo="Ajustes del negocio" />} />
        <Route path="*" element={<Navigate to="/vender" replace />} />
      </Route>
    </Routes>
  );
}
