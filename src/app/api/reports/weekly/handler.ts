import {
  generateWeeklyReport,
  type GenerateWeeklyReportResult,
} from "@/reports/service";
import type { WeeklyReportTrigger } from "@/reports/types";

type GenerateFn = (trigger: WeeklyReportTrigger) => Promise<GenerateWeeklyReportResult>;

/**
 * Respuesta JSON sin caché: el resultado de una corrida jamás debe
 * reutilizarse para la siguiente.
 */
function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Handler del cron semanal (y de la verificación manual protegida).
 * Fino a propósito: valida autorización y trigger, delega en
 * generateWeeklyReport y traduce el resultado a HTTP. La respuesta solo
 * contiene información segura (estado y periodo) — nunca destinatario,
 * métricas, resumen, secretos ni errores internos; el detalle técnico va
 * solo a los logs del servidor (ya sanitizado por el servicio).
 *
 * `generate` es inyectable para probar el handler sin Supabase ni SMTP.
 */
export async function handleWeeklyReportRequest(
  request: Request,
  generate: GenerateFn = generateWeeklyReport,
): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // Sin secreto configurado no hay forma de autorizar a nadie: se
    // rechaza todo en vez de ejecutar un cron desprotegido.
    console.error("[reports] CRON_SECRET no está configurado; el reporte no puede dispararse.");
    return json({ ok: false, status: "not_configured" }, 503);
  }

  // Nunca registrar el header Authorization: contiene un secreto (válido o
  // no). El secreto tampoco se acepta por query param (quedaría en logs de
  // acceso e historiales).
  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${cronSecret}`) {
    return json({ ok: false, status: "unauthorized" }, 401);
  }

  // Vercel Cron llama sin query params (= scheduled); ?trigger=manual es
  // la verificación manual protegida con el mismo secreto.
  const triggerParam = new URL(request.url).searchParams.get("trigger");
  if (triggerParam !== null && triggerParam !== "scheduled" && triggerParam !== "manual") {
    return json({ ok: false, status: "invalid_trigger" }, 400);
  }
  const trigger: WeeklyReportTrigger = triggerParam === "manual" ? "manual" : "scheduled";

  const result = await generate(trigger);
  const ok = result.outcome === "sent" || result.outcome === "skipped_duplicate";

  if (!ok) {
    // Detalle solo al log del servidor; el servicio ya sanitiza (redacta la
    // contraseña SMTP y nunca incluye datos personales).
    console.error(
      `[reports] la corrida ${trigger} del periodo ${result.period.start}–${result.period.end} terminó en ${result.outcome}: ${result.error ?? "sin detalle"}`,
    );
  }

  return json(
    {
      ok,
      status: result.outcome,
      periodStart: result.period.start,
      periodEnd: result.period.end,
      ...(result.reportId ? { reportId: result.reportId } : {}),
    },
    ok ? 200 : 500,
  );
}
