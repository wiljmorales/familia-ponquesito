# Staging por HTTPS para Vercel Preview

Publica el backend de staging que ya corre en el VPS (`127.0.0.1:8001`, ver
[README.md](README.md)) como `https://api-staging.familiaponquesito.com`, y
añade un SMTP de pruebas para que Vercel Preview pueda enviar correo sin
destinatarios reales.

```
Navegador ──(Vercel Authentication)──▶ Vercel Preview (rama feature/supabase-to-django-local)
                                         │  Bearer de staging          │  SMTP 465, TLS + AUTH
                                         ▼                             ▼
VPS 37.27.149.66:   Caddy 80/443 ─▶ 127.0.0.1:8001 Django staging    Mailpit 465 (solo @example.invalid, no reenvía)
                    (sin sitio para producción: 127.0.0.1:8000 no se publica)
```

Estado: **preparado y probado en la simulación del VPS; nada aplicado.**

**Alcance de la fase actual: HTTPS de staging en 80/443** (`--aplicar`). El
correo de Preview (Mailpit en 465, `--aplicar-correo`) y Vercel quedan
preparados para el paso siguiente; no se aplican todavía.

**Caddy ya está instalado en el VPS** desde C1: paquete oficial 2.11.7
(`/usr/bin/caddy`, sha256 `678ade3bfc088749c81a681adc603333ee0bb023b6a6cfe3c0f58bef8ff854e9`),
con `caddy.service` y `caddy-api.service` inactivos y deshabilitados.
`publicar-https.sh` **no instala, actualiza ni reinstala Caddy ni ningún
paquete**. Comprueba que el binario es exactamente ese y bloquea si no lo es.
Después valida e instala solo la configuración prevista (`Caddyfile.api-staging`
→ `/etc/caddy/Caddyfile`) y habilita e inicia el `caddy.service` del paquete,
sin modificar su unidad. El procedimiento de instalación de
`deploy/caddy/README.md` es histórico y no se repite.

## Decisiones

- **Solo el nombre de staging.** `Caddyfile.api-staging` tiene un único sitio,
  `api-staging.familiaponquesito.com`, y un único destino, `127.0.0.1:8001`.
  Otro nombre, la IP sin SNI o `api.familiaponquesito.com` no obtienen TLS. Otro
  `Host` por la conexión de staging recibe 421 (`strict_sni_host`). Por HTTP,
  cualquier otro nombre recibe 404. Producción no tiene ruta.
- **Solo las rutas que usa la aplicación:** `/health/`, `/api/v1/internal/*`
  (Bearer, lo exige Django) y `/api/v1/private-images/*` (enlace firmado que
  abre la propietaria desde el correo). Todo lo demás es 404 de Caddy.
- **La credencial es la única barrera de la API.** Las IP de salida de Vercel
  no son fijas, así que no se filtra por origen. La clave interna de staging
  es distinta de la de producción y Django la compara en tiempo constante.
- **Administración de Caddy desactivada** (`admin off`): ningún proceso local
  puede reconfigurarlo por `localhost:2019`. Los cambios se aplican con
  `systemctl restart caddy`; `reload` no funciona sin admin.
- **Cabeceras de proxy fijadas por Caddy:**
  - `X-Forwarded-For` y `X-Real-IP` llevan la IP del par TCP; `Forwarded` se
    elimina.
  - `X-Forwarded-Proto` es `https` y `X-Forwarded-Host`, el nombre real.
  - Los valores que envía el cliente se descartan.
  - Django confía en `X-Forwarded-Proto` solo con
    `DJANGO_BEHIND_HTTPS_PROXY=true`, que es lo único que cambia en su `backend.env`.
- **Cuerpo máximo de 4.500.000 bytes**: cabe la imagen de 4.000.000 bytes con
  sus campos; más, 413 sin llegar a Django. (Un cuerpo `chunked` mayor se corta
  a mitad; Django lo rechaza.)
- **Registros sin secretos:** el acceso y los errores se registran sin el
  parámetro `sig` ni las cabeceras `Authorization` y `Cookie`.
- **Solo Let's Encrypt** (`issuer acme`), sin ZeroSSL de respaldo. Así la ruta
  del certificado es fija y Mailpit lo reutiliza.
- **Sin HTTP/3:** solo h1/h2, así que no se abre 443/udp.
- **Sin AAAA.** El VPS tiene `2a01:4f9:c015:a3dc::1/64` y ruta IPv6, pero el
  acceso por IPv6 desde fuera no está comprobado. Caddy y Mailpit escuchan
  también en IPv6, y UFW abre los puertos para ambas familias, pero sin AAAA
  ese camino no se anuncia.

### Correo de Preview: Mailpit en el VPS

El receptor local del túnel (`test/flujos-staging.e2e.ts`) solo existe
mientras corre la prueba en este equipo; Vercel no lo alcanza. Se propone
**Mailpit 1.31.4** (binario oficial con hash fijado, gratuito) como
`ponquesito-mailpit.service`:

| Requisito | Cómo se cumple |
|---|---|
| Accesible desde Vercel | `api-staging.familiaponquesito.com:465`, TLS implícito con el certificado de Let's Encrypt que obtiene Caddy (systemd lo entrega con `LoadCredential`; un temporizador diario recarga el renovado) |
| Acceso restringido | AUTH obligatoria (usuario `vercel-preview`, contraseña aleatoria guardada como hash SHA-512-crypt), sin AUTH en claro ni SMTP sin TLS. Buzón y API solo en `127.0.0.1:8025`, con otra contraseña y por túnel SSH |
| Sin relay abierto | Mailpit no reenvía: no se configuran `--smtp-relay-*` ni `--smtp-forward-config`, así que el reenvío queda desactivado (`MessageRelay.Enabled=false`) |
| Sin destinatarios reales | `MP_SMTP_ALLOWED_RECIPIENTS=(?i)@example[.]invalid$`: cualquier otro destinatario recibe 550 al hacer `RCPT`. Preview usa `cliente.preview@` y `propietaria.preview@example.invalid` |
| Sin servicios de pago | Software libre en el VPS existente |

Alternativas descartadas:
- **Ethereal**: buzón de un tercero, sin restricción de destinatarios.
- **Mailtrap**: cuenta en un servicio de pago, aunque tenga plan gratuito.
- **Gmail real**: los destinatarios serían reales.

Coste: un puerto más (465/tcp) y un servicio más. Ambos se retiran con
`--retirar`.

## Archivos

| Archivo | Función |
|---|---|
| `../caddy/Caddyfile.api-staging` | Sitio de staging → `127.0.0.1:8001` |
| `publicar-https.sh` | En el VPS con sudo: `--comprobar`, `--aplicar`, `--aplicar-correo`, `--retirar` |
| `ponquesito-mailpit.service`, `ponquesito-mailpit-renovar.{service,timer}` | Unidades del SMTP de pruebas |
| `empaquetar-https.sh` | En local: paquete para `~/fp-staging-https/` (con el tar.gz de Mailpit verificado) |
| `verificar-publico.sh` | En local, solo lectura: DNS por DoH, certificado, API, rutas, aislamiento y puertos |
| `probar-https.sh` | En local: los flujos reales de Next.js por HTTPS, incluida la imagen de 4.000.000 bytes |
| `probar-correo.sh` | En local: el cliente de correo de la app contra Mailpit; buzón por túnel |
| `verificar-imagen-preview.sh` | En local: verifica la prueba de la imagen hecha desde Preview |
| `vercel-preview.env.example` | Variables de Preview para la rama (sin secretos) |
| `test/https/` | Simulación: `preparar-sim.sh`, `instalar-paquete-sim.sh` y `probar-sim.sh`; sin VPS: `regresion-ufw.sh` (control de SSH en UFW) |

## Qué hace `publicar-https.sh`

Primero comprueba, solo en lectura. Si algo no cuadra, termina con código 2 sin
cambiar nada:
- La ubicación (como `preparar-staging.sh`) y el `SHA256SUMS` del paquete.
- El host y Ubuntu 26.04, la IPv4 del VPS, y Caddy 2.11.7 con el hash del VPS
  (`678ade3b…`).
- UFW activo, con entrada deny y SSH permitido. Se lee `ufw status verbose`
  por columnas: la primera regla que afecta a TCP 22 (`22`, `22/tcp`,
  `OpenSSH` o `22/tcp (OpenSSH)`) desde `Anywhere` (IPv4) debe ser `ALLOW IN`.
  DENY, REJECT, LIMIT, una regla de salida, un permiso limitado a un origen
  o solo IPv6 bloquean.
- Staging activo, con `ALLOWED_HOSTS` y su URL pública.
- Caddy en el estado C1: `caddy.service` y `caddy-api.service` inactivos y
  deshabilitados, el Caddyfile de la distribución (`66177d46…`) y 80/443/2019
  libres. También vale nuestra propia configuración ya aplicada.
- Que no haya un Mailpit ajeno.
- DNS tal como lo ve el VPS: solo A → `37.27.149.66` y ningún AAAA.
- Una foto de producción: servicios, puertos, `backend.env`, unidades,
  `/srv/ponquesito` y `pg_hba`.

Después aplica solo lo que falte, y al final compara la foto de producción.

- **`--aplicar`**:
  1. Guarda un respaldo en `/var/backups/ponquesito-staging-https/<UTC>/`
     (root 700) con `/etc/caddy`, `user.rules`, `user6.rules`, `ufw status
     numbered`, `ufw show added`, el `backend.env` de staging y el estado. El
     Caddyfile original queda en `Caddyfile.dist`.
  2. En UFW, `allow 80/tcp` y `allow 443/tcp` con el comentario `fp-staging-https`.
  3. Ejecuta `caddy validate` como el usuario `caddy` y comprueba sobre el JSON
     adaptado que el admin está desactivado y que el único destino es
     `127.0.0.1:8001`. Después instala el Caddyfile, habilita e inicia Caddy y
     espera el certificado.
  4. Pone `DJANGO_BEHIND_HTTPS_PROXY=true` en el env de staging y reinicia
     **solo** `ponquesito-staging-backend`.
  5. Verifica 38 puntos por `127.0.0.1` con el nombre público y el certificado
     verificado: health, HTTP→HTTPS, 401/200 de la API, la cookie no autentica,
     405, firma no válida, cabeceras, 13 rutas no publicadas, 421, TLS para
     otros nombres y por IP, 5 `Host` por HTTP, admin cerrado, que Caddy solo
     escucha en TCP 80 y 443, y que el journal no contiene la firma ni la clave.
- **`--aplicar-correo`** (requiere `--aplicar`):
  1. Crea el usuario `ponquesito-mailpit` e instala el binario fijado en
     `/opt/ponquesito-mailpit`.
  2. Genera dos contraseñas en `~/fp-staging-https/entrega/{smtp,ui}-password`
     (600) y sus hashes en `/etc/ponquesito-mailpit`.
  3. Instala las unidades y un drop-in con `LoadCredential` del certificado.
  4. Abre `allow 465/tcp` en UFW.
  5. Verifica TLS por nombre, envío a `.invalid` aceptado, `gmail.com` → 550,
     sin AUTH → 530, contraseña errónea → 535, SMTP sin TLS sin respuesta,
     buzón y API de envío → 401, relay desactivado y mensaje recibido.
- **`--retirar`**:
  1. Detiene y borra Mailpit (unidades, usuario, binario y buzón sintético).
  2. Vuelve a poner `DJANGO_BEHIND_HTTPS_PROXY=false` y reinicia staging.
  3. Deja Caddy inactivo y deshabilitado, con el Caddyfile de la distribución
     restaurado. Los datos ACME se conservan en `/var/lib/caddy`.
  4. Retira de UFW solo las reglas con el comentario `fp-staging-https`.
  5. Verifica que todo queda en el estado base.

Cada ejecución deja la evidencia en `~/fp-staging-https/evidencia-<UTC>-<modo>/`
y la sella al salir, por cualquier camino.

## Aplicación

Requiere tu autorización para cada servicio externo y tus manos para `sudo`.
Los pasos 1, 6 y 8 son locales.

1. **Local:** estado público antes de tocar nada, y paquete:
   ```bash
   deploy/staging/verificar-publico.sh antes            # zona como el 2026-10-18; api-staging sin registros
   deploy/staging/empaquetar-https.sh <dir-nuevo>
   rsync -a --chmod=D700,F600 -e "ssh -i ~/.ssh/familia_ponquesito" <dir-nuevo>/ wilfredo@37.27.149.66:fp-staging-https/
   ```
2. **Porkbun (DNS):**
   1. Antes de cambiar nada, anota o captura **todos** los registros de la
      zona. Hoy: A del apex `162.159.143.30` y `172.66.3.26`; CNAME de `www` →
      `custom-domains.chatgpt.site`; MX `fwd1`/`fwd2.porkbun.com`; TXT de SPF;
      DNSSEC activo (DS 2371); sin CAA.
   2. Crea **solo** este registro:

      | Tipo | Host | Respuesta | TTL |
      |---|---|---|---|
      | A | `api-staging` | `37.27.149.66` | 600 |

   3. No crees AAAA ni toques el apex, `www`, los MX ni el TXT. Después:
   ```bash
   deploy/staging/verificar-publico.sh dns              # zona igual; api-staging → 37.27.149.66, sin AAAA
   ```
3. **Hetzner Cloud Console:** en Servers → `ubuntu-4gb-hel1-1` → Networking /
   Firewalls, mira si hay un cortafuegos aplicado. Si lo hay, añade entrada
   TCP 80 y 443 desde cualquier origen (IPv4; IPv6 opcional) y anota las
   reglas para poder retirarlas. Si no hay cortafuegos, no se hace nada.
4. **VPS, en tu terminal.** Caddy ya está instalado: no se ejecuta `apt` ni
   se toca la unidad. `--comprobar` verifica el binario fijado y el estado
   C1; `--aplicar` instala solo la configuración:
   ```bash
   cd ~/fp-staging-https
   sudo bash ./publicar-https.sh --comprobar
   sudo bash ./publicar-https.sh --aplicar
   ```
   Si el certificado no llega en 180 s, revisa DNS, Hetzner y `journalctl -u
   caddy`. Una nueva ejecución de `--aplicar` continúa donde quedó, y
   `--retirar` lo deshace.
5. **Local, desde una red independiente (datos del móvil):** valida el
   certificado, la API y el aislamiento de producción, sin `-k`:
   ```bash
   deploy/staging/verificar-publico.sh despues respaldos-privado/staging-vps/secretos/internal-api-key
   ```
   Después, opcionalmente, ejecuta los 8 flujos de Next.js por HTTPS, que
   escriben datos sintéticos en staging:
   ```bash
   deploy/staging/probar-https.sh respaldos-privado/staging-vps/secretos/internal-api-key
   ```
6. **Correo (paso siguiente, no en esta fase):**
   1. Si hay cortafuegos de Hetzner, añade TCP 465.
   2. En el VPS: `sudo bash ./publicar-https.sh --aplicar-correo`.
   3. En local: copia `~/fp-staging-https/entrega/smtp-password` y
      `ui-password` a almacenamiento privado (600) y bórralos del VPS.
   4. Prueba el correo:
   ```bash
   deploy/staging/probar-correo.sh <smtp-password> <ui-password>
   ```
   Para ver el buzón: `ssh -L 18025:127.0.0.1:8025 wilfredo@37.27.149.66` y
   abrir `http://127.0.0.1:18025` (usuario `operador`).
7. **Vercel (paso siguiente):** la sección siguiente.
8. **Prueba de la imagen desde Preview (paso siguiente):** ver más abajo.

## Vercel Preview

Proyecto `familia-ponquesito` (`prj_zxK7…`), equipo `wiljmorales-projects`
(`team_T8pir…`), repositorio público `wiljmorales/familia-ponquesito`. La rama
`feature/supabase-to-django-local` **aún no está en GitHub**.

1. **Revisar las variables de Preview existentes**, las que aplican a todas
   las ramas. Una variable general que no se sobrescribe para la rama llega
   igual a ella. `GEMINI_API_KEY`, SMTP reales, `PONQUESITO_*` de producción y
   `SUPABASE_*` no deben estar en Preview: hay que dejarlas solo en Production.
2. **Variables de Preview solo para la rama**: las de
   `vercel-preview.env.example`, con los secretos marcados como Sensitive:
   - la clave de staging;
   - la contraseña SMTP de pruebas;
   - un `CRON_SECRET` nuevo, generado con `openssl rand -hex 32` y guardado en
     almacenamiento privado.

   Hay que crearlas **antes del primer push**: el push despliega
   automáticamente con las variables que haya en ese momento.
3. **Protección de despliegue:** Settings → Deployment Protection → Vercel
   Authentication con **Standard Protection**. Así, Preview, incluido el alias
   de rama, solo se abre con una sesión de Vercel con acceso al equipo. Está
   disponible en todos los planes. No se usa Password Protection: no existe en
   Hobby y en Pro es de pago.
4. **Primer despliegue:** `git push -u origin feature/supabase-to-django-local`.
   Es un repositorio **público**: queda publicado el código de la rama, que
   no contiene secretos.
5. **Origen canónico estable:** el alias de rama
   `familia-ponquesito-git-<rama>-wiljmorales-projects.vercel.app`. Supera 63
   caracteres, así que Vercel lo recorta con un hash; se lee en el
   despliegue, en «Domains». Pon `APP_CANONICAL_URL=https://<alias>` (solo
   para la rama) y **redespliega**. No hay dominio propio para Preview: haría
   falta otro registro DNS, fuera de esta fase.
6. **Comprobar:** Preview sin sesión → página de Vercel Authentication; con
   sesión, la portada. El cron de `vercel.json` no se ejecuta en Preview.

### Prueba de la imagen de 4.000.000 bytes

El límite real de Vercel es de 4,5 MB por petición a una función.
`bodySizeLimit` de Next.js es 4.200.000 bytes; Caddy acepta 4.500.000 y Django
admite imágenes de hasta 4.000.000 bytes.

```bash
node deploy/staging/test/png-exacto.mjs /tmp/maxima.png      # PNG válido de exactamente 4.000.000 bytes; imprime su sha256
date -u +%Y-%m-%dT%H:%M:%SZ                                   # hora de inicio (<desde>)
```

1. En el alias de Preview, con sesión de Vercel, rellena el formulario de
   solicitud con el correo `cliente.preview@example.invalid`.
2. Adjunta `/tmp/maxima.png` y envía. Debe confirmarse sin error.
3. Opcional: un archivo de 4.000.001 bytes debe rechazarse en el formulario
   («supera el máximo de 4 MB»).
4. Verifica:
   ```bash
   deploy/staging/verificar-imagen-preview.sh <ui-password> /tmp/maxima.png <desde>
   ```
   Comprueba el correo a la clienta y el aviso a la propietaria en el buzón de
   pruebas (por túnel). Después descarga la imagen por el enlace firmado,
   por HTTPS público con certificado verificado, y la compara byte a byte
   (200, `no-store`). No muestra el enlace.
5. Repite los flujos del túnel desde Preview: diseño, agenda (reserva, enlace
   privado, reprogramación, cancelación) y recuperación del enlace. Sus
   correos se ven en el buzón.

## Retirada

En este orden. Ninguno de estos pasos toca producción.

1. **Vercel:** borra las variables de la rama o quita la rama; la protección
   puede quedarse.
2. **VPS:** `sudo bash ./publicar-https.sh --retirar`.
3. **Hetzner:** retira las reglas 80, 443 y 465 que añadiste, si las hubo.
4. **Porkbun:** borra el A `api-staging`. Pasado el TTL (600 s),
   `deploy/staging/verificar-publico.sh antes` debe dar todo OK.

## Probado

En la simulación del VPS:
- Ubuntu 26.04 con systemd, el `.deb` oficial de Caddy 2.11.7 (mismo binario
  que el VPS) en estado C1, UFW con entrada deny y SSH permitido.
- La IPv4 del VPS en una interfaz ficticia.
- Pebble, el ACME de pruebas de Let's Encrypt, validando de verdad.

`test/https/probar-sim.sh` lo hace todo desde cero. En la simulación, la
regla SSH se crea como en el VPS, con el perfil (`ufw allow OpenSSH`). Su variante de paquete
solo añade `acme_ca` de Pebble al Caddyfile, y lo comprueba.

- `regresion-ufw.sh`, 20 casos con la salida exacta de `ufw status verbose`
  del VPS. Origen: el primer `--comprobar` real bloqueó con «UFW no muestra
  SSH», porque la expresión anterior no aceptaba `22/tcp (OpenSSH)`.
- Bloqueos con código 2, sin cambios en UFW, Caddy, puertos, staging ni Mailpit,
  y sin respaldos:
  - DNS sin A o con AAAA;
  - UFW inactivo, sin SSH, SSH solo desde un origen o con DENY antes del permiso;
  - Caddyfile ajeno;
  - puerto 80 ocupado;
  - paquete manipulado;
  - `--aplicar-correo` antes de `--aplicar`.
- `--aplicar` y su repetición sin cambios. `--comprobar` después vuelve a
  verificar los 38 puntos.
- Desde fuera del contenedor:
  - Solo 22, 80, 443 (y 465 con correo) accesibles; 2019, 3000, 5432, 8000,
    8001 y 8025 cerrados.
  - Certificado verificado y HTTP→HTTPS.
  - Cabeceras de proxy con la IP real (las falsificadas se descartan).
  - 4.500.000 bytes pasan y 4.500.001 dan 413.
  - Con el backend caído, 503 sin la firma en el journal.
  - HTTP-01 a través del bloque `http://`; el despliegue normal usó TLS-ALPN-01.
- `verificar-publico.sh despues`, en modo simulación.
- Los 8 flujos de Next.js por HTTPS a través de Caddy, incluida la imagen de
  4.000.000 bytes, descargada idéntica.
- `--aplicar-correo` y su repetición:
  - el cliente de correo real de la app (nodemailer con `secure: true`) entrega
    a `.invalid` y es rechazado para `example.com`;
  - el buzón se revisa por túnel;
  - el temporizador de renovación reinicia Mailpit.
- **Preview simulada:** la Server Action con las variables de
  `vercel-preview.env.example`, la imagen máxima y los correos por Mailpit;
  `verificar-imagen-preview.sh` la descarga idéntica.
- `--retirar`, dos veces: UFW, Caddyfile, unidades y puertos vuelven al
  estado inicial, y los datos ACME se conservan. Después funcionan una nueva
  aplicación y otra retirada.
- La producción simulada (8000/3000) no recibió ninguna petición en toda la
  prueba, y su foto es idéntica antes y después de cada ejecución.

No probado: Let's Encrypt real, el DNS público, el cortafuegos de Hetzner, el
acceso por IPv6, Vercel (despliegue, variables, protección y salida a 465) ni
el VPS real.

## Accesos pendientes

No se piden contraseñas ni secretos por el chat.

| Para | Falta | Consultado en solo lectura |
|---|---|---|
| DNS | Sesión en Porkbun para ver la zona y crear o borrar `api-staging` | Sin acceso: no hay API key ni CLI. Visto el DNS público por DoH (arriba) |
| Cortafuegos de red | Hetzner Cloud Console (o un token de API de solo lectura) para saber si hay un cortafuegos aplicado al servidor | Sin acceso: no hay `hcloud` ni token |
| VPS | Tu terminal con `sudo` para `publicar-https.sh` | SSH de `wilfredo` sin sudo: Caddy 2.11.7 inactivo/deshabilitado, Caddyfile de la distribución, puertos, IPv6 configurada; `user.rules` de UFW no es legible sin sudo |
| Vercel | Sesión en el dashboard, o `vercel login` (la CLI no está instalada y no hay token), para revisar y crear las variables de Preview, activar la protección y leer el alias | IDs del proyecto y del equipo en `.vercel/project.json`; equipo `wiljmorales-projects` y despliegues anteriores por la API de GitHub |
| GitHub | Autorizar el push de la rama al repositorio público | `gh` autenticado como `wiljmorales`; la rama no está publicada |
