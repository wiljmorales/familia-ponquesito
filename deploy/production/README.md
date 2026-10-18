# Preparación: Next.js en Vercel, Django en VPS

Estado: propuesta local; no aplicada. C1 está completado según confirmación del
operador: código 0, Caddy 2.11.7, caddy.service y caddy-api.service
inactive/disabled, sin máscaras ni listeners, servicios protegidos verificados.
Ejecutable C1: `34a1e4a6b04497b50c95703e88b308d12546e31580a2f54de46717a9699f9285`.
Manifiesto: `05a8f3ccec266b22fa4d8e73e71c4dc1398732739f02e6cc5b8a7bbf9eecfda2`.
No se conoce el TXID del intento exitoso: registrar su state/journal cuando el
operador los facilite. No reutilizar el ID de una ejecución revertida.

## Arquitectura que existe

- Navegador → Vercel: Next.js, Server Actions y `/api/assistant`, `/api/agent`,
  `/api/reports/weekly`. Los fetch del navegador son relativos al mismo origen.
- Next.js servidor → API privada Django/PostgreSQL (solicitudes, diseños,
  agenda, reservas, leads, eventos, agente y reportes), Gemini y SMTP.
- `api.familiaponquesito.com` → Caddy → Gunicorn `127.0.0.1:8000` → PostgreSQL.
  Django implementa `/health/`, la API interna `/api/v1/internal/*` y
  acceso temporal firmado a imágenes privadas.
- La API usa un Bearer exclusivo entre servidores. El navegador no recibe la
  credencial ni accede directamente a Django.

La migración está implementada localmente; NO se ha aplicado en Vercel ni VPS.
Ver `docs/supabase-to-django.md` antes de cualquier promoción. El Supabase
anterior solo contenía datos de prueba, pero PostgreSQL del VPS NO está
autorizado para borrarse ni reinicializarse.

## Vercel y valores pendientes

Seleccionar proyecto/team y rama de producción existentes: pendientes de acceso
a Vercel, sin inventar IDs. Root Directory: raíz del repositorio Next.js (si se
importa el workspace padre, `familia-ponquesito`). Usar lockfile y preset Next.js;
`npm ci`, `npm run build`; versión Node compatible con `.nvmrc`. No activar
`PONQUESITO_STANDALONE`. `.vercelignore` excluye el backend.

`vercel.env.example` enumera variables leídas realmente por el código:

| Variables | Acción/valor |
|---|---|
| APP_CANONICAL_URL | https://familiaponquesito.com; evita enlaces privados al dominio vercel.app por defecto |
| NEXT_PUBLIC_WHATSAPP_URL | Valor público confirmado del ejemplo; incorporado al build |
| PONQUESITO_API_URL, PONQUESITO_INTERNAL_API_KEY | URL pública HTTPS de Django y secreto compartido exclusivo entre servidores; crear en staging sin exponer al navegador |
| GEMINI_API_KEY, GEMINI_MODEL | Cuenta/cuota/modelo a verificar; sin clave se usa comportamiento de demostración |
| SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_APP_PASSWORD, EMAIL_FROM | Cuenta autorizada y TLS; credenciales pendientes, nunca reutilizar contraseña normal |
| KAREM_NOTIFICATION_EMAIL | Destinatario real pendiente de confirmar |
| CRON_SECRET | Secreto aleatorio en Vercel; endpoint debe rechazar peticiones sin él |

No copiar `.env.local`: puede contener credenciales antiguas. Secretos sin prefijo
NEXT_PUBLIC_. Configurar Production y volver a compilar; Preview debe tener
servicios/datos de prueba y origen canónico propio, nunca credenciales productivas.
`vercel.json` programa lunes 12:00 UTC (08:00 Caracas). Revisar plan, cron,
duración máxima de funciones (agente: 60 s) y SMTP saliente antes de promover.
No activar pruebas con efectos de correo usando el cron de producción.

## Django: hosts, CORS, CSRF y autenticación

Combinar `django.env.example` con el backend.env existente, conservando secretos
y PostgreSQL; no cargar un archivo de ejemplo incompleto en systemd.
El código local ya admite hosts explícitos, proxy HTTPS y cookies Secure.
La documentación registra un backend remoto antiguo: verificar revisión antes
de desplegar este código. No suponer que cambiar solo el env basta.

CORS: no instalar/configurar comodines ni CORS en Caddy. El navegador no
consume Django. CSRF: middleware permanece para cookies; la API interna usa
Bearer y no acepta cookies como autenticación.
Las cookies actuales son host-only, Path=/api/v1/, SameSite=Lax; sesiones HttpOnly.
Esto no crea un login ni permisos: contrib.auth instalado no es una API de auth.

La arquitectura BFF es la única implementada: navegador → Server Actions de
Next.js → Django; no requiere CORS. Las operaciones de reservas necesitan
código y token privado además de la credencial de servidor.

Actualmente las reservas usan enlaces privados con token; el cron usa Bearer.
No hay login general de usuario/operador. Revisar `/agente` (demostración con
efectos), reporte y páginas operativas antes de exponer toda la app. Los límites
en memoria no son globales entre instancias Vercel: revisar abuso/cuotas antes
de producción completa.

## Caddy, DNS y UFW (propuesta, sin ejecutar)

Usar `../caddy/Caddyfile.api`, autocontenido. No usar el Caddyfile.production
histórico que publica el apex y Next.js :3000. Solo Django recibe /health/ y
/api/v1/*, conservando ruta; resto 404. Sin admin Django ni servidor de media.
Caddy obtiene/renueva HTTPS y redirige HTTP; conserva Host y fija X-Forwarded-Proto.
Gunicorn debe seguir ligado a localhost; confiar en ese header solo detrás de
Caddy. Sin proxy CDN delante de API en esta propuesta. H1/H2: no necesita UDP443.
No habilitar caddy-api.service. La API administrativa de Caddy, si existe en
localhost:2019, nunca se publica ni se abre en UFW. Conservar datos ACME.

| DNS | Destino propuesto |
|---|---|
| @ | Registro exacto que muestre Vercel para el proyecto; pendiente |
| www | CNAME específico que muestre Vercel; pendiente; redirección www→apex en Vercel |
| api A | 37.27.149.66 (VPS conocido; reconfirmar asignación antes del corte) |
| api AAAA | Solo si IPv6 está verificado; no inventar ni dejar un AAAA obsoleto |
| TXT verificación | Copiar valor de Vercel si lo solicita; pendiente |

Consulta pública del 2026-10-18: NS de Porkbun; apex y www hacia IPs de
Cloudflare (`/linktree` 200 hoy); MX de reenvío de Porkbun; sin CAA; sin `api.`.
Proveedor DNS, zona, registros actuales/TTL, MX/SPF/DKIM/DMARC/CAA, DNSSEC y
registros de verificación requieren acceso al proveedor. Exportarlos antes de
cambiar. No migrar nameservers para esto ni borrar registros de correo.
Comprobar CAA permite el emisor ACME elegido. Reducir TTL con antelación solo
en los registros afectados; mantener rollback y considerar cachés previas.

UFW: conservar OpenSSH y reglas vigentes; añadir únicamente TCP80 y TCP443 para
Caddy, IPv4/IPv6 según configuración. No abrir 3000, 8000, 5432 ni 2019, no resetear
UFW. Comprobar también firewall de Hetzner si existe. Registrar identificadores
de reglas nuevas para poder retirar solo esas. Requiere autorización de aplicación.

## Secuencia y aceptación del flujo completo

1. Capturar revisiones, env cifrado/backup privado, DNS/TTL, reglas, estado de
   Caddy y health de web/backend. Registrar último deployment sano de Vercel.
2. Validar localmente Caddyfile.api con Caddy 2.11.7; Django tests y check --deploy
   con env de producción en fase autorizada; resolver advertencias con contexto.
3. Configurar servicios externos de prueba. Probar Preview: landing → solicitud
   con imagen privada → fila/archivo → correo cliente y propietario; diseño personalizado;
   agenda → reserva → enlace privado → reprogramación/cancelación. Comprobar
   que un enlace inválido no accede a otra reserva y que no hay duplicados.
4. Probar asistente/agente con destinatarios de prueba, cuotas y límites. Probar
   reporte con secreto en entorno de prueba; sin secreto de cliente debe dar 401
   cuando CRON_SECRET está configurado (503 si falta configuración).
5. Tras revisión/autorización separada: actualizar backend si hace falta,
   verificar /health/ local con BD; aplicar API DNS/UFW/Caddy y validar TLS.
   Caddyfile se valida antes de instalar; backup previo. Preservar servicio web
   local como fallback; no pararlo ni purgarlo durante el cambio a Vercel.
6. Preparar deployment Vercel productivo, variables y dominios, aprobar pruebas,
   después cambiar solo apex/www. La API Django debe estar sana antes de
   promover Next.js porque sus Server Actions la consumen.
7. Ejecutar `bash deploy/production/smoke.sh` tras el corte autorizado: valida
   TLS, web, API health/BD, redirecciones y cron protegido, sin escrituras.
   Completar prueba de negocio con datos de prueba autorizados y limpieza
   dirigida; registrar deployment, hora, respuestas, correos y resultados.
   Un health verde NO acredita por sí solo los flujos Next.js–Django.

El smoke NO se ejecuta durante esta preparación. No hay prueba real de negocio
completada mientras falten cuentas/secretos y servicios disponibles.

## Reversión

- Si falla antes del corte DNS: mantener sitio actual; retirar Preview/alias
  candidato según plataforma sin cambiar datos. No ejecutar C1 otra vez.
- Primer lanzamiento: no hay deployment anterior sano (el de `main` depende de
  Supabase y da 404 en /linktree). Ver la sección B de
  `docs/supabase-to-django.md`: deployment degradado preparado o DNS exportado.
- Si falla Vercel tras el corte: rollback al deployment sano registrado y a sus
  variables compatibles. Si no existe deployment sano, restaurar EXACTAMENTE
  registros DNS/TTL previos; no apuntar al VPS por suposición (su web podría no
  tener entrada HTTPS). El origen previo debe haberse comprobado accesible antes
  del corte. Contemplar propagación; vigilar ambos destinos durante el TTL.
- Si falla API: restaurar código/env backend guardados y configuración anterior
  de Caddy validada. Si el baseline era C1 recién completado sin configuración,
  volver a Caddy detenido/deshabilitado; conservar instalación y datos ACME.
  caddy-api.service permanece deshabilitado. Restaurar API DNS y retirar solo
  reglas UFW añadidas, tras verificar que no sirven a otro tráfico.
- No revertir automáticamente migraciones ni borrar solicitudes/reservas. Un
  rollback de código no deshace escrituras: reconciliar datos y correos, restaurar
  BD solo con plan separado y backup probado. Mantener secretos fuera de logs.
- Verificar web/backend activos, PostgreSQL local, SSH accesible, DNS/UFW según
  baseline; Caddy inactive/disabled y sin listeners públicos si se vuelve a C1.

## Referencias

- https://vercel.com/docs/domains/working-with-domains/add-a-domain
- https://caddyserver.com/docs/automatic-https
- https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- https://docs.djangoproject.com/en/5.2/ref/settings/#csrf-trusted-origins
- https://docs.djangoproject.com/en/5.2/ref/settings/#secure-proxy-ssl-header
- Documentación Next.js local: node_modules/next/dist/docs/01-app/02-guides/environment-variables.md
