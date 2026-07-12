"use client";

import { useEffect, useRef, useState } from "react";
import type { AssistantReply, AssistantStatus } from "@/assistant/types";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  status?: AssistantStatus;
}

const INITIAL_MESSAGE: ChatMessage = {
  id: 0,
  role: "assistant",
  status: "answered",
  text:
    "¡Hola! 👋 Soy el asistente virtual de Familia Ponquesito. Puedo " +
    "ayudarle con información sobre nuestras tortas: sabores, tamaños, " +
    "precios, entregas y cómo hacer su pedido. Si algo no lo sé, se lo " +
    "diré con honestidad. ¿En qué puedo ayudarle?",
};

/* Respaldadas por la base de conocimiento; cubren los estados del
   asistente (respuesta directa y derivación a una persona). */
const SUGGESTED_QUESTIONS = [
  "¿Qué sabores de torta tienen?",
  "¿Hacen entregas a domicilio?",
  "¿Cómo hago un pedido?",
];

const STATUS_LABELS: Partial<Record<AssistantStatus, string>> = {
  unknown: "Sin información todavía",
  human_required: "Mejor con una persona",
};

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);
  const scrollAnchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0 || isLoading) return;

    /* Contexto acotado: solo los últimos turnos reales (sin el saludo
       fijo), para no enviar conversaciones crecientes al proveedor. */
    const history = messages
      .filter((m) => m.id !== INITIAL_MESSAGE.id)
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text }));

    setError(null);
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: nextId.current++, role: "user", text: trimmed },
    ]);
    setIsLoading(true);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "El asistente no pudo responder.");
      }

      const reply = (await response.json()) as AssistantReply;
      setMessages((prev) => [
        ...prev,
        {
          id: nextId.current++,
          role: "assistant",
          text: reply.reply,
          status: reply.status,
        },
      ]);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "No se pudo enviar el mensaje. Revisa tu conexión e intenta de nuevo.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section
      aria-label="Chat con el asistente"
      className="flex w-full flex-col overflow-hidden rounded-2xl border border-border-soft bg-surface shadow-sm"
    >
      <div
        aria-live="polite"
        className="flex h-[26rem] flex-col gap-3 overflow-y-auto p-4 sm:h-[28rem]"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex flex-col ${
              message.role === "user" ? "items-end" : "items-start"
            }`}
          >
            {message.status && STATUS_LABELS[message.status] && (
              <span className="mb-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-strong">
                {STATUS_LABELS[message.status]}
              </span>
            )}
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed sm:max-w-[75%] ${
                message.role === "user"
                  ? "rounded-br-sm bg-accent text-white"
                  : "rounded-bl-sm bg-accent-soft/60 text-foreground"
              }`}
            >
              {message.text}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex items-start">
            <div
              aria-label="El asistente está escribiendo"
              className="rounded-2xl rounded-bl-sm bg-accent-soft/60 px-4 py-3"
            >
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:300ms]" />
              </span>
            </div>
          </div>
        )}

        <div ref={scrollAnchor} />
      </div>

      {error && (
        <div
          role="alert"
          className="mx-4 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2 px-4 pb-3">
        {SUGGESTED_QUESTIONS.map((question) => (
          <button
            key={question}
            type="button"
            disabled={isLoading}
            onClick={() => send(question)}
            className="rounded-full border border-border-soft bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent hover:text-accent-strong disabled:opacity-50"
          >
            {question}
          </button>
        ))}
      </div>

      <form
        className="flex gap-2 border-t border-border-soft p-3"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Escribe tu pregunta…"
          aria-label="Escribe tu pregunta"
          maxLength={1000}
          className="min-w-0 flex-1 rounded-full border border-border-soft bg-background px-4 py-2.5 text-sm outline-none placeholder:text-muted/70 focus:border-accent"
        />
        <button
          type="submit"
          disabled={isLoading || input.trim().length === 0}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          Enviar
        </button>
      </form>
    </section>
  );
}
