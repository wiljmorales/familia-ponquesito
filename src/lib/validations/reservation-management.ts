import { z } from "zod";

const codeSchema = z
  .string()
  .trim()
  .regex(/^FP-8-[2-9A-HJKMNP-Z]{4}$/, "Enlace de gestión inválido.");

const tokenSchema = z
  .string()
  .min(32, "Enlace de gestión inválido.")
  .max(256, "Enlace de gestión inválido.");

export const reservationCredentialSchema = z.object({
  code: codeSchema,
  token: tokenSchema,
});

export const reservationAvailabilitySchema = reservationCredentialSchema.extend({
  monthISO: z.string().regex(/^\d{4}-\d{2}$/, "Mes inválido."),
});

export const reservationRescheduleSchema = reservationCredentialSchema.extend({
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Selecciona una fecha válida."),
  confirmed: z.literal(true, "Confirma expresamente la nueva fecha."),
});

export const reservationCancellationSchema = reservationCredentialSchema.extend({
  confirmed: z.literal(true, "Confirma expresamente la cancelación."),
});
