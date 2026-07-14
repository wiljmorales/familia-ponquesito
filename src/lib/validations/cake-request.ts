import { z } from "zod";
import {
  CELEBRATION_TYPES,
  FORM_FLAVOR_OPTIONS,
  MAX_GUEST_COUNT,
  MIN_LEAD_DAYS,
} from "@/lib/constants/business";
import { normalizeWhatsapp } from "@/lib/utils/whatsapp";

const CELEBRATION_TYPE_VALUES = CELEBRATION_TYPES.map((c) => c.value) as [
  string,
  ...string[],
];
const FLAVOR_VALUES = FORM_FLAVOR_OPTIONS.map((f) => f.value) as [
  string,
  ...string[],
];

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

/** "YYYY-MM-DD" del día más próximo permitido, comparable como texto. */
export function minCelebrationDateString(): string {
  const now = new Date();
  const min = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  min.setUTCDate(min.getUTCDate() + MIN_LEAD_DAYS);
  return min.toISOString().slice(0, 10);
}

export const cakeRequestSchema = z.object({
  customerName: z
    .string()
    .trim()
    .min(2, "Ingresa tu nombre completo.")
    .max(80, "El nombre es demasiado largo."),

  whatsapp: z
    .string()
    .trim()
    .min(1, "Ingresa tu número de WhatsApp.")
    .refine((value) => {
      const digits = value.replace(/\D/g, "");
      return digits.length >= 7 && digits.length <= 15;
    }, "Ingresa un número de WhatsApp válido.")
    .transform(normalizeWhatsapp),

  email: z
    .string()
    .trim()
    .min(1, "Ingresa tu correo.")
    .max(160, "El correo es demasiado largo.")
    .email("Ingresa un correo válido."),

  celebrationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Selecciona una fecha válida.")
    .refine(
      (value) => value >= minCelebrationDateString(),
      `Selecciona una fecha con al menos ${MIN_LEAD_DAYS} días de anticipación.`,
    ),

  celebrationType: z.enum(
    CELEBRATION_TYPE_VALUES,
    "Selecciona el tipo de celebración.",
  ),

  guestCount: z
    .string()
    .trim()
    .min(1, "Ingresa el número aproximado de personas.")
    .regex(/^\d+$/, "Ingresa solo números.")
    .transform((value) => Number(value))
    .refine((value) => value >= 1, "Debe ser al menos 1 persona.")
    .refine(
      (value) => value <= MAX_GUEST_COUNT,
      `Ingresa un número menor o igual a ${MAX_GUEST_COUNT}.`,
    ),

  preferredFlavor: z.enum(FLAVOR_VALUES, "Selecciona un sabor."),

  cakeDescription: z
    .string()
    .trim()
    .min(10, "Cuéntanos un poco más sobre la torta que imaginas (mínimo 10 caracteres).")
    .max(1000, "La descripción es demasiado larga (máximo 1000 caracteres)."),

  // Campo trampa para spam: debe llegar vacío. Los bots suelen rellenar
  // todos los campos de un formulario, incluido este (oculto para personas).
  companyWebsite: z.string().max(0, "Solicitud inválida."),
});

export type CakeRequestValues = z.output<typeof cakeRequestSchema>;
