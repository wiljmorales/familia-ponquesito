import { randomInt } from "node:crypto";

// Sin 0/O/1/I/L: se muestra al cliente y se lee en voz alta por WhatsApp,
// así que evita caracteres que se confunden entre sí.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 4;

export function generateDesignCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `FP-3-${code}`;
}
