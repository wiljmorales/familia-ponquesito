# Reto 3 — "Crea tu propia torta": captura de leads con un juego

Ver `docs/product-brief.md` para el contexto general del producto.

## Requisitos explícitos

A partir del enunciado del reto (forma creativa de capturar leads):

1. Herramienta interactiva que entregue valor real antes de pedir datos.
2. Intercambio justo: la persona deja sus datos para recibir su resultado
   (en este caso, una cotización personalizada inspirada en su diseño).
3. Los datos capturados deben guardarse de verdad en una base de datos.
4. No puede ser un formulario simple de suscripción.
5. Ruta propia (`/crea-tu-torta`), evaluable de forma independiente de los
   retos 1 y 2, sin romperlos.

Brief funcional detallado (flujo de pasos, copy sugerido, campos del
formulario) provisto por ChatGPT como PM/mentor técnico del reto, en la
conversación de esta sesión.

## Fuentes de verdad usadas

- Identidad visual: `desing system FP.png` (adjunto por el usuario) —
  coincide con la paleta y tipografía ya cargadas en `globals.css` desde el
  Reto 2; no se introduce ningún color o fuente nueva.
- Assets del cake builder: 17 imágenes generadas con ChatGPT
  específicamente para este reto, entregadas en
  `~/Downloads/juego FP/` (fuera del repo). Organizadas y procesadas en
  `public/assets/cake-builder/` (ver más abajo).

## Etapa 1 — Inspección, reutilización y assets

### Reutilización confirmada del Reto 1/2

- Design system (`globals.css`): paleta y tipografías ya cargadas, sin
  cambios.
- Componentes UI (`src/components/ui/`): `Button`, `InputField`,
  `SelectField`, `TextareaField`, `FileField`, reutilizados tal cual.
- Patrón de captura de leads (`RequestForm.tsx`, reto 2): mismo esqueleto
  (react-hook-form + zod, honeypot, estados idle/success/error), pero no
  se reutiliza el componente literal — sus campos (sabor, tipo de
  celebración, descripción larga, imagen) no aplican al reto 3. Se arma un
  formulario nuevo componiendo los mismos primitivos de UI.
- Supabase: mismo patrón de Server Action + `service_role` desde servidor
  (`getSupabaseServiceClient`), RLS habilitado sin políticas públicas.
- Convención de rutas: el layout raíz no impone Header/Footer global; cada
  página arma la suya (`/` usa `Header`+`Footer`, `/asistente` es
  autocontenida). `/crea-tu-torta` sigue el patrón de `/asistente`:
  experiencia inmersiva, con un simple enlace de regreso, sin nav forzado.

### Assets: inventario y procesamiento

17 imágenes recibidas → 16 utilizables (bases de 1 y 2 pisos, pedestales,
placas, toppers). Se excluyó el topper temático de abejas/flores porque
trae el nombre **"Alana" horneado en la imagen**: no sirve como plantilla
genérica para cualquier persona que use el juego.

**Riesgo detectado y resuelto**: los 17 PNG fuente no tienen canal alpha
(`sharp().metadata().hasAlpha === false` en los 17, verificado uno por
uno). Lo que se ve como fondo "transparente" es en realidad una cuadrícula
gris/blanca pintada como píxeles reales por la herramienta de generación,
no transparencia real. Un primer intento con umbral de color + flood fill
falló de forma visible: el pedestal blanco-dorado (case casi del mismo
tono que el fondo) quedó borrado por completo, y los trazos finos de los
toppers desaparecían con cualquier erosión del borde.

**Solución**: `scripts/process-cake-assets.mjs`, usando
`@imgly/background-removal-node` (modelo de segmentación real, no umbral
de color) — agregado como **devDependency**, usado solo por este script,
nunca importado desde `src/` (no viaja al bundle de la app). Cada asset se
recorta a su bounding box real (elimina el margen transparente sobrante) y
se exporta a WebP con alpha real en `public/assets/cake-builder/`
(`bases/`, `stands/`, `plaques/`, `toppers/`), con nombres semánticos. Los
16 resultados se verificaron visualmente (bordes limpios, sin remanentes
de cuadrícula, detalle fino intacto) antes de darlos por buenos. Peso
total: ~2 MB (vs. 23 MB de los PNG originales).

Instalar `@imgly/background-removal-node` trajo 3 vulnerabilidades
transitivas menores (`lodash`/`zod` desactualizados dentro de su propio
árbol de dependencias, reportadas por `npm audit`). Riesgo aceptado y
documentado: es una herramienta local de un solo uso sobre archivos que el
propio dueño del proyecto provee, sin superficie de ataque real en
producción.

Si en el futuro se agregan más assets (decoraciones, toppers nuevos), el
script se puede volver a correr: solo hay que sumar las rutas nuevas al
arreglo `ASSETS` en `scripts/process-cake-assets.mjs`.

### Decisión de alcance: tabla nueva en Supabase, no se reutiliza `cake_requests`

`cake_requests` (Reto 2) tiene `celebration_type`, `preferred_flavor` y
`cake_description` como `NOT NULL`, campos que el flujo del Reto 3 no
recolecta. Forzarlos con valores inventados ensuciaría los datos reales
del Reto 2 y mezclaría dos tipos de lead distintos en una misma tabla. Se
crea una tabla nueva (`cake_designs`, a definir en la Etapa 3 de
implementación) — cero riesgo para los datos del Reto 2, cero migración
sobre una tabla que ya tiene filas reales. Mismo criterio de seguridad que
`cake_requests`: RLS habilitado, sin políticas públicas, solo
`service_role` desde una Server Action.

### Decisión de alcance: combinaciones de color en tortas de 2 pisos

Solo existen 2 combinaciones de color generadas para tortas de 2 pisos
(crema+rosada, crema+amarilla), no las 5 completas. El paso "color" del
juego, aplicado a una base de 2 pisos, ofrece esas 2 combinaciones más
crema+crema (3 en total) en vez de 5. El enunciado del reto permite esto
explícitamente ("no es obligatorio ofrecer todas si algunos assets no
encajan").

## Etapa 2 — Ruta, estado del builder y vista previa

- **Ruta**: `/crea-tu-torta` (App Router), autocontenida como `/asistente`
  (sin `Header`/`Footer` globales, con un simple "← Volver al inicio").
- **Catálogo data-driven** (`src/lib/cake-builder/options.ts`): cada paso
  lee sus opciones de aquí (id, label, ruta de imagen, dimensiones reales
  para evitar layout shift). Sumar una opción es editar datos, no tocar
  componentes.
- **Estado**: un único `CakeDesign` en `useCakeBuilder`
  (`src/app/crea-tu-torta/use-cake-builder.ts`, colocado junto a la ruta
  como `/asistente/chat.tsx`). El paso "mensaje" se salta automáticamente
  si no hay placa seleccionada. Cambiar de 1 a 2 pisos reasigna
  `baseVariant` a la primera variante de color válida para ese número de
  pisos (evita quedar con un id de variante que no existe).
- **`CakeStage`** apila las capas (pedestal, torta, placa + mensaje,
  topper) con offsets en porcentaje ajustados a ojo contra los assets
  reales (no hay puntos de anclaje exactos en los PNG fuente). Verificado
  visualmente con Playwright headless contra 1 piso y 2 pisos, escritorio
  y móvil, con varias combinaciones de color/pedestal/placa/topper — no
  solo se asumió que la matemática de CSS funcionaba.
- **`OptionGrid`** genérico: usado por color, pedestal, placa y topper.
  Patrón `radiogroup`/`radio` con `aria-checked`, foco visible, objetivo
  táctil ≥44px, y la selección se marca con borde + fondo + ícono de
  check (no depende solo del color).
- **Mobile-first confirmado**: vista previa arriba, controles abajo en
  móvil; vista previa a la izquierda, controles a la derecha en
  escritorio (mismo componente, se reordena por breakpoint).
- **Bug real encontrado y corregido durante la verificación**: el input
  de mensaje no tenía `id`/`name`, así que su `<label>` no quedaba
  asociado (`htmlFor` apuntaba a `undefined`) — invisible a simple vista
  pero real para lectores de pantalla y para `getByLabel` en las pruebas.
  Corregido en `MessageStep.tsx`.
- **Limitación conocida y a propósito**: el botón "Siguiente" del último
  paso (topper) queda deshabilitado — todavía no existe la vista final
  (Etapa 3). El tamaño de fuente del mensaje sobre la placa es pequeño
  por el espacio real disponible dentro del marco decorativo; aceptable
  para el MVP, se puede revisar si el negocio pide mensajes más largos.

## Etapa 3 — Vista final, formulario, persistencia y código de diseño

- **`FinalView`**: al terminar el último paso se oculta el wizard (barra de
  progreso y controles) y se muestra la torta terminada sobre confeti
  discreto (CSS puro, sin librería — respeta `prefers-reduced-motion` vía
  la regla global ya existente en `globals.css`), el título "¡Tu creación
  está lista!", un resumen en texto del diseño y el CTA "Hacerla
  realidad". "Editar mi diseño" regresa al wizard sin perder la selección.
- **Formulario adaptado, no reutilizado literalmente**: `DesignRequestForm`
  sigue el mismo patrón de `RequestForm` (Reto 2) — mismos primitivos de
  UI, mismo honeypot, mismos estados idle/success/error, misma regla real
  de negocio (mínimo 3 días de anticipación, reutilizando
  `minCelebrationDateString` del Reto 2 en vez de duplicarla) — pero con
  los campos que pide el Reto 3 (nombre, WhatsApp, fecha del evento,
  personas, zona de entrega/retiro, correo opcional). No se reutilizó el
  componente literal porque sus campos no coinciden (sabor, tipo de
  celebración, descripción larga e imagen no aplican aquí).
  "Zona de entrega o retiro" es texto libre: no existe una lista cerrada
  de zonas de cobertura en la base de conocimiento, así que no se inventa
  un selector con opciones que no están confirmadas.
- **Validación server-side del diseño, no solo del formulario de
  contacto**: el JSON del `CakeDesign` que llega del cliente se valida
  contra el catálogo real de `options.ts` (`cakeDesignSchema` en
  `src/lib/validations/cake-design.ts`) antes de guardarlo — un id que no
  exista en el catálogo se rechaza. Así el jsonb en Supabase siempre es
  reconstruible, incluso ante un cliente manipulado.
- **Tabla `cake_designs`** creada en `supabase/schema.sql` (ver Etapa 1):
  RLS habilitado sin políticas públicas, solo `service_role` desde
  `submitCakeDesign` (Server Action). Guarda el diseño completo en una
  columna `jsonb` además de los datos de contacto.
- **Código de diseño** (`FP-3-XXXX`): generado en el servidor
  (`src/lib/cake-builder/design-code.ts`) con un alfabeto sin caracteres
  ambiguos (sin `0/O/1/I/L`, se lee y se dicta por WhatsApp). La Server
  Action reintenta hasta 5 veces ante una colisión de `design_code`
  (columna `unique`); con 32⁴ combinaciones posibles es un caso extremo,
  pero se maneja en vez de asumir que nunca pasará.
- **WhatsApp opcional, sin inventar un número**: igual que el Reto 2, el
  botón "Continuar por WhatsApp" solo aparece si `NEXT_PUBLIC_WHATSAPP_URL`
  está configurada; el mensaje prellenado se arma con
  `buildWhatsappMessageUrl` (nuevo helper en `src/lib/utils/whatsapp.ts`)
  sin asumir el formato exacto del enlace del negocio.
- **El cambio de esquema no se aplicó por mi cuenta**: solo se cuenta con
  la URL del proyecto y la `service_role` key (acceso a datos vía API), no
  con una conexión directa a Postgres para ejecutar DDL. El dueño del
  proyecto pegó el `supabase/schema.sql` actualizado en el SQL Editor
  (mismo flujo ya documentado para el Reto 2) y creó la tabla
  `cake_designs`.
- **Verificado dos veces, antes y después de crear la tabla**: primero con
  Playwright headless de punta a punta (bienvenida → 6 pasos → vista final
  → formulario) sin la tabla creada — confirmó que el guardado falla con
  el mensaje amable esperado (`GENERIC_ERROR_MESSAGE`), no un error crudo.
  Después de que se aplicó el esquema, se repitió el mismo flujo con datos
  claramente marcados como prueba ("PRUEBA CLAUDE - borrar") y se
  consultó directamente la fila insertada en Supabase: `design` (jsonb),
  `whatsapp` normalizado, `event_date`, `zone`, `source: cake-builder` y
  `design_code` (`FP-3-2WRZ`) coincidían exactamente con lo enviado. La
  fila de prueba se borró después de confirmar el guardado, para no dejar
  un lead falso en la base real.
- **Pruebas nuevas** (Vitest): `cakeDesignSchema` (rechaza ids fuera de
  catálogo, variantes de base que no corresponden al número de pisos,
  mensajes demasiado largos) y `generateDesignCode` (formato, sin
  caracteres ambiguos). 70 pruebas en total (59 previas + 11 nuevas).

## Etapa 4 — Responsive, accesibilidad, manejo de errores y pruebas

Pasada de auditoría sobre lo ya construido en las Etapas 2-3 (no una
reconstrucción): se buscó activamente qué fallaba, en vez de asumir que
ya estaba bien por haberse visto correcto visualmente.

- **Bug de accesibilidad real corregido**: los selectores (piso, color,
  pedestal, placa, topper) usaban `role="radio"`/`role="radiogroup"` sin
  implementar la navegación por flechas que ese patrón exige en el
  estándar WAI-ARIA — quien usara solo teclado con un lector de pantalla
  se habría encontrado con un control que se anuncia como grupo de radio
  pero no se comporta como uno. Se cambió a botones tipo *toggle*
  (`aria-pressed`), que sí coinciden con el comportamiento real
  (Tab entre opciones, Enter/Espacio para activar). Cada grupo quedó
  asociado a su título de paso vía `aria-labelledby`.
- **Gestión de foco entre pasos**: el `<h2>` del paso no se remonta al
  cambiar de paso (persiste en la misma posición del árbol), así que sin
  intervención el foco de teclado se quedaba fijo en el botón "Siguiente"
  y quien usa lector de pantalla no se enteraba de que el contenido
  cambió. Se agregó `tabIndex={-1}` + `focus()` programático en el título
  de cada paso y en el título de la vista final, patrón estándar para
  wizards accesibles (el mismo que usa GOV.UK Design System). Verificado
  con Playwright conduciendo el flujo solo con teclado (Tab + Enter/Espacio,
  sin mouse): el foco aterriza correctamente en cada título nuevo.
- **Bug de manejo de errores real corregido**: `submitCakeDesign` llamaba
  `getSupabaseServiceClient()` y el `insert` fuera de cualquier
  `try/catch`. `getSupabaseServiceClient()` lanza una excepción si faltan
  las variables de entorno, y una falla de red también puede lanzar (no
  solo devolver `{ error }`) — sin envolver esa llamada, cualquiera de los
  dos casos habría roto en crudo en vez de mostrar el mensaje amable ya
  diseñado para eso. `submit-cake-request.ts` (Reto 2) sí lo hacía
  correctamente; se alineó el patrón. Verificado guardando y borrando un
  lead de prueba real después del cambio, para confirmar que el
  `try/catch` no alteró el camino exitoso.
- **Responsive verificado en el viewport más chico común** (320px de
  ancho, ej. iPhone SE): sin scroll horizontal, grilla de 3 columnas
  legible, botones de navegación visibles sin recortarse.
- **Sin `error.tsx`**: se evaluó agregar un error boundary de Next.js para
  la ruta, pero ni el Reto 1 ni el Reto 2 tienen uno — se decidió no
  introducir un patrón nuevo solo para este reto y mantener la app
  consistente consigo misma.
- 70 pruebas siguen pasando después de todos los cambios de esta etapa
  (ninguna prueba nueva: los cambios de esta etapa son de accesibilidad y
  manejo de errores, verificados con Playwright real, no con pruebas
  unitarias de renderizado — mismo criterio que ya sigue el resto del
  repo, que no usa Testing Library).

## Etapa 5 — Corrección de capas desalineadas (reporte real de uso)

Al probar el flujo real (no una captura aislada), el usuario reportó dos
problemas visuales concretos en el resultado final: el topper se veía
"montado encima" de la torta en vez de asentado, y el centro de la placa
dejaba ver el fondo en vez de una superficie sólida. Se investigaron y
corrigieron tres causas independientes:

1. **Las placas tenían el interior transparente por error**: se midió el
   canal alpha de las 2 placas ya procesadas y se confirmó que ~54% del
   área (todo el relleno crema interior, no solo el marco) tenía
   `alpha = 0`. El modelo de segmentación interpretó esa superficie lisa y
   clara como fondo. Para distinguir esto de agujeros legítimos (los
   lazos de las letras cursivas en los toppers, hasta ~17% del área), se
   escanearon todos los assets buscando componentes conexas de
   transparencia NO conectadas al borde de la imagen; el salto entre el
   máximo legítimo (17%) y el mínimo del bug (54%) fue lo bastante grande
   para fijar un umbral seguro (25%). `scripts/process-cake-assets.mjs`
   ahora rellena esas componentes grandes usando el color de la imagen
   **original** (el RGB que deja el modelo en la zona que borró no es
   confiable — se verificó que no correspondía al color real).
2. **`CakeStage` posicionaba las capas con porcentajes fijos relativos al
   alto del *stage***, sin tener en cuenta que una torta de 2 pisos es
   bastante más alta que una de 1 piso con el mismo ancho — por eso el
   topper quedaba flotando en vez de asentarse. Se reescribió para usar
   flujo normal (flex-column) con márgenes negativos calculados por
   imagen (`sinkMarginPercent`): la fracción de superposición se expresa
   como % de la altura PROPIA de cada capa (derivada de su propio ancho
   renderizado y su aspect ratio real), no como un offset fijo contra el
   stage. Así el mismo cálculo da un resultado visualmente correcto sin
   importar cuántos pisos tenga la torta.
3. **`sharp().trim()` dejaba una cola de sombra semitransparente** de
   varias decenas de píxeles en el borde inferior de tortas y pedestales
   (no un antialiasing normal de 2-3px), que sumada entre dos capas se
   notaba como un hueco visible aunque los recuadros técnicamente se
   superpusieran unos píxeles. Se reemplazó `.trim()` por un recorte al
   bounding box de los píxeles realmente SÓLIDOS (`alpha >= 200`, con un
   margen de 3px), conservando el degradado suave dentro de ese recuadro
   sin dejar que decida dónde cortar.
4. **Bug secundario descubierto durante la corrección**: al regenerar los
   assets, sus dimensiones reales cambiaron unos pocos píxeles, pero
   `src/lib/cake-builder/options.ts` seguía con los valores viejos —
   `CakeStage` usa esos números para su matemática de posicionamiento, así
   que quedaron desalineados en silencio. Se agregó
   `src/lib/cake-builder/options.test.ts`, que compara cada `width`/
   `height` del catálogo contra el archivo real en disco, para que este
   tipo de desajuste falle la próxima vez en `npm test` en vez de
   quedar invisible. También se agregó `sharp` como devDependency
   explícita (el script ya lo usaba, pero no estaba declarado).

Verificado con capturas reales en varias combinaciones (1 y 2 pisos, con
y sin placa/topper, escritorio y móvil) después del arreglo, incluyendo
la combinación exacta que reportó el usuario.

### Ajuste posterior: el topper quedaba tapado por la torta

El primer valor de `TOPPER_SINK_FRACTION` (0.65, pensado solo con datos
del pedestal/torta) resultó demasiado agresivo para los toppers: al
tener `zIndex` más alto que el topper, la torta terminaba tapando ~65%
de su altura — no solo los palitos, sino buena parte del diseño
decorativo. Se midió, para cada topper, en qué punto de la altura total
el contenido se angosta a solo los dos palitos (entre ~16% y ~40% según
el diseño, con bastante variación). Se bajó a 0.18 (conservador: prioriza
que el diseño se vea completo sobre que los palitos queden perfectamente
ocultos) y se subió `CAKE_SINK_FRACTION` a 0.3 para que la torta se
asiente mejor sobre el pedestal, según feedback directo probando la app.
Verificado con los 4 toppers en 1 y 2 pisos.

### Segundo ajuste: topper delante de la torta y pedestal rosado más alto

Feedback directo probando la app: el topper seguía viéndose detrás de la
torta (el `zIndex` de la torta, más alto, tapaba también la parte
superior visible del diseño, no solo la base de los palitos como se
buscaba). Se decidió que el topper simplemente vaya siempre delante:
subió su `zIndex` de 1 a 3 (por encima del `zIndex: 2` de la torta).

Aparte, el pedestal rosado (`stand-blush`) se veía un poco más bajo que
el resto del set a la misma escala — problema del asset en sí, no de la
altura de la torta. Se subió con un `translateY(-14px)` fijo (no
proporcional al tier), aplicado solo cuando `stand.id === "stand-blush"`,
para no afectar el pedestal blanco con dorado. 14px es un punto de
partida razonable para seguir iterando si hace falta ajustar más.

Verificado con capturas: pedestal rosado en 1 y 2 pisos (sin gap visible
entre torta y pedestal), pedestal blanco sin cambios, y topper
(Happy Birthday dorado, Princess) completamente visible delante de la
torta en ambos casos.

### Tercer ajuste: lift del pedestal rosado por número de pisos

Feedback directo: el pedestal rosado necesitaba subir un poco más,
distinto según el número de pisos. Se agregó un extra sobre los 14px
base: +8px cuando la torta es de un piso (22px total) y +4px cuando es
de dos pisos (18px total). Es un ajuste puramente visual, sin relación
geométrica con la altura real de la torta — valores de partida para
seguir iterando si hace falta. Verificado con capturas en ambos casos,
sin gap visible.

### Cuarto ajuste: +4px más en 1 piso

Feedback directo: el extra de 1 piso pasó de 8px a 12px (26px total
sobre el pedestal rosado; el de 2 pisos queda igual, 18px). Verificado
con captura, sin gap visible.

### Quinto ajuste: sube la placa dedicatoria en tortas de un piso

Feedback directo: en tortas de un piso la placa quedaba un poco baja.
Se sube 12px (vía `top: calc(56% - 12px)` en vez de `transform`, para no
pisar el `-translate-x-1/2` de Tailwind que ya centra la placa
horizontalmente). Solo aplica cuando `design.tiers === 1`; en 2 pisos
la placa queda igual. Verificado con captura en ambos casos.

### Sexto ajuste: placa en 2 pisos, tamaño de la dedicatoria e interlineado

Serie de ajustes finos pedidos en vivo por el usuario mientras probaba la
app directamente (sin captura de por medio en cada paso, para ahorrar
tokens; verificado por el usuario en el navegador):

- Placa en tortas de 2 pisos: 15% más chica (`PLAQUE_WIDTH_TWO_TIER_SCALE
  = 0.85`) y bajada 4px (`PLAQUE_LOWER_TWO_TIER_PX`, vía el mismo patrón
  `top: calc(...)` que ya usaba el ajuste de 1 piso).
- Tamaño de fuente de la dedicatoria: subido de `0.5rem`/`0.7rem` (base/
  `sm`) a `1rem`/`0.9rem`. Nota: con este valor final, el texto se ve más
  grande en mobile que en `sm` (≥640px) — quedó así porque el pedido fue
  solo sobre el valor base; pendiente de revisar si se quiere igualar.
- Interlineado: se probó subirlo a `1.5` y se revirtió a `1.1` (valor
  original).

- **Incentivo/resultado exacto que recibe la persona.** El brief del reto
  (aportado por ChatGPT) ya define el flujo completo (ver vista final +
  formulario de cotización personalizada), pero el dueño del proyecto
  indicó que compartirá contexto adicional sobre el incentivo antes de
  cerrar ese detalle. Se retoma antes de construir la vista final
  (Etapa 3).

## Fuera de alcance (para este reto)

Definido explícitamente por el propio enunciado del reto: sin 3D real, sin
Three.js, sin física, sin IA generativa dentro del producto, sin cotizador
automático exacto, sin subida de imágenes, sin editor de diseño
profesional. Sin autenticación ni panel administrativo (igual que el Reto
2 — las solicitudes se consultan desde el dashboard de Supabase). Sin
plataforma de analítica nueva (el repo no tiene ninguna integrada; no se
introduce una solo para este reto).
