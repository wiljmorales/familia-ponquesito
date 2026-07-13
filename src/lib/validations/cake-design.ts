import { z } from "zod";
import { MAX_GUEST_COUNT } from "@/lib/constants/business";
import { minCelebrationDateString } from "@/lib/validations/cake-request";
import { normalizeWhatsapp } from "@/lib/utils/whatsapp";
import {
  BASE_OPTIONS,
  MAX_MESSAGE_LENGTH,
  PLAQUE_OPTIONS,
  STAND_OPTIONS,
  TOPPER_OPTIONS,
} from "@/lib/cake-builder/options";

const STAND_IDS = STAND_OPTIONS.map((o) => o.id) as [string, ...string[]];
const PLAQUE_IDS = PLAQUE_OPTIONS.map((o) => o.id) as [string, ...string[]];
const TOPPER_IDS = TOPPER_OPTIONS.map((o) => o.id) as [string, ...string[]];

/**
 * Valida la estructura del CakeDesign que llega del cliente contra el
 * catálogo real de opciones (no solo tipos): un id que no exista en
 * options.ts se rechaza, así el jsonb guardado en Supabase siempre es
 * reconstruible.
 */
export const cakeDesignSchema = z
  .object({
    version: z.literal(1),
    tiers: z.union([z.literal(1), z.literal(2)]),
    baseVariant: z.string(),
    standVariant: z.enum(STAND_IDS, "Diseño inválido."),
    plaqueVariant: z.enum(PLAQUE_IDS, "Diseño inválido.").nullable(),
    message: z.string().trim().max(MAX_MESSAGE_LENGTH, "Mensaje demasiado largo."),
    topperVariant: z.enum(TOPPER_IDS, "Diseño inválido.").nullable(),
  })
  .refine((design) => BASE_OPTIONS[design.tiers].some((o) => o.id === design.baseVariant), {
    message: "Diseño inválido.",
    path: ["baseVariant"],
  });

export type CakeDesignPayload = z.infer<typeof cakeDesignSchema>;

export const cakeDesignRequestSchema = z.object({
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
    .union([z.literal(""), z.string().trim().max(160).email("Ingresa un correo válido.")])
    .transform((value) => (value ? value : null)),

  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Selecciona una fecha válida.")
    .refine(
      (value) => value >= minCelebrationDateString(),
      "Selecciona una fecha con al menos 3 días de anticipación.",
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

  zone: z
    .string()
    .trim()
    .min(2, "Cuéntanos la zona de entrega o retiro.")
    .max(120, "La zona es demasiado larga."),

  // Campo trampa para spam: debe llegar vacío.
  companyWebsite: z.string().max(0, "Solicitud inválida."),
});

export type CakeDesignRequestValues = z.output<typeof cakeDesignRequestSchema>;
