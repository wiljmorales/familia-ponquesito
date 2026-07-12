/**
 * Datos reales del negocio (Barquisimeto, Venezuela), tomados de
 * `src/knowledge/familia-ponquesito.md` (Reto 1). Nada aquí se inventa: lo
 * que no está confirmado se deja explícitamente sin valor.
 */

export const BUSINESS_NAME = "Familia Ponquesito";
export const SLOGAN = "Hecho con amor, para compartir.";
export const LOCATION_LABEL = "Este de Barquisimeto, Venezuela";

export const INSTAGRAM_HANDLE = "@familiaponquesito";
export const INSTAGRAM_URL = "https://www.instagram.com/familiaponquesito";

/**
 * No hay un número de WhatsApp de negocio confirmado: la base de
 * conocimiento del Reto 1 solo documenta Instagram como canal de contacto.
 * Se deja configurable por variable de entorno pública en vez de inventar
 * un número; si no está definida, el footer no muestra el enlace. Ver
 * "Preguntas pendientes" en docs/challenge-2.md.
 */
export const WHATSAPP_URL = process.env.NEXT_PUBLIC_WHATSAPP_URL?.trim() || null;

export const MIN_LEAD_DAYS = 3;
export const DEPOSIT_PERCENT = 50;
export const MAX_GUEST_COUNT = 500;

/** Los cuatro sabores reales confirmados del negocio (sin inventar más). */
export const FLAVORS = [
  { value: "vainilla", label: "Vainilla" },
  { value: "chocolate", label: "Chocolate" },
  { value: "red_velvet", label: "Red velvet" },
  { value: "tres_leches", label: "Tres leches" },
] as const;

/** Opciones del selector de sabor en el formulario (incluye "no estoy seguro"). */
export const FORM_FLAVOR_OPTIONS = [
  ...FLAVORS,
  { value: "no_seguro", label: "Aún no estoy seguro" },
] as const;

export const CELEBRATION_TYPES = [
  { value: "cumpleanos", label: "Cumpleaños" },
  { value: "aniversario", label: "Aniversario" },
  { value: "graduacion", label: "Graduación" },
  { value: "boda", label: "Boda" },
  { value: "infantil", label: "Celebración infantil" },
  { value: "reunion_familiar", label: "Reunión familiar" },
  { value: "otro", label: "Otro" },
] as const;

export const CONDITIONS = [
  { label: "Pedidos con mínimo 3 días de anticipación" },
  { label: "No se aceptan pedidos para el mismo día" },
  { label: "Reserva con el 50 % del monto" },
  { label: "Delivery disponible con costo adicional" },
  { label: "Entregas todos los días" },
  { label: "Atención para pedidos hasta las 9:00 p. m." },
  { label: "Cobertura principal en el este de Barquisimeto" },
] as const;
