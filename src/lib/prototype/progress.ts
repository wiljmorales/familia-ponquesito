/**
 * Transformación centralizada de estado del pedido → pasos de la línea de
 * progreso (Reto 5). Vive aquí (y no como condicionales en JSX) para que
 * el mapeo se pruebe en node y la UI solo lo pinte.
 */

import type { OrderStatus } from "@/types/prototype";

export type ProgressStepState = "done" | "current" | "upcoming";

export interface ProgressStep {
  label: string;
  state: ProgressStepState;
}

export const PROGRESS_LABELS = [
  "Solicitud",
  "Revisión",
  "Cotización",
  "Anticipo",
  "Confirmado",
] as const;

/** Cada estado del pedido corresponde a un paso de la línea. */
const STATUS_STEP_INDEX: Record<OrderStatus, number> = {
  new: 0,
  reviewing: 1,
  to_quote: 2,
  waiting_deposit: 3,
  confirmed: 4,
};

/**
 * Devuelve los cinco pasos con su estado visual. El paso del estado actual
 * queda "current" (incluso "Confirmado", que es el estado final), los
 * anteriores "done" y los siguientes "upcoming".
 */
export function orderProgressSteps(status: OrderStatus): ProgressStep[] {
  const currentIndex = STATUS_STEP_INDEX[status];
  return PROGRESS_LABELS.map((label, index) => ({
    label,
    state: index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming",
  }));
}
