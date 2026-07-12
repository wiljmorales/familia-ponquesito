# Reto 2 — Landing de producto con captura real de datos

Ver `docs/product-brief.md` para el contexto general del producto.

## Requisitos explícitos

A partir del enunciado del reto, la landing debe:

1. Comunicar una propuesta de valor clara (qué es, para quién, por qué
   importa).
2. Incluir un formulario de solicitud de cotización cuyos datos se guarden
   en una base de datos real (Supabase), no un botón decorativo.
3. Ser responsive (celular y computador).
4. Reflejar fielmente el sistema de diseño y el mockup entregados por el
   negocio (paleta, tipografía, composición, fotografía real).

## Fuentes de verdad usadas

- Identidad visual: `logo FP.png`, `desing system FP.png` y `landing.png`
  (adjuntos por el usuario en la conversación de este reto).
- Datos del negocio: `src/knowledge/familia-ponquesito.md` (Reto 1) —
  sabores, condiciones de pedido, anticipación, cobertura, Instagram.
- Fotografías reales: 6 fotos de tortas enviadas por WhatsApp durante esta
  sesión (no incluidas en los 3 adjuntos de diseño, pero sí activos reales
  del negocio), usadas en el hero, la galería y el cierre.

## Preguntas pendientes (no se inventó nada para resolverlas)

- **Número de WhatsApp de negocio.** La base de conocimiento del Reto 1
  solo documenta Instagram (`@familiaponquesito`) como canal de contacto
  confirmado; no hay un número de WhatsApp de negocio registrado en ningún
  lado. El footer deja el enlace de WhatsApp detrás de la variable de
  entorno `NEXT_PUBLIC_WHATSAPP_URL`: si no está definida, el ícono
  simplemente no se muestra (no se inventa ni se deja un enlace roto).
- **Fotografías de corte por sabor.** Para la sección "Sabores" no existen
  fotos reales de vainilla, red velvet o tres leches en corte (solo se
  cuenta con fotos de tortas decoradas completas). Como está prohibido usar
  fotos de stock o generadas por IA, cada sabor se representa con un
  color sólido de la paleta de marca + un ícono lineal, en vez de una foto.
  Si el negocio provee fotos de corte reales más adelante, esta sección
  puede migrar a fotografía sin cambiar su estructura.

## Decisión de alcance: ruta de la landing vs. el asistente del Reto 1

El Reto 1 dejó el chat del asistente sirviendo en `/`. Este reto pide que
la cara pública del negocio sea una landing de producto, así que:

- `/` pasa a ser la landing de Familia Ponquesito (este reto).
- El chat del Reto 1 se movió a `/asistente`, sin cambios de lógica.

Motivo: cada reto debe poder evaluarse de forma independiente. Mover el
chat a su propia ruta lo mantiene 100 % funcional y accesible por URL
directa, sin forzar un link de navegación adicional en la landing que no
está en el mockup (prioridad visual del Reto 2). Documentado también en
`docs/decisions.md`.

## Decisiones de seguridad y datos (Supabase)

- La tabla `cake_requests` tiene RLS habilitado **sin políticas públicas**.
  La única vía de lectura/escritura es la service role key, usada
  exclusivamente en una Server Action de Next.js (nunca en el navegador).
  No se necesita abrir una política de inserción anónima para un
  formulario público.
- El bucket `cake-references` es **privado** (no público). Las imágenes de
  referencia que suben los clientes son para uso interno de cotización, no
  para publicar; no hace falta que tengan URL pública. `reference_image_url`
  guarda la **ruta del objeto dentro del bucket**, no una URL.
- El tipo real de la imagen se valida por sus primeros bytes (magic
  numbers) en el servidor, no solo por el `type` que reporta el navegador
  (que el cliente puede falsear).
- Anti-spam: campo honeypot (`companyWebsite`) oculto fuera de pantalla
  (no `display:none`, para que bots simples que sí lo detecten lo llenen).
  Si llega relleno, el servidor responde como si la solicitud hubiera sido
  exitosa, sin escribir nada, para no revelar que fue detectado.

## Fuera de alcance (para este reto)

- Autenticación o panel administrativo para gestionar las solicitudes
  (quedan en Supabase, consultables desde su dashboard).
- Rate limiting del formulario (el enunciado solo pide honeypot como
  protección anti-spam simple; no se agregó limitador adicional para no
  introducir complejidad no solicitada).
- Envío de confirmación por correo/WhatsApp automático al cliente.
