# Caddy: proxy inverso y HTTPS

Caddy recibe el tráfico público en 80 y 443, obtiene y renueva los
certificados de Let's Encrypt, y reparte las peticiones entre Django y
Next.js, todo en el **mismo origen**. Caddy **no sirve páginas propias**:
solo enruta.

> **Lanzamiento fase 1 (2026-10-09):** el dominio principal solo publica
> `/linktree`. Ver [Lanzamiento fase 1](#lanzamiento-fase-1-solo-linktree);
> el contrato de abajo es el de la aplicación completa (staging y fases
> posteriores).

## Contrato de rutas

| Ruta | Servicio | Notas |
|---|---|---|
| `/health/` (y `/health`) | Django, `127.0.0.1:8000` | `/health` redirige a `/health/` (`APPEND_SLASH` de Django). |
| `/api/v1/*` (y `/api/v1`) | Django | API versionada. Django recibe la ruta completa, sin recortes. |
| `/` | Next.js, `127.0.0.1:3000` | Landing público. |
| `/linktree` | Next.js | Página de enlaces (`public/linktree.html`, ver `docs/linktree.md`). **Permanente: está en QR impresos.** `/linktree/` → 308 a `/linktree` lo hace Next.js. |
| `/api/agent`, `/api/assistant`, `/api/reports/weekly` y cualquier otro `/api/*` | Next.js | `/api/v1x`, `/api/v10/…` o `/api/v2/…` no son de Django. |
| Todo lo demás | Next.js | Fallback del tráfico web. |
| `www.` → apex | Redirección 301 | Conserva ruta y parámetros. Solo en producción. |

Django refuerza el contrato: solo resuelve `/health/` y `/api/v1/*`, y sus
cookies llevan `Path=/api/v1/` (ver `backend/README.md`).

### IP del cliente

Los limitadores de Next.js (agenda, reservas, asistente y agente) usan como
clave el primer valor de `X-Forwarded-For`, o `X-Real-IP` si faltara. Caddy
es el único proxy público, así que el snippet `ponquesito_ip_cliente` fija
ambas cabeceras a la IP del par TCP (`{remote_host}`) y elimina `Forwarded`.
El cliente no puede elegir su IP; `test/run-local.sh` lo comprueba con
cabeceras falsificadas.

- **Sin el snippet**, Caddy 2.11 ya reemplaza `X-Forwarded-For`, pero deja
  pasar el `X-Real-IP` y el `Forwarded` que envíe el cliente.
- **Si se pone Cloudflare u otro proxy delante de Caddy, hay que revisar esta
  regla:** `{remote_host}` sería la IP del proxy y todos los clientes
  compartirían un límite. Habría que configurar `trusted_proxies` y
  `client_ip_headers` solo con los rangos de ese proxy, y usar
  `{client_ip}`.

## Archivos

| Archivo | Uso |
|---|---|
| `ponquesito.caddy` | Snippets compartidos: rutas, fase 1, protección de staging y cabeceras. Se instala en `/etc/caddy/ponquesito.caddy`. |
| `Caddyfile.fase1` | Preparado, **sin instalar**. Lanzamiento fase 1: apex solo con `/linktree` y `www` → apex. Sin staging público. |
| `Caddyfile.staging` | Configuración **actual**: solo `staging.familiaponquesito.com`, con acceso restringido. |
| `Caddyfile.production` | Preparado, **sin instalar**. Aplicación completa en el apex, `www` → apex y staging. Para una fase posterior. |
| `sync-to-vps.sh` | Copia `deploy/caddy/` del commit indicado a `~/ponquesito-caddy` del administrador. |
| `test/run-local.sh` | Prueba local de todas las rutas (apex completo, `www`, staging y fase 1), con Django real y Next.js (sustituto y, opcionalmente, real: un checkout con `NEXT_DIR` o un release de `deploy/web` con `NEXT_RELEASE`). Valida además `Caddyfile.fase1`, `.production` y `.staging`. |

## Staging

- **Acceso restringido:** `basic_auth` en todas las rutas, incluidas
  `/health/`, `/api/v1/*` y `/linktree`.
  - El usuario y el hash bcrypt viven en `/etc/caddy/staging.env` (root:caddy,
    640), fuera de Git, y systemd los carga.
  - Caddy atiende el desafío ACME antes de pedir la autenticación, así que
    el certificado se obtiene igual.
- **`X-Robots-Tag: noindex, nofollow, noarchive`.**
- **Sin escrituras ni correos desde Next.js:** la protección
  `ponquesito_staging_guard` bloquea con 403, **solo hacia Next.js**:
  - cualquier método distinto de GET/HEAD (las Server Actions de los
    formularios son POST);
  - todas sus rutas `/api/*`: asistente, agente y reporte con correo.

  Así Next.js no recibe nada que pueda escribir datos o enviar correo,
  aunque esté configurado. Además, el despliegue de Next.js en staging debe
  hacerse **sin** credenciales reales de SMTP ni la `service_role` de
  Supabase. `/health/` y `/api/v1/*` llegan a Django, que aplica su CSRF.
- **Next.js todavía no está desplegado:** sus rutas, incluidas `/` y
  `/linktree`, responden 503 con un mensaje explícito en lugar de 502. Solo
  `/health/` y `/api/v1/*` funcionan hasta que se despliegue Next.js.

## Prueba local

```bash
# Fase 1: precedencia de rutas, con un sustituto de Next.js
CADDY=/ruta/a/caddy deploy/caddy/test/run-local.sh

# Fases 1 y 2: además, Next.js real sobre un build hecho en un checkout
# limpio (sin .env*; el script se niega si los encuentra)
CADDY=/ruta/a/caddy NEXT_DIR=/ruta/al/checkout deploy/caddy/test/run-local.sh

# O con un release standalone de deploy/web (p. ej. el de producción),
# extraído de su artefacto
CADDY=/ruta/a/caddy NEXT_RELEASE=/ruta/al/release deploy/caddy/test/run-local.sh
```

Usa nombres `.test`, TLS interno de Caddy (`local_certs`) y los puertos
18080 y 18443. Django corre con `config.tests.e2e_settings` (SQLite temporal y
sesiones en cookie firmada), sin PostgreSQL ni datos reales. Comprueba:

- **Precedencia:** `/`, `/linktree`, sus recursos, `/agenda`, las tres rutas
  `/api/*` de Next.js, `/api/v1x`, `/api/v10/…`, `/api/v2/…`, `/healthz` y
  `/backend/…` llegan a Next.js; `/health/` y `/api/v1/*` llegan a Django
  y el sustituto de Next.js no los recibe.
- **Django:** `health`, `APPEND_SLASH`, `redirect()` y `reverse()` dentro de
  `/api/v1/`, URL absoluta HTTPS, `is_secure()` a través del proxy, cookies
  con `Path=/api/v1/` y `Secure`, 404 y CSRF propios.
- **HTTP → HTTPS y `www` → apex:** conservan ruta y parámetros.
- **Staging:** 401 sin credenciales o con credenciales erróneas; `noindex`;
  POST, PUT y `/api/*` hacia Next.js bloqueados sin llegar a él; `/api/v1/*`
  sí llega a Django; 503 si Next.js está caído y Django sigue respondiendo.
- **Lanzamiento fase 1:** `/` → 302 con parámetros; `/linktree`, sus dos
  recursos y `/health/` pasan; el resto de `/assets/*` (incluidos archivos
  reales del cake builder) → 404 sin llegar a Next.js; HEAD también; POST, PUT, DELETE, PATCH y
  OPTIONS → 405 con `Allow`; las rutas de la aplicación, `/api/*`,
  `/_next/*` y rutas con `..`, `%2e%2e` o `//` → 404 sin llegar a ninguna
  aplicación; HTTP → HTTPS, `www` → apex, IP del cliente y cabeceras; el
  bloque de `Caddyfile.fase1` es el probado.
- **Fase 2 (Next.js real):** `/` es el landing de Next.js y no la página de
  enlaces; `/linktree` (con y sin parámetros), favicon y logo byte a byte;
  `/linktree/?a=1` → 308 a `/linktree?a=1`; las API de Next.js responden
  desde Next.js; `/api/v1/*` y `/health/` siguen en Django. En fase 1:
  `/` y `www` llevan a la página de enlaces byte a byte, todos sus recursos
  cargan, no usa `/_next` ni scripts, y con Next.js caído la respuesta es
  503 mientras `/health/` sigue en Django.

## Instalación de staging en el VPS

Requisitos previos:
- El backend ya está instalado (ver `backend/README.md`).
- El registro DNS de staging ya existe y resuelve al VPS (ver el
  [paso 1](#1-dns-porkbun-solo-staging)).

Los pasos con `sudo` los ejecuta el administrador en su terminal.

### 1. DNS (Porkbun): solo staging

| Tipo | Host | Respuesta | TTL |
|---|---|---|---|
| A | `staging` | `<IPv4 del VPS>` | 600 |

- **No se crea registro AAAA** hasta haber probado el acceso por IPv6 desde
  fuera: si existe, Let's Encrypt valida primero por IPv6.
- **No se tocan** el A del apex, el CNAME de `www`, los MX ni el TXT (SPF).

Para comprobar que ya resuelve, desde cualquier equipo:

```bash
host staging.familiaponquesito.com        # debe responder solo <IPv4 del VPS>
```

### 2. Caddy (VPS, sudo)

```bash
# Caddy desde su repositorio oficial (Ubuntu solo ofrece 2.6.2)
sudo apt install --yes debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
caddy version
```

El paquete arranca Caddy con una configuración de ejemplo en el puerto 80.
No queda expuesto, porque UFW aún no abre ese puerto.

### 3. Copiar backend y configuración (equipo local, sin sudo)

```bash
VPS_HOST=<admin>@<host> backend/scripts/sync-to-vps.sh   # código con /api/v1/ y soporte de proxy HTTPS
VPS_HOST=<admin>@<host> deploy/caddy/sync-to-vps.sh
```

El servicio sigue ejecutando el código anterior hasta el `restart` del paso
6. Sin las variables nuevas, el código nuevo se comporta igual que el
anterior.

### 4. Credenciales de staging (VPS, sudo)

`caddy hash-password` pide la contraseña sin mostrarla en pantalla. No se
escribe en ningún archivo, comando ni chat.

```bash
HASH=$(caddy hash-password)
sudo install -m 640 -o root -g caddy /dev/null /etc/caddy/staging.env
printf "STAGING_BASIC_AUTH_USER='ponquesito'\nSTAGING_BASIC_AUTH_HASH='%s'\n" "$HASH" | sudo tee /etc/caddy/staging.env >/dev/null
unset HASH
sudo install -d -m 755 /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironmentFile=/etc/caddy/staging.env\n' | sudo tee /etc/systemd/system/caddy.service.d/staging-env.conf >/dev/null
sudo systemctl daemon-reload
```

### 5. Instalar la configuración (VPS, sudo)

```bash
sudo cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.dist     # respaldo del original
sudo install -m 644 ~/ponquesito-caddy/ponquesito.caddy /etc/caddy/ponquesito.caddy
sudo install -m 644 ~/ponquesito-caddy/Caddyfile.staging /etc/caddy/Caddyfile
sudo bash -c 'set -a; . /etc/caddy/staging.env; set +a; caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile'
```

### 6. Django detrás de Caddy (VPS)

Como `<admin>`, sin sudo, añade a `/srv/ponquesito/backend.env`:

```
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost,staging.familiaponquesito.com
DJANGO_BEHIND_HTTPS_PROXY=true
DJANGO_CSRF_TRUSTED_ORIGINS=https://staging.familiaponquesito.com
```

`DJANGO_ALLOWED_HOSTS` reemplaza a la línea existente. Después:

```bash
sudo systemctl restart ponquesito-backend
curl -s http://127.0.0.1:8000/health/      # sigue respondiendo por túnel
```

### 7. Abrir 80 y 443 y recargar Caddy (VPS, sudo)

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status verbose                      # 22, 80 y 443 en IPv4 y v6; nada más
sudo systemctl restart caddy                 # carga staging.env y la configuración
sudo journalctl -u caddy -n 30 --no-pager    # debe aparecer "certificate obtained successfully"
```

- **443/udp (HTTP/3) no se abre:** la configuración limita Caddy a HTTP/1.1
  y HTTP/2.
- **El 80 se abre por dos motivos:** el desafío HTTP-01 de Let's Encrypt y la
  redirección de HTTP a HTTPS.

### 8. Verificación

Hay que hacerla **desde una red independiente**, por ejemplo con los datos
del móvil, porque la red local intercepta el puerto 80. Ningún comando lleva
`-k`.

```bash
S=https://staging.familiaponquesito.com
curl -sS -o /dev/null -w '%{http_code}\n' $S/                     # 401 (certificado válido; sin credenciales)
curl -sS -u ponquesito $S/health/                                # {"status": "ok", "database": "ok"} (pide la contraseña)
curl -sS -u ponquesito -o /dev/null -D - $S/health | grep -i '^location'   # /health/
curl -sS -u ponquesito -o /dev/null -w '%{http_code}\n' $S/api/v1/       # 404 de Django (aún vacío)
curl -sS -u ponquesito -o /dev/null -w '%{http_code}\n' -X POST $S/agenda           # 403
curl -sS -u ponquesito -o /dev/null -w '%{http_code}\n' $S/linktree      # 503 hasta desplegar Next.js; luego 200
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://staging.familiaponquesito.com/linktree   # 308 https://…
```

Para dar staging por bueno:

- **HTTPS válido:** ningún `curl` falla por el certificado, y el
  navegador muestra el candado sin advertencias.
- **Nombre correcto:**
  `openssl s_client -connect staging.familiaponquesito.com:443 -servername staging.familiaponquesito.com </dev/null 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName`
  debe mostrar `staging.familiaponquesito.com`.
- **Pruebas funcionales:** las de la lista anterior. Cuando Next.js esté
  desplegado, abrir además `/` y `/linktree` en el navegador del móvil.

### Reversión

| Qué deshacer | Cómo |
|---|---|
| Cerrar la exposición pública | `sudo ufw delete allow 80/tcp && sudo ufw delete allow 443/tcp` |
| Detener Caddy | `sudo systemctl disable --now caddy` |
| Volver a la configuración original | `sudo cp -a /etc/caddy/Caddyfile.dist /etc/caddy/Caddyfile && sudo systemctl reload caddy` |
| Django sin proxy | Quitar de `backend.env` las líneas del paso 6 (restaurar `DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost`) y `sudo systemctl restart ponquesito-backend` |
| DNS | Borrar el registro A `staging` en Porkbun |

## Lanzamiento fase 1: solo Linktree

Decidido el 2026-10-09 (`docs/decisions.md`). Los QR apuntan a
`https://familiaponquesito.com/linktree`. `Caddyfile.fase1` usa el snippet
`ponquesito_fase1`, una lista blanca:

| Petición | Respuesta |
|---|---|
| `GET /`, `GET /?…` | 302 → `/linktree` (conserva los parámetros) |
| `GET /linktree`, `GET /linktree?…` | Next.js: `public/linktree.html` |
| `GET /linktree/` | Next.js: 308 → `/linktree` |
| `GET /favicon.svg`, `GET /assets/logo-familia-ponquesito.png` | Next.js: los dos únicos recursos de la página |
| `GET /health/` | Django |
| `HEAD` en las rutas anteriores | igual que `GET`, sin cuerpo |
| Otro método (`POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS`) en esas rutas | 405 de Caddy, `Allow: GET, HEAD` |
| Cualquier otra ruta y método: `/api/*` (incluida `/api/v1/*`), `/_next/*`, `/agenda*`, `/crea-tu-torta*`, `/agente*`, `/prototipo*`, `/reporte-semanal*`, `/asistente*`, `/health`, `/linktree.html`, `/favicon.ico`, `/robots.txt`, el resto de `/assets/*` (cake builder)… | 404 de Caddy (`No encontrado`); no llega a ninguna aplicación |
| `http://…` | 308 → `https://…` (Caddy) |
| `www.familiaponquesito.com/<ruta>?<query>` | 301 → `https://familiaponquesito.com/<ruta>?<query>` |
| Next.js caído | 503 `Servicio no disponible temporalmente` en las rutas que van a Next.js |

Caddy normaliza la ruta antes de comparar (`/assets/../agenda`,
`/assets/%2e%2e/agenda` y `//agenda` son 404). Las mayúsculas no se
distinguen al comparar: `/LINKTREE` sirve la misma página (la reescritura
de Next.js tampoco las distingue), `/AGENDA` es 404 de Caddy y el logo en
mayúsculas llega a Next.js, que responde 404.
`test/run-local.sh` lo prueba todo, también con el artefacto de producción
real (`NEXT_RELEASE`), y comprueba que el bloque de `Caddyfile.fase1` es el
mismo que se prueba.

Antes del corte, Django debe aceptar el apex: añadir
`familiaponquesito.com` a `DJANGO_ALLOWED_HOSTS` y activar
`DJANGO_BEHIND_HTTPS_PROXY=true` en `backend.env` (paso 6 de staging).

## Producción completa (más adelante)

`Caddyfile.production` publica la aplicación completa en el apex, con
`www` → apex y staging. Sustituirá a `Caddyfile.fase1` cuando se apruebe
publicar el resto de la aplicación con sus servicios externos.

Para ese corte:
- bajar antes el TTL del A del apex y del CNAME de `www`, y anotar sus
  valores actuales para poder revertir;
- **mantener intactos los MX y el TXT de SPF**, que son el reenvío de
  correo de Porkbun.
