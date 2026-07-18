import { AGENT_ROUTES, type AgentDecision, type AgentRoute } from "./types";

/**
 * Router del agente (Reto 7): selecciona LA ruta final a partir de la
 * decisión ya validada (esquema) y corregida (guardrails). Cada mensaje
 * ejecuta exactamente una ruta; nunca dos. Defensivo por diseño: ante una
 * ruta desconocida (imposible tras el esquema, pero este es el último
 * punto antes de ejecutar) degrada a revisión humana en vez de fallar.
 */
export function routeAgentDecision(decision: AgentDecision): AgentRoute {
  if (!(AGENT_ROUTES as readonly string[]).includes(decision.route)) {
    return "human_escalation";
  }
  return decision.route;
}
