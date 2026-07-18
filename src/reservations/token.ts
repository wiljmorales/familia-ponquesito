import { createHash, randomBytes } from "node:crypto";

/**
 * Tokens del enlace privado de gestión de una reserva. El token en claro
 * viaja UNA sola vez: del servidor al correo del cliente (dentro del
 * enlace). En base de datos solo vive su hash SHA-256; el token jamás se
 * registra en logs, eventos, leads ni en el correo interno de Karem.
 */

const TOKEN_RANDOM_BYTES = 32;

export interface ManageToken {
  /** Token en claro (base64url), solo para construir el enlace del correo. */
  token: string;
  /** SHA-256 del token en hex (64 caracteres); lo único que se persiste. */
  tokenHash: string;
}

export function generateManageToken(): ManageToken {
  const token = randomBytes(TOKEN_RANDOM_BYTES).toString("base64url");
  return { token, tokenHash: hashManageToken(token) };
}

export function hashManageToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
