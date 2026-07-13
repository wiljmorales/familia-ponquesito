/**
 * Normaliza un número de WhatsApp a formato internacional cuando es
 * reconocible. Acepta formatos venezolanos locales (0414xxxxxxx) e
 * internacionales (+58 414 xxx xxxx, +1 305 ...).
 */
export function normalizeWhatsapp(raw: string): string {
  const trimmed = raw.trim();
  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === 0) return trimmed;

  // Formato local venezolano: 0412/0414/0416/0424/0426 + 7 dígitos.
  if (!hadPlus && digits.length === 11 && digits.startsWith("0")) {
    return `+58${digits.slice(1)}`;
  }

  // Ya incluye el código de país de Venezuela sin "+".
  if (!hadPlus && digits.length === 12 && digits.startsWith("58")) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

/**
 * Agrega un mensaje prellenado a un enlace de WhatsApp del negocio
 * (`NEXT_PUBLIC_WHATSAPP_URL`), sin asumir su formato exacto: respeta si
 * ya trae query params propios.
 */
export function buildWhatsappMessageUrl(baseUrl: string, message: string): string {
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}text=${encodeURIComponent(message)}`;
}
