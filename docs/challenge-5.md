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

_Pendiente: se completará cuando las pantallas estén construidas._

## Cómo reiniciar el prototipo

_Pendiente: se completará cuando las pantallas estén construidas._

## Verificación manual del recorrido (pendiente de ejecutar)

Esta lista se ejecutará contra la app real al terminar la implementación;
no se marcará como realizada antes de tiempo.

- [ ] Portada → Centro de pedidos → filtro → detalle → preparar cotización
      → modificar montos → activar/desactivar delivery → enviar cotización
      simulada → confirmación → volver al centro → pedido en "Esperando
      anticipo" → reiniciar demo.
- [ ] Escritorio ≈1440 px y móvil ≈390 px, sin desbordamiento horizontal.
- [ ] Navegación por teclado básica y estados de foco visibles.
- [ ] Mensajes de validación claros en el formulario.
- [ ] Recarga de la página después de actualizar un pedido: el cambio se
      conserva.

## Verificaciones realizadas

_Pendiente: se registrarán aquí los resultados reales de `npm test`,
`npm run lint`, `npx tsc --noEmit`, `npm run build` y la verificación
manual._
