# Reto 8 — Agenda Ponquesito

## Producto clonado y mecánica central

El reto toma como referencia la mecánica central de Calendly: describir una
necesidad, consultar fechas disponibles, elegir una y conservar un enlace
privado para revisar o modificar la cita. No intenta copiar su interfaz ni
convertirse en un calendario genérico. La experiencia, el lenguaje y las reglas
pertenecen a Familia Ponquesito.

Una torta no ocupa un bloque horario uniforme. La agenda usa capacidad diaria
ponderada: una torta sencilla consume 1 punto, una personalizada 2 y una de
varios pisos o especial 3. La capacidad predeterminada es 4 puntos. Los pedidos
ambiguos pasan a `human_review`: conservan una estimación de 3 puntos para
recomendar fechas, pero no consumen capacidad hasta que el negocio los revise.

## Evolución por etapas

1. **Dominio y clasificación.** Se definieron estados, puntos, reglas de
   anticipación y ventana, clasificación determinística, tokens privados y
   traducción visual de disponibilidad.
2. **Persistencia y concurrencia.** Se añadieron tablas, RLS y RPC atómicos.
   PostgreSQL serializa por fecha con advisory locks y evita sobreventa.
3. **Wizard público.** `/agenda` implementó `Tu torta → La fecha → Tus datos →
   Confirmación`, con calendario mensual, alternativas, Zod, honeypot, rate
   limit y recuperación ante conflictos de capacidad.
4. **Leads, correos y eventos.** `cake_reservation` se integró al pipeline
   existente. La creación programa con `after()` dos correos independientes y
   proyecta eventos seguros e idempotentes. Las plantillas se verificaron con
   clientes falsos; no se enviaron correos reales antes de existir la ruta.
5. **Consulta y gestión privada.** `/agenda/reservas/[code]?token=...` permite
   consultar, reprogramar y cancelar según estado y política. La lectura usa
   código más hash del token, aplica anti-enumeración y devuelve una proyección
   pública cerrada.

La evidencia visual y el cierre editorial se completarán en la Etapa 6.

## Arquitectura y modelo de datos

- `cake_reservations` contiene el pedido, su fecha, peso, estado y únicamente
  el SHA-256 del token de gestión.
- `production_day_overrides` permite bloquear fechas o cambiar su capacidad.
- `reservation_events` conserva el ciclo de vida. `dedupe_key` evita duplicar
  eventos terminales de automatización; los fallos mantienen historial.
- `leads` y `lead_automation_events` reutilizan el pipeline transversal de
  retos anteriores.
- Los Server Components y Server Actions llaman RPC con `service_role`. El
  navegador nunca decide puntos, estado ni capacidad.
- `get_production_availability` entrega agregados; reserva y reprogramación
  vuelven a comprobar todas las reglas dentro de PostgreSQL.

Los estados que consumen capacidad son `pending_deposit` y `confirmed`.
`human_review` guarda una fecha preferida sin apartarla. `cancelled` libera el
cupo inmediatamente y `expired` queda modelado para una evolución futura.

## Seguridad

El código legible identifica, pero no autoriza. La lectura y cada modificación
exigen también el token; Next.js lo transforma a hash antes del RPC. Un código
inexistente y un token incorrecto producen `reservation_not_found` y la misma
experiencia pública.

La proyección privada excluye ids internos, hash, `order_details`, rutas de
imágenes, eventos, notas, payloads de leads y datos de automatización. El token
en claro no se persiste, no se registra, no se incorpora a analytics ni se
devuelve desde Server Actions. La ruta responde con `Cache-Control: no-store`,
`Referrer-Policy: no-referrer` y directivas de no indexación.

Las acciones validan con Zod, derivan los puntos de la reserva autoritativa,
requieren confirmación explícita y aplican un límite básico por IP. Como el
limitador vive en memoria, en Vercel serverless no constituye una cuota global
entre instancias o regiones.

## Concurrencia y políticas

La reserva toma un lock transaccional por fecha. La reprogramación bloquea
primero la fila de la reserva y después ambas fechas en orden estable; dos
operaciones sobre la misma reserva se serializan y no pueden consumir dos
destinos. Para `pending_deposit` y `confirmed`, mover libera el día anterior y
consume el nuevo en una sola transacción. Para `human_review`, solo cambia la
preferencia y no se suma capacidad.

Hay al menos 3 días de anticipación, una ventana de 60 días y una política de
cambios/cancelación hasta 24 horas antes del inicio del día de celebración en
`America/Caracas`. Las funciones rechazan misma fecha, bloqueo, falta de cupo,
estado terminal y credenciales inválidas, y registran `rescheduled` o
`cancelled`.

## Automatización y token transitorio

La reserva se confirma en PostgreSQL antes de programar `after()`. El enlace
privado existe en claro únicamente en memoria dentro de
`ReservationEmailContext` y solo llega a la plantilla del cliente. No forma
parte de `order_details`, `normalized_payload`, leads, eventos, correo interno
ni logs.

Cliente y dueña se intentan de forma independiente. Un fallo de correo no
revierte la reserva y un reintento no repite un envío ya exitoso. Si falla el
correo del cliente, un reenvío futuro requerirá rotar el token y su hash; esa
función todavía no está implementada. Reprogramaciones y cancelaciones solo
registran eventos en este MVP y no reutilizan `processLead()`.

## Trabajo con agentes y verificaciones reales

El desarrollo comenzó con Claude Code. Al agotarse temporalmente sus tokens,
Codex tomó el relevo, auditó los commits y recuperó cuatro cambios locales sin
descartarlos. Después completó los checkpoints y la integración siguiendo la
misma rama. Este documento resume únicamente decisiones visibles en Git y
resultados reportados; no reconstruye prompts ni conversaciones ausentes.

Los checkpoints de Etapas 2 y 4 se probaron en PostgreSQL 16 desechable y luego
se aplicaron al Supabase real por el responsable del proyecto. La prueba real
de concurrencia hizo competir dos reservas por el último punto: exactamente una
ganó, la otra recibió `capacity_unavailable` y la capacidad final fue `1/1`,
sin sobreventa. La Etapa 4 verificó además la proyección transaccional `1/1/0`,
ACL de RPC, deduplicación terminal y limpieza mediante `ROLLBACK`.

## Escenario oficial de demostración

`supabase/demo-agenda.sql` prepara una fecha situada 45 días después del día
actual del negocio. La capacidad total es 3 y una reserva semilla confirmada
consume 2, por lo que una torta sencilla ve exactamente el último espacio. El
script se detiene si la fecha contiene reservas u overrides ajenos al demo. Su
bloque de limpieza está comentado para impedir una eliminación accidental y
solo reconoce las marcas inequívocas del escenario.

Recorrido de demostración:

1. Ejecutar los bloques **Preparación** e **Inspección**. Confirmar `3/2/1`.
2. Abrir `/agenda` y describir una torta sencilla: un piso, sin decoración
   personalizada y sin imagen de referencia.
3. Elegir la fecha indicada por la inspección, completar únicamente datos de
   prueba identificables y crear la solicitud.
4. Conservar el código `FP-8-XXXX` y el enlace privado recibido sin capturar ni
   publicar el token.
5. Consultar otra vez la fecha: debe mostrar `3/3/0`.
6. Un segundo intento concurrente o realizado con disponibilidad anterior debe
   recibir `capacity_unavailable`, sin sobreventa.
7. Abrir el enlace privado, reprogramar la primera reserva y comprobar que la
   fecha original vuelve a `3/2/1`.
8. Cancelar la reserva reprogramada, comprobar el estado `cancelled` y revisar
   los eventos `created`, `lead_registered`, `email_sent`, `rescheduled` y
   `cancelled` que correspondan.
9. Ejecutar exclusivamente el bloque **Limpieza** del script.

Para demostrar `human_review`, se describe un diseño ambiguo o especial. La UI
debe llamarlo “fecha preferida”, mantener lenguaje de revisión personalizada y
mostrar en disponibilidad que la solicitud no incrementó `capacity_used`.

## Checklist de entrega y evidencia

La evidencia final debe cubrir primer paso, calendario, último espacio,
formulario, confirmación, gestión privada, reprogramación, cancelación y ambos
correos. Antes de guardar una captura se redactan tokens completos, correos,
teléfonos y cualquier dato real. Las capturas no deben contener query strings
privados.

La Preview necesita las variables de Supabase y SMTP, el destinatario interno,
`CRON_SECRET` y `APP_CANONICAL_URL`. Esta última debe ser el origen HTTPS
explícito del alias estable de Preview: no se deriva de headers ni de
`VERCEL_URL`. Producción usa como fallback
`https://familia-ponquesito.vercel.app`.

Preview de la rama de entrega:

`https://familia-ponquesito-git-reto-8-agend-3be41e-wiljmorales-projects.vercel.app`

`APP_CANONICAL_URL` está limitada en Vercel a la rama
`reto-8/agenda-ponquesito`, de modo que los correos de esta demostración abren
la ruta privada de la misma Preview sin alterar el origen canónico de
producción.

Commits principales del Reto 8:

- Dominio y SQL: `85dfe8e`, `03bc11f`, `661fad0`.
- Wizard: `fa740a2`, `d46586e`, `e1e942b`, `1f79ebb`.
- Automatización: `84d66fe`, `c8564d9`, `679ff90`, `1aaae98`.
- Gestión privada: `b12e493`, `b1a5ebf`, `61a5d53`.
- Verificaciones de Supabase: `1c56904`, `930106b`.

Limitaciones conocidas:

- No existe cron que convierta automáticamente solicitudes en `expired`.
- Reprogramar o cancelar registra eventos, pero no envía una notificación
  adicional en este MVP.
- Reenviar el correo privado requiere una futura rotación de token.
- El rate limit en memoria no es global entre instancias serverless.
- La evidencia y URL pública se registran solo después de una Preview exitosa;
  no se inventan antes del despliegue.

## Verificación E2E real — 18 de julio de 2026

La Preview de la rama se verificó contra el Supabase real con datos
inequívocamente marcados como “Cliente de demostración — Reto 8”. El escenario
usó el 1 de septiembre de 2026 con capacidad `3/2/1`. La reserva sencilla tomó
el último punto y produjo el código `FP-8-FX••`, estado
`pending_deposit` y capacidad `3/3/0`, sin presentar el pedido como confirmado.

La ejecución real utilizó 10 personas, retiro y la descripción “Verificación
E2E de Agenda Ponquesito”. Aunque el plan indicaba Vainilla y una temática
explícita, en el formulario probado se seleccionó Chocolate y la temática quedó
vacía. Se conserva esta diferencia en el registro para no inventar evidencia.

Llegaron dos mensajes independientes a la bandeja autorizada:

- **Cliente:** “Recibimos tu reserva FP-8-FXHH — Familia Ponquesito”. Incluyó
  código, fecha, resumen, anticipo del 50 %, próximos pasos y enlace privado.
  Indicó expresamente que el pedido todavía no estaba confirmado.
- **Interno:** “Reserva FP-8-FXHH — Agenda Ponquesito”. Incluyó cliente,
  WhatsApp, correo, fecha, 1 punto estimado, capacidad restante 0 de 3,
  entrega, descripción y clasificación. No incluyó enlace privado, token ni
  hash.

El enlace privado abrió la reserva correcta en `pending_deposit`. Un token
deliberadamente alterado mostró la misma experiencia genérica que un código
inexistente. El token no fue copiado a documentación, capturas versionadas ni
logs.

La reserva se reprogramó al 2 de septiembre de 2026 y luego se canceló desde la
interfaz con confirmaciones explícitas. La página refrescó la fecha
autoritativa, terminó en `cancelled`, mostró `cancelled_at` en base de datos y
retiró todas las acciones. La fecha original volvió a `3/2/1`; la fecha nueva
quedó `4/0/4` después de cancelar.

La auditoría confirmó:

- una reserva y un lead `cake_reservation` con el mismo código y `source_id`;
- `lead_registered`, `customer_email` y `owner_email` exitosos una sola vez;
- eventos `created`, `lead_registered`, dos `email_sent`, `rescheduled` y
  `cancelled`;
- un reintento de `processReservationLead()` conservó un solo lead y tres
  acciones exitosas, sin reenviar correos;
- ausencia de token, URL privada y credenciales en `order_details`,
  `normalized_payload`, eventos, errores persistidos y correo interno.

No se enviaron correos al reprogramar ni cancelar: es el comportamiento
deliberado del MVP. Esas operaciones solo registran eventos y no reutilizan
`processLead()`.

Finalmente se eliminaron exclusivamente la reserva E2E, su lead y eventos
dependientes, la semilla `FP-8-DEMO` y el override marcado. La comprobación
posterior devolvió cero reservas, cero leads y cero overrides del escenario.
