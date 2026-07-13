import type { Metadata } from "next";
import Builder from "./builder";

export const metadata: Metadata = {
  title: "Crea tu propia torta | Familia Ponquesito",
  description:
    "Diseña tu torta paso a paso: piso, color, pedestal, placa y topper. Al terminar, recibe una cotización personalizada inspirada en tu diseño.",
  alternates: {
    canonical: "/crea-tu-torta",
  },
};

export default function CreaTuTortaPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-cream-light">
      <Builder />
    </div>
  );
}
