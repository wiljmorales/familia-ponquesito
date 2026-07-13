import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente de Supabase con la service role key. Solo debe importarse desde
 * código de servidor (Server Actions, route handlers). El paquete
 * `server-only` hace fallar el build si algún día se importa por error
 * desde un componente de cliente.
 */
export function getSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase no está configurado: define NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
