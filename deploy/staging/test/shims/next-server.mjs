// after() real necesita el contexto de petición de Next.js; aquí se encola y la prueba lo espera.
export * from "next/server.js";
export function after(task) {
  (globalThis.__fpAfter ??= []).push(Promise.resolve().then(typeof task === "function" ? task : () => task));
}
