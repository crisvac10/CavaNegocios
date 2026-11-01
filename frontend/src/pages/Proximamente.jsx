import { Link } from "react-router-dom";

export default function Proximamente({ titulo }) {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <h1 className="font-display text-3xl font-bold text-tinta">{titulo}</h1>
      <p className="mt-3 text-suave">Esta sección está en construcción. Mientras tanto puedes seguir vendiendo.</p>
      <Link to="/vender" className="mt-6 inline-block rounded-lg bg-tinta px-5 py-3 font-semibold text-white">
        Ir a vender
      </Link>
    </div>
  );
}
