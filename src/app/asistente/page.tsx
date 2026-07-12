import type { Metadata } from "next";
import Link from "next/link";
import Chat from "./chat";

export const metadata: Metadata = {
  title: "Asistente virtual | Familia Ponquesito",
  description:
    "Pregúntele al asistente virtual de Familia Ponquesito por sabores, tamaños, precios, entregas y cómo hacer su pedido.",
};

export default function AsistentePage() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center px-4 py-8 sm:py-14">
      <main className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col items-center gap-3 text-center">
          <span aria-hidden className="text-5xl">
            🧁
          </span>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Familia Ponquesito
          </h1>
          <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent-strong">
            Asistente virtual · primera versión
          </span>
          <p className="max-w-lg text-sm leading-relaxed text-muted sm:text-base">
            Repostería familiar en Barquisimeto. Pregúntele al asistente por
            nuestras tortas, sabores, precios, entregas y cómo hacer su
            pedido: responde con la información real del negocio, admite lo
            que no sabe y le indica cuándo es mejor hablar con una persona.
          </p>
        </header>

        <Chat />

        <footer className="flex flex-col items-center gap-2 text-center text-xs text-muted">
          <Link href="/" className="underline-offset-2 hover:underline">
            ← Volver al inicio
          </Link>
          <span>Demo del Reto 1 · Platzi Vibe Coding Challenge</span>
        </footer>
      </main>
    </div>
  );
}
