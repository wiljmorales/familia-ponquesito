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
  - el resultado es `ponquesito-web-<commit>.tar.gz` más su `.sha256`.
- **`deploy-to-vps.sh`** (en tu PC) construye el artefacto, lo sube y lo
  activa. `VPS_HOST` es obligatoria y `DRY_RUN=1` no conecta.
- **`bootstrap.sh`** (en el VPS, con sudo, una vez) crea el usuario, los
  directorios, `web.env` vacío, el script de releases y la unidad.
- **`release.sh`** (en el VPS, como `/usr/local/sbin/ponquesito-web-release`)
  instala, activa, revierte y limpia releases.
- **`test/run-local.sh`** prueba todo lo anterior sin SSH ni root.

## Artefacto

```
ponquesito-web-<commit>/
  server.js              servidor standalone de Next.js
  package.json
  node_modules/          solo lo que Next.js trazó (incluye sharp para linux x64)
  .next/                 servidor compilado, manifiestos y .next/static
  public/                landing, /linktree y sus recursos
  src/knowledge/familia-ponquesito.md   la lee el asistente en runtime
  REVISION  NODE_VERSION  BUILD_INFO
```

No contiene `.git`, `backend/`, `.env*`, credenciales, `.next/cache` ni
rutas locales: `build-artifact.sh` se niega a empaquetar si aparece algo de
eso, y `release.sh` vuelve a comprobarlo antes de instalar. El build corre
en `/tmp/ponquesito-web-build/<commit>` porque Next.js graba la ruta del
proyecto en `server.js`.

`output: "standalone"` solo se activa con `PONQUESITO_STANDALONE=1`, que
pone `build-artifact.sh`. Vercel compila sin esa variable, igual que antes.

## Variables

Detalle en [`.env.example`](.env.example).

- **Build** (en tu PC, `BUILD_ENV_FILE=<archivo fuera de Git>`): solo se
  leen `APP_CANONICAL_URL` y `NEXT_PUBLIC_WHATSAPP_URL`. Quedan grabadas en
  el artefacto; cambiarlas exige recompilar.
- **Runtime** (`/etc/ponquesito/web.env`): `APP_CANONICAL_URL` (debe
  coincidir con la del build), `NEXT_PUBLIC_SUPABASE_URL` (solo la lee el
  servidor), Supabase, Gemini, SMTP y `CRON_SECRET`.
- **Ninguna es necesaria para arrancar.** Sin ellas las páginas cargan y,
  en producción:
  - el formulario, la agenda y las reservas fallan;
  - `/api/assistant` falla de forma explícita;
  - el correo registra el error, sin simular el envío;
  - `/api/reports/weekly` responde 503.
- **`HOSTNAME`, `PORT` y `NODE_ENV` los fija la unidad.** `web.env` no
  puede redefinirlos, porque `EnvironmentFile` tendría prioridad.
  `release.sh` se niega a activar si los encuentra.

## Prerrequisitos en el VPS

- **Node exacto de `.nvmrc`** en `/opt/ponquesito/node/bin/node`:
  - es el binario oficial de nodejs.org para linux-x64;
  - se instala a mano, sin `curl | bash` ni gestores de versiones;
  - antes de instalarlo, verifica el `.tar.xz` contra `SHASUMS256.txt` y la
    firma de ese archivo con las claves publicadas por el proyecto Node.js.

  ```
  sudo tar -xJf node-v<versión>-linux-x64.tar.xz -C /opt/ponquesito
  sudo ln -sfn node-v<versión>-linux-x64 /opt/ponquesito/node
  /opt/ponquesito/node/bin/node --version
  ```
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
4. Opcional: rellena `/etc/ponquesito/web.env` con `sudoedit`. Staging
   arranca sin nada.
5. Despliega desde tu PC:
   ```
   VPS_HOST=<admin>@<host> DRY_RUN=1 deploy/web/deploy-to-vps.sh
   VPS_HOST=<admin>@<host> deploy/web/deploy-to-vps.sh
   ```

## Despliegue y reversión

`deploy-to-vps.sh` sube el artefacto a `~/ponquesito-web-incoming/` y
ejecuta `sudo ponquesito-web-release deploy`, que hace lo siguiente:

1. **Verifica el artefacto:**
   - el SHA-256;
   - el nombre y `REVISION`;
   - que no haya enlaces, rutas fuera del directorio ni archivos prohibidos;
   - que la versión de Node coincida.
2. **Lo instala en `releases/<commit>`:**
   - root es el dueño y el grupo `ponquesito-web` solo lee;
   - `.next/cache` apunta a `/var/cache/ponquesito-web/<commit>`.
3. **Activa el release:**
   - cambia `current` de forma atómica (symlink temporal y `rename`);
   - reinicia el servicio;
   - comprueba durante 30 s que `/linktree`, `/`, el favicon y el logo
     responden 200 y que el puerto solo escucha en loopback.
4. **Según el resultado:**
   - **si pasa**, `previous` apunta al release que estaba activo;
   - **si falla**, restaura `current`, reinicia de nuevo y sale con error;
     el release fallido queda instalado pero inactivo.
5. **Limpia:** conserva los 3 releases más recientes, y siempre `current`
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
deploy/web/test/run-local.sh            # construye el artefacto de HEAD
ARTIFACT=<tarball> deploy/web/test/run-local.sh
```

La prueba hace cuatro cosas:

1. Valida la sintaxis de los scripts y la unidad, y los modos dry-run.
2. Revisa el contenido del artefacto.
3. Arranca el servidor standalone en un puerto temporal de `127.0.0.1`:
   - sin variables de la app;
   - con el release de solo lectura;
   - comprueba las rutas públicas, los 404 de `/backend/`, `/health/` y
     `/api/v1/*`, y la caché de imágenes externa.
4. Ejecuta `release.sh` con un servicio local para comprobar:
   - el despliegue;
   - el rollback automático y el manual;
   - los rechazos;
   - la limpieza.
