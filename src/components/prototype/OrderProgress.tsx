import { Check } from "lucide-react";
import { orderProgressSteps, type ProgressStepState } from "@/lib/prototype/progress";
import type { OrderStatus } from "@/types/prototype";

const STEP_CLASSES: Record<ProgressStepState, string> = {
  done: "border-terracotta/30 bg-terracotta/10 text-terracotta-dark",
  current: "border-terracotta-dark bg-terracotta-dark font-semibold text-cream-light",
  upcoming: "border-border-soft bg-transparent text-text-secondary",
};

/** Texto solo para lectores de pantalla: el estado no depende del color. */
const STEP_SR_TEXT: Record<ProgressStepState, string> = {
  done: " (completado)",
  current: " (estado actual)",
  upcoming: " (pendiente)",
};

export default function OrderProgress({ status }: { status: OrderStatus }) {
  const steps = orderProgressSteps(status);

  return (
    // En móvil la línea se desplaza en horizontal de forma controlada.
    // `relative` es imprescindible: los sr-only (position:absolute) de los
    // pasos deben quedar contenidos en este scroll; si no, se posicionan
    // respecto al documento y ensanchan la página en móvil.
    <ol
      aria-label="Progreso del pedido"
      className="relative -mx-1 flex items-center overflow-x-auto px-1 py-1"
    >
      {steps.map((step, index) => (
        <li
          key={step.label}
          aria-current={step.state === "current" ? "step" : undefined}
          className="flex shrink-0 items-center"
        >
          <span
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs ${STEP_CLASSES[step.state]}`}
          >
            {step.state === "done" ? (
              <Check aria-hidden className="size-3" />
            ) : (
              <span aria-hidden className="w-3 text-center leading-none">
                {index + 1}
              </span>
            )}
            {step.label}
            <span className="sr-only">{STEP_SR_TEXT[step.state]}</span>
          </span>
          {index < steps.length - 1 && (
            <span aria-hidden className="mx-1 h-px w-3 shrink-0 bg-border-soft sm:w-5" />
          )}
        </li>
      ))}
    </ol>
  );
}
