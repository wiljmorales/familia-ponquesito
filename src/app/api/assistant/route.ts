import { AssistantInputError, askAssistant } from "@/assistant/service";

export async function POST(request: Request) {
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
    const reply = await askAssistant(body);
    return Response.json(reply);
  } catch (error) {
    if (error instanceof AssistantInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("Error inesperado del asistente:", error);
    return Response.json(
      { error: "Ocurrió un error inesperado. Intenta de nuevo." },
      { status: 500 },
    );
  }
}
