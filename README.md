# Familia Ponquesito 🧁

Producto real para **Familia Ponquesito**, una repostería familiar de
Barquisimeto (Venezuela), construido para el **Platzi Vibe Coding
Challenge**. El repositorio evoluciona reto a reto (ver
[`docs/product-brief.md`](docs/product-brief.md)).

**Demo en vivo:** https://familia-ponquesito.vercel.app

| Ruta | Qué es | Reto |
|---|---|---|
| `/` | Landing de producto: propuesta de valor, galería, sabores, condiciones y formulario de solicitud de cotización (persistido en Supabase). | Reto 2 |
| `/crea-tu-torta` | Juego "Crea tu propia torta": decora una torta paso a paso y deja tus datos para recibir una cotización personalizada inspirada en tu diseño (persistido en Supabase). | Reto 3 |
| `/asistente` | Chat del asistente virtual que responde con la base de conocimiento real del negocio y admite lo que no sabe. | Reto 1 |

Los leads de `/` y `/crea-tu-torta` se procesan automáticamente (Reto 4):
registro y clasificación, correo de confirmación al cliente, correo interno
a Karem con enlace de WhatsApp precargado. Ver más abajo.

## Reto 4 — "La máquina de leads que trabaja sola"

Cuando cualquiera de los dos formularios se envía con éxito, un servicio
central (`src/leads/service.ts`) corre en segundo plano (vía `after()` de
Next.js, sin bloquear la respuesta al usuario):

1. Registra el lead en una tabla común (`leads`) y lo clasifica por
   anticipación (`not_viable` / `urgent` / `high` / `normal`, calculado
   sobre el calendario de Caracas).
2. Envía un correo de confirmación al cliente, personalizado por origen.
3. Envía un correo interno a Karem con el resumen completo, prioridad y un
   enlace de WhatsApp precargado para contactar al cliente.
4. Registra cada paso (éxito o error) en `lead_automation_events`, de forma
   idempotente: un reintento posterior nunca duplica un correo ya enviado
   con éxito.

Un fallo de correo nunca borra ni bloquea el lead ya guardado en
`cake_requests`/`cake_designs`. Detalle completo, riesgos y decisiones en
[`docs/challenge-4.md`](docs/challenge-4.md).

## Reto 3 — "Crea tu propia torta": captura de leads con un juego

Wizard mobile-first para decorar una torta (piso, color, pedestal, placa
con dedicatoria, topper) sobre assets reales del negocio con transparencia
recortada a propósito (ver `docs/challenge-3.md`). Solo después de ver el
resultado terminado aparece la llamada a la acción: dejar los datos de
contacto para recibir una cotización personalizada de Familia Ponquesito
inspirada en el diseño. Cada lead guarda el diseño completo (JSON
reconstruible) y recibe un código de diseño (`FP-3-XXXX`) en la tabla
`cake_designs` — separada de `cake_requests` (Reto 2) a propósito, para no
mezclar ambos tipos de lead ni forzar campos que no aplican. Detalle
completo, riesgos y decisiones en
[`docs/challenge-3.md`](docs/challenge-3.md).

## Reto 2 — Landing con captura real de datos

Landing fiel al sistema de diseño e identidad visual entregados por el
negocio (paleta crema/terracota/cacao/dorado, tipografía Playfair Display +
Inter + Sacramento, fotografía real de tortas). El formulario "Cuéntanos
cómo imaginas tu celebración" valida en cliente y servidor, sube la imagen
de referencia opcional a Supabase Storage y guarda la solicitud en la tabla
`cake_requests`. Detalle de requisitos, preguntas pendientes y decisiones
de alcance en [`docs/challenge-2.md`](docs/challenge-2.md).

### Configurar Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Copia el contenido de [`supabase/schema.sql`](supabase/schema.sql) en el
   **SQL Editor** de tu proyecto y ejecútalo (es idempotente: puedes
   volver a correrlo sin duplicar nada). Crea las tablas `cake_requests`,
   `cake_designs`, `leads` y `lead_automation_events` (todas con RLS
   habilitado, sin políticas públicas) y el bucket privado
   `cake-references`.
3. En **Project Settings → API Keys**, copia la URL del proyecto y la
   clave secreta a tu `.env.local` (ver `.env.example`). En proyectos
   nuevos aparece como **"Secret key"** (`sb_secret_...`); en proyectos
   más antiguos, como **"service_role"**. Esa clave solo se usa en la
   Server Action de servidor; nunca se expone al navegador.

### Probar el formulario en local

```bash
npm run dev
# abre http://localhost:3000, baja a "Cuéntanos cómo imaginas tu celebración"
```

Sin las variables de Supabase configuradas, el formulario valida
correctamente pero el envío final falla con un mensaje amable (comportamiento
esperado: no hay dónde guardar los datos).

## Reto 1 — Asistente de IA

| Requisito | Cómo se cumple |
|---|---|
| Base de conocimiento real (mín. 10 datos) | [`src/knowledge/familia-ponquesito.md`](src/knowledge/familia-ponquesito.md): ~30 datos reales — FAQ, 12 precios, tamaños, horarios, políticas, pagos, delivery — provistos por los dueños. Nada inventado. |
| Responde lo que sabe, admite lo que no | Tres estados de respuesta: `answered` (con dato de la base), `unknown` (lo admite explícitamente) y `human_required` (deriva a Instagram con los datos a preparar). Prompt anti-invención + salida estructurada validada en servidor + 59 pruebas. |
| Tono definido y coherente | Definido por los dueños y documentado en la base: trato de usted, respetuoso, cálido, emojis con moderación. |
| Canal utilizable | Chat web en `/asistente`, mobile-first, con preguntas sugeridas. |

Pruébelo con: *"¿Qué sabores de torta tienen?"* (responde), *"¿Tienen
tortas sin azúcar?"* (admite que no sabe), *"Quiero encargar una torta"*
(deriva a una persona).

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · React Hook Form +
Zod · Supabase (Postgres + Storage) · Google Gemini (`@google/genai`,
salida estructurada con JSON Schema) · Nodemailer (correo por SMTP de Gmail) ·
lucide-react · Vitest.

## Arquitectura (mínima a propósito)

```
Landing (/)                          Asistente (/asistente)
  └─ RequestForm (RHF + Zod)           └─ Chat → POST /api/assistant
       └─ Server Action                     → servicio (src/assistant/service.ts)
            └─ Supabase (service role)           → proveedor Gemini (src/providers/gemini.ts)
                 ├─ tabla cake_requests                 ├─ prompt del sistema
                 └─ bucket cake-references              └─ base de conocimiento
            └─ after(() => processLead())  ← src/leads/service.ts (Reto 4)
                 ├─ tabla leads
                 ├─ tabla lead_automation_events
                 └─ correos (src/email/) vía SMTP de Gmail (Nodemailer)
```

El asistente incluye rate limiting (10 req/min/IP), validación estricta de
la salida del modelo con fallback seguro e historial acotado a 6 turnos.
En producción, si falta `GEMINI_API_KEY` la app **falla explícitamente**
(sin degradar en silencio); la automatización de leads sigue el mismo
criterio para el correo (ver `docs/challenge-4.md`). Las decisiones
importantes de los cuatro retos y sus motivos están en
[`docs/decisions.md`](docs/decisions.md).

## Correr en local

Requiere Node ≥ 20.9 (hay `.nvmrc` con 22.14.0).

```bash
nvm use
npm install
cp .env.example .env.local   # ver variables abajo
npm run dev                  # http://localhost:3000
```

Variables de entorno (`.env.local`, ver `.env.example` para el detalle de
cada una):

- `GEMINI_API_KEY` — opcional; sin ella, `/asistente` usa un proveedor
  determinista de demostración (sin IA).
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — necesarias para
  que el formulario de la landing guarde datos de verdad (ver sección de
  Supabase arriba).
- `NEXT_PUBLIC_WHATSAPP_URL` — opcional; sin ella, el footer no muestra el
  enlace de WhatsApp (no hay número de negocio confirmado todavía).
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
  `SMTP_APP_PASSWORD`, `EMAIL_FROM`, `KAREM_NOTIFICATION_EMAIL` —
  necesarias para que la automatización de leads (Reto 4) envíe correos
  reales por el SMTP de la cuenta Gmail del negocio (contraseña de
  aplicación, nunca la contraseña normal). Sin ellas, en desarrollo/test
  se usa un stub que solo loguea en consola (no envía nada); en
  producción, cada paso de correo sin configurar queda registrado como
  error explícito, nunca como éxito simulado. Detalle en
  [`docs/challenge-4.md`](docs/challenge-4.md).

Pruebas y lint:

```bash
npm test      # 139 pruebas (no consumen cuota de Gemini ni tocan Supabase/SMTP)
npm run lint
npm run build
```

## Documentación

- [`docs/product-brief.md`](docs/product-brief.md) — contexto general del producto
- [`docs/challenge-1.md`](docs/challenge-1.md) — requisitos y criterios del Reto 1
- [`docs/challenge-2.md`](docs/challenge-2.md) — requisitos y criterios del Reto 2
- [`docs/challenge-3.md`](docs/challenge-3.md) — requisitos y criterios del Reto 3
- [`docs/challenge-4.md`](docs/challenge-4.md) — requisitos y criterios del Reto 4
- [`docs/decisions.md`](docs/decisions.md) — registro de decisiones con motivos
- [`CLAUDE.md`](CLAUDE.md) — reglas para agentes de IA que trabajen en el repo
