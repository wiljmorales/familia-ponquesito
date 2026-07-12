@AGENTS.md

# Familia Ponquesito — guía para agentes

Contexto completo en `docs/product-brief.md` y `docs/challenge-1.md`. Léelos
antes de proponer cambios de alcance o estructura.

## Cómo trabajar en este repo

- **Simplicidad y experiencia de usuario primero.** Ante dos formas de
  resolver algo, prefiere la más simple que cumpla el reto actual. La UX de
  quien usa el asistente pesa más que la elegancia interna del código.
- **No inventes información del negocio.** Nombres de producto, precios,
  horarios, políticas, tono de marca: todo debe venir de una fuente real
  (el usuario o la base de conocimiento). Si falta un dato, dilo
  explícitamente y regístralo como pregunta pendiente en
  `docs/challenge-1.md` en lugar de rellenarlo con un placeholder plausible.
- **Cuestiona la complejidad innecesaria.** Si una tarea pide (o parece
  requerir) autenticación, microservicios, panel admin, abstracciones para
  "cuando lleguemos ahí", o cualquier pieza que no sirve al reto que se está
  resolviendo ahora mismo, dilo antes de construirla. Señala el trade-off en
  vez de implementarlo por defecto.
- **Cada reto debe poder evaluarse de forma independiente.** No amarres la
  funcionalidad de un reto a que exista código de un reto futuro. Un
  evaluador debe poder probar el reto actual sin depender de lo que aún no
  se ha construido.
- **Documenta las decisiones importantes.** Cuando tomes una decisión de
  alcance, estructura o trade-off que no sea obvia, déjala escrita (en el
  doc del reto correspondiente o en un commit claro), con el motivo.
- **No implementes funcionalidad futura antes de necesitarla.** No adelantes
  trabajo para retos que aún no se han anunciado. Construye lo que el reto
  actual pide, ni más ni menos.
- **Antes de tocar código de la aplicación en cambios no triviales**,
  presenta el plan y explica cualquier decisión que pueda añadir
  complejidad, siguiendo el mismo criterio con el que se armó este archivo.
