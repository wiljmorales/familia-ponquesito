# Familia Ponquesito 🧁

Producto real para **Familia Ponquesito**, una repostería familiar de
Barquisimeto (Venezuela), construido para el **Platzi Vibe Coding
Challenge**. El repositorio evoluciona reto a reto (ver
[`docs/product-brief.md`](docs/product-brief.md)).

**Demo en vivo:** https://familia-ponquesito.vercel.app

| Ruta | Qué es | Reto |
|---|---|---|
| `/` | Landing de producto: propuesta de valor, galería, sabores, condiciones y formulario de solicitud de cotización (persistido en Supabase). | Reto 2 |
| `/asistente` | Chat del asistente virtual que responde con la base de conocimiento real del negocio y admite lo que no sabe. | Reto 1 |

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
   **SQL Editor** de tu proyecto y ejecútalo. Crea la tabla
   `cake_requests` (con RLS habilitado, sin políticas públicas) y el bucket
   privado `cake-references`.
3. En **Project Settings → API**, copia la URL del proyecto y la
   **service role key** a tu `.env.local` (ver `.env.example`). La service
   role key solo se usa en la Server Action de servidor; nunca se expone
   al navegador.

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
salida estructurada con JSON Schema) · lucide-react · Vitest.

## Arquitectura (mínima a propósito)

```
Landing (/)                          Asistente (/asistente)
  └─ RequestForm (RHF + Zod)           └─ Chat → POST /api/assistant
       └─ Server Action                     → servicio (src/assistant/service.ts)
            └─ Supabase (service role)           → proveedor Gemini (src/providers/gemini.ts)
                 ├─ tabla cake_requests                 ├─ prompt del sistema
                 └─ bucket cake-references              └─ base de conocimiento
```

El asistente incluye rate limiting (10 req/min/IP), validación estricta de
la salida del modelo con fallback seguro e historial acotado a 6 turnos.
En producción, si falta `GEMINI_API_KEY` la app **falla explícitamente**
(sin degradar en silencio). Las decisiones importantes de ambos retos y sus
motivos están en [`docs/decisions.md`](docs/decisions.md).

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

Pruebas y lint:

```bash
npm test      # 59 pruebas (no consumen cuota de Gemini ni tocan Supabase)
npm run lint
npm run build
```

## Documentación

- [`docs/product-brief.md`](docs/product-brief.md) — contexto general del producto
- [`docs/challenge-1.md`](docs/challenge-1.md) — requisitos y criterios del Reto 1
- [`docs/challenge-2.md`](docs/challenge-2.md) — requisitos y criterios del Reto 2
- [`docs/decisions.md`](docs/decisions.md) — registro de decisiones con motivos
- [`CLAUDE.md`](CLAUDE.md) — reglas para agentes de IA que trabajen en el repo
