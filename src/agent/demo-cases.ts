/**
 * Los cinco casos obligatorios de demostración del Reto 7. Nada aquí es un
 * cliente real: los mensajes vienen del enunciado del Platzi Vibe Coding
 * Challenge y las fuentes llevan "(simulado)" de forma explícita.
 *
 * Este módulo es importable desde el cliente (la página los muestra), así
 * que NO contiene datos de contacto: el contacto simulado del caso 1 se
 * resuelve en servidor (ver resolveDemoContact en service.ts), porque
 * depende de variables de entorno privadas.
 */

export interface AgentDemoCase {
  id: string;
  title: string;
  /** Resultado que el enunciado espera; visible como guía en la demo. */
  expectation: string;
  sourceLabel: string;
  message: string;
  /**
   * true cuando el canal simulado aporta datos de contacto del remitente
   * (como haría WhatsApp con el número): solo el caso 1 los necesita para
   * que la máquina de leads pueda registrar el lead de verdad.
   */
  hasSimulatedContact: boolean;
}

export const AGENT_DEMO_CASES: AgentDemoCase[] = [
  {
    id: "caso-1",
    title: "Nueva oportunidad lista para cotizar",
    expectation: "Lead registrado con la máquina de leads del Reto 4.",
    sourceLabel: "WhatsApp (simulado)",
    message:
      "Hola, necesito una torta de chocolate para el cumpleaños de mi hija dentro de ocho días. Seremos 30 personas y puedo pagar hoy el anticipo.",
    hasSimulatedContact: true,
  },
  {
    id: "caso-2",
    title: "Consulta general",
    expectation: "Respuesta con la base de conocimiento, sin crear lead.",
    sourceLabel: "Instagram (simulado)",
    message:
      "¿Qué sabores tienen, hacen delivery al este de Barquisimeto y puedo pagar con Binance?",
    hasSimulatedContact: false,
  },
  {
    id: "caso-3",
    title: "Información insuficiente",
    expectation: "Solicitud de los datos que faltan, sin inventar precios.",
    sourceLabel: "WhatsApp (simulado)",
    message: "Hola, quiero una torta. ¿Cuánto cuesta?",
    hasSimulatedContact: false,
  },
  {
    id: "caso-4",
    title: "Cambio urgente de pedido",
    expectation: "Pedido PED-001 identificado y escalado a Karem sin confirmar el cambio.",
    sourceLabel: "WhatsApp (simulado)",
    message:
      "Hola, soy la persona del pedido PED-001. Quiero cambiar el sabor a chocolate y la celebración es mañana.",
    hasSimulatedContact: false,
  },
  {
    id: "caso-5",
    title: "Caso sensible",
    expectation: "Respuesta automática detenida y caso escalado a revisión humana.",
    sourceLabel: "Correo (simulado)",
    message:
      "Uno de los invitados tiene una alergia severa. ¿Pueden garantizar que la torta no tendrá ningún contacto con el alérgeno?",
    hasSimulatedContact: false,
  },
];

export function findDemoCase(id: string | null): AgentDemoCase | null {
  if (!id) return null;
  return AGENT_DEMO_CASES.find((demoCase) => demoCase.id === id) ?? null;
}
