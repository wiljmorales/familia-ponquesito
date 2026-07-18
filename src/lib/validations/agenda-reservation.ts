import { z } from "zod";
import { FORM_FLAVOR_OPTIONS, MAX_GUEST_COUNT } from "@/lib/constants/business";
import { normalizeWhatsapp } from "@/lib/utils/whatsapp";

/**
 * Validaciones del wizard de Agenda Ponquesito (Reto 8). El paso 1 ("Tu
 * torta") y el paso 3 ("Tus datos") tienen su propio esquema para validar
 * cada formulario por separado; el envío final valida todo junto más la
 * fecha. La clasificación en puntos NUNCA se recibe del navegador: el
 * servidor la recalcula con classifyOrder a partir de estas respuestas.
 */

const FLAVOR_VALUES = FORM_FLAVOR_OPTIONS.map((f) => f.value) as [string, ...string[]];

export const TIERS_VALUES = ["one", "two_or_more"] as const;
const YES_NO = ["yes", "no"] as const;

/** Paso 1 — Tu torta: respuestas cerradas + descripción libre. */
export const agendaOrderSchema = z.object({
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

  // .pipe: la entrada del formulario es un string libre ("" cuando no se ha
  // respondido) y la salida queda tipada con el enum.
  tiers: z
    .string()
    .pipe(z.enum(TIERS_VALUES, "Cuéntanos si tu torta llevará uno o varios pisos.")),

  isCustomDesign: z
    .string()
    .pipe(z.enum(YES_NO, "Cuéntanos si quieres decoración personalizada.")),

  hasReferenceImage: z
    .string()
    .pipe(z.enum(YES_NO, "Cuéntanos si tienes una imagen de referencia.")),

  designDescription: z
    .string()
    .trim()
    .min(10, "Cuéntanos un poco más sobre la torta que imaginas (mínimo 10 caracteres).")
    .max(1000, "La descripción es demasiado larga (máximo 1000 caracteres)."),

  flavor: z.enum(FLAVOR_VALUES, "Selecciona un sabor."),

  theme: z
    .string()
    .trim()
    .max(120, "El tema es demasiado largo (máximo 120 caracteres).")
    .transform((value) => (value === "" ? undefined : value)),
});

export type AgendaOrderValues = z.output<typeof agendaOrderSchema>;

const contactShape = {
  customerName: z
    .string()
    .trim()
    .min(2, "Ingresa tu nombre completo.")
    .max(80, "El nombre es demasiado largo."),

  email: z
    .string()
    .trim()
    .min(1, "Ingresa tu correo.")
    .max(160, "El correo es demasiado largo.")
    .email("Ingresa un correo válido."),

  phone: z
    .string()
    .trim()
    .min(1, "Ingresa tu número de WhatsApp.")
    .refine((value) => {
      const digits = value.replace(/\D/g, "");
      return digits.length >= 7 && digits.length <= 15;
    }, "Ingresa un número de WhatsApp válido.")
    .transform(normalizeWhatsapp),

  fulfillmentType: z
    .string()
    .pipe(
      z.enum(["pickup", "delivery"], "Cuéntanos si retiras tu torta o prefieres delivery."),
    ),

  deliveryDetails: z
    .string()
    .trim()
    .max(400, "La dirección es demasiado larga (máximo 400 caracteres).")
    .transform((value) => (value === "" ? undefined : value)),

  // Campo trampa para spam: debe llegar vacío (mismo criterio del Reto 2).
  companyWebsite: z.string().max(0, "Solicitud inválida."),
};

function requireDeliveryDetails(
  values: { fulfillmentType: string; deliveryDetails?: string },
  ctx: z.RefinementCtx,
) {
  if (values.fulfillmentType === "delivery" && !values.deliveryDetails) {
    ctx.addIssue({
      code: "custom",
      path: ["deliveryDetails"],
      message: "Indícanos la dirección o zona de entrega.",
    });
  }
}

/** Paso 3 — Tus datos: contacto y entrega. */
export const agendaContactSchema = z.object(contactShape).superRefine(requireDeliveryDetails);

export type AgendaContactValues = z.output<typeof agendaContactSchema>;

/** Envío final: pedido + fecha elegida + datos de contacto. */
export const agendaReservationSchema = z
  .object({
    ...agendaOrderSchema.shape,
    ...contactShape,
    celebrationDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Selecciona una fecha en el calendario."),
  })
  .superRefine(requireDeliveryDetails);

export type AgendaReservationValues = z.output<typeof agendaReservationSchema>;
