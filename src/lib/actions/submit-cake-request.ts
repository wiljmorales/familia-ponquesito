"use server";

import { after } from "next/server";
import {
  cakeRequestSchema,
  MAX_IMAGE_SIZE_BYTES,
  MAX_IMAGE_SIZE_LABEL,
} from "@/lib/validations/cake-request";
import { detectImageType } from "@/lib/utils/image-signature";
import { backendPost } from "@/lib/backend/client";
import { processLead } from "@/leads/service";
import { describeCakeRequest } from "@/leads/cake-request-summary";

export interface SubmitCakeRequestResult {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
}

const GENERIC_ERROR_MESSAGE =
  "No pudimos enviar tu solicitud en este momento. Inténtalo nuevamente o contáctanos por WhatsApp.";

export async function submitCakeRequest(
  formData: FormData,
): Promise<SubmitCakeRequestResult> {
  // Campo trampa para spam: si un bot lo rellenó, respondemos como si todo
  // hubiera salido bien (sin escribir nada) para no revelarle que fue
  // detectado.
  const honeypot = formData.get("companyWebsite");
  if (typeof honeypot === "string" && honeypot.length > 0) {
    return { ok: true, message: "¡Recibimos tu solicitud!" };
  }

  const parsed = cakeRequestSchema.safeParse({
    customerName: formData.get("customerName"),
    whatsapp: formData.get("whatsapp"),
    email: formData.get("email"),
    celebrationDate: formData.get("celebrationDate"),
    celebrationType: formData.get("celebrationType"),
    guestCount: formData.get("guestCount"),
    preferredFlavor: formData.get("preferredFlavor"),
    cakeDescription: formData.get("cakeDescription"),
    companyWebsite: formData.get("companyWebsite") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
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

  const values = parsed.data;

  const file = formData.get("referenceImage");
  let referenceImage: Blob | null = null;

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return {
        ok: false,
        message: "Revisa los datos marcados en el formulario.",
        fieldErrors: { referenceImage: `La imagen supera el máximo de ${MAX_IMAGE_SIZE_LABEL}.` },
      };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const imageType = detectImageType(bytes);

    if (!imageType) {
      return {
        ok: false,
        message: "Revisa los datos marcados en el formulario.",
        fieldErrors: {
          referenceImage: "Solo se aceptan imágenes JPG, PNG o WebP.",
        },
      };
    }

    // Django exige que el MIME coincida con la firma: se envían los bytes
    // ya verificados con el tipo detectado, no el que declaró el navegador.
    referenceImage = new Blob([bytes], { type: imageType });
  }

  try {
    const payload = new FormData();
    payload.set("customer_name", values.customerName);
    payload.set("whatsapp", values.whatsapp);
    payload.set("email", values.email);
    payload.set("celebration_date", values.celebrationDate);
    payload.set("celebration_type", values.celebrationType);
    payload.set("guest_count", String(values.guestCount));
    payload.set("preferred_flavor", values.preferredFlavor);
    payload.set("cake_description", values.cakeDescription);
    if (referenceImage) payload.set("reference_image", referenceImage, "reference");
    const inserted = await backendPost<{ ok: boolean; id?: string; reference_image_path?: string | null }>("cake-request", payload);
    if (!inserted.ok || !inserted.id) throw new Error("No se pudo guardar la solicitud.");
    const sourceId = inserted.id;

    // La automatización (registrar el lead, clasificarlo, enviar los
    // correos) corre después de responder al usuario: un fallo de correo
    // nunca debe bloquear ni demorar la confirmación de que su solicitud
    // ya quedó guardada (eso ya ocurrió arriba).
    after(() =>
      processLead({
        source: "cake_request",
        sourceId,
        customerName: values.customerName,
        customerWhatsapp: values.whatsapp,
        customerEmail: values.email,
        celebrationDate: values.celebrationDate,
        summaryLines: describeCakeRequest({
          celebrationType: values.celebrationType,
          guestCount: values.guestCount,
          preferredFlavor: values.preferredFlavor,
          cakeDescription: values.cakeDescription,
        }),
        normalizedPayload: {
          celebrationType: values.celebrationType,
          guestCount: values.guestCount,
          preferredFlavor: values.preferredFlavor,
          cakeDescription: values.cakeDescription,
          referenceImagePath: inserted.reference_image_path ?? null,
        },
        referenceImagePath: inserted.reference_image_path ?? null,
      }),
    );
  } catch {
    console.error("[cake-request] fallo al guardar la solicitud");
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }

  return { ok: true, message: "¡Recibimos tu solicitud!" };
}
