import { Navigate, Route, Routes } from "react-router-dom";
import { useSesion } from "./context/Sesion";
import Layout from "./components/Layout";
import { CarritoProvider } from "./context/Carrito";
import Login from "./pages/Login";
import Vender from "./pages/Vender";
import Hoy from "./pages/Hoy";
import Recibo from "./pages/Recibo";
import MenuPublico from "./pages/MenuPublico";
import Pedidos from "./pages/Pedidos";
import Productos from "./pages/Productos";
import Ajustes from "./pages/Ajustes";
import Fiados from "./pages/Fiados";
import Gastos from "./pages/Gastos";
import Reportes from "./pages/Reportes";
import Creditos from "./pages/Creditos";

function Cargando() {
  return (
    <div className="grid min-h-dvh place-items-center text-suave">
      <p>Cargando…</p>
    </div>
  );
}

export default function App() {
  const { usuario, cargando, esAdmin } = useSesion();
  // El recibo digital es público: no requiere sesión
  // Recibo digital y menú por QR son públicos: no requieren sesión
  if (/^\/(r|m)\//.test(window.location.pathname)) {
    return (
      <Routes>
        <Route path="/r/:token" element={<Recibo />} />
        <Route path="/m/:slug" element={<MenuPublico />} />
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
      <Route element={<CarritoProvider><Layout /></CarritoProvider>}>
        <Route path="/" element={<Navigate to="/vender" replace />} />
        <Route path="/vender" element={<Vender />} />
        <Route path="/hoy" element={<Hoy />} />
        <Route path="/pedidos" element={<Pedidos />} />
        <Route path="/productos" element={<Productos />} />
        <Route path="/fiados" element={<Fiados />} />
        <Route path="/gastos" element={<Gastos />} />
        <Route path="/reportes" element={esAdmin ? <Reportes /> : <Navigate to="/vender" replace />} />
        <Route path="/creditos" element={esAdmin ? <Creditos /> : <Navigate to="/vender" replace />} />
        <Route path="/ajustes" element={esAdmin ? <Ajustes /> : <Navigate to="/vender" replace />} />
        <Route path="*" element={<Navigate to="/vender" replace />} />
      </Route>
    </Routes>
  );
}
