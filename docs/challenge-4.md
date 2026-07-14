# Reto 4 — "La máquina de leads que trabaja sola"

Ver `docs/product-brief.md` para el contexto general del producto.

## Requisitos explícitos

Cuando un cliente envía el formulario del Reto 2 o el juego del Reto 3, el
sistema debe, de principio a fin y sin intervención manual:

1. Registrar y clasificar el lead.
2. Enviar un correo personalizado de confirmación al cliente.
3. Enviar un correo inmediato a Karem con el resumen completo del lead.
4. Incluir en el correo de Karem un enlace de WhatsApp para contactar al
   cliente, con un mensaje precargado.
5. Registrar el resultado de cada paso automático, para poder demostrar que
   el flujo se ejecutó correctamente.

## Fuentes de verdad usadas

- Reglas de negocio reales ya confirmadas en `src/knowledge/familia-ponquesito.md`
  (Reto 1): 3 días de anticipación mínima, sin pedidos el mismo día, reserva
  con 50 %, atención todos los días hasta las 9 p. m., cobertura principal
  este de Barquisimeto, delivery con costo adicional, eslogan.
- Esquema y flujos reales de los Retos 2 y 3 (`supabase/schema.sql`,
  `src/lib/actions/submit-cake-request.ts`,
  `src/lib/actions/submit-cake-design.ts`).

## Hallazgo que cambió el alcance: el Reto 2 no recolectaba correo

Al inspeccionar `RequestForm.tsx` y `cake-request.ts` (Reto 2) se confirmó
que ese formulario nunca pidió el correo del cliente — ni en el formulario
ni en la tabla `cake_requests`. El Reto 3 sí lo tenía, pero como campo
**opcional**. Sin correo no hay forma de cumplir el requisito de "correo de
confirmación al cliente" para la mitad de los leads.

**Decisión (aprobada por el dueño del proyecto):** se agrega el campo
correo, ahora **obligatorio**, a ambos formularios:

- Reto 2: campo nuevo en `RequestForm.tsx` + `cakeRequestSchema` + columna
  nueva `email` en `cake_requests`.
- Reto 3: `email` pasa de opcional a obligatorio en `cakeDesignRequestSchema`
  (la columna `email` en `cake_designs` ya existía desde el Reto 3, sin
  cambios de esquema ahí).

La columna `cake_requests.email` se agregó como **nullable** a propósito:
forzar `NOT NULL` habría roto cualquier fila ya existente sin correo (no se
puede aplicar una migración destructiva sobre datos reales). Lo obligatorio
se aplica en la validación Zod/UI para todo envío nuevo a partir de este
reto, no a nivel de columna.

## Correo de Karem: sin dato real confirmado todavía

No existe un correo de negocio documentado en `src/knowledge/familia-ponquesito.md`
ni en ningún otro lugar del repositorio (solo Instagram está confirmado como
canal de contacto). No se inventó ningún valor. Mientras tanto, el dueño del
proyecto autorizó usar un correo de pruebas personal a través de la variable
de entorno `KAREM_NOTIFICATION_EMAIL` (nunca versionada — vive solo en
`.env.local`/Vercel). Cuando exista un correo real de negocio, basta con
cambiar el valor de esa variable; no requiere tocar código.

## Clasificación de prioridad

Basada en días de anticipación entre hoy y la fecha de celebración/evento,
calculados sobre el calendario de **America/Caracas** (no el huso horario
del servidor — en Vercel el runtime corre en UTC, y Caracas es UTC-4 sin
horario de verano, así que usar la hora del servidor directamente movería
el límite de "hoy" varias horas antes de la medianoche real del negocio).
Implementado en `src/leads/classify.ts`.

- `not_viable`: menos de 3 días (reutiliza `MIN_LEAD_DAYS` de
  `src/lib/constants/business.ts`).
- `urgent`: 3 o 4 días.
- `high`: entre 5 y 10 días.
- `normal`: más de 10 días.

**Nota:** como ambos formularios ya rechazan en el servidor cualquier fecha
con menos de `MIN_LEAD_DAYS` de anticipación (validación Zod existente desde
los Retos 2 y 3), la categoría `not_viable` es, en la práctica, inalcanzable
a través del flujo normal — se mantiene como defensa ante datos que
llegaran manipulados, no como caso esperado.

## Arquitectura

```
submitCakeRequest / submitCakeDesign (Server Actions existentes)
  └─ insert en cake_requests / cake_designs (sin cambios de comportamiento)
  └─ responde éxito al usuario (rápido, como antes del Reto 4)
  └─ after(() => processLead(...))          ← src/leads/service.ts
        1. registra/reutiliza el lead en `leads` (idempotente)
        2. clasifica la prioridad
        3. envía el correo de confirmación al cliente (si no se había
           enviado con éxito antes)
        4. envía el correo de notificación a Karem (si no se había
           enviado con éxito antes)
        5. registra cada intento en `lead_automation_events`
```

`processLead` nunca lanza hacia afuera: cualquier fallo interno queda
registrado en logs y en `lead_automation_events`, pero el lead original
(`cake_requests`/`cake_designs`) ya se guardó antes de llegar aquí, así que
un fallo de correo jamás lo pierde ni lo revierte.

Se usa [`after()`](https://nextjs.org/docs/app/api-reference/functions/after)
de Next.js (estable desde 15.1, compatible con Vercel vía `waitUntil`) para
que la automatización corra después de responder al usuario — un correo
lento o caído nunca demora la confirmación de que la solicitud ya quedó
guardada.

### Idempotencia real (no solo la restricción `unique` de la tabla)

`unique(source_type, source_id)` en `leads` evita duplicar la fila del lead,
pero no evita reenviar correos si `processLead` se vuelve a ejecutar para el
mismo lead (reintento de `after()`, doble invocación, etc.). Por eso, antes
de cada envío, el servicio consulta si ya existe un evento con
`status = 'success'` para ese `lead_id` + `event_type` en
`lead_automation_events`:

- Si `customer_email` ya tuvo éxito, no se reenvía.
- Si `owner_email` ya tuvo éxito, no se reenvía.
- Un intento fallido sí puede reintentarse en una ejecución posterior.
- El id devuelto por Resend se guarda en `metadata.providerId` cuando el
  envío tiene éxito.

Cubierto en `src/leads/service.test.ts`, incluyendo una prueba que corre
`processLead` dos veces sobre el mismo lead y confirma que no se duplican
los correos exitosos.

### Correo al cliente y correo a Karem son independientes

Si falla el correo al cliente, igual se intenta el correo a Karem (y
viceversa). Ninguno de los dos revierte al otro ni afecta la fila original.
Cada uno se reintenta una sola vez ante un fallo transitorio, dentro de la
misma ejecución de `processLead`.

### Configuración de correo: nunca simular éxito en producción

`src/email/client.ts` sigue el mismo patrón que `defaultProvider()` del
asistente (Reto 1: con `GEMINI_API_KEY` usa el proveedor real, sin ella usa
el determinista solo en desarrollo/test):

- Con `RESEND_API_KEY` + `RESEND_FROM_EMAIL` configuradas: cliente real de
  Resend.
- Sin ellas, en desarrollo/test: un stub que solo loguea en consola (no
  envía nada real; así `npm run dev` y `npm test` funcionan sin cuenta de
  Resend).
- Sin ellas, en producción: un cliente que **siempre devuelve error
  explícito** — nunca simula un envío exitoso. El paso queda registrado
  como `error` en `lead_automation_events`.
- Si falta `KAREM_NOTIFICATION_EMAIL` (en cualquier entorno): no hay a quién
  enviar, así que ni siquiera se intenta — se registra el error
  directamente, sin llamar al proveedor de correo.

### Imagen de referencia (Reto 2) en el correo a Karem

Cuando la solicitud tiene imagen de referencia, el correo a Karem incluye un
enlace **firmado y temporal** (`getReferenceImageSignedUrl`, reutilizada del
Reto 2, 1 hora de expiración por defecto), generado en el momento de
preparar la notificación — nunca se guarda una URL firmada en la base de
datos porque expiraría. El bucket sigue siendo privado.

### Vista del diseño (Reto 3) en el correo a Karem

Solo resumen en texto (reutilizando `describeCakeDesign`, la misma lógica
que ya usa `FinalView.tsx` en la vista final del builder). Se evaluó generar
una imagen del diseño compuesto (vía `next/og` `ImageResponse`), pero
requeriría reimplementar fuera de CSS el posicionamiento de capas que hoy
resuelve `CakeStage` — la relación costo/beneficio no se justifica para la
primera versión de este reto. Sin captura ni imagen generada.

## Plantillas de correo

Funciones HTML simples (sin dependencias nuevas como React Email), en
`src/email/templates/`. Cada una genera versión HTML y texto plano.

- Todo texto aportado por el cliente (nombre, descripción, mensaje de la
  placa) se escapa antes de insertarse en HTML (`src/email/escape.ts`).
- El asunto de ambos correos solo usa valores generados por el servidor
  (código de referencia, prioridad, origen) — nunca texto libre del
  cliente.
- El enlace de WhatsApp hacia el cliente codifica el mensaje con
  `encodeURIComponent` (`buildCustomerContactWhatsappLink`, distinto del
  `buildWhatsappMessageUrl` ya existente para el WhatsApp *del negocio*).
- Ningún correo incluye errores internos ni secretos.

Cubierto con pruebas que intentan inyectar HTML en nombre, descripción y
mensaje (`customer-confirmation.test.ts`, `owner-notification.test.ts`).

## Cambios de base de datos

Ver la migración exacta en `supabase/schema.sql` (sección "Reto 4"):
columna `email` nullable en `cake_requests`, tablas nuevas `leads` y
`lead_automation_events`. Mismo criterio de seguridad que las tablas
existentes: RLS habilitado, sin políticas públicas, solo `service_role`
desde el servidor. No se tocó `cake_designs` (su columna `email` ya
existía).

Se omitió `updated_at` en `leads`: los leads no se editan después de
creados (la clasificación y los datos normalizados se calculan una sola vez
al registrarse), así que un campo que nunca cambia no aporta nada.

## Generador de código de referencia, compartido entre ambas fuentes

`src/lib/reference-code.ts` extrae la lógica que antes vivía solo en
`src/lib/cake-builder/design-code.ts` (alfabeto sin caracteres ambiguos,
formato `PREFIJO-XXXX`) a una función genérica `generateReferenceCode(prefix)`.
`generateDesignCode()` (Reto 3) ahora delega en ella sin cambiar su
comportamiento externo (`FP-3-XXXX`, mismas pruebas). Los leads del Reto 2
usan el prefijo `FP-2`; los del Reto 3 reutilizan el `design_code` ya
generado por `submitCakeDesign` como `reference_code` del lead (no se
genera un código nuevo para el mismo diseño).

## Fuera de alcance (para este reto)

- Panel administrativo o CRM: no se construyó ninguna pantalla nueva para
  ver o gestionar leads; siguen siendo consultables desde el dashboard de
  Supabase, igual que en los Retos 2 y 3.
- Imagen o captura generada del diseño en el correo (ver sección de arriba).
- Cola de reintentos externa (Redis, cron, etc.) para correos fallidos: el
  único reintento es el acotado dentro de la misma ejecución de
  `processLead`; una ejecución posterior del mismo lead (ej. si el cliente
  vuelve a intentar algo relacionado) sí reintenta lo que haya fallado
  antes, pero no hay un mecanismo automático que dispare esa ejecución por
  sí solo.
- Enlace "ver la solicitud completa" en el correo a Karem: no existe ninguna
  ruta interna para eso (ningún reto anterior construyó panel
  administrativo); el correo ya incluye el resumen completo, así que no
  hace falta.
