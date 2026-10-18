import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "x-forwarded-for": "192.0.2.10" })) }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/backend/client", () => ({ backendPost: vi.fn() }));
vi.mock("@/email/client", () => ({ defaultEmailClient: vi.fn() }));

import { after } from "next/server";
import { backendPost } from "@/lib/backend/client";
import { defaultEmailClient, type EmailClient } from "@/email/client";
import { requestReservationLinkRecovery } from "./recover-reservation";

const send = vi.fn<EmailClient["send"]>(async () => ({ ok: true, providerId: "local" }));

function form(email = "synthetic@example.invalid"): FormData {
  const data = new FormData();
  data.set("code", "FP-8-K7M2");
  data.set("email", email);
  return data;
}

beforeEach(() => {
  vi.mocked(after).mockReset();
  vi.mocked(backendPost).mockReset();
  send.mockClear();
  vi.mocked(defaultEmailClient).mockReturnValue({ send });
});

describe("requestReservationLinkRecovery", () => {
  it("responde sin esperar a SMTP y envía el enlace después, solo al correo guardado", async () => {
    vi.mocked(backendPost).mockResolvedValue({ ok: true, deliver: true, recipient: "stored@example.invalid" });

    const result = await requestReservationLinkRecovery(form());

    expect(send).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledTimes(1);
    const sentHash = (vi.mocked(backendPost).mock.calls[0][1] as Record<string, string>).new_token_hash;
    expect(sentHash).toMatch(/^[0-9a-f]{64}$/);

    await (vi.mocked(after).mock.calls[0][0] as () => Promise<void>)();
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][0];
    expect(message.to).toBe("stored@example.invalid");
    expect(message.text).toContain("/agenda/reservas/FP-8-K7M2?token=");
    expect(message.text).not.toContain(sentHash);
    expect(result.message).toContain("Si el código y el correo coinciden");
  });

  it("da la misma respuesta cuando no hay coincidencia y no programa correo", async () => {
    vi.mocked(backendPost).mockResolvedValue({ ok: true, deliver: false });
    const miss = await requestReservationLinkRecovery(form("other@example.invalid"));

    vi.mocked(backendPost).mockRejectedValue(new Error("API caída"));
    const down = await requestReservationLinkRecovery(form());

    vi.mocked(backendPost).mockResolvedValue({ ok: true, deliver: true, recipient: "stored@example.invalid" });
    const hit = await requestReservationLinkRecovery(form());

    expect(miss).toEqual(hit);
    expect(down).toEqual(hit);
    expect(after).toHaveBeenCalledTimes(1);
  });
});
