/**
 * Persistencia de la demo del agente (Reto 7) en sessionStorage, bajo una
 * clave versionada propia — mismo patrón del prototipo del Reto 5
 * (src/lib/prototype/storage.ts): defensivo ante JSON corrupto, versiones
 * desconocidas y storages que lanzan; recibe el storage como parámetro
 * para poder probarse en node con un doble.
 *
 * Se guardan los resultados ya procesados (vienen del servidor, que es
 * quien decide): recargar la página no repite análisis ni reejecuta rutas.
 */

import type { AgentCaseResult } from "./types";

export const AGENT_DEMO_STORAGE_KEY = "familia-ponquesito:agente:v1";

const STORAGE_VERSION = 1;

/** Suficiente para la demo (5 casos + mensajes libres de la sesión). */
const MAX_STORED_RESULTS = 20;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Chequeo estructural mínimo: los datos son nuestros (los guardó esta
 * misma página), pero un item que no pueda renderizarse se descarta en
 * vez de romper la demo.
 */
function isPlausibleResult(value: unknown): value is AgentCaseResult {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const input = record.input as Record<string, unknown> | undefined;
  const decision = record.decision as Record<string, unknown> | undefined;
  const execution = record.execution as Record<string, unknown> | undefined;
  return (
    typeof input?.message === "string" &&
    typeof decision?.intent === "string" &&
    typeof execution?.status === "string" &&
    Array.isArray(record.timeline) &&
    Array.isArray(record.guardrailCorrections)
  );
}

/** Lee los resultados guardados; null si no hay nada utilizable (nunca lanza). */
export function loadAgentResults(storage: StorageLike): AgentCaseResult[] | null {
  try {
    const raw = storage.getItem(AGENT_DEMO_STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const record = parsed as Record<string, unknown>;
    if (record.version !== STORAGE_VERSION) return null;
    if (!Array.isArray(record.results)) return null;

    const results = record.results.filter(isPlausibleResult);
    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

/** Guarda los resultados (acotados); con lista vacía limpia la clave. */
export function saveAgentResults(storage: StorageLike, results: AgentCaseResult[]): void {
  try {
    if (results.length === 0) {
      storage.removeItem(AGENT_DEMO_STORAGE_KEY);
      return;
    }
    storage.setItem(
      AGENT_DEMO_STORAGE_KEY,
      JSON.stringify({
        version: STORAGE_VERSION,
        results: results.slice(0, MAX_STORED_RESULTS),
      }),
    );
  } catch {
    // Sin persistencia la demo sigue funcionando; no hay nada que romper.
  }
}

/** Borra el estado guardado (botón "Reiniciar demostración"). */
export function clearAgentResults(storage: StorageLike): void {
  try {
    storage.removeItem(AGENT_DEMO_STORAGE_KEY);
  } catch {
    // Ídem: fallar en silencio es el comportamiento deseado.
  }
}
