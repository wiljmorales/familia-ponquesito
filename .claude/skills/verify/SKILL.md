---
name: verify
description: Cómo verificar end-to-end los flujos de Familia Ponquesito (formulario Reto 2, builder Reto 3, automatización de leads Reto 4) contra la app real.
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

## Observar el resultado (Reto 4)

`processLead` corre en `after()`, después de responder al usuario: espera
con polling (hasta ~90 s) y consulta Supabase por REST con
`SUPABASE_SERVICE_ROLE_KEY` de `.env.local`:

- `leads?customer_email=eq.<correo de prueba>&order=created_at.desc&limit=1`
- `lead_automation_events?lead_id=eq.<id>&order=created_at.asc`

Éxito = eventos `lead_registered`, `customer_email` y `owner_email` en
`success`, con `metadata.providerId` (messageId de Nodemailer, formato
`<uuid@gmail.com>`). Usa como destinatario de prueba la propia cuenta del
negocio (el valor de `SMTP_USER`) para no escribir correos a terceros.

## Gotchas

- Nunca imprimas valores de `.env.local`; para confirmar presencia usa
  `grep -oE '^VAR=..' | sed 's/=../=SET/'`, y para buscar fugas en logs
  carga el secreto en una variable de shell y reporta solo `grep -c`.
- Los envíos de prueba crean filas reales en `cake_requests`, `leads` y
  `lead_automation_events`; anota los `reference_code` generados para
  poder limpiarlos desde el dashboard de Supabase si estorban.
