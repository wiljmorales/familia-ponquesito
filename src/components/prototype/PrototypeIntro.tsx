"use client";

import { ChatIcon, ClipboardIcon, HeartIcon, type IconProps } from "@/components/ui/icons";
import type { ComponentType } from "react";
import PrototypeButton from "./PrototypeButton";

/** El flujo que la herramienta propone ordenar. */
const FLOW_STEPS = ["Solicitud", "Cotización", "Anticipo", "Pedido confirmado"] as const;

const CONTEXT_CARDS: {
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
}[] = [
  {
    icon: ChatIcon,
    title: "El problema",
    description:
      "Las solicitudes de tortas llegan por el formulario de la página, el juego «Crea tu torta», WhatsApp e Instagram. Con todo disperso es fácil olvidar una solicitud, responder tarde o perder de vista quién espera cotización.",
  },
  {
    icon: HeartIcon,
    title: "Para quién",
    description:
      "Una propuesta para presentarle a Karem, dueña de Familia Ponquesito: ella revisa cada solicitud, prepara las cotizaciones y organiza la producción de la semana.",
  },
  {
    icon: ClipboardIcon,
    title: "La propuesta",
    description:
      "Reunir todas las solicitudes en un solo lugar para revisar cada pedido, preparar su cotización y saber de un vistazo qué clientes esperan respuesta, anticipo o confirmación.",
  },
];

export default function PrototypeIntro({ onExplore }: { onExplore: () => void }) {
  return (
    <section className="mx-auto flex max-w-4xl flex-col items-center gap-10 py-6 text-center sm:py-10">
      <div className="flex flex-col items-center gap-4">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-terracotta">
          <span aria-hidden>•</span>
          <span>Prototipo · datos de demostración</span>
          <span aria-hidden>•</span>
        </p>
        <h1 className="font-serif text-4xl leading-tight text-cocoa sm:text-5xl">
          Centro de pedidos
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-text-secondary sm:text-lg">
          Una idea nueva para <span className="font-script text-2xl text-terracotta">Familia Ponquesito</span>:
          todas las solicitudes de tortas personalizadas, de todos los canales, organizadas en
          un solo lugar.
        </p>
      </div>

      <div className="grid gap-4 text-left sm:grid-cols-3">
        {CONTEXT_CARDS.map(({ icon: Icon, title, description }) => (
          <div
            key={title}
            className="flex flex-col gap-3 rounded-2xl border border-border-soft bg-cream-light p-5"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-terracotta/10 text-terracotta">
              <Icon aria-hidden className="size-5" />
            </span>
            <h2 className="font-serif text-lg text-cocoa">{title}</h2>
            <p className="text-sm leading-relaxed text-text-secondary">{description}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-text-secondary">
          El camino de cada pedido
        </h2>
        <ol className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
          {FLOW_STEPS.map((step, index) => (
            <li key={step} className="flex items-center gap-2">
              <span className="rounded-full border border-terracotta/30 bg-terracotta/10 px-3.5 py-1.5 text-sm font-medium text-terracotta-dark">
                {step}
              </span>
              {index < FLOW_STEPS.length - 1 && (
                <span aria-hidden className="text-gold">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>

      <div className="max-w-2xl rounded-2xl border border-gold/40 bg-gold/10 px-5 py-4 text-sm leading-relaxed text-cocoa">
        Esto es un <strong>prototipo navegable</strong> para validar la idea antes de
        construirla: los pedidos que verás son de demostración y nada de lo que hagas aquí
        envía mensajes reales ni afecta al negocio.
      </div>

      <div className="flex flex-col items-center gap-3">
        <PrototypeButton onClick={onExplore} withHeart>
          Explorar el prototipo
        </PrototypeButton>
        <p className="text-xs text-text-secondary">
          Recorre el flujo completo: de una solicitud nueva a un pedido esperando anticipo.
        </p>
      </div>
    </section>
  );
}
