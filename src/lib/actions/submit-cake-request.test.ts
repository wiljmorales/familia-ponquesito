import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/backend/client", () => ({ backendPost: vi.fn() }));
vi.mock("@/leads/service", () => ({ processLead: vi.fn() }));

import { backendPost } from "@/lib/backend/client";
import { addDaysISO, businessTodayISO } from "@/lib/business-dates";
import { submitCakeRequest } from "./submit-cake-request";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1]);

function form(image: File): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    customerName: "Cliente sintético",
    whatsapp: "+584120000000",
    email: "synthetic@example.invalid",
    celebrationDate: addDaysISO(businessTodayISO(), 30),
    celebrationType: "cumpleanos",
    guestCount: "10",
    preferredFlavor: "chocolate",
    cakeDescription: "Descripción sintética suficiente",
    companyWebsite: "",
  })) data.set(key, value);
  data.set("referenceImage", image);
  return data;
}

beforeEach(() => {
  vi.mocked(backendPost).mockReset();
  vi.mocked(backendPost).mockResolvedValue({ ok: true, id: "00000000-0000-4000-8000-000000000001" });
});

describe("submitCakeRequest → Django", () => {
  it("envía el MIME detectado por firma, no el declarado por el navegador", async () => {
    // Un JPEG real con extensión y tipo de PNG: antes Django lo rechazaba.
    const result = await submitCakeRequest(form(new File([JPEG], "foto.png", { type: "image/png" })));

    expect(result.ok).toBe(true);
    const payload = vi.mocked(backendPost).mock.calls[0][1] as FormData;
    const image = payload.get("reference_image") as File;
    expect(image.type).toBe("image/jpeg");
    expect(image.name).toBe("reference");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(JPEG);
  });

  it("no llama a Django si el contenido no es una imagen permitida", async () => {
    const fake = new File([new TextEncoder().encode("no es una imagen real")], "x.jpg", { type: "image/jpeg" });
    const result = await submitCakeRequest(form(fake));

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.referenceImage).toBeDefined();
    expect(backendPost).not.toHaveBeenCalled();
  });
});
