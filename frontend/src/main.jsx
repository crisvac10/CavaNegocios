import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SesionProvider } from "./context/Sesion";
import App from "./App";
import "./index.css";

const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (n, e) => e?.estado >= 500 && n < 2, refetchOnWindowFocus: true },
  },
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <SesionProvider>
          <App />
        </SesionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
