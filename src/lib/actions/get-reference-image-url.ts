"use server";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { CAKE_REFERENCES_BUCKET } from "@/lib/supabase/config";

const DEFAULT_EXPIRES_IN_SECONDS = 60 * 60; // 1 hora

/**
 * Genera una URL firmada temporal para ver una imagen de referencia
 * guardada en el bucket privado cake-references. No existe URL pública ni
 * firmada guardada en la base de datos (expiraría); esta función es la
 * única forma prevista de visualizar una imagen, y solo debe llamarse
 * desde código de servidor (usa la service role key).
 */
export async function getReferenceImageSignedUrl(
  path: string,
  expiresInSeconds: number = DEFAULT_EXPIRES_IN_SECONDS,
): Promise<string | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.storage
    .from(CAKE_REFERENCES_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data) {
    console.error("[cake-request] no se pudo generar la signed URL", path, error);
    return null;
  }

  return data.signedUrl;
}
