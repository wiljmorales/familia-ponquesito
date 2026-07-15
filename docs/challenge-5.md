# Reto 5 — "El prototipo que convence en una reunión"

Ver `docs/product-brief.md` para el contexto general del producto.

## Resumen del reto

Convertir una idea en un prototipo navegable que se pueda ver, recorrer y
probar mediante un enlace antes de una reunión. Debe tener al menos tres
pantallas conectadas, interacciones reales (botones que navegan, formularios
que avanzan, estados que cambian) y un contexto claro: qué problema resuelve
y a quién se le presentaría. No necesita backend ni datos reales.

## La idea: "Centro de pedidos de Familia Ponquesito"

Un mini CRM de pedidos especializado para la repostería, presentado con
lenguaje cercano al negocio (nunca como "CRM" en la interfaz).

### Problema

Las solicitudes de tortas llegan por varios canales (formulario de la
landing, el diseñador "Crea tu torta", WhatsApp, Instagram). Eso puede
provocar solicitudes olvidadas, información dispersa, respuestas tardías y
confusión entre solicitudes, cotizaciones, anticipos y pedidos confirmados.

### Audiencia

**Karem**, dueña de Familia Ponquesito y responsable de revisar solicitudes,
cotizar y organizar la producción. El prototipo se le presentaría a ella.

### Hipótesis de producto

> Centralizar todas las solicitudes en un solo lugar le permite a Karem
> revisar cada pedido, preparar una cotización y saber qué clientes esperan
> respuesta, anticipo o confirmación, sin perder ninguna solicitud.

## Alcance

Cinco pantallas conectadas en una sola ruta pública (`/prototipo`):

```text
intro → dashboard → request-detail → quote-form → quote-sent
```

1. **Presentación**: portada de la idea (problema, audiencia, beneficio,
   aclaración de que es un prototipo) con CTA "Explorar el prototipo".
2. **Centro de pedidos**: indicadores, filtros por estado y tarjetas de
   pedidos de demostración.
3. **Detalle de la solicitud**: ficha completa + línea de progreso
   `Nueva → En revisión → Cotización → Anticipo → Confirmada`.
4. **Preparar cotización**: formulario real con total reactivo, anticipo
   automático del 50 %, validaciones y vista previa del mensaje al cliente.
5. **Cotización enviada**: confirmación simulada; al volver al centro, el
   pedido aparece en "Esperando anticipo" y los indicadores se actualizan.

Estados posibles de un pedido:

```text
new → reviewing → to_quote → waiting_deposit → confirmed
```

## Decisiones técnicas

Cada una sigue el criterio de `CLAUDE.md`: la solución más simple que cumpla
el reto actual.

- **Una sola ruta `/prototipo` con navegación controlada por estado**
  (`useReducer`), en lugar de rutas anidadas (`/prototipo/pedidos/[id]`).
  La demo es una historia lineal con un solo estado compartido; rutas
  profundas exigirían sincronizar URL ↔ estado sin aportar nada a la
  presentación, y podrían abrirse fuera de contexto.
- **Fechas relativas y deterministas.** Los datos demo se generan con
  `createPrototypeOrders(baseDate)`: nunca se llama `new Date()` al importar
  el módulo. La página server calcula la fecha base con el calendario de la
  zona horaria del negocio (`America/Caracas`, igual que el clasificador de
  leads del Reto 4) y la pasa como prop al cliente, de modo que servidor y
  cliente usan exactamente la misma referencia y las pruebas usan fechas
  fijas. Así los pedidos demo jamás quedan vencidos.
- **Persistencia mínima y defensiva.** `sessionStorage` bajo la clave
  versionada `familia-ponquesito:prototype:v1`. Solo se guarda lo que no se
  puede reconstruir: los cambios de estado de los pedidos
  (`statusOverrides`). JSON corrupto, versión desconocida o estados
  inválidos se descartan sin romper la app. Tras una recarga se conserva el
  cambio del pedido, pero la demo vuelve a la portada (decisión de
  prototipo: la portada es el contexto de la presentación).
- **Pruebas de lógica pura en Vitest (entorno node)**, siguiendo la
  convención del repo: reducer, cálculos de cotización, filtros, generador
  de datos y persistencia. Sin jsdom ni Testing Library; el recorrido visual
  se cubre con una verificación manual documentada (ver más abajo).
- **Sin enlace desde el Header público.** El prototipo es una herramienta
  interna para presentarle a Karem; se accede por URL directa.
- **Montos en US$.** Decisión de prototipo: los montos de la cotización son
  ficticios y se muestran en dólares como moneda de referencia. No hay
  precios reales confirmados del negocio, así que no se usan.
- **Prioridad derivada, no inventada.** El "nivel de atención" de cada
  pedido se deriva de los días que faltan para la celebración, con los
  mismos umbrales del clasificador real de leads del Reto 4
  (`src/leads/classify.ts`).
- **Fecha límite de la cotización acotada por la política real.** No puede
  ser posterior a (celebración − 3 días), porque la anticipación mínima del
  negocio es de 3 días y la reserva se confirma con el anticipo.
- **`noindex` no es protección de acceso.** `/prototipo` es públicamente
  accesible mediante su URL — a propósito: el reto exige un enlace que se
  pueda compartir antes de una reunión. El `robots: noindex` solo reduce su
  descubrimiento en buscadores; no es autenticación ni control de acceso.
  Quien tenga el enlace puede abrirlo.
- **Botón propio del prototipo (`PrototypeButton`).** El `ui/Button`
  compartido dibuja su anillo de foco con `currentColor` (crema sobre fondo
  crema en el variant primario: imperceptible con teclado). En vez de
  cambiar el contrato del componente global por este reto, el prototipo usa
  un botón propio con ring terracota oscuro visible sobre crema, blanco y
  terracota.
- **Cotizar solo tiene sentido en estados cotizables.** `canPrepareQuote`
  (new/reviewing/to_quote) se aplica en la UI y en el reducer (doble
  barrera): un pedido esperando anticipo o confirmado ya no ofrece
  "Preparar cotización"; muestra una nota de su situación.

## Decisiones del formulario de cotización

- **Sin librería de formularios.** react-hook-form existe en el repo (Reto
  2), pero la validación ya vive en funciones puras (`validateQuote`,
  `computeQuoteTotals`); un estado controlado simple las consume directo y
  agregar el resolver/registro de RHF solo sumaría indirección.
- **La UI no duplica cálculos.** El formulario guarda strings crudos y los
  convierte con `quoteInputFromForm` (coma decimal aceptada, opcionales
  vacíos = 0, precio base vacío = NaN para que la validación lo exija). El
  total y el anticipo del 50 % (`DEPOSIT_PERCENT`) se recalculan en vivo en
  una región `aria-live`.
- **Errores tras el primer intento de envío**, asociados por campo con
  `aria-describedby`/`aria-invalid` (los componentes `InputField`/
  `TextareaField` existentes ya lo hacen), más un resumen `role="alert"`.
  El reducer vuelve a validar en `send_quote`: con datos inválidos no se
  avanza aunque la UI fallara.
- **Delivery desactivado: el campo de costo se oculta** y una nota aclara
  que no se suma al total; el valor escrito se conserva en el estado del
  formulario por si se reactiva en la misma edición.
- **Cancelar descarta los valores.** "Volver al detalle" no cambia el
  estado del pedido ni persiste nada; reabrir "Preparar cotización"
  arranca de los valores iniciales (delivery según lo pidió el cliente y
  fecha límite propuesta por la regla). Predecible y sin estado extra.
- **Vista previa honesta.** El mensaje se genera con `buildCustomerMessage`
  cuando los montos son numéricos y la fecha está bien formada
  (`isPreviewableQuote`); lleva la etiqueta "Vista previa · No se enviará
  ningún mensaje" y es una tarjeta neutra de la marca, sin imitar una
  conversación de WhatsApp ni enlaces externos.
- **Montos en "US$ de demostración"**, dicho en el encabezado del
  formulario, junto a los totales y en la confirmación: no son precios
  oficiales de Familia Ponquesito.

## Datos simulados

Cinco solicitudes definidas en `src/data/prototype-orders.ts`, una por cada
estado del pedido. Todo es claramente ficticio:

- Teléfonos `0412-0000000` (contacto de demostración).
- Nombres inventados; la interfaz muestra la etiqueta "Datos de
  demostración".
- Fechas relativas a la fecha base (entre 4 y 12 días hacia adelante), de
  modo que siempre respetan la anticipación mínima de 3 días.
- Sabores y tipos de celebración tomados de las constantes reales del
  negocio (`src/lib/constants/business.ts`): vainilla, chocolate, red
  velvet, tres leches.
- Políticas coherentes con la base de conocimiento: reserva del 50 %,
  delivery por la app Vamos con costo adicional, zona este de Barquisimeto.
- El pedido `PED-001` es el preparado para recorrer el flujo completo de la
  demostración (llega como solicitud nueva el mismo día).

## Fuera de alcance

Sin autenticación, roles, base de datos, Supabase, correos, WhatsApp real,
pagos, inventario, calendario, gestión de clientes, drag-and-drop, CRUD
completo ni integración real con los leads de los retos anteriores. No se
tocan tablas, migraciones ni variables de entorno. El Reto 5 no es un CRM
completo: es una historia de producto navegable.

## Criterios de aceptación

- Ruta pública y navegable (`/prototipo`) que se entiende sin explicación
  oral.
- Karem identificada como la persona a quien se presenta.
- Al menos tres pantallas conectadas; el flujo completo se puede recorrer.
- Formulario de cotización funcional: total y anticipo (50 %) automáticos,
  delivery activable, validaciones con mensajes claros.
- El pedido cambia realmente a "Esperando anticipo" y se ve al volver al
  centro (indicadores y filtro incluidos).
- Botón "Reiniciar demo" que restaura los datos iniciales.
- Todos los datos identificados como demostración; sin backend ni envíos
  reales.
- Responsive (≈1440 px y ≈390 px), identidad visual de Familia Ponquesito.
- Los retos anteriores siguen funcionando y las verificaciones del repo
  pasan.

## Cómo ejecutar la demo

```bash
npm run dev
# abrir http://localhost:3000/prototipo
```

La ruta es pública y se entiende sin explicación oral: la portada presenta
el problema, la audiencia y el CTA "Explorar el prototipo". `/prototipo` se
renderiza por request (`connection()`) para que la fecha base sea siempre
la del día; el resto del sitio sigue estático. La página lleva
`robots: noindex` (decisión de prototipo: es una herramienta interna que se
comparte por enlace directo).

## Cómo reiniciar el prototipo

Botón "Reiniciar demo" en el encabezado (visible en todas las pantallas
menos la portada). Pide confirmación, borra la clave de `sessionStorage` y
restaura pedidos, contadores y filtros iniciales.

## Verificación manual del recorrido (ejecutada el 2026-07-14)

Contra el build de producción (`npm run build` + `npm start`), con
Playwright sobre Chromium, siguiendo el mecanismo del skill `verify` del
repo:

- [x] Portada → Centro de pedidos → filtro → detalle → preparar cotización
      → modificar montos → activar/desactivar delivery → enviar cotización
      simulada → confirmación → volver al centro → pedido en "Esperando
      anticipo" → reiniciar demo.
- [x] Escritorio ≈1440 px y móvil ≈390 px, sin desbordamiento horizontal.
- [x] Navegación por teclado (Tab, Shift+Tab, Enter, Space) y estados de
      foco visibles, incluido el foco que se mueve al título al cambiar de
      pantalla.
- [x] Mensajes de validación claros en el formulario (por campo y resumen).
- [x] Recarga de la página después de actualizar un pedido: el cambio se
      conserva.

## Verificaciones realizadas

### Etapa 3 (recorrido completo) — 2026-07-14

- `npm test`: 222 pruebas pasan (26 archivos, 83 del Reto 5).
- `npm run lint` y `npx tsc --noEmit`: sin errores.
- `npm run build`: `/prototipo` sigue siendo la única ruta dinámica (ƒ);
  el resto del sitio queda estático (○).
- Verificación E2E con Playwright (66/66 puntos): recorrido completo en
  1440 px y 390 px con todos los datos del detalle, línea de progreso con
  `aria-current`, envío inválido bloqueado, total/anticipo en vivo (80 →
  105 → 110 con delivery → 100 con descuento; anticipo siempre 50 %),
  delivery on/off conservando el monto, fecha límite validada contra la
  anticipación mínima, vista previa etiquetada con métodos de pago reales,
  confirmación con nuevo estado, contadores actualizados al volver
  (Nuevas 0, Esperando 2), filtro incluye a PED-001, "Recorrido sugerido"
  desaparece y queda la marca "Cotizada en esta demostración", el detalle
  reabierto ya no ofrece cotizar, recarga conserva el estado, reinicio
  restaura todo, JSON corrupto no rompe, acceso directo y enlace al sitio
  funcionan.
- Teclado real (12/12): Tab/Shift+Tab/Enter/Space, anillo de foco del
  botón propio perceptible (offset crema 2px + ring terracota oscuro), y
  el foco aterriza en el h1 de cada pantalla al navegar.
- **Cero solicitudes externas** durante todo el flujo (monitoreadas con
  Playwright: ninguna petición salió de localhost) y cero errores de
  consola o hidratación.
- Hallazgo corregido durante la verificación: los `sr-only`
  (position:absolute) de la línea de progreso escapaban del contenedor de
  scroll en móvil y ensanchaban la página; se contuvo con `relative` en el
  `<ol>`.

## Limitaciones del prototipo

- Los datos viven en memoria + `sessionStorage`: cada pestaña tiene su
  propia demo y cerrar la pestaña la reinicia.
- Solo el pedido en estados cotizables recorre el flujo de cotización; las
  acciones "Solicitar información" y "No puedo tomar este pedido" son
  visión de producto (deshabilitadas, sin flujo).
- No hay integración con los leads reales de los retos anteriores ni
  ningún envío: es una historia de producto navegable para validar la idea
  con Karem, no el sistema operando.

### Etapa 2 (portada + centro de pedidos) — 2026-07-14

- `npm test`: 204 pruebas pasan (25 archivos, 65 del Reto 5).
- `npm run lint` y `npx tsc --noEmit`: sin errores.
- `npm run build`: `/prototipo` sale como única ruta dinámica (ƒ); todas
  las rutas anteriores siguen estáticas (○).
- Verificación manual con Playwright (build de producción, siguiendo el
  skill `verify` del repo) en 1440 px y 390 px: portada comprensible
  (Karem, problema, flujo, aviso de demo), explorar → dashboard,
  indicadores y 5 tarjetas, filtros con `aria-pressed` y estado vacío
  útil, "Ver pedido" → vista temporal del detalle → volver, overrides
  válidos en `sessionStorage` sobreviven la recarga, JSON corrupto no
  rompe la UI, "Reiniciar demo" limpia la clave y restaura los datos,
  regreso al sitio principal, sin desbordamiento horizontal en ninguno de
  los dos anchos, foco visible con navegación por teclado (Tab/Enter) y
  chip activo de filtros con contraste ~5.5:1 (terracota oscura).

El flujo total del reto (detalle → cotización → confirmación → regreso)
sigue **pendiente**: se verificará al cerrar la Etapa 3.
