import type { Metadata } from "next";
import AgentConsole from "./agent-console";

export const metadata: Metadata = {
  title: "Agente de Atención Ponquesito | Familia Ponquesito",
  description:
    "Demostración del Agente de Atención Ponquesito: analiza mensajes libres de clientes, comprende la intención y decide qué proceso del negocio activar.",
  // Demostración del challenge: accesible por URL directa, fuera de los
  // buscadores (mismo criterio que el prototipo del Reto 5).
  robots: { index: false, follow: false },
};

export default function AgentePage() {
  return <AgentConsole />;
}
