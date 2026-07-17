# Decisiones

Registro de decisiones importantes de alcance y estructura. Una entrada por
decisión, con fecha y motivo.

## 2026-07-11 — Estructura de carpetas para el Reto 1

Aprobada por el dueño del proyecto, con estos ajustes sobre la propuesta
inicial:

- **`src/app/`** — interfaz (App Router, ya existe).
- **`src/knowledge/`** — base de conocimiento: archivos Markdown o JSON con
  información real del negocio, versionados en el repositorio. **Se creará
  cuando exista el primer contenido real** (no se inventan datos).
- **`src/assistant/`** — lógica del asistente (orquestación, tono, manejo de
  "no sé"). **Se creará con el primer archivo de implementación.**
- **No** se crea `providers/` todavía; se añadirá cuando exista una
  integración real de IA.
- **No** se separa `domain/` de `assistant/` por ahora; se dividirá solo
  cuando la lógica del negocio lo justifique.
- **No** se crean carpetas vacías ni placeholders (`.gitkeep`).

Motivo: estructura mínima suficiente para implementar y evaluar el Reto 1,
sin abstracciones anticipadas. Las carpetas nacen con su primer archivo
real, nunca antes.

## 2026-07-11 — Esqueleto funcional del Reto 1 (sin IA real)

- **Capas**: UI (`src/app/`) → endpoint (`src/app/api/assistant/route.ts`)
  → servicio (`src/assistant/service.ts`) → proveedor
  (`src/assistant/temporary-provider.ts`), con tipos compartidos en
  `src/assistant/types.ts`. Separación mínima; nada más.
- **Proveedor temporal determinista** (palabras clave, sin IA): responde
  `unknown` ante cualquier dato del negocio, `human_required` ante
  intención de pedido/contacto, y `answered` solo sobre sí mismo. Nunca
  afirma datos comerciales; declara que la base de conocimiento está en
  construcción. Vive dentro de `src/assistant/` — `src/providers/` sigue
  reservado para la integración real de IA.
- **Estados de respuesta**: `answered` | `unknown` | `human_required`.
  Cualquier proveedor futuro debe cumplir este mismo contrato
  (`AssistantProvider` en `types.ts`).
- **Identidad visual PROVISIONAL**: paleta cálida de pastelería definida en
  `src/app/globals.css` como placeholder. No representa lineamientos
  oficiales de la marca; se reemplazará cuando Karem los defina (sección 11
  del cuestionario de descubrimiento).
- **Pruebas con Vitest** (`vitest` + `vite-tsconfig-paths`, recomendado por
  la guía oficial de Next 16). Sin jsdom ni Testing Library: las pruebas
  cubren el contrato del servicio/endpoint y el comportamiento seguro (no
  inventar), no el renderizado. Config en `vitest.config.mts` (extensión
  `.mts` porque `vite-tsconfig-paths` v6 es solo ESM).
- **Nota de entorno**: el build requiere Node ≥ 20.9 (el `.nvmrc` pide
  22.14.0; usar `nvm use` antes de `npm run build`).

## 2026-07-11 — Nace `src/knowledge/` con las primeras respuestas reales

- El descubrimiento con Karem se está manejando con un cuestionario externo
  (ChatGPT), no con `docs/familia-ponquesito-discovery.md`. La fuente de
  verdad del asistente es `src/knowledge/familia-ponquesito.md`, que separa
  explícitamente: **confirmado** / **por confirmar (ambiguo)** /
  **pendiente**.
- Respuestas recibidas sin su pregunta original (17: "No",
  18: "todas las mencionadas") no se incorporan hasta conocer qué
  preguntaban. No se interpreta a ciegas.
- Sigue sin haber precios, moneda, canal de contacto ni tono de marca: el
  asistente debe seguir respondiendo "unknown" sobre esos temas.

## 2026-07-11 — Integración de Gemini como proveedor real

- **Proveedor**: Google Gemini vía SDK oficial `@google/genai`, modelo
  `gemini-3.1-flash-lite` (configurable con `GEMINI_MODEL`). Nace
  `src/providers/` como estaba reservado. La clave vive en
  `GEMINI_API_KEY` (`.env.local`, ignorado por git); solo la lee el código
  de servidor y jamás se registra en logs.
- **Selección de proveedor mínima**: con `GEMINI_API_KEY` se usa Gemini;
  sin ella, el determinista (así la demo funciona sin configurar nada y
  las pruebas jamás consumen cuota). Sin registry ni abstracción
  multi-proveedor.
- **Salida estructurada y validada**: Gemini responde JSON forzado por
  `responseSchema` (enum de los 3 estados). El servidor valida parse, enum
  y texto no vacío; ante salida inválida devuelve un fallback seguro
  `unknown`. El usuario nunca ve JSON crudo ni errores técnicos.
- **Prompt del sistema** en `src/assistant/prompt.ts`, separado de UI,
  endpoint, proveedor y base de conocimiento: solo información confirmada
  de la base, "unknown" ante lo pendiente/ambiguo, "human_required" para
  cotizaciones/pedidos/disponibilidad, anti prompt-injection, no revelar
  internals, no confirmar acciones.
- **Cuota**: historial acotado a los últimos 6 turnos (validado en
  servidor), respuestas limitadas (`maxOutputTokens` 500, tope 1200
  caracteres), timeout de 15 s, sin herramientas ni grounding.
- ~~**Pendiente para producción**: rate limiting por IP.~~ Implementado el
  2026-07-12 (ver entrada siguiente).

## 2026-07-12 — Protección básica de cuota (rate limiting en memoria)

- Limitador de ventana fija por IP en el endpoint: **10 peticiones por
  minuto**; el exceso recibe 429 con mensaje amable **sin llamar a Gemini**
  (no consume cuota). IP tomada de `x-forwarded-for` (Vercel la provee).
- **Limitación conocida y aceptada**: el contador vive en memoria, así que
  en serverless cada instancia cuenta por separado — el límite no es
  global. Cubre el caso realista del challenge (un curioso o un bot simple
  en bucle); un ataque distribuido requeriría un limitador externo
  (p. ej. Redis), infraestructura que decidimos no añadir para este reto.

## 2026-07-12 — Reto 2: landing de producto, `/` cambia de dueño

- **`/` pasa a ser la landing de Familia Ponquesito** (Reto 2). El chat del
  Reto 1 se movió a `/asistente` (mismo componente, sin cambios de lógica).
  Motivo: la landing es ahora la cara pública del negocio; mover el chat a
  su propia ruta lo mantiene evaluable de forma independiente sin forzar
  un link adicional en el nav que no está en el mockup entregado. Detalle
  completo en `docs/challenge-2.md`.
- **Paleta y tipografía oficiales**: reemplazan la paleta provisional del
  Reto 1 en `globals.css`. Los tokens antiguos (`--accent`, `--muted`, etc.)
  se dejaron como alias de los nuevos para que `/asistente` siga
  funcionando sin reescribir sus clases.
- **Fotografía real**: se usaron 6 fotos de tortas entregadas por WhatsApp
  durante la sesión (no estaban en los 3 adjuntos de diseño) para el hero,
  la galería y el cierre. No hay fotos reales de corte por sabor, así que
  "Sabores" usa color sólido de marca + ícono en vez de foto — no se generó
  ninguna imagen con IA ni se usó stock. Ver preguntas pendientes en
  `docs/challenge-2.md`.
- **Ícono de header/footer**: el logo entregado es un lockup único (ícono +
  texto + tagline). Se recortó solo el ícono (cupcake + monograma) del
  archivo real para el header/footer compacto; el wordmark "Familia
  Ponquesito" se renderiza como texto real (fuente Sacramento) en vez de
  usar el logo rasterizado completo, por accesibilidad y nitidez en
  cualquier tamaño.
- **Supabase — bucket privado y sin políticas RLS públicas**: la tabla
  `cake_requests` y el bucket `cake-references` solo son accesibles con la
  service role key desde una Server Action de servidor. No se abrió
  inserción anónima vía RLS para el formulario público; se evita porque el
  servidor ya media cada escritura con su propia validación. Detalle en
  `docs/challenge-2.md` y `supabase/schema.sql`.
- **WhatsApp de negocio no confirmado**: no hay número documentado en la
  base de conocimiento del Reto 1 (solo Instagram). El enlace de WhatsApp
  del footer queda tras `NEXT_PUBLIC_WHATSAPP_URL`; sin definir, el ícono
  no se muestra. No se inventó un número.

## 2026-07-12 — Reto 3: rama, assets del cake builder y tabla nueva en Supabase

- **Rama**: `reto-3/crea-tu-torta`, creada desde `main`, siguiendo la misma
  convención de los retos anteriores (`reto-N/nombre-corto`).
- **Assets sin transparencia real**: los 17 PNG generados con ChatGPT para
  el cake builder no tienen canal alpha (verificado con `sharp`); el fondo
  "transparente" era una cuadrícula gris/blanca horneada como píxeles. Un
  primer intento de recorte por umbral de color + flood fill falló de
  forma visible (borró por completo el pedestal blanco-dorado, destruyó
  los trazos finos de los toppers). Se resolvió con
  `@imgly/background-removal-node` (modelo de segmentación real),
  agregado como devDependency usada solo por
  `scripts/process-cake-assets.mjs` (nunca se importa desde `src/`, no
  viaja al bundle). 16 de los 17 assets quedaron utilizables en
  `public/assets/cake-builder/` (se excluyó el topper de abejas/flores por
  traer el nombre "Alana" horneado en la imagen). Detalle completo,
  incluyendo el riesgo de las vulnerabilidades transitorias de esa
  dependencia, en `docs/challenge-3.md`.
- **Tabla nueva `cake_designs`, no se reutiliza `cake_requests`**:
  `cake_requests` tiene columnas `NOT NULL` (`celebration_type`,
  `preferred_flavor`, `cake_description`) que no aplican al flujo del
  Reto 3; forzarlas con valores inventados ensuciaría los datos reales del
  Reto 2. Tabla nueva = cero riesgo para esos datos, cero migración. Mismo
  patrón de seguridad (RLS sin políticas públicas, solo `service_role`
  desde Server Action). Se define el esquema exacto en la etapa de
  persistencia. Ver `docs/challenge-3.md`.

## 2026-07-13 — Reto 2: endurecer el manejo de la imagen de referencia

- **Columna renombrada**: `reference_image_url` → `reference_image_path`.
  El nombre anterior era engañoso: nunca se guarda una URL (el bucket es
  privado), solo la ruta del objeto. `supabase/schema.sql` migra
  instalaciones existentes con un `rename column` condicional (no se
  recrea la tabla, no se pierden filas).
- **Bucket reforzado también del lado de Supabase**: `file_size_limit`
  (5 MB) y `allowed_mime_types` (jpeg/png/webp) se configuran en
  `storage.buckets`, no solo se validan en el código de la app. Segunda
  capa de defensa independiente de la aplicación.
- **Limpieza de huérfanos**: si la imagen se sube pero el `insert` en
  `cake_requests` falla después, el Server Action borra el archivo recién
  subido (`storage.remove`) antes de devolver el error. Si el upload
  falla, nunca se llega a insertar la solicitud (orden ya era ese; se
  mantiene). Verificado en vivo contra el proyecto real: se forzó un
  fallo de insert y se confirmó que el archivo desaparece del bucket.
- **`getReferenceImageSignedUrl`** (`src/lib/actions/get-reference-image-url.ts`):
  función server-only que genera una signed URL temporal (`createSignedUrl`,
  1 hora por defecto) a partir de una ruta. Es la única forma prevista de
  visualizar una imagen — no se guarda ninguna URL firmada en la base de
  datos porque expiraría. No está conectada a ninguna pantalla todavía (no
  hay panel administrativo en este reto); queda lista para cuando exista
  uno.

## 2026-07-13 — Reto 3: ruta, estado del builder y vista previa (Etapa 2)

- **Ruta `/crea-tu-torta`** autocontenida (sin `Header`/`Footer`
  globales), catálogo de opciones data-driven en
  `src/lib/cake-builder/options.ts`, estado único (`CakeDesign`) en
  `useCakeBuilder`. Detalle completo en `docs/challenge-3.md`.
- **Verificación real, no asumida**: se instaló Playwright temporalmente
  (`npm install --no-save`, nunca quedó en `package.json`) para conducir
  el wizard completo en headless Chrome, en escritorio y móvil, con
  distintas combinaciones de piso/color/pedestal/placa/topper, y así
  ajustar a ojo los offsets de capas de `CakeStage` contra los assets
  reales. Se encontró y corrigió un bug real de accesibilidad de paso: el
  input del mensaje no tenía `id`/`name`, así que su `<label>` no quedaba
  asociado.
- **Pendiente a propósito**: el botón "Siguiente" del último paso queda
  deshabilitado hasta que exista la vista final (Etapa 3).

## 2026-07-13 — Reto 3: vista final, formulario, persistencia y código (Etapa 3)

- **Tabla `cake_designs`** agregada a `supabase/schema.sql` (RLS sin
  políticas públicas, solo `service_role`). **No se aplicó contra el
  proyecto real de Supabase**: solo hay acceso a la API con la
  `service_role` key, no a una conexión directa a Postgres para ejecutar
  DDL. Queda pendiente que el dueño del proyecto pegue el script
  actualizado en el SQL Editor (mismo flujo que el Reto 2).
- **Formulario adaptado** (`DesignRequestForm`), no reutilizado literal de
  `RequestForm`: mismos primitivos de UI, honeypot y estados
  idle/success/error, pero campos distintos (los del Reto 3). Reutiliza
  `minCelebrationDateString` del Reto 2 en vez de duplicar la regla de
  anticipación mínima.
- **Validación server-side del `CakeDesign`** contra el catálogo real de
  `options.ts`, no solo tipos — un id fuera de catálogo se rechaza antes
  de guardar.
- **Código de diseño `FP-3-XXXX`** generado en servidor con alfabeto sin
  caracteres ambiguos, con reintento ante colisión (columna `unique`).
- **Verificado localmente sin tocar la base real**: flujo completo con
  Playwright headless hasta el envío; sin la tabla creada todavía, falla
  con el mensaje amable esperado (no un error crudo) — confirma que el
  manejo de errores es correcto antes de tener la tabla disponible.
- 11 pruebas nuevas (70 en total): validación del diseño contra catálogo y
  formato del código de diseño.

## 2026-07-13 — Reto 3: auditoría de accesibilidad y manejo de errores (Etapa 4)

- **`role="radio"` sin navegación por flechas → botones toggle**: los
  selectores del builder se anunciaban como grupo de radio ARIA sin
  implementar el comportamiento de teclado que ese rol exige. Se cambió a
  `aria-pressed` (Tab + Enter/Espacio), que sí coincide con el
  comportamiento real, con `aria-labelledby` apuntando al título del
  paso.
- **Foco no se movía entre pasos**: el `<h2>` del paso no se remonta al
  cambiar de paso, así que el foco de teclado quedaba fijo en "Siguiente".
  Se agregó `tabIndex={-1}` + foco programático en el título de cada paso
  y de la vista final. Verificado con Playwright navegando solo con
  teclado.
- **`submitCakeDesign` sin `try/catch` alrededor de Supabase**: a
  diferencia de `submit-cake-request.ts` (Reto 2), la llamada a
  `getSupabaseServiceClient()` y el `insert` no estaban protegidos —
  variables de entorno faltantes o un fallo de red habrían roto en crudo
  en vez de mostrar el mensaje amable ya diseñado. Corregido para seguir
  el mismo patrón que el Reto 2. Verificado guardando y borrando un lead
  de prueba real después del cambio.
- Sin `error.tsx`: se evaluó, pero ni el Reto 1 ni el Reto 2 tienen uno;
  se mantiene consistencia con el resto de la app en vez de introducir un
  patrón nuevo solo para este reto.

## 2026-07-13 — Reto 3: corrección de capas desalineadas (Etapa 5)

Reportado por el usuario probando la app real (no una captura aislada):
el topper se veía "montado encima" y el centro de la placa dejaba ver el
fondo. Tres causas independientes, las tres corregidas:

- **Placas con el interior transparente**: el modelo de segmentación
  borró ~54% del área (todo el relleno crema, no solo el marco),
  interpretando esa superficie lisa como fondo. `scripts/process-cake-
  assets.mjs` ahora detecta componentes de transparencia encerradas (no
  conectadas al borde) y rellena solo las grandes (>=25%, muy por encima
  del máximo legítimo de ~17% de los lazos cursivos de los toppers) con
  el color de la imagen ORIGINAL — el RGB que deja el modelo en la zona
  borrada no es confiable.
- **`CakeStage` con offsets fijos relativos al stage**: no distinguía
  entre una torta de 1 y 2 pisos (la de 2 pisos es más alta con el mismo
  ancho), así que el topper quedaba descuadrado según el número de pisos.
  Reescrito a flujo normal (flex-column) con márgenes negativos
  calculados por imagen, expresados como fracción de la altura PROPIA de
  cada capa en vez de un offset fijo contra el stage.
- **`sharp().trim()` dejaba una cola de sombra semitransparente** de
  varias decenas de píxeles que, sumada entre capas, se notaba como un
  hueco. Reemplazado por un recorte al bounding box de píxeles
  realmente sólidos (`alpha >= 200`), no solo "no transparentes".
- **Bug secundario**: `options.ts` quedó con dimensiones viejas después
  de regenerar los assets (cambiaron unos pocos píxeles), y `CakeStage`
  usa esos números para su matemática de posicionamiento — desajuste
  silencioso. Se agregó `options.test.ts` comparando cada `width`/
  `height` del catálogo contra el archivo real en disco, y `sharp` como
  devDependency explícita (el script ya lo usaba sin declararlo).

Verificado con capturas reales en varias combinaciones tras el arreglo,
incluyendo la combinación exacta reportada.

## 2026-07-13 — Reto 4: automatización de leads (registro + correo + WhatsApp)

- **Rama**: `reto-4/maquina-de-leads`, creada desde `main` (que ya contenía
  los Retos 2 y 3 completos, verificado con `git merge-base --is-ancestor`
  antes de crear la rama).
- **El Reto 2 nunca recolectó correo del cliente**: se descubrió al
  inspeccionar `RequestForm.tsx`/`cake-request.ts` antes de implementar.
  Aprobado por el dueño del proyecto: se agrega el campo, **obligatorio**,
  a ambos formularios (Reto 2 desde cero, Reto 3 pasa de opcional a
  obligatorio). La columna nueva `cake_requests.email` es nullable a
  propósito (no romper filas previas); lo obligatorio se aplica en
  Zod/UI para envíos nuevos. Detalle completo en `docs/challenge-4.md`.
- **Correo de Karem sin dato real confirmado**: no existe en la base de
  conocimiento (solo Instagram). El dueño del proyecto autorizó usar un
  correo de pruebas personal vía `KAREM_NOTIFICATION_EMAIL`, nunca
  versionado.
- **Tablas nuevas `leads` y `lead_automation_events`** en
  `supabase/schema.sql`, aditivas, RLS sin políticas públicas. Se omitió
  `status` en `leads` (evita una segunda fuente de verdad divergente del
  `status` que ya tienen `cake_requests`/`cake_designs`) y `updated_at`
  (los leads no se editan después de creados).
- **Clasificación de prioridad sobre el calendario de America/Caracas**, no
  el huso horario del servidor (Vercel corre en UTC) — `src/leads/classify.ts`,
  probado en los límites exactos (2, 3, 4, 5, 10, 11 días).
- **`processLead` corre dentro de `after()`** (Next.js, estable, compatible
  con Vercel), después de responder al usuario: un correo lento o caído
  nunca demora ni bloquea la confirmación de que la solicitud ya se guardó.
  Nunca lanza hacia afuera; todo fallo queda en logs y en
  `lead_automation_events`.
- **Idempotencia real, no solo la restricción `unique`**: antes de cada
  envío se consulta si ya existe un evento `success` para ese
  `lead_id` + `event_type`; solo se reintenta lo que falló antes. Probado
  corriendo `processLead` dos veces sobre el mismo lead.
- **Correo al cliente y correo a Karem son independientes**: el fallo de
  uno no afecta al otro. Un solo reintento por envío dentro de la misma
  ejecución.
- **Nunca se simula éxito de correo en producción**: sin la configuración
  SMTP completa (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_APP_PASSWORD`/
  `EMAIL_FROM`) o sin `KAREM_NOTIFICATION_EMAIL`, en producción cada paso
  queda registrado como `error` explícito; el stub que solo loguea en
  consola es exclusivo de desarrollo/test (mismo patrón que
  `defaultProvider()` del asistente, Reto 1).
- **Plantillas de correo con funciones HTML simples** (sin React Email),
  con escape de todo texto del cliente y asunto que nunca interpola texto
  libre (solo código de referencia, prioridad y origen, generados por el
  servidor).
- **Generador de código de referencia extraído a `src/lib/reference-code.ts`**,
  reutilizado por `generateDesignCode()` (Reto 3, sin cambios de
  comportamiento) y por los leads del Reto 2 (prefijo `FP-2`); los leads
  del Reto 3 reutilizan el `design_code` ya generado como `reference_code`.
- **Sin panel administrativo, sin imagen generada del diseño, sin cola de
  reintentos externa**: fuera de alcance explícito, igual criterio que los
  Retos 2 y 3. Detalle completo, incluyendo el flujo de extremo a extremo y
  las variables de entorno nuevas, en `docs/challenge-4.md`.
- **Verificado de extremo a extremo con envío real** (local y Preview de
  Vercel, con el proveedor original Resend — ver siguiente punto): ambos
  flujos (Reto 2 y Reto 3) probados con Playwright dirigido contra la app
  real, confirmando en Supabase que el lead se registra, se clasifica y
  ambos correos llegan con éxito (`providerId` real del proveedor en
  `lead_automation_events.metadata`).
- **Migración de Resend a SMTP de Gmail (Nodemailer)**: sin dominio propio
  verificado, el remitente de prueba de Resend (`onboarding@resend.dev`)
  solo podía enviar al correo del dueño de la cuenta — inservible para
  confirmar solicitudes a clientes reales, y el negocio no tiene dominio
  propio (el DNS de `*.vercel.app` lo administra Vercel). Se reemplazó
  solo la capa de transporte en `src/email/client.ts` por Nodemailer
  contra el SMTP de una cuenta Gmail exclusiva del negocio, con contraseña
  de aplicación (nunca la contraseña normal, nunca versionada — solo
  `.env.local` y Vercel). `processLead`, las plantillas, la idempotencia,
  la clasificación y las Server Actions no cambiaron; el `messageId` de
  Nodemailer ocupa el lugar del id de Resend como `providerId`. Detalle y
  limitaciones de Gmail SMTP en `docs/challenge-4.md`. Verificado de
  extremo a extremo en local con envío real: ambos flujos (Reto 2 y
  Reto 3) probados por el dueño del proyecto con ambos correos recibidos,
  más una pasada automatizada (Playwright) confirmando en
  `lead_automation_events` los tres eventos en `success` con `providerId`
  de Gmail, cero fugas de la contraseña en logs, y el camino de
  producción mal configurada registrando `error` explícito sin perder el
  lead. Pendiente solo la verificación en Vercel Preview cuando las
  variables estén configuradas allí.

## 2026-07-16 — Reto 6: "Pulso Ponquesito", reporte semanal automático (etapas 1–4)

- **Rama**: `reto-6/pulso-ponquesito`, desde `main`.
- **Orquestador: Vercel Cron** (lunes 12:00 UTC ≈ 8:00 a. m. Caracas), sin
  n8n/Make. Se asume plan Hobby (disparo con precisión de ±1 hora — el
  periodo no cambia mientras sea el mismo día calendario en Caracas).
- **Privacidad desde la consulta**: el reporte solo selecciona columnas no
  personales de `leads` y `lead_automation_events` (nunca nombre, correo,
  WhatsApp, payload, `error_message` ni `metadata`); los conteos usan
  `count` + `head`. Gemini recibe exclusivamente métricas agregadas.
  Probado con un fake de Supabase que siembra datos personales y proyecta
  columnas.
- **Terminología honesta de correo**: SMTP solo permite afirmar "aceptado
  por el servidor" — el contrato usa `sent`/`sendSuccessRate` (no
  `delivered`), sin métricas de apertura ni entrega. Tasa `null` cuando no
  hubo envíos (nunca 0 %/100 % inventado). Correos deduplicados por
  `lead_id + event_type`: error + reintento exitoso = UN envío exitoso.
- **Gemini nunca es punto único de fallo**: resumen con salida
  estructurada validada (mismo patrón del Reto 1) y fallback
  determinístico ante cualquier fallo; el reporte se envía igual y
  `summary_source` registra cuál se usó. Un fallo de Gemini NO es un
  estado de error del reporte.
- **Tabla `weekly_reports`** = registro de ejecuciones (una fila por
  corrida). Estados `processing → sent | email_error | data_error`;
  `metrics`/`summary` nullable a propósito (la fila nace como reserva).
  Idempotencia del cron con **índice único parcial**: una sola corrida
  `scheduled` por periodo (el segundo disparo recibe 23505 y se omite sin
  enviar); las corridas manuales quedan fuera del índice a propósito.
  RLS sin políticas públicas, igual que el resto.
- **Celebraciones próximas sobre todos los leads** (celebration_date entre
  hoy y hoy+7, calendario Caracas), no solo los del periodo: una
  celebración cercana importa aunque el lead sea antiguo.
- **Destinatario: `KAREM_NOTIFICATION_EMAIL`** (variable existente del
  Reto 4), guardado enmascarado (`k•••@…`) en la base. Alertas por reglas
  fijas, nunca por IA. Una semana sin registros produce y envía un reporte
  válido. Detalle completo en `docs/challenge-6.md`.
- **Etapas 5–6 (mismo día)**: endpoint `GET /api/reports/weekly`
  (`runtime nodejs`, `maxDuration 60`, `Cache-Control: no-store`) que solo
  acepta el secreto por header `Authorization: Bearer` (nunca query
  param); sin `CRON_SECRET` responde 503 sin ejecutar nada. Respuestas
  mínimas (`ok`, `status`, periodo, `reportId`): nunca destinatario,
  métricas, resumen ni errores internos. `?trigger=manual` para la
  verificación protegida, con el mismo secreto. Página pública
  `/reporte-semanal` que consulta EXCLUSIVAMENTE `weekly_reports` sin
  seleccionar `recipient_masked`, `error_message` ni `id` — el
  destinatario se describe solo como "correo configurado del negocio" y
  los estados fallidos usan etiquetas genéricas. **Riesgos aceptados como
  limitación documentada** (decisión del dueño del proyecto): fila
  `processing` huérfana ante una interrupción abrupta (el desbloqueo es
  una corrida manual, siempre permitida), sin paginación sobre el límite
  de 1000 filas de Supabase, y ventana de ±1 hora del cron en Vercel
  Hobby sin reintentos automáticos.
