import { AssistantInputError, askAssistant } from "@/assistant/service";
import { AssistantProviderError } from "@/providers/gemini";

const PROVIDER_ERROR_MESSAGES: Record<AssistantProviderError["kind"], string> =
  {
    quota:
      "Estoy recibiendo muchas consultas en este momento. Espera unos minutos e intenta de nuevo, por favor.",
    timeout:
      "Me tomó demasiado tiempo preparar la respuesta. Intenta de nuevo, por favor.",
    unavailable:
      "El asistente no está disponible en este momento. Intenta de nuevo en unos minutos, por favor.",
    network:
      "No pude conectarme para preparar tu respuesta. Intenta de nuevo, por favor.",
  };

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
    if (error instanceof AssistantProviderError) {
      // Detalle técnico solo al log del servidor; al usuario, mensaje amable.
      console.error(`Fallo del proveedor (${error.kind}):`, error.message);
      return Response.json(
        { error: PROVIDER_ERROR_MESSAGES[error.kind] },
        { status: error.kind === "quota" ? 429 : 503 },
      );
    }
    console.error("Error inesperado del asistente:", error);
    return Response.json(
      { error: "Ocurrió un error inesperado. Intenta de nuevo." },
      { status: 500 },
    );
  }
}
