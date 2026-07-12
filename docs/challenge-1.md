# Reto 1 — Asistente de IA para Familia Ponquesito

Ver `docs/product-brief.md` para el contexto general del producto y por qué
este reto es la prioridad actual.

## Requisitos explícitos

A partir de lo indicado para este reto, el asistente debe:

1. Conocer el negocio (Familia Ponquesito) a partir de una base de
   conocimiento real, no inventada.
2. Responder preguntas correctamente basándose en esa base de conocimiento.
3. Mantener un tono definido y consistente en sus respuestas.
4. Admitir explícitamente cuando no sabe algo, en lugar de inventar
   (alucinar) una respuesta.

## Criterios de aceptación verificables

- [ ] Existe una base de conocimiento con información real de Familia
      Ponquesito (no placeholders ni datos ficticios), en un formato legible
      y versionado en el repositorio.
- [ ] Ante una pregunta cuya respuesta está en la base de conocimiento, el
      asistente responde de forma correcta y consistente con esa fuente.
- [ ] Ante una pregunta cuya respuesta **no** está en la base de
      conocimiento, el asistente lo declara explícitamente (no inventa una
      respuesta plausible).
- [ ] Las respuestas mantienen un tono reconocible y consistente entre
      distintas preguntas (a definir y documentar una vez se conozca el tono
      real de la marca).
- [ ] El sistema es evaluable de forma independiente: se puede probar el
      Reto 1 sin depender de funcionalidad de retos futuros aún no
      construida.

## Riesgos

- **Datos del negocio incompletos o inexistentes.** Si no contamos con
  información real suficiente de Familia Ponquesito, no se puede construir
  una base de conocimiento fiel. No se debe rellenar el vacío con datos
  inventados.
- **Tono no definido.** "Mantener un tono definido" requiere que ese tono
  esté especificado (por la marca o por el usuario) antes de poder
  verificarse. Sin definición, este criterio no es evaluable objetivamente.
- **Ambigüedad en "admitir que no sabe".** Sin ejemplos concretos de
  preguntas fuera de alcance, existe riesgo de calibrar mal cuándo el
  asistente debe abstenerse de responder.
- **Sobre-alcance.** Riesgo de construir infraestructura pensada para retos
  futuros (autenticación, panel admin, multi-proveedor, etc.) que no aporta
  a superar el Reto 1 y añade complejidad y superficie de fallo.
- **Reglas oficiales del challenge no confirmadas.** Este documento se basa
  en la descripción del reto dada por el usuario en esta conversación. No se
  ha verificado contra un enunciado oficial de Platzi si existe uno con más
  detalle o criterios de evaluación adicionales.

## Fuera de alcance (para este reto)

- Autenticación o gestión de usuarios.
- Panel administrativo.
- Arquitectura de microservicios o separación en múltiples servicios/apps.
- Integración real con un SDK o proveedor de IA (se define la estructura,
  no la integración).
- Persistencia en base de datos externa.
- Cualquier funcionalidad de retos posteriores aún no anunciados.

## Preguntas pendientes sobre el negocio

- ¿Qué información real de Familia Ponquesito está disponible para construir
  la base de conocimiento (productos, precios, horarios, ubicación,
  políticas, preguntas frecuentes reales, etc.), y en qué formato existe hoy?
- ¿Existe una definición explícita del tono de marca (formal/informal,
  cercano, uso de emojis, trato de "tú"/"usted", etc.), o hay que
  proponerlo a partir de material existente (redes sociales, sitio web,
  mensajes reales)?
- ¿Hay un enunciado oficial del Reto 1 del Platzi Vibe Coding Challenge con
  criterios de evaluación específicos que debamos incorporar aquí?
- ¿Qué canales o formatos de pregunta debe soportar el asistente en este
  reto (texto libre, preguntas frecuentes predefinidas, ambos)?
- ¿Qué proveedor de IA se usará cuando llegue el momento de integrar (esto
  no bloquea el Reto 1, pero afecta el diseño de `providers/`)?
