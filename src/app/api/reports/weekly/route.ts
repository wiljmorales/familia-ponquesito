import { handleWeeklyReportRequest } from "./handler";

// Node.js explícito: el flujo usa Nodemailer (SMTP), que no corre en edge.
export const runtime = "nodejs";
// El reporte puede tomar varios segundos (consultas + Gemini con timeout de
// 15 s + SMTP con un reintento); 60 s es el máximo configurable en Hobby.
export const maxDuration = 60;

export async function GET(request: Request) {
  return handleWeeklyReportRequest(request);
}
