import type { Metadata } from "next";
import Link from "next/link";
import RecoveryForm from "./recovery-form";

export const metadata: Metadata = {
  title: "Recuperar enlace de reserva | Familia Ponquesito",
  robots: { index: false, follow: false, noarchive: true },
};

export default function RecoveryPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-16">
      <h1 className="font-serif text-3xl text-cocoa">Recuperar enlace de reserva</h1>
      <p className="mt-4 text-text-secondary">Escribe el código y el correo con el que hiciste la solicitud. Por seguridad, solo enviaremos el enlace a la dirección registrada.</p>
      <RecoveryForm />
      <Link className="mt-6 text-terracotta underline" href="/agenda">Volver a la agenda</Link>
    </main>
  );
}
