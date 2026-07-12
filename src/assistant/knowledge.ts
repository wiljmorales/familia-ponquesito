import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Lector de la base de conocimiento (solo servidor).
 * `src/knowledge/familia-ponquesito.md` es la única fuente de verdad
 * comercial del asistente.
 */

const KNOWLEDGE_PATH = path.join(
  process.cwd(),
  "src",
  "knowledge",
  "familia-ponquesito.md",
);

let cached: string | null = null;

export function getKnowledgeBase(): string {
  /* En desarrollo se relee en cada consulta para que los cambios en el
     markdown se reflejen sin reiniciar el servidor. */
  if (process.env.NODE_ENV !== "production") {
    return readFileSync(KNOWLEDGE_PATH, "utf8");
  }
  if (cached === null) {
    cached = readFileSync(KNOWLEDGE_PATH, "utf8");
  }
  return cached;
}
