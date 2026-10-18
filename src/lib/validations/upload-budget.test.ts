import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { CELEBRATION_TYPES, FORM_FLAVOR_OPTIONS } from "@/lib/constants/business";
import {
  cakeRequestSchema,
  MAX_GUEST_COUNT_INPUT_LENGTH,
  MAX_IMAGE_SIZE_BYTES,
  MAX_WHATSAPP_INPUT_LENGTH,
} from "./cake-request";

/** Límite de cuerpo de una función de Vercel (4,5 MB). Se toma la lectura
 * decimal, la más estricta; la comprobación real queda pendiente en Preview. */
const VERCEL_FUNCTION_BODY_LIMIT_BYTES = 4_500_000;
/** Holgura para diferencias de boundary y cabeceras entre navegadores. */
const MULTIPART_SLACK_BYTES = 16_384;

// Carácter de 3 bytes en UTF-8 que ocupa una sola unidad para .max() de zod:
// el peor caso de bytes por carácter permitido.
const wide = (length: number) => "€".repeat(length);
const longest = (values: readonly { value: string }[]) =>
  values.map((item) => item.value).reduce((a, b) => (b.length > a.length ? b : a));

/** El mismo cuerpo que envía el navegador al invocar submitCakeRequest(formData):
 * React prefija los campos con `_1_` y añade al final la raíz `0`. */
function worstCaseActionBody(): FormData {
  const body = new FormData();
  const fields: Record<string, string> = {
    customerName: wide(80),
    whatsapp: wide(MAX_WHATSAPP_INPUT_LENGTH),
    email: wide(160),
    celebrationDate: "2099-12-31",
    celebrationType: longest(CELEBRATION_TYPES),
    guestCount: "9".repeat(MAX_GUEST_COUNT_INPUT_LENGTH),
    preferredFlavor: longest(FORM_FLAVOR_OPTIONS),
    cakeDescription: wide(1000),
    companyWebsite: "",
  };
  for (const [key, value] of Object.entries(fields)) body.set(`_1_${key}`, value);
  // 255 bytes: el nombre de archivo más largo de los sistemas de archivos comunes.
  body.set("_1_referenceImage", new File([new Uint8Array(MAX_IMAGE_SIZE_BYTES)], wide(85), { type: "image/webp" }));
  body.set("0", '["$K1"]');
  return body;
}

describe("presupuesto de la subida de imagen", () => {
  it("el peor caso válido cabe en el límite de la Server Action y este en Vercel", async () => {
    const bytes = (await new Request("http://localhost/", { method: "POST", body: worstCaseActionBody() }).arrayBuffer()).byteLength;
    const limit = nextConfig.experimental?.serverActions?.bodySizeLimit;

    expect(typeof limit).toBe("number");
    expect(bytes).toBeGreaterThan(MAX_IMAGE_SIZE_BYTES);
    expect(bytes + MULTIPART_SLACK_BYTES).toBeLessThanOrEqual(limit as number);
    expect(limit as number).toBeLessThan(VERCEL_FUNCTION_BODY_LIMIT_BYTES);
  });

  // zod recorta antes de medir: un relleno de espacios no está acotado por la
  // validación, pero un cuerpo así supera bodySizeLimit y Next.js lo rechaza
  // antes de ejecutar la acción. Aquí se comprueban los máximos sin relleno.
  it("los máximos usados en el cálculo son los que impone la validación", () => {
    const valid = {
      customerName: "Cliente sintético",
      whatsapp: "+58 412 000 0000",
      email: "synthetic@example.invalid",
      celebrationDate: "2099-12-31",
      celebrationType: "cumpleanos",
      guestCount: "10",
      preferredFlavor: "chocolate",
      cakeDescription: "Descripción sintética suficiente",
      companyWebsite: "",
    };
    expect(cakeRequestSchema.safeParse(valid).success).toBe(true);
    for (const [field, value] of Object.entries({
      customerName: "a".repeat(81),
      whatsapp: "+58-412-000-0000" + "-".repeat(MAX_WHATSAPP_INPUT_LENGTH),
      email: `${"a".repeat(150)}@example.com`,
      guestCount: "0".repeat(MAX_GUEST_COUNT_INPUT_LENGTH) + "1",
      cakeDescription: "a".repeat(1001),
      companyWebsite: "x",
    })) {
      expect(cakeRequestSchema.safeParse({ ...valid, [field]: value }).success, field).toBe(false);
    }
  });
});
