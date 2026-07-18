import { afterEach, describe, expect, it, vi } from "vitest";

// El handler importa el servicio del reporte, que (con sus dependencias)
// importa "server-only"; en Vitest no hay bundler que distinga
// cliente/servidor, así que se neutraliza aquí.
vi.mock("server-only", () => ({}));

import type { GenerateWeeklyReportResult } from "@/reports/service";
import { handleWeeklyReportRequest } from "./handler";

const SECRET = "secreto-de-prueba-cron";

function makeRequest(options: { auth?: string; query?: string } = {}): Request {
  const url = `http://localhost/api/reports/weekly${options.query ?? ""}`;
  const headers = new Headers();
  if (options.auth !== undefined) headers.set("authorization", options.auth);
  return new Request(url, { headers });
}

function makeResult(
  overrides: Partial<GenerateWeeklyReportResult> = {},
): GenerateWeeklyReportResult {
  return {
    outcome: "sent",
    reportId: "report-1",
    period: { start: "2026-07-06", end: "2026-07-12" },
    ...overrides,
  };
}

function fakeGenerate(result: GenerateWeeklyReportResult) {
  return vi.fn(async () => result);
}

describe("handleWeeklyReportRequest", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sin CRON_SECRET configurado responde 503 y no invoca el servicio", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const generate = fakeGenerate(makeResult());

    const response = await handleWeeklyReportRequest(
      makeRequest({ auth: `Bearer ${SECRET}` }),
      generate,
    );

    expect(response.status).toBe(503);
    expect(generate).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: false, status: "not_configured" });
  });

  it("sin header Authorization responde 401 y no invoca el servicio", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const generate = fakeGenerate(makeResult());

    const response = await handleWeeklyReportRequest(makeRequest(), generate);

    expect(response.status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });

  it("con un Bearer incorrecto responde 401 y no invoca el servicio", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const generate = fakeGenerate(makeResult());

    const response = await handleWeeklyReportRequest(
      makeRequest({ auth: "Bearer otro-secreto" }),
      generate,
    );

    expect(response.status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });

  it("el secreto por query param NO autoriza (solo el header)", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const generate = fakeGenerate(makeResult());

    const response = await handleWeeklyReportRequest(
      makeRequest({ query: `?secret=${SECRET}` }),
      generate,
    );

    expect(response.status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });

  it("con el Bearer correcto y sin query params ejecuta el servicio como scheduled", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const generate = fakeGenerate(makeResult());

    const response = await handleWeeklyReportRequest(
      makeRequest({ auth: `Bearer ${SECRET}` }),
      generate,
    );

    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith("scheduled");
  });

  it("?trigger=manual ejecuta el servicio como manual", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const generate = fakeGenerate(makeResult());

    await handleWeeklyReportRequest(
      makeRequest({ auth: `Bearer ${SECRET}`, query: "?trigger=manual" }),
      generate,
    );

    expect(generate).toHaveBeenCalledWith("manual");
  });

  it("un trigger desconocido responde 400 sin invocar el servicio", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const generate = fakeGenerate(makeResult());

    const response = await handleWeeklyReportRequest(
      makeRequest({ auth: `Bearer ${SECRET}`, query: "?trigger=cualquiera" }),
      generate,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, status: "invalid_trigger" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("sent responde 200 con estado, periodo y reportId", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    const response = await handleWeeklyReportRequest(
      makeRequest({ auth: `Bearer ${SECRET}` }),
      fakeGenerate(makeResult()),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      status: "sent",
      periodStart: "2026-07-06",
      periodEnd: "2026-07-12",
      reportId: "report-1",
    });
  });

  it("skipped_duplicate responde 200 (una omisión programada no es un fallo)", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    const response = await handleWeeklyReportRequest(
      makeRequest({ auth: `Bearer ${SECRET}` }),
      fakeGenerate(makeResult({ outcome: "skipped_duplicate", reportId: null })),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("skipped_duplicate");
    expect(body).not.toHaveProperty("reportId");
  });

  it("email_error responde 500 sin filtrar el error interno", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handleWeeklyReportRequest(
      makeRequest({ auth: `Bearer ${SECRET}` }),
      fakeGenerate(makeResult({ outcome: "email_error", error: "smtp caído en el host X" })),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      status: "email_error",
      periodStart: "2026-07-06",
      periodEnd: "2026-07-12",
      reportId: "report-1",
    });
    expect(JSON.stringify(body)).not.toContain("smtp caído");
  });

  it("data_error responde 500", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handleWeeklyReportRequest(
      makeRequest({ auth: `Bearer ${SECRET}` }),
      fakeGenerate(
        makeResult({ outcome: "data_error", reportId: null, error: "detalle interno" }),
      ),
    );

    expect(response.status).toBe(500);
    expect((await response.json()).status).toBe("data_error");
  });

  it("ninguna respuesta expone el secreto, destinatarios ni errores internos", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const responses = [
      await handleWeeklyReportRequest(makeRequest(), fakeGenerate(makeResult())),
      await handleWeeklyReportRequest(
        makeRequest({ auth: `Bearer ${SECRET}` }),
        fakeGenerate(makeResult({ outcome: "email_error", error: "credencial xyz" })),
      ),
    ];

    for (const response of responses) {
      const text = JSON.stringify(await response.json());
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("@");
      expect(text).not.toContain("credencial");
    }
  });

  it("toda respuesta lleva Cache-Control: no-store", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    const unauthorized = await handleWeeklyReportRequest(makeRequest(), fakeGenerate(makeResult()));
    const success = await handleWeeklyReportRequest(
      makeRequest({ auth: `Bearer ${SECRET}` }),
      fakeGenerate(makeResult()),
    );

    expect(unauthorized.headers.get("Cache-Control")).toBe("no-store");
    expect(success.headers.get("Cache-Control")).toBe("no-store");
  });
});
