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

## Preguntas pendientes

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
