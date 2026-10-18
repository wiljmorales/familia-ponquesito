"use server";

import { after } from "next/server";
import { cakeDesignRequestSchema, cakeDesignSchema } from "@/lib/validations/cake-design";
import { generateDesignCode } from "@/lib/cake-builder/design-code";
import { backendPost } from "@/lib/backend/client";
import { processLead } from "@/leads/service";
import { describeCakeDesign } from "@/lib/cake-builder/design-summary";

export interface SubmitCakeDesignResult {
  ok: boolean;
  message: string;
  designCode?: string;
  fieldErrors?: Record<string, string>;
}

const GENERIC_ERROR_MESSAGE =
  "No pudimos guardar tu diseño en este momento. Inténtalo nuevamente o contáctanos por Instagram.";

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

  // Django valida y persiste; nunca se envía una credencial de BD al navegador.
  try {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const designCode = generateDesignCode();
      const inserted = await backendPost<{ ok: boolean; id?: string; error?: string }>("cake-design", {
          design_code: designCode,
          design: parsedDesign.data,
          customer_name: values.customerName,
          whatsapp: values.whatsapp,
          email: values.email,
          event_date: values.eventDate,
          guest_count: values.guestCount,
          zone: values.zone,
      });

      if (inserted.ok && inserted.id) {
        const sourceId = inserted.id;
        // Igual que en submit-cake-request.ts: la automatización corre
        // después de responder, para que un fallo de correo nunca demore
        // ni bloquee la confirmación del diseño ya guardado.
        after(() =>
          processLead({
            source: "cake_design",
            sourceId,
            customerName: values.customerName,
            customerWhatsapp: values.whatsapp,
            customerEmail: values.email,
            celebrationDate: values.eventDate,
            summaryLines: describeCakeDesign(parsedDesign.data),
            normalizedPayload: {
              design: parsedDesign.data,
              guestCount: values.guestCount,
              zone: values.zone,
            },
            referenceCode: designCode,
          }),
        );

        return { ok: true, message: "¡Tu diseño ya está en manos de Familia Ponquesito!", designCode };
      }

      if (inserted.error !== "code_taken") {
        console.error("[cake-design] fallo al guardar el diseño");
        return { ok: false, message: GENERIC_ERROR_MESSAGE };
      }
      // Colisión de design_code (poco probable): reintenta con un código nuevo.
    }

    console.error("[cake-design] no se pudo generar un código de diseño único");
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  } catch {
    console.error("[cake-design] fallo inesperado al guardar el diseño");
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }
}
