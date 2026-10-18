---
name: verify
description: Cómo verificar end-to-end los flujos de Familia Ponquesito (formulario Reto 2, builder Reto 3, automatización de leads Reto 4) contra la app real con Django/PostgreSQL desechable.
---

# Verificación end-to-end de este repo

## Levantar la app

```bash
npm run dev -- -p 3100        # dev (usa .env.local)
# o el camino de producción (requiere npm run build previo):
npm start -- -p 3101
```

Para simular configuración faltante en producción, sobrescribe las
variables con valores vacíos en el comando (`SMTP_HOST= ... npm start`):
Next.js no pisa variables ya presentes en el entorno, aunque estén vacías,
así que `.env.local` no las rellena.

## Manejar el navegador

Playwright no es dependencia del proyecto (a propósito). Instálalo en un
directorio temporal (`npm install playwright`) y usa los navegadores ya
cacheados en `~/.cache/ms-playwright`. Los campos del formulario de la
landing se localizan por etiqueta (`getByLabel`): Nombre, WhatsApp, Correo,
Fecha de la celebración, Tipo de celebración, Número aproximado de
personas, Sabor preferido, Idea o descripción de la torta. El campo
`companyWebsite` es un honeypot: déjalo siempre vacío o el envío se
descarta en silencio. La fecha debe tener ≥ 3 días de anticipación.

## Backend para las pruebas

Los formularios llaman a Django por la API interna (`PONQUESITO_API_URL`,
`PONQUESITO_INTERNAL_API_KEY`). Usa una PostgreSQL **desechable** y un Django
local, nunca el VPS: ver "Validación local reproducible" en
`docs/supabase-to-django.md`. `next start` exige HTTPS hacia la API (solo
`NODE_ENV=test` admite `http://127.0.0.1`): pon un proxy TLS local con
certificado autofirmado y pásalo en `NODE_EXTRA_CA_CERTS`.

## Observar el resultado (Reto 4)

`processLead` corre en `after()`, después de responder al usuario: espera
con polling (hasta ~90 s) y consulta la PostgreSQL desechable, por ejemplo
`docker exec <contenedor> psql -U <usuario> -d <bd> -Atc "<consulta>"`:

- `select id, reference_code from leads where customer_email = '<correo>' order by created_at desc limit 1`
- `select event_type, status, error_message from lead_automation_events where lead_id = '<id>' order by created_at`
- `select event_type, state, attempts from email_dispatches where lead_id = '<id>'`

Éxito = eventos `lead_registered`, `customer_email` y `owner_email` en
`success`, con `metadata.providerId`. El correo de prueba va a un receptor
SMTP local (ver `src/email/local-smtp.test.ts`) o a una casilla controlada
por el negocio; nunca a direcciones de clientes.

## Gotchas

- Nunca imprimas valores de `.env.local`; para confirmar presencia usa
  `grep -oE '^VAR=..' | sed 's/=../=SET/'`, y para buscar fugas en logs
  carga el secreto en una variable de shell y reporta solo `grep -c`.
- Los envíos de prueba crean filas en la BD desechable; al terminar se
  descarta el contenedor entero en vez de limpiar filas sueltas.
- `.env.local` puede contener credenciales antiguas o reales (SMTP): para
  probar `next build`/`next start` copia el árbol sin ese archivo.
