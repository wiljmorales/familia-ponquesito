import { AgentInputError, processAgentMessage } from "@/agent/service";
import { createRateLimiter } from "../assistant/rate-limit";

/**
 * Endpoint del Agente de Atención (Reto 7). Mismo criterio del asistente
 * del Reto 1: rate limiting por IP antes de tocar Gemini, entradas
 * inválidas → 400 con mensaje claro, y nunca detalles técnicos internos
 * en la respuesta.
 */

// El flujo completo puede encadenar Gemini (análisis), el asistente del
// Reto 1 (consultas) y la máquina de leads (correos): margen holgado.
export const maxDuration = 60;

/* Procesar los 5 casos en lote son 5 peticiones; 10/min deja espacio para
   probar mensajes libres sin permitir un bucle abusivo. */
const isAllowed = createRateLimiter({ limit: 10, windowMs: 60_000 });

function clientKey(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}

export async function POST(request: Request) {
  if (!isAllowed(clientKey(request))) {
    return Response.json(
      {
        error:
          "Ha enviado muchos mensajes en poco tiempo. Espere un momento e intente de nuevo, por favor.",
      },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "El cuerpo de la solicitud debe ser JSON válido." },
      { status: 400 },
    );
  }

  try {
    const result = await processAgentMessage(body);
    return Response.json(result);
  } catch (error) {
    if (error instanceof AgentInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    // processAgentMessage no debería lanzar por otra causa; cinturón final.
    console.error("[agent] fallo inesperado en el endpoint", error);
    return Response.json(
      { error: "No se pudo procesar el mensaje en este momento. Intente de nuevo, por favor." },
      { status: 500 },
    );
  }
}
