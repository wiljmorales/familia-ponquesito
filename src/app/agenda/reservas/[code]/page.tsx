import type { Metadata } from "next";
import Link from "next/link";
import { lookupReservation } from "@/reservations/service";
import ReservationManager from "./reservation-manager";

export const metadata: Metadata = {
  title: "Gestiona tu reserva | Familia Ponquesito",
  description: "Consulta de forma privada el estado de tu solicitud.",
  robots: { index: false, follow: false, noarchive: true },
};

interface ReservationPageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}

export default async function ReservationPage({
  params,
  searchParams,
}: ReservationPageProps) {
  const [{ code }, query] = await Promise.all([params, searchParams]);
  const token = typeof query.token === "string" ? query.token : "";
  const result = token
    ? await lookupReservation(code, token)
    : { ok: false as const, error: "reservation_not_found" as const };

  if (!result.ok) {
    return (
      <main className="flex min-h-full flex-1 items-center justify-center bg-cream px-4 py-16">
        <section className="w-full max-w-lg rounded-3xl border border-border-soft bg-cream-light p-8 text-center shadow-sm">
          <p className="font-script text-3xl text-terracotta">Familia Ponquesito</p>
          <h1 className="mt-4 font-serif text-3xl text-cocoa">No pudimos abrir la reserva</h1>
          <p className="mt-4 text-sm leading-6 text-text-secondary">
            El enlace puede ser incorrecto o haber vencido. Por seguridad mostramos el mismo
            mensaje si el código o la clave privada no coinciden.
          </p>
          <Link
            href="/agenda"
            className="mt-7 inline-flex rounded-full bg-terracotta px-6 py-3 font-semibold text-white transition-colors hover:bg-terracotta-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-dark"
          >
            Volver a la agenda
          </Link>
        </section>
      </main>
    );
  }

  return <ReservationManager initialReservation={result.reservation} token={token} />;
}
