# Reto 7 — Agente de Atención Ponquesito

Agente que recibe mensajes libres de clientes, comprende la intención con
IA y decide cuál capacidad existente del sistema activar. Es el cerebro
que conecta los retos anteriores:

```text
Reto 1: el sistema responde preguntas.
Retos 2 y 3: captura solicitudes.
Reto 4: automatiza nuevos leads.
Reto 5: ayuda a gestionar pedidos.
Reto 6: reporta resultados.
Reto 7: comprende cualquier mensaje y decide qué capacidad utilizar.
```

Demostración en `/agente` (accesible por URL directa, `noindex`, igual que
el prototipo del Reto 5). Endpoint: `POST /api/agent`.

## Arquitectura (src/agent/)

Cinco piezas separadas, nunca una función monolítica:

| Pieza | Archivo | Qué hace |
| --- | --- | --- |
| Interpretación | `analyze.ts` | Gemini con `responseSchema` + validación Zod en servidor; fallback determinista ante cualquier fallo. |
| Guardrails | `guardrails.ts` | Reglas deterministas del negocio; prevalecen sobre el modelo y registran cada corrección. |
| Router | `router.ts` | Una sola ruta por decisión; ruta desconocida degrada a revisión humana. |
| Ejecutores | `execute.ts` | Una consecuencia distinta por ruta, reutilizando Retos 1/4/5. |
| Orquestador y registro | `service.ts` | `processAgentMessage()`: análisis → guardrails → ruta → ejecución → fila en `agent_decisions`. Nunca lanza (salvo entrada inválida → 400). |

Contratos en `types.ts` (unión discriminada de 5 intenciones y 5 rutas),
esquema cerrado en `schema.ts` (Zod: coherencia intención↔ruta↔
`requiresHuman`, confianza 0–1, `missingFields` de lista cerrada, campos
extra rechazados). Los campos "detectados" (código de pedido, fecha) con
formato inválido se normalizan a `null` en vez de tumbar la decisión: los
guardrails los re-derivan del mensaje por regex (anti-invención).

`detectedCelebrationDate` no está en la propuesta del enunciado; se agregó
porque los guardrails de anticipación mínima necesitan la fecha absoluta
para aplicarse de forma determinista.

## Qué se reutiliza (y qué no se duplica)

- **Ruta "máquina de leads"**: invoca `processLead()` del Reto 4 tal cual.
  La fila de `agent_decisions` actúa como fila original del lead
  (`source_type = 'agent_message'`, prefijo `FP-7`), igual que
  `cake_requests`/`cake_designs` para los Retos 2/3. Tras invocarlo se
  consulta la tabla `leads` para confirmar el registro: `processLead` no
  devuelve resultado y jamás se afirma un registro sin verificarlo.
- **Ruta "consulta general"**: `askAssistant()` del Reto 1 (base de
  conocimiento completa), llamado en servidor. No crea lead.
- **Ruta "revisión de pedido"**: pedidos demo del Reto 5
  (`createPrototypeOrders`) con la misma fecha base de Caracas; etiquetas
  de estado de `StatusBadge`. Nunca confirma cambios automáticamente.
- **Clasificación de prioridad**: la hace el propio `processLead`
  (`classifyLeadPriority`, Reto 4); el agente no la reimplementa.
- **Patrón Gemini + fallback**: mismo esquema estructurado + validación +
  degradación de los Retos 1 y 6; `decision_source` registra quién decidió
  (como `summary_source` en el Reto 6).
- **Rate limiting**: `createRateLimiter` del Reto 1 (10/min por IP).
- **Persistencia de la demo**: sessionStorage con clave versionada y carga
  defensiva, patrón del Reto 5 (el enunciado sugería localStorage "según
  el patrón del Reto 5", pero ese patrón usa sessionStorage; se mantiene
  la convención real del repositorio).

## Guardrails deterministas (las políticas mandan)

Si la decisión del modelo contradice una política, la regla la corrige y
la corrección queda visible en la demo y en `guardrail_corrections`:

- Alergias, seguridad alimentaria o reclamos → intervención humana
  SIEMPRE; ninguna ruta automática responde comprometiéndose.
- Menos de 3 días de anticipación (incluido el mismo día) → nunca entra
  sola a la máquina de leads; escala a Karem con urgencia alta/crítica.
- Cambios o cancelaciones → jamás se confirman automáticamente (la
  política de cambios depende de que la preparación no haya comenzado y
  eso lo confirma Karem). Urgencia crítica si la fecha real o la declarada
  está cerca, o si la fecha declarada no coincide con la registrada.
- Consulta general → nunca crea lead.
- Máquina de leads sin datos de contacto o sin fecha → primero se piden
  (la tabla `leads` exige correo/WhatsApp y la clasificación exige fecha).
- Código de pedido: la extracción por regex del mensaje prevalece sobre el
  modelo (completa omisiones y descarta códigos que no están en el texto).
- Confianza < 0.4 → revisión humana (decisión de diseño del agente, no
  política del negocio; documentada en `guardrails.ts`).

## Fallback (Gemini nunca es punto único de fallo)

Ante clave ausente, error, timeout, JSON inválido, intención desconocida o
decisión incoherente: el mensaje **no se pierde**, se clasifica como caso
sensible ("situación ambigua con riesgo"), va a revisión humana, la razón
explica que no se pudo determinar una ruta segura y `decision_source =
'fallback'` queda registrado. Ninguna acción automática se ejecuta.

## Persistencia

- `agent_decisions` (en `supabase/schema.sql`, aditiva, RLS sin políticas
  públicas): mensaje, decisión completa, correcciones, ruta, acción
  ejecutada y estado. La fila se inserta ANTES de ejecutar (patrón de
  reserva del Reto 6) y se completa al final.
- El check de `leads.source_type` se amplió (idempotente) con
  `'agent_message'`; las filas existentes no se ven afectadas.
- **Pendiente de aplicar en el proyecto real**: pegar `supabase/schema.sql`
  en el SQL Editor (mismo flujo de los retos anteriores). Sin la tabla, la
  demo funciona igual y lo dice honestamente ("sin registro en base de
  datos"); la ruta de leads no registra nada ni envía correos.

## Datos de la demo y honestidad

- Las fuentes de los cinco casos llevan "(simulado)"; los mensajes libres
  se etiquetan "Mensaje directo (demostración)".
- El caso 1 trae contacto simulado resuelto EN SERVIDOR: teléfono
  `0412-0000000` (el mismo ficticio del Reto 5) y correo de
  `AGENT_DEMO_CUSTOMER_EMAIL` o, en su defecto, `KAREM_NOTIFICATION_EMAIL`
  — así los correos reales que dispara la automatización del Reto 4 llegan
  a una casilla controlada por el negocio, nunca a un tercero inventado.
  El cliente jamás recibe estos valores (no van al bundle).
- Los casos demo se procesan por id: el servidor usa siempre el mensaje
  canónico del caso (el cliente no puede inyectar otro texto bajo esa
  etiqueta).
- Las notificaciones a Karem de las rutas de revisión/escalamiento son
  simuladas y se muestran como "(simulada)". Lo único que envía correos
  reales es la automatización existente del Reto 4 cuando un lead se
  registra de verdad, y así se indica.
- Los contadores del resumen se derivan del estado real; no hay estados
  escritos a mano.

## Pruebas (45 nuevas; 324 en total)

- `schema.test.ts`: decisión válida aceptada; intención desconocida,
  confianza fuera de rango, combinaciones incoherentes, campos extra y
  `missingFields` fuera de lista rechazados; normalización anti-invención.
- `guardrails.test.ts`: mismo día, < 3 días, alergia (incluso si el modelo
  la trató como consulta), cambio para mañana, consulta sin lead,
  campos faltantes, lead sin contacto, extracción de códigos y fechas.
- `router.test.ts`: cada intención a su ruta; fallback a revisión humana;
  ruta desconocida degrada.
- `service.test.ts`: integración mensaje → decisión → guardrails → ruta →
  resultado con los CINCO casos (analizador mockeado, sin red), incluido
  el registro real del lead vía `processLead` contra un fake de Supabase
  (correos del Reto 4 verificados con un email client falso), el camino de
  fallo de la IA y la demo sin Supabase.
- `demo-storage.test.ts`: persistencia defensiva de la demo.

Ninguna prueba llama a Gemini: la capa del modelo se inyecta.

## Verificación manual realizada (2026-07-17)

Contra el servidor local con Gemini real: los cinco casos tomaron las
cinco rutas esperadas (caso 4 detectó `PED-001`, urgencia crítica por
discrepancia de fechas; caso 1 resolvió "dentro de ocho días" a la fecha
exacta), un mensaje libre con intención de compra sin contacto fue
redirigido por el guardrail a solicitar datos, y sin la tabla
`agent_decisions` la demo degradó honestamente sin enviar correos.
`vitest` (324), `eslint`, `tsc` y `next build` en verde.

## Variables de entorno

Sin variables nuevas obligatorias. Opcional: `AGENT_DEMO_CUSTOMER_EMAIL`
(correo del "cliente" simulado del caso 1; si falta se usa
`KAREM_NOTIFICATION_EMAIL`; si tampoco existe, la ruta de leads pide
contacto en vez de registrar).

## Pendientes

Ninguno. El esquema se aplicó en el proyecto real de Supabase
(2026-07-17) y el caso 1 se verificó completo contra ese entorno: lead
`FP-7-CKB7` registrado en `leads` (prioridad alta, fecha resuelta por
Gemini), fila de `agent_decisions` completada (`lead_registered`,
`decision_source = 'gemini'`) y los tres eventos de la automatización del
Reto 4 en `success` (`lead_registered`, `customer_email`, `owner_email`),
es decir, ambos correos reales enviados.
