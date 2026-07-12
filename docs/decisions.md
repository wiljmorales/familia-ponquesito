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
