import "server-only";
import { backendPost } from "@/lib/backend/client";

/**
 * Pide a Django un enlace de una hora para una imagen asociada a una solicitud.
 * No es una Server Action: ningún componente cliente puede solicitar rutas.
 */
export async function getReferenceImageSignedUrl(path: string): Promise<string | null> {
  try {
    const result = await backendPost<{ ok: boolean; url?: string }>("image-link", { path });
    return result.ok ? result.url ?? null : null;
  } catch {
    console.error("[cake-request] no se pudo generar el enlace privado de imagen");
    return null;
  }
}
