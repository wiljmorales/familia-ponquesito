"use server";

import { randomUUID } from "node:crypto";
import { cakeRequestSchema, MAX_IMAGE_SIZE_BYTES } from "@/lib/validations/cake-request";
import { detectImageType, extensionForImageType } from "@/lib/utils/image-signature";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { CAKE_REFERENCES_BUCKET, CAKE_REQUESTS_TABLE } from "@/lib/supabase/config";

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

  let referenceImagePath: string | null = null;
  const file = formData.get("referenceImage");

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return {
        ok: false,
        message: "Revisa los datos marcados en el formulario.",
        fieldErrors: { referenceImage: "La imagen supera el máximo de 5 MB." },
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

    const fileName = `${randomUUID()}.${extensionForImageType(imageType)}`;

    try {
      const supabase = getSupabaseServiceClient();
      const { error: uploadError } = await supabase.storage
        .from(CAKE_REFERENCES_BUCKET)
        .upload(fileName, bytes, { contentType: imageType, upsert: false });

      if (uploadError) throw uploadError;
      referenceImagePath = fileName;
    } catch (error) {
      console.error("[cake-request] fallo al subir la imagen de referencia", error);
      return { ok: false, message: GENERIC_ERROR_MESSAGE };
    }
  }

  try {
    const supabase = getSupabaseServiceClient();
    const { error: insertError } = await supabase.from(CAKE_REQUESTS_TABLE).insert({
      customer_name: values.customerName,
      whatsapp: values.whatsapp,
      celebration_date: values.celebrationDate,
      celebration_type: values.celebrationType,
      guest_count: values.guestCount,
      preferred_flavor: values.preferredFlavor,
      cake_description: values.cakeDescription,
      reference_image_path: referenceImagePath,
    });

    if (insertError) throw insertError;
  } catch (error) {
    console.error("[cake-request] fallo al guardar la solicitud", error);

    // La imagen ya se subió pero la solicitud no quedó registrada: borrarla
    // para no dejar un archivo huérfano en el bucket sin ninguna fila que
    // lo referencie.
    if (referenceImagePath) {
      const supabase = getSupabaseServiceClient();
      const { error: cleanupError } = await supabase.storage
        .from(CAKE_REFERENCES_BUCKET)
        .remove([referenceImagePath]);
      if (cleanupError) {
        console.error(
          "[cake-request] no se pudo limpiar la imagen huérfana",
          referenceImagePath,
          cleanupError,
        );
      }
    }

    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }

  return { ok: true, message: "¡Recibimos tu solicitud!" };
}
