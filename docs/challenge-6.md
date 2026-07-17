# Reto 6 — "Pulso Ponquesito": el reporte que se arma y se envía solo

Ver `docs/product-brief.md` para el contexto general del producto.

## Resumen del reto

Un reporte semanal automático que consulta los datos reales de Supabase
(`leads` y `lead_automation_events`), los transforma en métricas y
prioridades, genera un resumen ejecutivo (Gemini cuando está disponible,
fallback determinístico siempre), envía el correo a Karem por el SMTP de
Gmail existente (Reto 4), registra cada ejecución en `weekly_reports` y se
dispara automáticamente con Vercel Cron (lunes 12:00 UTC ≈ 8:00 a. m. de
Venezuela). Una página pública `/reporte-semanal` muestra el último reporte
con datos exclusivamente agregados y anonimizados.

**Estado: etapas 1–4 implementadas** (esquema, métricas, resumen, plantilla
y servicio orquestador, todo con pruebas). Pendientes: route handler del
cron + `vercel.json` (etapa 5), página pública (etapa 6) y verificación
end-to-end real (etapa 7).

## Decisiones de alcance

- **Orquestador: Vercel Cron**, sin n8n ni Make. La ruta del cron irá
  protegida con `CRON_SECRET`. Se asume plan **Vercel Hobby** mientras no
  haya evidencia distinta: el disparo tiene precisión de ±1 hora (el
  periodo calculado no cambia mientras siga siendo el mismo día calendario
  en Caracas) y el `maxDuration` de la función es limitado.
- **Fuente principal: `leads`** (ya normaliza `cake_requests` y
  `cake_designs`), más `lead_automation_events` para éxitos y errores.
  "Acumulado" significa filas en `leads` — solo los leads automatizados
  desde el Reto 4; las solicitudes previas a ese despliegue no aparecen.
- **Los registros actuales son pruebas funcionales del challenge, no
  clientes comerciales.** Esa condición viaja en el propio contrato de
  métricas (`dataDisclaimer`) y se muestra en el correo (y en la página,
  etapa 6).
- **Gemini nunca es punto único de fallo**: sin clave, con timeout, con
  cuota agotada o con salida inválida, el resumen lo produce un fallback
  determinístico construido solo con las métricas, y el reporte se envía
  igual. Un fallo de Gemini **no** es un estado de error del reporte.
- **Una semana sin registros produce y envía un reporte válido** (tasa de
  envío `null`, resumen honesto de semana sin actividad).
- **Sin autenticación, dashboard admin, colas ni microservicios.** El
  destinatario es `KAREM_NOTIFICATION_EMAIL` (la variable existente del
  Reto 4); no se creó una variable nueva ni una tabla de suscriptores.

## Privacidad desde la consulta (no solo en la salida)

El servicio del reporte **no selecciona columnas personales**: de `leads`
solo `id, source_type, celebration_date, priority, created_at`; de
`lead_automation_events` solo `lead_id, event_type, status, created_at`
(nunca `error_message` ni `metadata`). Los conteos (acumulado y
celebraciones próximas) usan `count` con `head: true`, sin traer filas.
Gemini recibe exclusivamente el JSON de métricas agregadas
(`WeeklyReportMetrics`), que por construcción no contiene nombres, correos,
teléfonos ni payloads. El destinatario se guarda **enmascarado**
(`k•••@gmail.com`); el correo real solo vive en la variable de entorno.
Cubierto con pruebas: el fake de Supabase siembra filas CON datos
personales y proyecta las columnas pedidas, y se verifica que ni el
generador de resumen ni el correo los reciben.

## Terminología honesta de correo

Nodemailer/SMTP solo puede afirmar que el mensaje fue **aceptado por el
servidor SMTP**, no que fue entregado ni leído. Por eso el contrato usa
`sent` y `sendSuccessRate` (no `delivered`), el correo dice "aceptados por
el servidor de correo" con una nota aclaratoria, y no existen métricas de
apertura o entrega.

## Contrato de métricas (`WeeklyReportMetrics`)

```jsonc
{
  "period": { "start": "2026-07-06", "end": "2026-07-12", "timezone": "America/Caracas" },
  "leads": {
    "newInPeriod": 3,
    "totalAccumulated": 12,
    "bySource": { "cake_request": 2, "cake_design": 1 },
    "byPriority": { "not_viable": 0, "urgent": 1, "high": 1, "normal": 1 }
  },
  "upcomingCelebrations": { "next7Days": 2 },
  "automation": {
    "eventsInPeriod": { "success": 9, "error": 0 },
    "emails": { "attempted": 6, "sent": 6, "failed": 0, "sendSuccessRate": 1 }
  },
  "alerts": ["…derivadas por reglas fijas, nunca por IA…"],
  "dataDisclaimer": "Los registros de este periodo son pruebas funcionales…"
}
```

- **Periodo**: última semana completa lunes–domingo en el **calendario de
  Caracas** (reutiliza `businessTodayString` del clasificador del Reto 4).
  Los límites se traducen a instantes UTC exactos (Caracas es UTC-4 fijo:
  la medianoche del negocio son las 04:00 UTC) para filtrar `created_at`.
- **Celebraciones próximas**: `celebration_date` entre hoy y hoy+7
  (calendario Caracas), sobre **todos** los leads — una celebración cercana
  importa aunque el lead sea antiguo.
- **Correos deduplicados por `lead_id + event_type`**: un intento fallido
  seguido de un reintento exitoso cuenta como UN envío exitoso (contar
  filas crudas inflaría los fallos). El conteo crudo va aparte en
  `eventsInPeriod`.
- **`sendSuccessRate` es `null`** cuando no hubo envíos: nunca un 0 % ni
  100 % inventado.
- **Alertas por reglas fijas** (correos fallidos, celebraciones a ≤7 días,
  semana sin solicitudes). La IA no genera alertas: evita inventar
  urgencias.
- `not_viable` es inalcanzable por el flujo normal (ambos formularios
  validan la fecha); el correo la oculta salvo que algún dato manipulado la
  produzca.

## Tabla `weekly_reports` (registro de ejecuciones)

Una fila por corrida (programada o manual). Ver la sección "Reto 6" de
`supabase/schema.sql`. Estados: `processing → sent | email_error |
data_error`. `metrics`/`summary`/`summary_source` son nullable a propósito:
la fila se inserta primero como **reserva del periodo** y se completa
durante la ejecución. Mismo criterio de seguridad del repo: RLS habilitado,
sin políticas públicas, solo `service_role`.

### Idempotencia del cron: reservar antes de generar

Índice único **parcial**: solo puede existir una corrida con
`trigger_type = 'scheduled'` por `(period_start, period_end)`. El flujo
programado inserta la fila `processing` antes de consultar o enviar nada;
si otro disparo del mismo periodo ya la reservó, el insert falla con 23505
y la corrida responde "omitida" **sin enviar correo**. Las corridas
manuales quedan fuera del índice a propósito: reenviar a mano es una acción
deliberada, y cada una queda auditada con su propia fila. Sin reintentos
distribuidos ni colas — fuera de alcance explícito.

## Arquitectura (etapas 1–4)

```
generateWeeklyReport(trigger)               ← src/reports/service.ts
  1. reserva la fila 'processing' en weekly_reports (idempotencia)
  2. consulta agregados (columnas no personales, counts con head)
  3. computeWeeklyMetrics(...)              ← src/reports/metrics.ts (pura)
  4. resumen: Gemini validado o fallback    ← src/reports/summary.ts
  5. buildWeeklyReportEmail(...)            ← src/email/templates/weekly-report.ts
  6. envía vía defaultEmailClient() (Reto 4) con un reintento
  7. actualiza la fila: sent | email_error | data_error
```

`generateWeeklyReport` nunca lanza; todas las dependencias (Supabase,
correo, generador de resumen, destinatario, reloj) son inyectables para
pruebas — mismo patrón que `processLead` del Reto 4. Las pruebas jamás
consumen Gemini, ni tocan Supabase real, ni envían correos.

## Verificaciones realizadas

### Etapas 1–4 — 2026-07-16

- `npm test`: 266 pruebas pasan (31 archivos; 44 nuevas del Reto 6).
- `npm run lint` y `npx tsc --noEmit`: sin errores.
- `npm run build`: compila; ninguna ruta nueva (el route handler y la
  página pública son de las etapas 5–6).

## Pendiente (etapas 5–7)

- Route handler `GET /api/reports/weekly` protegido con `CRON_SECRET` +
  `vercel.json` (`0 12 * * 1`) + `maxDuration`.
- Página pública `/reporte-semanal` (último reporte + historial breve +
  diagrama del flujo), leyendo solo `weekly_reports`.
- Aplicar la sección Reto 6 de `supabase/schema.sql` en el SQL Editor
  (dueño del proyecto), configurar `CRON_SECRET` en Vercel y verificar el
  flujo end-to-end con un envío real.
