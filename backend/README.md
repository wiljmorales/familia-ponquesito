# Backend Django — base mínima

Base de Django con PostgreSQL en el VPS de Hetzner. En esta etapa solo hay
un endpoint, `/health/`. No incluye módulos de negocio, Django Admin ni
datos de Supabase. El frontend Next.js de la raíz no cambia.

## Versiones

Las versiones se eligieron con la documentación oficial, consultada el
2026-10-08.

| Pieza | Versión | Motivo |
|---|---|---|
| Django | 5.2.18 (LTS) | Es el LTS vigente, con soporte extendido hasta abril de 2028. El siguiente LTS, 6.2, sale en abril de 2027. |
| Python (VPS) | 3.14 (sistema, Ubuntu 26.04) | Django 5.2 lo soporta desde la 5.2.8. |
| Python (local) | 3.10 | También está soportado por Django 5.2. |
| PostgreSQL | 18 (paquete `postgresql-18` de Ubuntu) | Django 5.2 exige PostgreSQL 14 o superior. |
| Gunicorn | 26.2.0 | Es la última versión, verificada con `pip index` el 2026-10-08. Requiere Python 3.10 o superior, no tiene dependencias obligatorias e implementa `sd_notify` para `Type=notify`. Sus metadatos declaran hasta Python 3.13, pero es Python puro; se comprobó en el VPS con 3.14. El socket de control (desde 25.1) está desactivado: systemd gestiona el servicio con señales. |
| psycopg | 3.3.6 (`psycopg[binary]`) | Es el driver recomendado por Django; psycopg2 va camino de quedar obsoleto. |

Todas las dependencias, incluidas las transitivas, están fijadas en
`requirements.txt`. Los paquetes se instalan siempre dentro de un entorno
virtual, nunca de forma global.

## Configuración

`config/settings.py` lee todo de variables de entorno. Hay una plantilla en
`.env.example`.

En el VPS, los secretos viven en `/srv/ponquesito/backend.env`, fuera de Git.
Tiene permisos `640` y pertenece a `<admin>:ponquesito`: el administrador lo edita
y el grupo del servicio lo lee, pero no es público. Esa copia es la única:
no hay otra en el repositorio ni en el equipo local.

- Si falta `DJANGO_SECRET_KEY` o alguna credencial de PostgreSQL, Django no
  arranca.
- `DEBUG` está desactivado por defecto.
- `DJANGO_ALLOWED_HOSTS` es obligatoria y no tiene valor por defecto. En el
  VPS vale `127.0.0.1,localhost`.

## PostgreSQL en el VPS

- Escucha solo en `localhost` (`127.0.0.1` y `::1`). Usa scram-sha-256 para
  TCP y peer para el socket local.
- El rol `ponquesito_app` es `LOGIN` y no tiene superusuario, `CREATEDB`,
  `CREATEROLE`, replicación ni `BYPASSRLS`.
- La base `ponquesito` pertenece a `ponquesito_app`, y se le quitó todo
  acceso a `PUBLIC`.

## Desarrollo local

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
DJANGO_SECRET_KEY=dev DJANGO_ALLOWED_HOSTS=localhost POSTGRES_DB=x POSTGRES_USER=x POSTGRES_PASSWORD=x \
  .venv/bin/python manage.py check
```

Para correr el servidor en local hace falta un PostgreSQL local, o bien
apuntar las variables a uno.

## Despliegue en el VPS

### Estructura

| Ruta | Dueño y permisos | Contenido |
|---|---|---|
| `/srv/ponquesito` | `<admin>:ponquesito`, `2750` (setgid) | Raíz del despliegue. Lo que se crea dentro hereda el grupo. |
| `/srv/ponquesito/backend` | `<admin>:ponquesito`, el grupo solo lee | Código del commit desplegado y su `REVISION`. |
| `/srv/ponquesito/venv` | `<admin>:ponquesito`, el grupo solo lee | Venv con `requirements.txt`. |
| `/srv/ponquesito/backend.env` | `<admin>:ponquesito`, `640` | Secretos. |

- **`ponquesito`:** usuario de servicio del sistema. No tiene shell ni
  directorio personal, no tiene sudo y su grupo no incluye a nadie más.
- **`<admin>`:** administrador. Despliega sin sudo y solo necesita sudo
  para gestionar la unidad.
- **Otros usuarios:** no pueden entrar en `/srv/ponquesito`.

### Servicio

- La unidad es `deploy/ponquesito-backend.service`.
- Gunicorn 26.2.0 corre como `ponquesito`, con 3 workers, en
  `127.0.0.1:8000`.
- Está habilitada para arrancar con el sistema (`enable`), aunque **no se
  ha probado reiniciando el VPS** después de instalarla. También se reinicia
  sola si falla (`Restart=on-failure`) y envía los logs a journald.
- Aislamiento:
  - `NoNewPrivileges`, sin capacidades.
  - Sistema de archivos de solo lectura (`ProtectSystem=strict`).
  - Sin acceso a `/home`, con `/tmp` privado.

### Instalación inicial (una vez)

En los ejemplos, `<admin>` es el usuario administrador del VPS (con sudo y
acceso SSH por llave) y `<host>` es la IP o el nombre del servidor. Los pasos
con `sudo` los ejecuta el administrador en su propia terminal.

```bash
# 1. VPS (sudo): usuario de servicio y directorio
sudo adduser --system --group --no-create-home --home /nonexistent \
  --shell /usr/sbin/nologin ponquesito
sudo install -d -m 2750 -o <admin> -g ponquesito /srv/ponquesito
sudo install -m 640 -o <admin> -g ponquesito /dev/null /srv/ponquesito/backend.env
# Rellena backend.env a partir de .env.example como <admin>, con un editor
# (nunca en Git ni en un chat). Genera DJANGO_SECRET_KEY y la contraseña con
#   python3 -c 'import secrets; print(secrets.token_urlsafe(50))'

# 2. Equipo local: código, venv, check y migraciones (sin sudo)
VPS_HOST=<admin>@<host> backend/scripts/sync-to-vps.sh

# 3. VPS (sudo): instalar, validar y arrancar la unidad
sudo install -m 644 -o root -g root /srv/ponquesito/backend/deploy/ponquesito-backend.service \
  /etc/systemd/system/ponquesito-backend.service
sudo systemd-analyze verify /etc/systemd/system/ponquesito-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now ponquesito-backend
```

La base de datos y su rol se crean antes, como se describe en
[PostgreSQL en el VPS](#postgresql-en-el-vps):

```bash
sudo -u postgres psql
-- dentro de psql, con la contraseña de backend.env:
CREATE ROLE ponquesito_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '<contraseña>';
CREATE DATABASE ponquesito OWNER ponquesito_app ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE ponquesito FROM PUBLIC;
```

### Actualización

```bash
VPS_HOST=<admin>@<host> backend/scripts/sync-to-vps.sh   # equipo local
sudo systemctl reload ponquesito-backend       # VPS: el código nuevo entra sin cortar el servicio (ExecReload → HUP; aún no ejecutado)
sudo systemctl restart ponquesito-backend      # VPS: si cambiaron dependencias o la configuración de Gunicorn
```

Si cambia la unidad, hay que repetir el `install` del paso 4 y después
ejecutar `sudo systemctl daemon-reload` y
`sudo systemctl restart ponquesito-backend`.

### Diagnóstico

```bash
systemctl status ponquesito-backend --no-pager
journalctl -u ponquesito-backend -n 50 --no-pager
curl -s http://127.0.0.1:8000/health/
```

### Reversión

- **A un commit anterior:** `VPS_HOST=<admin>@<host> backend/scripts/sync-to-vps.sh <commit>` y
  después `sudo systemctl restart ponquesito-backend`. Las migraciones no se
  revierten solas; si hiciera falta, se usa `manage.py migrate <app> <migración>`.
- **Retirar el servicio por completo:**
  ```bash
  sudo systemctl disable --now ponquesito-backend
  sudo rm /etc/systemd/system/ponquesito-backend.service
  sudo systemctl daemon-reload
  ```
  `/srv/ponquesito`, la base de datos y el usuario `ponquesito` se conservan.
  Si también hay que quitarlos: `sudo rm -r /srv/ponquesito` (incluye los
  secretos) y `sudo deluser --system ponquesito`.

### Túnel SSH

Desde el equipo local, deja esta terminal abierta:

```bash
ssh -N -L 8000:127.0.0.1:8000 <admin>@<host>
```

Después abre http://127.0.0.1:8000/health/. Debe responder
`{"status": "ok", "database": "ok"}`.

El backend no se publica todavía. Eso requiere su propia etapa: proxy con
HTTPS, DNS y, entonces sí, abrir 80/443 en el firewall.

## Verificación (2026-10-08)

Resultados de la instalación inicial. El registro detallado, con datos
reales del servidor, se guarda fuera del repositorio.

- **Django:** `manage.py check` no encontró problemas. `check --deploy` solo
  dio los 4 avisos de HTTPS (W004, W008, W012 y W016), esperables mientras
  el acceso sea por túnel. `migrate` aplicó las migraciones iniciales de
  `auth`, `contenttypes` y `sessions`, y `migrate --check` no encuentra
  pendientes.
- **Conexión real:** como `ponquesito_app`, por 127.0.0.1, sin superusuario,
  a PostgreSQL 18.6.
- **Venv:** contiene exactamente lo fijado en `requirements.txt`, y no hay
  pip global.
- **Unidad:**
  - `systemd-analyze verify` correcto.
  - `active` y `enabled`, con `Type=notify`.
  - Un maestro y 3 workers como `ponquesito`, escuchando solo en
    `127.0.0.1:8000`.
- **`/health/`:** responde 200 `{"status": "ok", "database": "ok"}` en el
  VPS y por túnel SSH.
  - `DEBUG=False`.
  - Con un `Host` ajeno responde 400.
  - Con una ruta inexistente da un 404 genérico, y `/admin/` también 404.
- **`sudo systemctl restart`:** probado dos veces. El PID cambió, el servicio
  volvió a `active` y `/health/` respondió 200.
- **Error del socket de control:** en el primer arranque, Gunicorn registró
  `Control server error: Read-only file system: '/nonexistent'`. Su socket
  de control (versión 25.1 o posterior) busca `$HOME`, y el usuario de
  servicio no tiene. Se desactivó con `control_socket_disable = True`, y el
  error no volvió a aparecer.
- **No verificado todavía:**
  - `systemctl reload` (HUP): está configurado, pero no se ha ejecutado.
  - Arranque automático: la unidad está `enabled`, pero no se ha probado con
    un reinicio del VPS posterior a la instalación.
  - Prueba externa de puertos: solo se hizo desde una red local que
    intercepta el puerto 80, así que no es concluyente. No hay verificación
    desde una red independiente.
