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

**Estado: etapas 1–6 implementadas** (esquema, métricas, resumen,
plantilla, servicio, endpoint del cron y página pública, todo con
pruebas). Pendiente solo la etapa 7: aplicar el SQL en Supabase,
configurar `CRON_SECRET` en Vercel y verificar el envío real (pasos
exactos al final de este documento).

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

## Endpoint del cron (etapa 5)

`GET /api/reports/weekly` (`src/app/api/reports/weekly/route.ts`), con
`runtime = "nodejs"` (Nodemailer no corre en edge) y `maxDuration = 60`
(consultas + Gemini con timeout de 15 s + SMTP con un reintento; 60 s es
el máximo configurable en Hobby). El handler es fino a propósito: valida
autorización y trigger, delega en `generateWeeklyReport` (inyectable en
pruebas) y traduce el resultado a HTTP.

- **Autorización**: `Authorization: Bearer <CRON_SECRET>`. Sin
  `CRON_SECRET` configurado → 503 sin ejecutar nada (jamás un cron
  desprotegido). Header ausente o incorrecto → 401. El secreto **no** se
  acepta por query param (quedaría en logs de acceso) y el header nunca se
  registra en logs.
- **Trigger**: sin query params = `scheduled` (así llama Vercel Cron);
  `?trigger=manual` para la verificación manual protegida (mismo secreto,
  sin secreto adicional). Cualquier otro valor → 400.
- **Respuestas** (JSON, siempre con `Cache-Control: no-store`): `sent` y
  `skipped_duplicate` → 200; `email_error` y `data_error` → 500. El cuerpo
  solo lleva `ok`, `status`, `periodStart`, `periodEnd` y `reportId` si
  existe — nunca destinatario, métricas, resumen, secretos ni errores
  internos (el detalle va solo a `console.error`, ya sanitizado por el
  servicio).

`vercel.json` registra el cron `0 12 * * 1` (lunes 12:00 UTC) apuntando a
esa ruta, sin configuración adicional.

## Página pública `/reporte-semanal` (etapa 6)

Server component renderizado por request (`connection()`, patrón del
repo). **Privacidad estructural**: consulta exclusivamente
`weekly_reports` — nunca `leads`, `lead_automation_events`,
`cake_requests` ni `cake_designs` — y ni siquiera selecciona
`recipient_masked`, `error_message` ni `id`; nada de eso llega al
navegador. Muestra:

- Presentación ("Pulso Ponquesito", "el reporte que se arma y se envía
  solo", etiqueta Reto 6, enlace al sitio principal) con el disclaimer de
  datos de prueba destacado (el texto exacto almacenado en las métricas).
- El flujo `Supabase → transformación → resumen ejecutivo → correo →
  registro` como diagrama responsive (íconos de Lucide + CSS, sin
  librerías de diagramas).
- La programación honesta: todos los lunes, entre 8:00 y 8:59 a. m. hora
  de Venezuela (Hobby dispara dentro de la hora, no en el minuto). El
  destino se describe como "correo configurado del negocio", sin mostrar
  `recipient_masked` ni dominio.
- El último reporte: periodo, fecha de generación, estado, tipo de
  ejecución, origen del resumen (IA o automático), resumen, métricas y
  alertas. `not_viable` se oculta cuando es 0 (sigue en el JSON).
- Historial de las últimas 5 ejecuciones (periodo, fecha, trigger,
  estado). Los estados fallidos usan etiquetas genéricas ("No se pudo
  completar el envío", "No se pudo generar el reporte"), nunca el error
  técnico guardado.
- Estados degradados: sin reportes aún, la página explica que el flujo
  está configurado y conserva diagrama, programación y disclaimer (sin
  métricas inventadas); si la consulta falla, un mensaje amable genérico y
  el detalle solo en el log del servidor.

Sin botón público que ejecute nada, sin formularios, sin autenticación,
sin polling ni auto-refresh.

## Limitaciones conocidas (aceptadas para este reto)

- **Vercel Hobby** ejecuta el cron dentro de la hora programada
  (12:00–12:59 UTC ≈ 8:00–8:59 a. m. de Venezuela), no en el minuto
  exacto.
- **Vercel no reintenta** automáticamente una ejecución de cron fallida.
- **Una interrupción abrupta** (timeout, crash) después de reservar la
  fila puede dejarla en `processing`; el índice único hará que el
  siguiente disparo programado del mismo periodo se omita. El desbloqueo
  es una ejecución `manual` (siempre posible aunque exista una fila
  `processing` del mismo periodo) o borrar la fila. Sin locks
  distribuidos, recuperación automática ni expiración de reservas — fuera
  de alcance a propósito.
- **Las consultas semanales no paginan**: el límite implícito de Supabase
  (1000 filas por consulta) truncaría una semana con más de 1000 leads o
  eventos. Irrelevante para el volumen actual; se documenta en vez de
  agregar paginación que hoy no sirve a nadie.
- **Los registros actuales son pruebas funcionales del challenge**, no
  actividad comercial; el correo y la página lo dicen explícitamente.

## Verificaciones realizadas

### Etapas 5–6 — 2026-07-16

- `npm test`: 279 pruebas pasan (32 archivos; 13 nuevas del route
  handler). `npm run lint` y `npx tsc --noEmit`: sin errores.
- `npm run build`: `/api/reports/weekly` y `/reporte-semanal` salen como
  rutas dinámicas (ƒ); el resto del sitio no cambia.
- **Endpoint verificado contra el build de producción local** (variables
  de Supabase/SMTP/Gemini vaciadas a propósito — cero servicios reales):
  sin `CRON_SECRET` → 503 `not_configured`; con secreto configurado: sin
  header → 401, Bearer incorrecto → 401, secreto por query param → 401,
  trigger inválido → 400, Bearer correcto → ejecuta y (con Supabase sin
  configurar) responde 500 `data_error` con solo `ok/status/periodo`.
  Todas las respuestas con `Cache-Control: no-store`; el secreto no
  aparece en ninguna respuesta ni en los logs del servidor.
- **Revisión visual con Playwright** (chromium headless, instalado con
  `npm install --no-save`, nunca en `package.json`) en 390 px y 1440 px,
  sin desbordamiento horizontal en ninguno de los dos anchos: estado
  degradado real (Supabase sin configurar → mensaje amable, diagrama y
  disclaimer intactos, cero menciones técnicas en el HTML) y vista con
  datos (inyectados temporalmente en local solo para la captura, cambio
  revertido sin commitear): badges de estado, resumen, métricas, fuentes,
  prioridades sin "No viables" en cero, alertas e historial con etiquetas
  genéricas para los fallos.

### Etapas 1–4 — 2026-07-16

- `npm test`: 266 pruebas pasan (31 archivos; 44 nuevas del Reto 6).
- `npm run lint` y `npx tsc --noEmit`: sin errores.
- `npm run build`: compila; ninguna ruta nueva (el route handler y la
  página pública son de las etapas 5–6).

## Pendiente (etapa 7): pasos manuales para activar el flujo real

1. **Aplicar el esquema**: pegar `supabase/schema.sql` completo en el SQL
   Editor de Supabase y ejecutarlo (idempotente; crea `weekly_reports` y
   su índice único parcial).
2. **Configurar `CRON_SECRET`**: generar un valor largo y aleatorio
   (`openssl rand -hex 32`) y agregarlo en Vercel (Production; también
   Preview si se quiere probar allí) y en `.env.local` para pruebas
   locales. Vercel Cron enviará el header automáticamente.
3. **Desplegar la rama** y verificar que el cron aparece en el dashboard
   de Vercel (Settings → Cron Jobs).
4. **Verificación manual protegida** sin esperar al lunes:
   `curl -i -H "Authorization: Bearer <CRON_SECRET>" "https://<deploy>/api/reports/weekly?trigger=manual"`
   → esperar 200 `sent`, el correo en la bandeja de
   `KAREM_NOTIFICATION_EMAIL`, la fila en `weekly_reports` y el reporte
   visible en `/reporte-semanal`.
5. **Confirmar la idempotencia programada** (opcional): dos llamadas sin
   `?trigger` seguidas → la segunda debe responder `skipped_duplicate`.
