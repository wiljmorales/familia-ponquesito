/**
 * Datos reales del negocio (Barquisimeto, Venezuela), tomados de
 * `src/knowledge/familia-ponquesito.md` (Reto 1). Nada aquí se inventa: lo
 * que no está confirmado se deja explícitamente sin valor.
 */

export const BUSINESS_NAME = "Familia Ponquesito";
export const SLOGAN = "Hecho con amor, para compartir.";
/** Zona de cobertura principal del delivery (no es la dirección del local). */
export const LOCATION_LABEL = "Este de Barquisimeto, Venezuela";

/**
 * Local físico, confirmado en octubre de 2026 (ver docs/decisions.md). Es la
 * dirección de public/linktree.html; src/lib/location-official.test.ts
 * comprueba que el Linktree, esta constante y la base de conocimiento
 * coincidan.
 */
export const BUSINESS_ADDRESS = {
  street: "Carrera 19 entre calles 8 y 9",
  reference: "detrás del Rectorado de la UCLA",
  city: "Barquisimeto",
  region: "Lara",
  country: "Venezuela",
} as const;

export const BUSINESS_ADDRESS_TEXT = [
  BUSINESS_ADDRESS.street,
  BUSINESS_ADDRESS.reference,
  BUSINESS_ADDRESS.city,
  BUSINESS_ADDRESS.region,
  BUSINESS_ADDRESS.country,
].join(", ");

export const INSTAGRAM_HANDLE = "@familiaponquesito";
export const INSTAGRAM_URL = "https://www.instagram.com/familiaponquesito";

/**
 * WhatsApp oficial del negocio (+58 424-8532526), confirmado en octubre de
 * 2026 (ver docs/decisions.md). Sigue viniendo de la variable pública
 * `NEXT_PUBLIC_WHATSAPP_URL` (base `https://wa.me/584248532526`, sin
 * mensaje): se graba en el build y, si un entorno no la define, el footer y
 * "Continuar por WhatsApp" no se muestran. El staging del VPS la fija en
 * deploy/web/staging.build.env; src/lib/whatsapp-official.test.ts comprueba
 * que coincida con el botón de public/linktree.html.
 */
export const WHATSAPP_URL = process.env.NEXT_PUBLIC_WHATSAPP_URL?.trim() || null;

/** Mensaje prellenado de pedido: el mismo del botón de /linktree. */
export const ORDER_WHATSAPP_MESSAGE = "Hola Familia Ponquesito, quiero hacer un pedido.";

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

/** Métodos de pago confirmados (ver src/knowledge/familia-ponquesito.md). */
export const PAYMENT_METHODS = [
  "Pago Móvil",
  "Transferencia bancaria",
  "Efectivo",
  "Binance",
  "Mercantil Panamá",
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
