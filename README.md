# Familia Ponquesito — Asistente de IA 🧁

Asistente virtual de **Familia Ponquesito**, una repostería familiar real
de Barquisimeto (Venezuela), construido para el **Proyecto 1 del Platzi
Vibe Coding Challenge**: un asistente que conoce el negocio a fondo,
responde preguntas de clientes basándose en una base de conocimiento real
y **admite honestamente cuando no sabe algo**.

**Demo en vivo:** https://familia-ponquesito.vercel.app

## Qué cumple del enunciado

| Requisito | Cómo se cumple |
|---|---|
| Base de conocimiento real (mín. 10 datos) | [`src/knowledge/familia-ponquesito.md`](src/knowledge/familia-ponquesito.md): ~30 datos reales — FAQ, 12 precios, tamaños, horarios, políticas, pagos, delivery — provistos por los dueños. Nada inventado. |
| Responde lo que sabe, admite lo que no | Tres estados de respuesta: `answered` (con dato de la base), `unknown` (lo admite explícitamente) y `human_required` (deriva a Instagram con los datos a preparar). Prompt anti-invención + salida estructurada validada en servidor + 59 pruebas. |
| Tono definido y coherente | Definido por los dueños y documentado en la base: trato de usted, respetuoso, cálido, emojis con moderación. |
| Canal utilizable | Chat web público, mobile-first, con preguntas sugeridas. |

Pruébelo con: *"¿Qué sabores de torta tienen?"* (responde), *"¿Tienen
tortas sin azúcar?"* (admite que no sabe), *"Quiero encargar una torta"*
(deriva a una persona).

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Google Gemini
(`@google/genai`, salida estructurada con JSON Schema) · Vitest.

## Arquitectura (mínima a propósito)

```
UI (src/app) → POST /api/assistant → servicio (src/assistant/service.ts)
  → proveedor Gemini (src/providers/gemini.ts)
      ├─ prompt del sistema (src/assistant/prompt.ts)
      └─ base de conocimiento (src/knowledge/*.md)
```

Incluye rate limiting (10 req/min/IP), validación estricta de la salida
del modelo con fallback seguro, historial acotado a 6 turnos y errores
siempre amables. En producción, si falta la API key la app **falla
explícitamente** (sin degradar en silencio). Las decisiones y sus motivos
están en [`docs/decisions.md`](docs/decisions.md).

## Correr en local

Requiere Node ≥ 20.9 (hay `.nvmrc` con 22.14.0).

```bash
nvm use
npm install
cp .env.example .env.local   # poner GEMINI_API_KEY (gratis en aistudio.google.com/apikey)
npm run dev                  # http://localhost:3000
```

Sin `GEMINI_API_KEY`, en desarrollo funciona con un proveedor determinista
de demostración (sin IA). Pruebas y lint:

```bash
npm test      # 59 pruebas (no consumen cuota de Gemini)
npm run lint
```

## Documentación

- [`docs/product-brief.md`](docs/product-brief.md) — contexto del producto
- [`docs/challenge-1.md`](docs/challenge-1.md) — requisitos y criterios del reto
- [`docs/decisions.md`](docs/decisions.md) — registro de decisiones con motivos
- [`CLAUDE.md`](CLAUDE.md) — reglas para agentes de IA que trabajen en el repo
