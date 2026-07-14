import { randomInt } from "node:crypto";

// Sin 0/O/1/I/L: se muestra al cliente y se lee en voz alta por WhatsApp,
// así que evita caracteres que se confunden entre sí.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 4;

/**
 * Genera un código de referencia legible con el formato `${prefix}-XXXX`
 * (ej. `FP-2-A7K2`, `FP-3-2WRZ`). Compartido entre las distintas fuentes de
 * leads para no reimplementar el mismo alfabeto/formato en cada una.
 */
export function generateReferenceCode(prefix: string): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${prefix}-${code}`;
}
