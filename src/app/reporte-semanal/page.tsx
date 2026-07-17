import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import SectionHeading, { Em } from "@/components/ui/SectionHeading";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { WEEKLY_REPORTS_TABLE } from "@/lib/supabase/config";
import { DATA_DISCLAIMER } from "@/reports/metrics";
import {
  AutomationStatus,
  FlowDiagram,
  HistoryList,
  LatestReport,
  type HistoryRow,
  type LatestReportRow,
} from "./report-view";

export const metadata: Metadata = {
  title: "Pulso Ponquesito — Reporte semanal | Familia Ponquesito",
  description:
    "El reporte que se arma y se envía solo: cada lunes, la actividad registrada en Supabase se convierte en métricas y un resumen ejecutivo que llega por correo al negocio. Datos agregados y anonimizados.",
};

/**
 * Privacidad estructural: esta página consulta EXCLUSIVAMENTE
 * weekly_reports (métricas agregadas y resumen), nunca leads,
 * lead_automation_events, cake_requests ni cake_designs. Tampoco
 * selecciona recipient_masked, error_message ni id — nada de eso debe
 * llegar al navegador.
 */
async function fetchReports(): Promise<
  { ok: true; latest: LatestReportRow | null; history: HistoryRow[] } | { ok: false }
> {
  try {
    const supabase = getSupabaseServiceClient();

    const { data: latest, error: latestError } = await supabase
      .from(WEEKLY_REPORTS_TABLE)
      .select(
        "period_start, period_end, status, trigger_type, summary, summary_source, metrics, generated_at",
      )
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) {
      console.error("[reports] fallo al consultar el último reporte para la página", latestError);
      return { ok: false };
    }

    const { data: history, error: historyError } = await supabase
      .from(WEEKLY_REPORTS_TABLE)
      .select("period_start, period_end, trigger_type, status, generated_at")
      .order("generated_at", { ascending: false })
      .limit(5);

    if (historyError) {
      console.error("[reports] fallo al consultar el historial para la página", historyError);
      return { ok: false };
    }

    return {
      ok: true,
      latest: (latest as LatestReportRow | null) ?? null,
      history: (history ?? []) as HistoryRow[],
    };
  } catch (error) {
    // Incluye Supabase sin configurar: la página degrada con un mensaje
    // amable; el detalle queda solo en el log del servidor.
    console.error("[reports] no se pudo cargar la página del reporte semanal", error);
    return { ok: false };
  }
}

function Section({
  children,
  alt = false,
  labelledBy,
}: {
  children: React.ReactNode;
  alt?: boolean;
  labelledBy?: string;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={`border-t border-border-soft py-12 sm:py-16 ${alt ? "bg-cream-light" : "bg-cream"}`}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 sm:px-6 lg:px-8">{children}</div>
    </section>
  );
}

export default async function ReporteSemanalPage() {
  // Render por request (patrón del repo en esta versión de Next): el
  // último reporte debe ser el de verdad, nunca uno congelado en el build.
  await connection();
  const result = await fetchReports();

  const disclaimer =
    (result.ok && result.latest?.metrics?.dataDisclaimer) || DATA_DISCLAIMER;

  return (
    <>
      <Header />
      <main>
        {/* Presentación */}
        <section className="bg-cream py-14 sm:py-20">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-5 px-4 text-center sm:px-6 lg:px-8">
            <p className="rounded-full border border-terracotta/40 bg-terracotta/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-terracotta">
              Reto 6
            </p>
            <h1 className="font-serif text-4xl leading-tight text-cocoa sm:text-5xl">
              Pulso <Em>Ponquesito</Em>
            </h1>
            <p className="max-w-2xl text-base leading-relaxed text-text-secondary sm:text-lg">
              El reporte que se arma y se envía solo. Antes, saber cómo fue la
              semana exigía revisar registros a mano; ahora, cada lunes la
              actividad registrada se convierte automáticamente en métricas,
              prioridades y un resumen ejecutivo que llega por correo — sin que
              nadie tenga que pedirlo.
            </p>
            <p
              className="max-w-2xl rounded-2xl border border-gold/60 bg-gold/10 px-5 py-3 text-sm font-medium text-cocoa"
              role="note"
            >
              {disclaimer}
            </p>
            <Link
              href="/"
              className="text-sm font-semibold text-terracotta underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-dark"
            >
              ← Volver al sitio principal
            </Link>
          </div>
        </section>

        {/* Cómo funciona */}
        <Section alt labelledBy="flujo">
          <SectionHeading
            id="flujo"
            eyebrow="Automatización semanal"
            title="Cómo se arma el reporte"
            description="Cinco pasos, de los datos al correo, sin intervención manual."
          />
          <FlowDiagram />
          <AutomationStatus />
        </Section>

        {/* Último reporte */}
        <Section labelledBy="ultimo-reporte">
          <SectionHeading
            id="ultimo-reporte"
            eyebrow="Datos agregados y anonimizados"
            title="Último reporte"
            description="Lo mismo que recibe el negocio por correo, sin ningún dato personal."
          />
          {!result.ok ? (
            <p className="rounded-2xl border border-border-soft bg-cream-light p-6 text-center text-sm leading-relaxed text-text-secondary">
              No pudimos cargar el reporte en este momento. Intenta de nuevo
              más tarde, por favor.
            </p>
          ) : result.latest ? (
            <LatestReport report={result.latest} />
          ) : (
            <p className="rounded-2xl border border-border-soft bg-cream-light p-6 text-center text-sm leading-relaxed text-text-secondary">
              El flujo ya está configurado, pero todavía no hay una ejecución
              registrada. El primer reporte aparecerá aquí después del próximo
              lunes (o de una ejecución manual de verificación).
            </p>
          )}
        </Section>

        {/* Historial */}
        {result.ok && result.history.length > 0 && (
          <Section alt labelledBy="historial">
            <SectionHeading
              id="historial"
              eyebrow="Cada ejecución queda registrada"
              title="Historial reciente"
              description="Las últimas ejecuciones del reporte, con su resultado."
            />
            <HistoryList rows={result.history} />
          </Section>
        )}
      </main>
      <Footer />
    </>
  );
}
