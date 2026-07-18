"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import Button from "@/components/ui/Button";
import TextareaField from "@/components/ui/TextareaField";
import { AGENT_DEMO_CASES } from "@/agent/demo-cases";
import {
  clearAgentResults,
  loadAgentResults,
  saveAgentResults,
} from "@/agent/demo-storage";
import {
  CASE_STATUS_LABEL,
  DECISION_SOURCE_LABEL,
  INTENT_LABEL,
  ROUTE_LABEL,
  URGENCY_LABEL,
} from "@/agent/labels";
import type { AgentCaseResult, AgentCaseStatus, AgentUrgency } from "@/agent/types";

/**
 * Consola de demostración del Agente de Atención Ponquesito (Reto 7).
 * Todo lo que se muestra viene del servidor (decisión real por mensaje):
 * aquí no hay estados escritos a mano ni contadores estáticos.
 */

const MAX_MESSAGE_LENGTH = 1000;

const STATUS_CHIP_CLASSES: Record<AgentCaseStatus, string> = {
  lead_registered: "border-terracotta/40 bg-terracotta/10 text-terracotta-dark",
  answered: "border-gold/60 bg-gold/15 text-cocoa",
  waiting_information: "border-yellow/60 bg-yellow/20 text-cocoa",
  escalated_to_human: "border-cocoa bg-cocoa text-cream-light",
  not_executed: "border-border-soft bg-cream text-text-secondary",
};

const URGENCY_CHIP_CLASSES: Record<AgentUrgency, string> = {
  low: "text-text-secondary",
  normal: "text-cocoa",
  high: "font-medium text-cocoa",
  critical: "font-semibold text-terracotta-dark",
};

/** Resumen superior: cada contador se deriva del estado real de la demo. */
function summarize(results: AgentCaseResult[]) {
  const byStatus: Record<AgentCaseStatus, number> = {
    lead_registered: 0,
    answered: 0,
    waiting_information: 0,
    escalated_to_human: 0,
    not_executed: 0,
  };
  for (const result of results) byStatus[result.execution.status] += 1;
  return { total: results.length, byStatus };
}

interface RequestPayload {
  message?: string;
  demoCaseId?: string;
}

interface ConsoleState {
  results: AgentCaseResult[];
  /** false hasta leer sessionStorage; evita escrituras antes de la lectura. */
  hydrated: boolean;
}

type ConsoleAction =
  | { type: "hydrate"; results: AgentCaseResult[] | null }
  | { type: "add"; result: AgentCaseResult }
  | { type: "reset" };

function consoleReducer(state: ConsoleState, action: ConsoleAction): ConsoleState {
  switch (action.type) {
    case "hydrate":
      return { results: action.results ?? state.results, hydrated: true };
    case "add":
      return { ...state, results: [action.result, ...state.results] };
    case "reset":
      return { ...state, results: [] };
  }
}

export default function AgentConsole() {
  const [message, setMessage] = useState("");
  const [state, dispatch] = useReducer(consoleReducer, { results: [], hydrated: false });
  const [processingKeys, setProcessingKeys] = useState<string[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { results } = state;

  // Rehidratación DESPUÉS del montaje, con una acción explícita (mismo
  // patrón del Reto 5): el HTML del servidor y la hidratación del cliente
  // coinciden siempre; sin nada guardado no pasa nada.
  useEffect(() => {
    dispatch({ type: "hydrate", results: loadAgentResults(window.sessionStorage) });
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    saveAgentResults(window.sessionStorage, results);
  }, [results, state.hydrated]);

  const busy = processingKeys.length > 0 || batchRunning;

  const analyze = useCallback(async (payload: RequestPayload, key: string) => {
    setError(null);
    setProcessingKeys((keys) => [...keys, key]);
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const errorMessage =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : "No se pudo procesar el mensaje. Intenta de nuevo, por favor.";
        throw new Error(errorMessage);
      }
      dispatch({ type: "add", result: data as AgentCaseResult });
      return true;
    } catch (requestError) {
      setError(
        requestError instanceof Error && requestError.message
          ? requestError.message
          : "No se pudo procesar el mensaje. Intenta de nuevo, por favor.",
      );
      return false;
    } finally {
      setProcessingKeys((keys) => keys.filter((candidate) => candidate !== key));
    }
  }, []);

  const handleFreeMessage = async () => {
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      setError("Escribe un mensaje para analizarlo.");
      return;
    }
    const ok = await analyze({ message: trimmed }, "libre");
    if (ok) setMessage("");
  };

  const handleBatch = async () => {
    setBatchRunning(true);
    try {
      // Secuencial a propósito: respeta el rate limit y muestra cada
      // decisión apareciendo en orden.
      for (const demoCase of AGENT_DEMO_CASES) {
        const ok = await analyze({ demoCaseId: demoCase.id }, demoCase.id);
        if (!ok) break;
      }
    } finally {
      setBatchRunning(false);
    }
  };

  const handleReset = () => {
    const confirmed = window.confirm(
      "Se borrarán los resultados de la demostración en esta pestaña. ¿Reiniciar la demo?",
    );
    if (!confirmed) return;
    dispatch({ type: "reset" });
    setError(null);
    clearAgentResults(window.sessionStorage);
  };

  const summary = summarize(results);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-cream">
      <header className="sticky top-0 z-40 border-b border-border-soft bg-cream-light/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <Image
              src="/images/logo/icon.png"
              alt="Familia Ponquesito"
              width={605}
              height={745}
              className="h-10 w-auto sm:h-12"
              priority
            />
            <span className="flex flex-col leading-none">
              <span className="font-script text-xl sm:text-2xl">
                <span className="text-cocoa">Familia </span>
                <span className="text-terracotta">Ponquesito</span>
              </span>
              <span className="text-[0.55rem] font-sans uppercase tracking-[0.25em] text-text-secondary">
                Agente de Atención · Demostración
              </span>
            </span>
          </div>

          <nav aria-label="Navegación de la demostración" className="flex items-center gap-1 sm:gap-2">
            {results.length > 0 && (
              <button
                type="button"
                onClick={handleReset}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-cocoa transition-colors hover:text-terracotta focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RotateCcw aria-hidden className="size-4" />
                <span>
                  Reiniciar <span className="hidden sm:inline">demostración</span>
                </span>
              </button>
            )}
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-cocoa transition-colors hover:text-terracotta focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-dark"
            >
              <span>
                Ir al sitio<span className="hidden sm:inline"> principal</span>
              </span>
            </Link>
          </nav>
        </div>
        <p className="border-t border-gold/30 bg-gold/15 py-1 text-center text-xs text-cocoa">
          Demostración del Reto 7 (Platzi Vibe Coding Challenge) — las fuentes de los
          mensajes son simuladas y los datos de prueba están marcados como tales.
        </p>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <section aria-labelledby="titulo-agente" className="flex flex-col gap-2">
          <h1 id="titulo-agente" className="text-2xl font-semibold text-cocoa sm:text-3xl">
            Agente de Atención Ponquesito
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-text-secondary sm:text-base">
            Analiza mensajes, comprende la intención y decide qué proceso del negocio
            activar: la máquina de leads (Reto 4), la base de conocimiento (Reto 1),
            una solicitud de datos, la revisión de un pedido (Reto 5) o la
            intervención directa de Karem.
          </p>
        </section>

        {results.length > 0 && (
          <section aria-label="Resumen de la demostración" className="mt-6">
            <ul className="flex flex-wrap gap-2 text-xs font-medium">
              <li className="rounded-full border border-cocoa/30 bg-cream-light px-3 py-1 text-cocoa">
                {summary.total} analizado{summary.total === 1 ? "" : "s"}
              </li>
              {(Object.keys(summary.byStatus) as AgentCaseStatus[])
                .filter((status) => summary.byStatus[status] > 0)
                .map((status) => (
                  <li
                    key={status}
                    className={`rounded-full border px-3 py-1 ${STATUS_CHIP_CLASSES[status]}`}
                  >
                    {summary.byStatus[status]} · {CASE_STATUS_LABEL[status]}
                  </li>
                ))}
            </ul>
          </section>
        )}

        <section
          aria-labelledby="titulo-mensaje-libre"
          className="mt-6 rounded-2xl border border-border-soft bg-cream-light p-4 sm:p-5"
        >
          <h2 id="titulo-mensaje-libre" className="text-base font-semibold text-cocoa">
            Escribe un mensaje como si fueras un cliente
          </h2>
          <form
            className="mt-3 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void handleFreeMessage();
            }}
          >
            <TextareaField
              label="Mensaje del cliente"
              name="mensaje-cliente"
              rows={3}
              maxLength={MAX_MESSAGE_LENGTH}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={busy}
              hint="Ejemplo: “Quiero una torta de vainilla para 20 personas el sábado, ¿cómo reservo?”"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" loading={processingKeys.includes("libre")} disabled={busy}>
                Analizar mensaje
              </Button>
              <span className="text-xs text-text-secondary">
                Los mensajes escritos aquí no traen datos de contacto: si el agente
                decide registrar un lead, primero los pedirá.
              </span>
            </div>
          </form>
        </section>

        <section aria-labelledby="titulo-casos" className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="titulo-casos" className="text-base font-semibold text-cocoa">
              Los cinco casos de demostración
            </h2>
            <Button
              type="button"
              variant="outline"
              loading={batchRunning}
              disabled={busy}
              onClick={() => void handleBatch()}
            >
              Procesar los 5 casos
            </Button>
          </div>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {AGENT_DEMO_CASES.map((demoCase, index) => (
              <li
                key={demoCase.id}
                className="flex flex-col gap-2 rounded-2xl border border-border-soft bg-cream-light p-4"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-cocoa">
                    Caso {index + 1} — {demoCase.title}
                  </h3>
                </div>
                <p className="text-xs text-text-secondary">{demoCase.sourceLabel}</p>
                <blockquote className="border-l-2 border-terracotta/40 pl-3 text-sm italic leading-relaxed text-cocoa">
                  “{demoCase.message}”
                </blockquote>
                <p className="text-xs text-text-secondary">
                  Esperado: {demoCase.expectation}
                </p>
                <div className="mt-auto pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="!px-4 !py-2 text-xs"
                    loading={processingKeys.includes(demoCase.id)}
                    disabled={busy}
                    onClick={() => void analyze({ demoCaseId: demoCase.id }, demoCase.id)}
                  >
                    Procesar este caso
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        <section aria-labelledby="titulo-resultados" className="mt-8" aria-live="polite">
          <h2 id="titulo-resultados" className="text-base font-semibold text-cocoa">
            Decisiones del agente
          </h2>
          {results.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-border-soft bg-cream-light/60 px-4 py-6 text-center text-sm text-text-secondary">
              Todavía no hay mensajes procesados. Analiza un mensaje libre o
              procesa los casos de demostración.
            </p>
          ) : (
            <ol className="mt-3 flex flex-col gap-4">
              {results.map((result, index) => (
                <li key={`${results.length - index}-${result.input.demoCaseId ?? "libre"}`}>
                  <ResultCard result={result} />
                </li>
              ))}
            </ol>
          )}
        </section>

        <section
          aria-labelledby="titulo-narrativa"
          className="mt-10 rounded-2xl border border-border-soft bg-cream-light p-4 sm:p-5"
        >
          <h2 id="titulo-narrativa" className="text-sm font-semibold text-cocoa">
            El agente es el cerebro que conecta las capacidades anteriores
          </h2>
          <ol className="mt-2 space-y-1 text-xs leading-relaxed text-text-secondary">
            <li>Reto 1: el sistema responde preguntas.</li>
            <li>Retos 2 y 3: captura solicitudes.</li>
            <li>Reto 4: automatiza nuevos leads.</li>
            <li>Reto 5: ayuda a gestionar pedidos.</li>
            <li>Reto 6: reporta resultados.</li>
            <li>
              Reto 7: comprende cualquier mensaje y decide qué capacidad utilizar.
            </li>
          </ol>
        </section>
      </main>

      <footer className="border-t border-border-soft bg-cream-light">
        <p className="mx-auto max-w-4xl px-4 py-4 text-center text-xs text-text-secondary">
          Agente de Atención · Familia Ponquesito ·{" "}
          <Link
            href="/"
            className="underline underline-offset-2 transition-colors hover:text-terracotta"
          >
            Volver al sitio principal
          </Link>
        </p>
      </footer>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[0.7rem] font-medium uppercase tracking-wide text-text-secondary">
        {label}
      </dt>
      <dd className="text-sm leading-relaxed text-cocoa">{children}</dd>
    </div>
  );
}

function ResultCard({ result }: { result: AgentCaseResult }) {
  const { decision, execution } = result;
  return (
    <article className="rounded-2xl border border-border-soft bg-cream-light p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-secondary">
          {result.input.sourceLabel}
          {result.input.demoCaseId ? ` · ${result.input.demoCaseId}` : ""}
        </span>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded-full border px-2.5 py-0.5 font-medium ${STATUS_CHIP_CLASSES[execution.status]}`}
          >
            {CASE_STATUS_LABEL[execution.status]}
          </span>
          <span className="rounded-full border border-border-soft bg-cream px-2.5 py-0.5 text-text-secondary">
            {DECISION_SOURCE_LABEL[result.decisionSource]}
          </span>
        </div>
      </header>

      <blockquote className="mt-3 border-l-2 border-terracotta/40 pl-3 text-sm italic leading-relaxed text-cocoa">
        “{result.input.message}”
      </blockquote>

      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Field label="Intención detectada">{INTENT_LABEL[decision.intent]}</Field>
        <Field label="Urgencia · Confianza">
          <span className={URGENCY_CHIP_CLASSES[decision.urgency]}>
            {URGENCY_LABEL[decision.urgency]}
          </span>{" "}
          · {Math.round(decision.confidence * 100)} %
        </Field>
        <Field label="Motivo">{decision.reason}</Field>
        <Field label="Ruta seleccionada">{ROUTE_LABEL[result.route]}</Field>
        {decision.detectedOrderCode && (
          <Field label="Pedido identificado">{decision.detectedOrderCode}</Field>
        )}
        <Field label="Acción ejecutada">
          {execution.executedAction}
          {execution.details.length > 0 && (
            <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-text-secondary">
              {execution.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </Field>
        <Field label="Registro">
          {result.persisted
            ? "Decisión registrada en la base de datos (agent_decisions)."
            : "Sin registro en base de datos en este entorno; la decisión solo vive en esta demo."}
        </Field>
      </dl>

      {result.guardrailCorrections.length > 0 && (
        <div className="mt-4 rounded-xl border border-gold/50 bg-gold/10 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-cocoa">
            Reglas deterministas del negocio aplicadas
          </p>
          <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-cocoa">
            {result.guardrailCorrections.map((correction) => (
              <li key={correction.rule}>{correction.description}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-medium text-cocoa transition-colors hover:text-terracotta">
          Línea de tiempo de la decisión
        </summary>
        <ol className="mt-2 space-y-1 border-l border-border-soft pl-4 text-xs leading-relaxed text-text-secondary">
          {result.timeline.map((step, index) => (
            <li key={`${index}-${step.slice(0, 24)}`}>→ {step}</li>
          ))}
        </ol>
      </details>
    </article>
  );
}
