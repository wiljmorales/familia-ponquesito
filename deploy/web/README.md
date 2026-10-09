# Next.js en el VPS

Despliegue del frontend Next.js como servidor standalone detrás de Caddy.
**Preparado y probado en local; no se ha instalado en ningún servidor.**

| Pieza | Valor |
|---|---|
| Servicio systemd | `ponquesito-web` ([`ponquesito-web.service`](ponquesito-web.service)) |
| Usuario de servicio | `ponquesito-web` (sistema, sin login, sin home, sin sudo) |
| Escucha | solo `127.0.0.1:3000`; Caddy es el único punto público |
| Releases | `/opt/ponquesito/web/releases/<commit>` (root, solo lectura para el servicio) |
| Release activo | `/opt/ponquesito/web/current` → `releases/<commit>` |
| Release anterior | `/opt/ponquesito/web/previous` → `releases/<commit>` |
| Variables | `/etc/ponquesito/web.env` (root, 600; plantilla [`.env.example`](.env.example)) |
| Caché de Next | `/var/cache/ponquesito-web/<commit>` (única escritura del servicio) |
| Node | `/opt/ponquesito/node/bin/node`, versión exacta de `.nvmrc` |

El contrato de rutas no cambia (ver [`deploy/caddy/README.md`](../caddy/README.md)):
Django atiende `/health/` y `/api/v1/*`; Next.js, `/`, `/linktree` y todo lo
demás.

## Archivos

- **`build-artifact.sh`** (en tu PC) construye el artefacto de un commit:
  - parte de un checkout limpio (`git worktree`) con `npm ci` y un entorno vacío;
  - exige `BUILD_ENV_FILE` con `APP_CANONICAL_URL`
    (staging: [`staging.build.env`](staging.build.env));
  - el resultado es `ponquesito-web-<commit12>-<build12>.tar.gz` más su
    `.sha256`.
- **`deploy-to-vps.sh`** (en tu PC) construye el artefacto, lo sube y lo
  activa. `VPS_HOST` es obligatoria y `DRY_RUN=1` no conecta.
- **`bootstrap.sh`** (en el VPS, con sudo, una vez) crea el usuario, los
  directorios, `web.env` vacío, el script de releases y la unidad.
- **`release.sh`** (en el VPS, como `/usr/local/sbin/ponquesito-web-release`)
  instala, activa, revierte y limpia releases.
- **`test/run-local.sh`** prueba todo lo anterior sin SSH ni root.

## Artefacto

```
ponquesito-web-<commit12>-<build12>/
  server.js              servidor standalone de Next.js
  package.json
  node_modules/          solo lo que Next.js trazó (incluye sharp para linux x64)
  .next/                 servidor compilado, manifiestos y .next/static
  public/                landing, /linktree y sus recursos
  src/knowledge/familia-ponquesito.md   la lee el asistente en runtime
  REVISION               commit completo
  NODE_VERSION           versión de .nvmrc
  BUILD_ENV              variables de build (públicas), en orden fijo
  BUILD_INFO             commit, node, canonical_url, build_fingerprint
```

**Identidad.** `<build12>` son los 12 primeros caracteres del SHA-256 de
`BUILD_ENV`. Un mismo commit compilado con otra URL canónica u otro
WhatsApp produce otro nombre, otro release y otra caché. `BUILD_ENV` solo
lleva variables de build, que ya son públicas en el bundle; nunca valores de
runtime ni secretos. `release.sh` comprueba antes de activar que `REVISION`,
`BUILD_ENV` y `BUILD_INFO` coinciden con el nombre.

No contiene `.git`, `backend/`, `.env*`, credenciales, `.next/cache` ni
rutas locales: `build-artifact.sh` se niega a empaquetar si aparece algo de
eso, y `release.sh` vuelve a comprobarlo antes de instalar. El build corre
en `/tmp/ponquesito-web-build/<commit12>-<build12>` porque Next.js graba la
ruta del proyecto en `server.js`.

`output: "standalone"` solo se activa con `PONQUESITO_STANDALONE=1`, que
pone `build-artifact.sh`, y entonces `next.config.ts` exige
`APP_CANONICAL_URL`. Vercel compila sin esa variable, igual que antes.

## Variables

Detalle en [`.env.example`](.env.example).

- **Build** (en tu PC, `BUILD_ENV_FILE=<archivo>`): solo se leen
  `APP_CANONICAL_URL` (obligatoria) y `NEXT_PUBLIC_WHATSAPP_URL`. Quedan
  grabadas en el artefacto y lo identifican; cambiarlas exige recompilar.
- **Runtime** (`/etc/ponquesito/web.env`): `APP_CANONICAL_URL` (obligatoria
  e idéntica a la del build), `NEXT_PUBLIC_SUPABASE_URL` (solo la lee el
  servidor), Supabase, Gemini, SMTP y `CRON_SECRET`.
- **URL canónica de staging:** `https://staging.familiaponquesito.com`, en
  `staging.build.env` y en `web.env`. No hay caída silenciosa a la URL de
  Vercel: el build falla sin ella y el release no se activa si `web.env` no
  tiene exactamente la misma.
- **Del resto, ninguna es necesaria para arrancar.** Sin ellas las páginas
  cargan y, en producción:
  - el formulario, la agenda y las reservas fallan;
  - `/api/assistant` falla de forma explícita;
  - el correo registra el error, sin simular el envío;
  - `/api/reports/weekly` responde 503.
- **`HOSTNAME`, `PORT` y `NODE_ENV` los fija la unidad.** `web.env` no
  puede redefinirlos, porque `EnvironmentFile` tendría prioridad.
  `release.sh` se niega a activar si los encuentra.

## Prerrequisitos en el VPS

- **Node exacto de `.nvmrc` (22.23.3 LTS)** en `/opt/ponquesito/node/bin/node`:
  - es el binario oficial de nodejs.org para linux-x64;
  - se instala a mano, sin `curl | bash` ni gestores de versiones;
  - `/opt/ponquesito/node` es un symlink estable al directorio de la versión:
    la unidad no cambia al actualizar Node;
  - antes de instalarlo, se verifica la firma de `SHASUMS256.txt` con las
    claves de los releasers de Node.js
    ([nodejs/release-keys](https://github.com/nodejs/release-keys)) y el
    `.tar.xz` contra ese archivo.

  En tu PC, en un directorio vacío:
  ```
  V=v22.23.3
  curl -fO https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz
  curl -fO https://nodejs.org/dist/$V/SHASUMS256.txt
  curl -fO https://nodejs.org/dist/$V/SHASUMS256.txt.sig
  curl -fL -o pubring.kbx https://github.com/nodejs/release-keys/raw/HEAD/gpg-only-active-keys/pubring.kbx
  gpgv --keyring ./pubring.kbx SHASUMS256.txt.sig SHASUMS256.txt   # "Good signature"
  grep " node-$V-linux-x64.tar.xz\$" SHASUMS256.txt | sha256sum -c
  ```
  Súbelos (sin sudo) y vuelve a comprobar el SHA-256 en el VPS:
  ```
  scp node-v22.23.3-linux-x64.tar.xz SHASUMS256.txt <admin>@<host>:ponquesito-web-setup/
  ssh <admin>@<host> 'cd ~/ponquesito-web-setup && grep " node-v22.23.3-linux-x64.tar.xz$" SHASUMS256.txt | sha256sum -c'
  ```
  Instálalo (sudo):
  ```
  sudo install -d -o root -g root -m 755 /opt/ponquesito
  sudo tar --no-same-owner -xJf ~/ponquesito-web-setup/node-v22.23.3-linux-x64.tar.xz -C /opt/ponquesito
  sudo ln -sfn node-v22.23.3-linux-x64 /opt/ponquesito/node
  /opt/ponquesito/node/bin/node --version    # v22.23.3
  ```
  Para cambiar de versión, se instala la nueva junto a la anterior y se mueve
  el symlink. Los releases construidos con otra versión no se activan
  (`release.sh` compara `NODE_VERSION`).
- **Arquitectura:** el artefacto trae `sharp` para linux x64 (glibc y musl),
  así que el VPS debe ser x86_64. Si fuera ARM, habría que compilar en ARM.
- **Herramientas:** `curl`, `ss`, `tar` y `sha256sum` (vienen con Ubuntu).
- **Caddy instalado según `deploy/caddy/README.md`** (staging primero).

## Primera instalación (requiere sudo)

1. Copia `deploy/web/` y `.nvmrc` al VPS. No hace falta sudo:
   ```
   git archive HEAD deploy/web .nvmrc | ssh <admin>@<host> 'rm -rf ~/ponquesito-web-setup && mkdir -p ~/ponquesito-web-setup && tar -x -C ~/ponquesito-web-setup'
   ```
2. Revisa qué haría el bootstrap y después ejecútalo:
   ```
   ssh -t <admin>@<host> 'sudo bash ~/ponquesito-web-setup/deploy/web/bootstrap.sh --dry-run'
   ssh -t <admin>@<host> 'sudo bash ~/ponquesito-web-setup/deploy/web/bootstrap.sh'
   ```
3. Instala Node (ver Prerrequisitos).
4. Con `sudoedit /etc/ponquesito/web.env`, define `APP_CANONICAL_URL` con
   el mismo valor que `staging.build.env`. El resto es opcional.
5. Despliega desde tu PC:
   ```
   VPS_HOST=<admin>@<host> BUILD_ENV_FILE=deploy/web/staging.build.env DRY_RUN=1 deploy/web/deploy-to-vps.sh
   VPS_HOST=<admin>@<host> BUILD_ENV_FILE=deploy/web/staging.build.env deploy/web/deploy-to-vps.sh
   ```

## Despliegue y reversión

`deploy-to-vps.sh` sube el artefacto a `~/ponquesito-web-incoming/` y
ejecuta `sudo ponquesito-web-release deploy`, que hace lo siguiente:

1. **Verifica el artefacto:**
   - el SHA-256;
   - el nombre y su identidad (`REVISION`, `BUILD_ENV`, `BUILD_INFO`);
   - que no haya enlaces, rutas fuera del directorio ni archivos prohibidos;
   - que la versión de Node coincida.
2. **Lo instala en `releases/<commit12>-<build12>`:**
   - root es el dueño y el grupo `ponquesito-web` solo lee;
   - `.next/cache` apunta a `/var/cache/ponquesito-web/<commit12>-<build12>`.
3. **Comprueba `web.env`** antes de tocar `current`, y si algo falla se
   detiene sin cambiar nada:
   - `APP_CANONICAL_URL` es exactamente la de `BUILD_INFO`; si hay varias
     líneas, cuenta la última, como en systemd;
   - no redefine `HOSTNAME`, `PORT` ni `NODE_ENV`.
4. **Activa el release:**
   - cambia `current` de forma atómica (symlink temporal y `rename`);
   - reinicia el servicio;
   - comprueba durante 30 s que `/linktree`, `/`, el favicon y el logo
     responden 200 y que el puerto solo escucha en loopback.
5. **Según el resultado:**
   - **si pasa**, `previous` apunta al release que estaba activo;
   - **si falla**, restaura `current`, reinicia de nuevo y sale con error;
     el release fallido queda instalado pero inactivo.
6. **Limpia:** conserva los 3 releases más recientes, y siempre `current`
   y `previous`.

Reversión manual (alterna entre `current` y `previous`):

```
ssh -t <admin>@<host> 'sudo ponquesito-web-release rollback'
ssh -t <admin>@<host> 'sudo ponquesito-web-release status'
```

Si se cambió Node en el VPS, los releases construidos con otra versión no se
activan. Para volver a uno de ellos, primero hay que reinstalar su Node.

Desactivar el servicio por completo: `sudo systemctl disable --now ponquesito-web`.
Con Next.js parado, Caddy responde 503 en staging.

## Prueba local

```
nvm use
deploy/web/test/run-local.sh            # construye dos artefactos de HEAD
ARTIFACT=<staging> ARTIFACT2=<otra-url> deploy/web/test/run-local.sh
```

La prueba hace cuatro cosas:

1. Valida la sintaxis de los scripts y la unidad, y los modos dry-run.
2. Comprueba la URL canónica y el artefacto:
   - el build rechaza la URL ausente o mal formada sin llegar a compilar;
   - dos builds del mismo commit (staging y una URL ficticia) no colisionan;
   - el contenido del artefacto y su identidad son los esperados.
3. Arranca el servidor standalone en un puerto temporal de `127.0.0.1`:
   - solo con `APP_CANONICAL_URL`;
   - con el release de solo lectura;
   - comprueba las rutas públicas, los 404 de `/backend/`, `/health/` y
     `/api/v1/*`, y la caché de imágenes externa.
4. Ejecuta `release.sh` con un servicio local para comprobar:
   - la URL de runtime ausente, distinta o correcta;
   - un artefacto con la identidad alterada;
   - el despliegue;
   - el rollback automático y el manual;
   - los rechazos;
   - la limpieza.
