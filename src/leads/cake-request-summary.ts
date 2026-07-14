import { CELEBRATION_TYPES, FORM_FLAVOR_OPTIONS } from "@/lib/constants/business";

export interface CakeRequestSummaryInput {
  celebrationType: string;
  guestCount: number;
  preferredFlavor: string;
  cakeDescription: string;
}

/**
 * Resumen en texto de una solicitud de cotización del Reto 2, con el mismo
 * criterio que describeCakeDesign (Reto 3): usado por el correo de
 * notificación a Karem (Reto 4).
 */
export function describeCakeRequest(input: CakeRequestSummaryInput): string[] {
  const celebrationLabel =
    CELEBRATION_TYPES.find((c) => c.value === input.celebrationType)?.label ??
    input.celebrationType;
  const flavorLabel =
    FORM_FLAVOR_OPTIONS.find((f) => f.value === input.preferredFlavor)?.label ??
    input.preferredFlavor;

  return [
    `Celebración: ${celebrationLabel}`,
    `Personas: ${input.guestCount}`,
    `Sabor preferido: ${flavorLabel}`,
    `Descripción: ${input.cakeDescription}`,
  ];
}
