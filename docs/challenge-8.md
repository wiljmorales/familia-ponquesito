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
