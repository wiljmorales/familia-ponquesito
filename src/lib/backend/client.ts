import "server-only";

/** Transporte privado Vercel -> Django. Nunca se importa desde un componente cliente. */
export async function backendPost<T>(operation: string, payload: Record<string, unknown> | FormData): Promise<T> {
  const origin = process.env.PONQUESITO_API_URL;
  const key = process.env.PONQUESITO_INTERNAL_API_KEY;
  const testLoopback = process.env.NODE_ENV === "test" && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin ?? "");
  if (!origin || !key || (!origin.startsWith("https://") && !testLoopback)) {
    throw new Error("La API de negocio no está configurada.");
  }
  if (!/^[a-z][a-z-]*$/.test(operation)) throw new Error("Operación inválida.");
  const isForm = payload instanceof FormData;
  const response = await fetch(`${origin.replace(/\/$/, "")}/api/v1/internal/${operation}/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(isForm ? {} : { "Content-Type": "application/json" }),
    },
    body: isForm ? payload : JSON.stringify(payload),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  // Nunca imprimir body/URL/Authorization: pueden contener datos privados.
  if (response.status === 401 || response.status === 503) throw new Error("La API de negocio no está disponible.");
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Respuesta inválida de la API de negocio.");
  }
  return (await response.json()) as T;
}
