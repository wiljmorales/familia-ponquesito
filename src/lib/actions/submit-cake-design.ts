"use server";

import { cakeDesignRequestSchema, cakeDesignSchema } from "@/lib/validations/cake-design";
import { generateDesignCode } from "@/lib/cake-builder/design-code";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { CAKE_DESIGNS_TABLE } from "@/lib/supabase/config";

export interface SubmitCakeDesignResult {
  ok: boolean;
  message: string;
  designCode?: string;
  fieldErrors?: Record<string, string>;
}

const GENERIC_ERROR_MESSAGE =
  "No pudimos guardar tu diseño en este momento. Inténtalo nuevamente o contáctanos por Instagram.";

const UNIQUE_VIOLATION = "23505";
const MAX_CODE_ATTEMPTS = 5;

export async function submitCakeDesign(formData: FormData): Promise<SubmitCakeDesignResult> {
  // Campo trampa para spam: si un bot lo rellenó, respondemos como si todo
  // hubiera salido bien (sin escribir nada) para no revelarle que fue
  // detectado.
  const honeypot = formData.get("companyWebsite");
  if (typeof honeypot === "string" && honeypot.length > 0) {
    return { ok: true, message: "¡Listo!", designCode: undefined };
  }

  const parsedRequest = cakeDesignRequestSchema.safeParse({
    customerName: formData.get("customerName"),
    whatsapp: formData.get("whatsapp"),
    email: formData.get("email") ?? "",
    eventDate: formData.get("eventDate"),
    guestCount: formData.get("guestCount"),
    zone: formData.get("zone"),
    companyWebsite: formData.get("companyWebsite") ?? "",
  });

  if (!parsedRequest.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsedRequest.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !(key in fieldErrors)) {
        fieldErrors[key] = issue.message;
      }
    }
    return {
      ok: false,
      message: "Revisa los datos marcados en el formulario.",
      fieldErrors,
    };
  }

  const designRaw = formData.get("design");
  if (typeof designRaw !== "string") {
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }

  let designJson: unknown;
  try {
    designJson = JSON.parse(designRaw);
  } catch {
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }

  const parsedDesign = cakeDesignSchema.safeParse(designJson);
  if (!parsedDesign.success) {
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }

  const values = parsedRequest.data;

  // getSupabaseServiceClient() lanza si faltan las variables de entorno, y
  // el insert puede lanzar ante un fallo de red (no solo devolver
  // {error}). Todo el bloque va en try/catch, igual que
  // submit-cake-request.ts (Reto 2), para no dejar escapar un error crudo.
  try {
    const supabase = getSupabaseServiceClient();

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const designCode = generateDesignCode();
      const { error } = await supabase.from(CAKE_DESIGNS_TABLE).insert({
        design_code: designCode,
        design: parsedDesign.data,
        customer_name: values.customerName,
        whatsapp: values.whatsapp,
        email: values.email,
        event_date: values.eventDate,
        guest_count: values.guestCount,
        zone: values.zone,
      });

      if (!error) {
        return { ok: true, message: "¡Tu diseño ya está en manos de Familia Ponquesito!", designCode };
      }

      if (error.code !== UNIQUE_VIOLATION) {
        console.error("[cake-design] fallo al guardar el diseño", error);
        return { ok: false, message: GENERIC_ERROR_MESSAGE };
      }
      // Colisión de design_code (poco probable): reintenta con un código nuevo.
    }

    console.error("[cake-design] no se pudo generar un código de diseño único");
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  } catch (error) {
    console.error("[cake-design] fallo inesperado al guardar el diseño", error);
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }
}
