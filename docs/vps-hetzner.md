# VPS: arquitectura y procedimientos

El backend de Familia Ponquesito corre en un VPS de Hetzner Cloud con
Ubuntu 26.04 LTS, 2 vCPU y 4 GB de RAM. Este documento describe cómo se
configuró y cómo repetirlo.

Los datos operativos reales (IP, usuarios, huellas, rutas de respaldo y
fechas exactas) se guardan **fuera del repositorio**, en un registro privado.
En los ejemplos:

- `<host>` es la IP o el nombre del servidor.
- `<admin>` es el usuario administrador.
- `<huella-ed25519>` es la huella de la llave ED25519 del host.

Ver [`backend/README.md`](../backend/README.md) para el backend.

## 1. Primer acceso y huella del host

1. **Verificar la huella por una vía independiente antes de confiar en
   ella.** Que coincida con `known_hosts` solo prueba continuidad con la
   llave aceptada la primera vez.
   1. Restablece la contraseña de root desde el panel: **Rescue → Reset root
      password**. La contraseña se muestra una sola vez; guárdala en un
      gestor de contraseñas.
   2. Entra por **Console/VNC**, que no depende de SSH.
   3. Ejecuta `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` y compara
      el resultado carácter por carácter con la huella que mostró el
      cliente SSH (`<huella-ed25519>`).
   4. Si difiere, detente e investiga.
2. Restablecer la contraseña de root no habilita el acceso SSH por
   contraseña: por defecto, `PermitRootLogin` es `prohibit-password`.

## 2. Usuario administrador

```bash
adduser --disabled-password --comment "" <admin>
usermod -aG sudo <admin>
install -d -m 700 -o <admin> -g <admin> /home/<admin>/.ssh
install -m 600 -o <admin> -g <admin> /root/.ssh/authorized_keys /home/<admin>/.ssh/authorized_keys
passwd <admin>        # interactivo; lo hace el propio administrador
```

- Solo se copian llaves **públicas**.
- El administrador pone su contraseña él mismo. Sudo la pide y nunca se
  comparte.
- Antes de tocar SSH, con una sesión root abierta de respaldo, comprueba:
  - una conexión SSH nueva como `<admin>`, más `sudo whoami`;
  - el login por Console/VNC como `<admin>`.

## 3. Endurecimiento de SSH

1. Respalda `/etc/ssh` (por ejemplo, en
   `/root/backup-ssh-<AAAAMMDDTHHMMSSZ>`).
2. Crea `/etc/ssh/sshd_config.d/10-hardening.conf`:

   ```
   PermitRootLogin no
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   X11Forwarding no
   AllowUsers <admin>
   MaxAuthTries 3
   ```

3. Valida con `sshd -t` y revisa la configuración efectiva con `sshd -T`.
4. Aplica con `systemctl reload ssh` (reload, no restart), sin cerrar la
   sesión de respaldo.
5. Con conexiones nuevas, comprueba que:
   - `<admin>` entra con llave;
   - `root` es rechazado;
   - el servidor ya no ofrece la contraseña.
6. Solo entonces cierra la sesión de respaldo.

## 4. Firewall (UFW)

1. Respalda `/etc/default/ufw` y `/etc/ufw`.
2. Comprueba que `IPV6=yes`.
3. Aplica las reglas en este orden:

   ```bash
   ufw allow OpenSSH            # 22/tcp, IPv4 y v6, ANTES de activar
   ufw default deny incoming
   ufw default allow outgoing
   ufw enable
   ufw status verbose
   ```

4. Prueba una conexión SSH nueva antes de cerrar la sesión.
5. Único puerto abierto: 22/tcp. PostgreSQL y Gunicorn escuchan solo en
   localhost.

## 5. Actualizaciones

1. **Actualiza siempre los índices antes de concluir nada.** El diagnóstico
   inicial dijo "sin actualizaciones" porque leyó índices de apt de más de
   una semana. Con los índices al día había 108 paquetes pendientes, 94 de
   seguridad.
2. Revisa sin privilegios con `apt-get -s dist-upgrade`: paquetes nuevos,
   eliminaciones y origen (`-updates` y `-security`, sin cambio de versión
   de Ubuntu).
3. Aplica con `sudo apt update && sudo apt full-upgrade`, revisando el
   resumen antes de confirmar.
4. Reinicia en una ventana acordada si hay kernel o libc nuevos.
5. Después del reinicio, verifica:
   - una conexión SSH nueva y sudo;
   - `sshd -T`;
   - `ufw status verbose`;
   - PostgreSQL;
   - `/health/` por túnel.

## 6. Proxy inverso y HTTPS (Caddy)

- Rutas en el mismo origen:
  - `/health/` y `/api/v1/*`: Django;
  - todo lo demás, incluidos `/` (landing), `/linktree` (página de enlaces
    de los QR) y el resto de `/api/*`: Next.js;
  - `www`: redirige al apex.
- Caddy no sirve contenido propio, así que no necesita leer nada de
  `/srv/ponquesito` (backend y secretos, 2750).
- Instalación, configuración de staging con acceso restringido,
  verificación y reversión: [`deploy/caddy/README.md`](../deploy/caddy/README.md).

## 7. Rescate

Entra por Console/VNC y, según lo que haya que deshacer:

- **SSH:** `rm /etc/ssh/sshd_config.d/10-hardening.conf && systemctl reload ssh`.
- **Firewall:** `ufw disable`.
- **Backend:** `systemctl disable --now ponquesito-backend`.
- **Exposición web:** `ufw delete allow 80/tcp`, `ufw delete allow 443/tcp`
  y `systemctl disable --now caddy`.

## Estado y pendientes (2026-10-08)

**Operativo:**

- Huella del host verificada por Console/VNC.
- Administrador con sudo y acceso solo por llave.
- Root y contraseñas deshabilitados en SSH (`sshd -T` revisado).
- UFW activo con solo 22/tcp abierto.
- Sistema actualizado y reiniciado.
- PostgreSQL 18 solo en localhost.
- Backend Django con Gunicorn como servicio systemd, solo en
  `127.0.0.1:8000` y accesible por túnel SSH.

**Pendiente:**

1. Confirmar `sudo whoami` dentro de Console/VNC. Sudo por SSH sí está
   probado.
2. Probar el acceso por IPv6 desde fuera.
3. Escanear los puertos desde una red independiente. La red local desde la
   que se probó intercepta el puerto 80, así que esa prueba no es
   concluyente.
4. Probar el arranque automático de `ponquesito-backend` reiniciando el VPS
   en una ventana acordada.
5. Ejecutar por primera vez `sudo systemctl reload ponquesito-backend`.
6. Evaluar más adelante: fail2ban y swap.
7. Staging (`deploy/caddy/README.md`): registro DNS de staging, Caddy, 80 y
   443 en UFW y verificación desde una red independiente. Preparado, sin
   aplicar.
