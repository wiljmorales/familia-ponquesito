import type { Metadata } from "next";
import { connection } from "next/server";
import { businessTodayISO } from "@/lib/prototype/dates";
import PrototypeApp from "./prototype-app";

export const metadata: Metadata = {
  title: "Centro de pedidos (prototipo) | Familia Ponquesito",
  description:
    "Prototipo navegable del Centro de pedidos de Familia Ponquesito: una propuesta para organizar solicitudes, cotizaciones y anticipos en un solo lugar. Datos de demostración.",
  // Herramienta interna para presentar la idea: accesible por URL directa,
  // pero fuera de los buscadores.
  robots: { index: false, follow: false },
};

export default async function PrototipoPage() {
  // connection() detiene el prerender aquí (API preferida en esta versión
  // de Next sobre `dynamic = "force-dynamic"`): la fecha base se calcula en
  // cada request y los pedidos demo nunca quedan congelados en el build.
  // Solo afecta a esta ruta; el resto del sitio sigue estático.
  await connection();
  const baseDate = businessTodayISO();

  return <PrototypeApp baseDate={baseDate} />;
}
