# Migración local de Supabase a Django/PostgreSQL

Estado: código y migraciones preparados en `feature/supabase-to-django-local`.
No se han instalado en VPS/Vercel ni se ha cambiado DNS/UFW. El Supabase
antiguo tenía **solo datos de prueba**; esto no autoriza borrar ni reinicializar
la PostgreSQL existente del VPS.

## Contratos conservados

El navegador sigue hablando con las Server Actions y rutas Next.js. Solo los
servidores Next.js llaman a `/api/v1/internal/<operación>/` con
`Authorization: Bearer <PONQUESITO_INTERNAL_API_KEY>` y JSON o multipart.
El secreto es exclusivo de esta integración, diferente de `DJANGO_SECRET_KEY`
y de la contraseña PostgreSQL, sin prefijo `NEXT_PUBLIC_`. La API rechaza
cookies como credencial, no expone CRUD genérico y no habilita CORS. El sitio
`/linktree` sigue siendo el archivo estático existente.

| Flujo Next.js | Operaciones Django | Persistencia |
|---|---|---|
| Solicitud / diseño | `cake-request`, `cake-design`, `image-link` | `cake_requests`, `cake_designs`, archivo privado |
| Agenda y enlace privado | `agenda-availability`, `agenda-reserve`, `agenda-lookup`, `agenda-reschedule`, `agenda-cancel`, `agenda-recovery` | `production_day_overrides`, `cake_reservations`, `reservation_events`, `recovery_throttles` |
| Leads y correo | `lead-by-source`, `lead-ensure`, `lead-event`, `lead-success`, `email-claim`, `email-finish`, `reservation-event` | `leads`, `lead_automation_events`, `email_dispatches`, `reservation_events` |
| Agente existente | `agent-create`, `agent-update` | `agent_decisions` |
| Reporte y Vercel Cron existentes | `report-reserve`, `report-data`, `report-update`, `report-list` | `weekly_reports`; `CRON_SECRET` sigue protegiendo la ruta Next.js |

Son nueve tablas de negocio originales y dos de apoyo local (despacho
idempotente de correo y limitación de recuperación). Las migraciones Django
`0001`–`0004` crean el esquema y sus restricciones. `supabase/schema.sql` y
`docs/challenge-*.md` quedan como archivo histórico, no se aplican ni se
importan en el código activo. `deploy/production/review.diff` también refleja
una propuesta previa de infraestructura y no representa el diff de esta
migración. Las funcionalidades de prototipo y asistente
que no usaban Supabase siguen con su comportamiento previo; no se agregó un
módulo de negocio nuevo.

Agenda usa días de `America/Caracas`, ventana 3–60 días, capacidad inicial 4
puntos, estados consumidores `pending_deposit` y `confirmed`, y bloqueos
transaccionales PostgreSQL por fecha. Código y token SHA-256 son necesarios
para consultar, reprogramar y cancelar. El lookup devuelve solo campos
públicos. La recuperación puede solicitarla cualquiera que conozca código y
correo, pero la respuesta es indistinguible para códigos inexistentes y el
enlace solo se envía al correo guardado. Hay 10 solicitudes por IP ofuscada
por hora, máximo 3 por reserva/día y 15 minutos de separación. El token
anterior permanece válido hasta que se usa el nuevo (que expira en una hora);
usarlo rota el hash, sin crear otra reserva. Un correo fallido no invalida el
enlace anterior. La IP en X-Forwarded-For es una defensa secundaria; la cuota
por reserva persiste aunque se falsifique la IP.

Las imágenes son JPG/PNG/WebP, máximo 4 MB (4.000.000 bytes), comprobadas por firma y MIME
(Next.js reenvía los bytes con el MIME detectado por firma, no el que declaró
el navegador), con nombres aleatorios, permisos 0600 bajo
`PONQUESITO_PRIVATE_IMAGE_ROOT` fuera de cualquier release. No hay ruta
pública de media ni listado. Solo un servidor con Bearer puede pedir una URL
firmada para una imagen asociada a una solicitud; la URL dura una hora,
responde `no-store`, y Gunicorn registra rutas sin query strings. El directorio
pertenece al usuario de servicio, no a Caddy ni al usuario de Next.js.

Tamaño (decidido el 2026-10-18): 4.000.000 bytes en el formulario, la
validación de la Server Action y Django (`MAX_IMAGE_SIZE_BYTES`,
`MAX_IMAGE_BYTES`), con el mensaje «La imagen supera el máximo de 4 MB.».
Presupuesto de la petición:

| Pieza | Bytes |
|---|---|
| Peor caso válido medido (imagen 4.000.000 + campos al máximo en UTF-8 de 3 bytes + nombre de archivo de 255 bytes + multipart de React) | 4.004.761 |
| `serverActions.bodySizeLimit` en `next.config.ts` (el defecto es 1 MB) | 4.200.000 |
| Límite de cuerpo de una función de Vercel (4,5 MB, lectura decimal) | 4.500.000 |

Para que el peor caso esté definido, `whatsapp` admite como máximo 32
caracteres y `guestCount` 4. zod recorta espacios antes de medir, así que un
relleno de espacios no está acotado por la validación; ese cuerpo supera
`bodySizeLimit` y Next.js lo rechaza (413) antes de ejecutar la acción.
`src/lib/validations/upload-budget.test.ts` mide el cuerpo y falla si deja
de caber. **Pendiente en Vercel Preview**: subir una imagen de exactamente
4.000.000 bytes con todos los campos al máximo y confirmar que llega a Django.

Huérfanas: la API borra el archivo si falla el guardado. Si el proceso muere
entre escribir el archivo y confirmar la fila, queda un huérfano;
`manage.py cleanup_orphan_images` los cuenta (no borra) y con `--delete`
borra solo nombres generados por la API, sin referencia en `cake_requests`
ni `cake_reservations` y con más de 24 h (`--min-age-hours`). Programarlo
(timer systemd semanal) es una tarea de staging, aún no instalada.

La recuperación del enlace responde siempre lo mismo y envía el correo en
`after()`: esperar a SMTP antes de responder revelaría, por tiempo, qué
combinaciones de código y correo existen.

El despacho de correo registra un `claim` exclusivo por lead y tipo de
destinatario antes del envío, con lease de cinco minutos. Un éxito conocido
no vuelve a enviarse y un fallo conocido admite reintento. SMTP **no ofrece
exactly-once**: si el proveedor acepta el mensaje y se pierde su respuesta,
un reintento posterior puede duplicarlo. No se debe presentar como garantía
absoluta. Ni contraseñas, Bearer, tokens de reserva, firmas de imágenes ni
cuerpos de errores del proveedor se escriben en logs.

## Configuración equivalente

Vercel (Production y Preview por separado): `PONQUESITO_API_URL` (origen HTTPS
de su API correspondiente), `PONQUESITO_INTERNAL_API_KEY`,
`APP_CANONICAL_URL`, `SMTP_*`, `EMAIL_FROM`, `KAREM_NOTIFICATION_EMAIL`,
`CRON_SECRET`, y opcionalmente `GEMINI_API_KEY`/`GEMINI_MODEL` y
`AGENT_DEMO_CUSTOMER_EMAIL`. `NEXT_PUBLIC_WHATSAPP_URL` es la única variable
pública relevante. Quitar las tres variables `*_SUPABASE_*` del proyecto
Vercel solo **después** de promover y validar la nueva revisión.

Django: `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS` con el host API real,
`DJANGO_BEHIND_HTTPS_PROXY=true`, `DJANGO_CSRF_TRUSTED_ORIGINS` explícitos,
`POSTGRES_*`, `PONQUESITO_INTERNAL_API_KEY` idéntica a la de Vercel,
`PONQUESITO_PRIVATE_IMAGE_ROOT=/var/lib/ponquesito/images`, y
`PONQUESITO_API_PUBLIC_URL` igual al origen HTTPS de API. `StateDirectory`
da al servicio acceso de escritura solo a `/var/lib/ponquesito`; verificar el
dueño y modo del directorio antes de servirlo. Caddy termina TLS en
`api.familiaponquesito.com` y solo envía `/health/` y `/api/v1/*` a Gunicorn
en `127.0.0.1:8000`; no hace falta CORS. No habilitar Django Admin.

SMTP sigue en Next.js; Gemini también. El cron semanal sigue en Vercel
(`vercel.json`, lunes 12:00 UTC/08:00 Caracas) con `CRON_SECRET`, mientras
las métricas y el resultado se guardan en PostgreSQL. Confirmar límites y
plan de Vercel antes de activarlo; no usar destinatarios reales en staging.

## Validación local reproducible

Usar una PostgreSQL **desechable**, otra base/rol y solo datos `.invalid`.
Ejemplo de comandos de prueba (elegir puerto libre; nunca apuntar a VPS):

```bash
docker run --rm --name fp-migration-test -e POSTGRES_DB=ponquesito_test \
  -e POSTGRES_USER=ponquesito_test -e POSTGRES_PASSWORD=synthetic-only \
  -p 127.0.0.1:55439:5432 -d postgres:18-alpine
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ..
export DJANGO_SECRET_KEY=synthetic-test-only DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,testserver
export POSTGRES_DB=ponquesito_test POSTGRES_USER=ponquesito_test POSTGRES_PASSWORD=synthetic-only POSTGRES_PORT=55439
backend/.venv/bin/python backend/manage.py migrate --noinput
backend/.venv/bin/python backend/manage.py test commerce config.tests --noinput
npm ci
npm test
RUN_DJANGO_INTEGRATION=1 ./node_modules/.bin/vitest run src/lib/backend/integration.test.ts
./node_modules/.bin/tsc --noEmit
npm run lint
docker stop fp-migration-test
```

`local-smtp.test.ts` levanta un receptor solo en `127.0.0.1`, rechaza una
entrega y acepta el reintento a `synthetic@example.invalid`. No envía correo
externo. La suite Django usa PostgreSQL real; SQLite no reproduce los
bloqueos de cupo ni las restricciones. El test de integración inicia Django
temporalmente y usa el transporte real Next.js→API contra la base sintética.

### Revisión del 2026-10-18 (Claudio)

Repetido sobre PostgreSQL 18 desechable, Node 22.23.3 (`.nvmrc`) y Python del
`backend/.venv`; datos `.invalid`, sin red externa ni SMTP real:

- `makemigrations --check`: sin cambios pendientes; `migrate` 0001–0004 en BD vacía.
- `manage.py test commerce config.tests`: 22 pruebas (17 previas + 5 nuevas:
  `human_review` en día lleno, límites 3/60 días y rutas de imagen
  arbitrarias, espaciado/límite diario/límite por IP/caducidad de la
  recuperación, idempotencia de `reservation-event`, limpieza de huérfanas).
- Estrés ad hoc (no versionado): 5 rondas de 12 reservas y 6
  reprogramaciones simultáneas hacia un día de capacidad 4, mezclando
  `pending_deposit` y `human_review`. El día terminó siempre en 4 puntos;
  ninguna sobreventa.
- `npm test` 467 pruebas, `tsc --noEmit`, `npm run lint` sin avisos,
  `next build` sin variables de API, `integration.test.ts` y
  `local-smtp.test.ts`.
- Extremo a extremo con `next start` (producción) → proxy TLS local →
  Django: la Server Action real aceptó un JPEG de 3 MB etiquetado como PNG,
  Django lo guardó como `.jpg` 0600 en un directorio 0700, registró el lead y,
  sin SMTP, dejó el despacho en `failed` reintentable. Logs sin Bearer ni
  tokens. `/linktree` respondió 200 en esa compilación.

Ajuste a 4 MB, con el mismo `next start` → proxy TLS → Django: imagen de
4.000.000 bytes y campos al máximo (cuerpo 4.004.761) aceptada y guardada;
4.000.001 rechazada con el mensaje de 4 MB sin llegar a Django; cuerpo de
4.304.761 cortado por Next.js (`Body exceeded 4200000 limit`). Django rechaza
4.000.001 (`image_too_large`) sin dejar fila ni archivo.

No probado aquí: Vercel real (límite de 4,5 MB, Cron, `after()` en
serverless, variables), Caddy/TLS real, Gmail SMTP, Gemini, VPS.

## Preparación de staging (requiere autorización posterior)

1. Inspeccionar **solo metadatos** de PostgreSQL del VPS: versión, bases,
   propietarios, extensiones, tablas, migraciones Django, privilegios,
   espacio y conexiones. No asumir que `ponquesito` esté vacía ni ejecutar
   `flush`, `dropdb`, `migrate` o limpieza. Registrar revisión y servicios.
   Comprobar en concreto si ya existen tablas con los nombres que crea
   `commerce` (`cake_requests`, `leads`, `cake_reservations`…, p. ej. por
   haber aplicado alguna vez `supabase/schema.sql`) y qué filas tiene
   `django_migrations`: `0001_initial` falla si la tabla ya existe.
2. Elegir base, rol y host de staging separados; respaldar primero esquema y
   datos existentes con `pg_dump` hacia almacenamiento privado y comprobar
   restauración en un entorno aislado. Aprobar explícitamente el plan de
   migración después del inventario.
3. Crear secretos nuevos solo en gestores de secretos de staging, con Vercel
   Preview apuntando a API/BD/SMTP de staging. Nunca reutilizar el `service_role`
   antiguo ni copiar `.env.local` a Vercel. El receptor SMTP debe ser local o
   una casilla de prueba controlada, sin direcciones de clientes.
4. Desplegar código Django compatible, ejecutar `manage.py migrate --plan`,
   revisar y **solo entonces** aplicar `migrate` en staging. Crear/verificar
   directorio privado 0700 del usuario de servicio. Validar Gunicorn en
   localhost, Caddyfile y TLS API antes de conectar Preview. Mantener el
   frontend público anterior sin cambios durante este ensayo.
5. Desplegar Next.js Preview de la **misma revisión** con API, SMTP y cron
   de prueba. Comprobar `/linktree`, formularios con/sin imagen, correos,
   último cupo concurrente, enlace correcto/incorrecto, recuperación,
   reprogramación/cancelación, agente, reporte manual y cron protegido.
   Confirmar métricas y ausencia de secretos/PII en logs. No disparar el cron
   productivo ni usar Gmail real sin aprobación.
6. Solo con aceptación separada, planear producción: inventario y backup
   PostgreSQL del VPS, compatibilidad de migraciones, ventana de corte,
   secretos/ dominios Vercel ya existentes, API DNS/UFW/Caddy, y pruebas de
   extremo a extremo. No crear proyecto Vercel nuevo por defecto.

## Reversión

Hay dos situaciones distintas. Solo la primera se puede ensayar entera antes
del lanzamiento.

### A. Reversión ensayable en staging

Objetivo: demostrar que una versión candidata defectuosa se retira sin tocar
datos, y medir cuánto tarda. Todo con BD, API, SMTP y Preview de staging.

1. Antes: `pg_dump` de la BD de staging y prueba de restauración en un
   PostgreSQL aislado; copia del env del backend y del Caddyfile vigente;
   revisión anterior del backend conservada en disco.
2. Frontend: los deployments de Vercel son inmutables. Desplegar la
   candidata N y una N−1 compatible con la misma API; ensayar volver a N−1
   (alias/promoción) y comprobar `/linktree`, formularios y agenda.
3. API: volver al código anterior reiniciando el servicio sobre la revisión
   guardada. Las migraciones 0001–0004 solo crean tablas nuevas; un código
   anterior que no las usa convive con ellas. Ensayar también, **solo en
   staging**, `migrate commerce zero` + restauración del dump, para medir la
   pérdida de datos y el tiempo. En producción no se hace.
4. Caddy: restaurar el Caddyfile guardado, `caddy validate`, recargar; o
   volver a la base C1 (detenido y deshabilitado, conservando datos ACME).
5. Fallback degradado (ensayar en Preview): la misma revisión **sin**
   `PONQUESITO_API_URL`/`PONQUESITO_INTERNAL_API_KEY` compila y sirve
   `/linktree` y las páginas estáticas; formularios, agenda y reporte
   muestran su mensaje de error amable. No requiere código nuevo.

### B. Recuperación del primer lanzamiento (producción)

Limitación real: **no existe una versión anterior funcional de la
plataforma**. El deployment de producción actual en Vercel (`main`,
`3eb69ce`) depende del Supabase eliminado y además responde 404 en
`/linktree`. Volver a él rompería los QR: no se usa como reversión.

Base actual (consulta pública del 2026-10-18): los NS son de Porkbun; el
apex y `www` resuelven a IPs de Cloudflare y `/linktree` responde 200 desde
ahí; el MX es el reenvío de Porkbun (`fwd1/fwd2.porkbun.com`); no hay CAA;
`api.` no existe. Antes del corte hay que exportar la zona completa (con TTL)
y averiguar qué servicio está detrás de esas IPs y si sigue disponible.

Recuperación según el fallo:

- **API caída o defectuosa, Next.js bien:** `/linktree` y las páginas
  estáticas siguen funcionando; formularios y agenda fallan con mensaje
  amable. No se pierden datos: corregir hacia delante o restaurar la
  revisión anterior del backend (A.3). Interrupción: formularios.
- **Deployment de Vercel defectuoso:** asignar el dominio al deployment
  degradado preparado de antemano (A.5), si se aprobó, o restaurar
  EXACTAMENTE los registros DNS exportados del apex/`www`. Con DNS hay
  ventana de propagación (TTL y cachés) en la que conviven ambos destinos.
  Durante ella `/linktree` responde mientras el destino anterior siga vivo.
- **Problema de datos o de migración:** sin reversión automática de
  migraciones ni purga de tablas o imágenes. Ya puede haber solicitudes,
  reservas y enlaces enviados. Restaurar un dump solo con decisión explícita
  de pérdida de datos y tras reconciliar correos y enlaces emitidos.

Nunca se resuelve creando otro Supabase. Bajar el TTL, exportar
la zona y preparar el deployment degradado son condiciones previas
al corte, no pasos del momento del fallo.
