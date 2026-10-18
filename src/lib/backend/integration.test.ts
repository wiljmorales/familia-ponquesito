import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { addDaysISO, businessTodayISO } from "@/lib/business-dates";
import { createHash } from "node:crypto";

vi.mock("server-only", () => ({}));
import { backendPost } from "./client";

async function freeLoopbackPort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Puerto local inválido");
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return address.port;
}

/** Requiere RUN_DJANGO_INTEGRATION=1 y PostgreSQL sintético ya migrado.
 * No forma parte de npm test ordinario para evitar depender de Docker/SMTP. */
describe.skipIf(process.env.RUN_DJANGO_INTEGRATION !== "1")("contrato Next.js → Django/PostgreSQL real", () => {
  it("solicitud, diseño, agenda, enlace, lead, agente y reporte usan el transporte real", async () => {
    const port = await freeLoopbackPort();
    const origin = `http://127.0.0.1:${port}`;
    const previousUrl = process.env.PONQUESITO_API_URL;
    const previousKey = process.env.PONQUESITO_INTERNAL_API_KEY;
    process.env.PONQUESITO_API_URL = origin;
    process.env.PONQUESITO_INTERNAL_API_KEY = "synthetic-integration-key";
    const child = spawn("backend/.venv/bin/python", ["backend/manage.py", "runserver", `127.0.0.1:${port}`, "--noreload"], {
      cwd: process.cwd(),
      env: { ...process.env, DJANGO_SECRET_KEY: "synthetic-test-only", DJANGO_ALLOWED_HOSTS: "127.0.0.1,localhost", PONQUESITO_PRIVATE_IMAGE_ROOT: "/tmp/fp-integration-images", PONQUESITO_INTERNAL_API_KEY: "synthetic-integration-key" },
      stdio: "ignore",
    });
    try {
      let ready = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        if (child.exitCode !== null) throw new Error("Django no arrancó en el entorno sintético");
        try {
          const response = await fetch(`${origin}/health/`);
          if (response.ok) { ready = true; break; }
        } catch { /* Aún no escucha. */ }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!ready) throw new Error("Django no respondió al health local");
      const day = addDaysISO(businessTodayISO(), 35);
      const form = new FormData();
      for (const [key, value] of Object.entries({ customer_name: "Cliente sintético", whatsapp: "+584120000000", email: "synthetic@example.invalid", celebration_date: day, celebration_type: "cumpleanos", guest_count: "10", preferred_flavor: "chocolate", cake_description: "Descripción sintética suficiente" })) form.set(key, value);
      const request = await backendPost<{ ok: boolean; id: string }>("cake-request", form);
      expect(request.ok).toBe(true);
      const design = await backendPost<{ ok: boolean; id: string }>("cake-design", { design_code: `FP-3-${port}`, design: { version: 1, tiers: 1, baseVariant: "one-tier-cream", standVariant: "stand-blush", plaqueVariant: null, message: "", topperVariant: null }, customer_name: "Cliente sintético", whatsapp: "+584120000000", email: "synthetic@example.invalid", event_date: day, guest_count: 10, zone: "Centro" });
      expect(design.ok).toBe(true);
      const tokenHash = createHash("sha256").update("synthetic-integration-token").digest("hex");
      const code = `FP-8-${port}`;
      const reserved = await backendPost<{ ok: boolean; reservation_id: string }>("agenda-reserve", { code, manage_token_hash: tokenHash, celebration_date: day, capacity_points: 1, status: "pending_deposit", customer_name: "Cliente sintético", customer_email: "synthetic@example.invalid", customer_phone: "+584120000000", guest_count: 10, flavor: "Chocolate", fulfillment_type: "pickup", order_details: { synthetic: true } });
      expect(reserved.ok).toBe(true);
      expect((await backendPost<{ ok: boolean }>("agenda-lookup", { code, token_hash: tokenHash })).ok).toBe(true);
      expect((await backendPost<{ ok: boolean }>("agenda-lookup", { code, token_hash: "0".repeat(64) })).ok).toBe(false);
      expect((await backendPost<{ ok: boolean }>("agenda-reschedule", { code, token_hash: tokenHash, new_date: addDaysISO(day, 1) })).ok).toBe(true);
      expect((await backendPost<{ ok: boolean }>("agenda-cancel", { code, token_hash: tokenHash })).ok).toBe(true);
      const lead = await backendPost<{ ok: boolean; id: string }>("lead-ensure", { source_type: "cake_request", source_id: request.id, reference_code: `FP-2-${port}`, customer_name: "Cliente sintético", customer_email: "synthetic@example.invalid", customer_whatsapp: "+584120000000", celebration_date: day, priority: "normal", normalized_payload: { synthetic: true } });
      expect(lead.ok).toBe(true);
      const agent = await backendPost<{ ok: boolean; id: string }>("agent-create", { source: "synthetic", input_content: "Hola", intent: "general_question", route: "knowledge_answer", urgency: "normal", confidence: 0.9, requires_human: false, reason: "prueba", missing_fields: [], recommended_action: "responder", guardrail_corrections: [], decision_source: "fallback", status: "processing" });
      expect(agent.ok).toBe(true);
      const report = await backendPost<{ ok: boolean; id: string }>("report-reserve", { period_start: addDaysISO(day, -7), period_end: day, trigger_type: "manual" });
      expect(report.ok).toBe(true);
    } finally {
      child.kill();
      if (previousUrl === undefined) delete process.env.PONQUESITO_API_URL;
      else process.env.PONQUESITO_API_URL = previousUrl;
      if (previousKey === undefined) delete process.env.PONQUESITO_INTERNAL_API_KEY;
      else process.env.PONQUESITO_INTERNAL_API_KEY = previousKey;
    }
  }, 20_000);
});
