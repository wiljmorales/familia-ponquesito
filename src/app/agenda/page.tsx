import type { Metadata } from "next";
import AgendaWizard from "./agenda-wizard";

export const metadata: Metadata = {
  title: "Agenda tu torta | Familia Ponquesito",
  description:
    "Reserva la fecha de tu torta en cuatro pasos: cuéntanos tu pedido, elige un día con espacio en nuestra agenda de producción y aparta tu fecha.",
  alternates: {
    canonical: "/agenda",
  },
};

export default function AgendaPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-cream">
      <AgendaWizard />
    </div>
  );
}
