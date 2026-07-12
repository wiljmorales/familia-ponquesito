import Chat from "./chat";

export default function Home() {
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
            Este asistente responderá preguntas sobre Familia Ponquesito.
            Mientras su base de conocimiento se construye con la información
            real del negocio, puedes probar cómo conversa: responde con lo que
            sabe, admite lo que no sabe y te indica cuándo es mejor hablar con
            una persona.
          </p>
        </header>

        <Chat />

        <footer className="text-center text-xs text-muted">
          Demo del Reto 1 · Platzi Vibe Coding Challenge · La información del
          negocio aún no está cargada.
        </footer>
      </main>
    </div>
  );
}
