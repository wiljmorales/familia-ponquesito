#!/usr/bin/env bash
# Publica el backend de staging del VPS por HTTPS para Vercel Preview:
#   api-staging.familiaponquesito.com → Caddy (80/443) → 127.0.0.1:8001
# y, aparte, el SMTP de pruebas de Preview (Mailpit en 465: TLS, AUTH,
# solo destinatarios @example.invalid, sin reenvío).
#
# Uso, en la consola del VPS como wilfredo, con el paquete en ~/fp-staging-https/:
#   cd ~/fp-staging-https
#   sudo bash ./publicar-https.sh --comprobar        # solo lectura
#   sudo bash ./publicar-https.sh --aplicar          # UFW 80/443, Caddy y Django de staging detrás de HTTPS
#   sudo bash ./publicar-https.sh --aplicar-correo   # Mailpit y UFW 465 (requiere --aplicar)
#   sudo bash ./publicar-https.sh --retirar          # deshace todo lo anterior
#
# Requisitos fuera del VPS (no los toca): el registro A api-staging → IPv4 del
# VPS, sin AAAA, y el cortafuegos de Hetzner (si existe) con 80/443 (y 465).
# No toca producción (ponquesito-backend/web, /srv/ponquesito, la base
# ponquesito), PostgreSQL, DNS ni Vercel. No muestra secretos.
#
# Código de salida: 0 completo y verificado; 1 fallo después de empezar a
# cambiar (se listan los cambios hechos; no se revierte nada: usar --retirar);
# 2 bloqueo previo (nada cambiado). Ver deploy/staging/README-https.md.

set -Eeuo pipefail
umask 077
case "$0" in /*) SCRIPT_INVOCADO=$0 ;; *) SCRIPT_INVOCADO=$PWD/$0 ;; esac
cd /

MODO=${1:-}
case "$MODO" in --comprobar|--aplicar|--aplicar-correo|--retirar) ;;
  *) echo "Uso: sudo bash $0 --comprobar|--aplicar|--aplicar-correo|--retirar"; exit 2 ;; esac

# --- Valores fijados ----------------------------------------------------------
HOST_ESPERADO=ubuntu-4gb-hel1-1
ADMIN=wilfredo
IP_VPS=37.27.149.66
NOMBRE=api-staging.familiaponquesito.com
CADDY_VERSION=v2.11.7
CADDY_SHA256=678ade3bfc088749c81a681adc603333ee0bb023b6a6cfe3c0f58bef8ff854e9
CADDYFILE_DIST_SHA256=66177d46fa761acb07208065db9b0274cb1b12c02ac43b9bfc9857b698b1ccfe
MAILPIT_TGZ=mailpit-v1.31.4-linux-amd64.tar.gz
MAILPIT_TGZ_SHA256=30942c4605c2ca8b9f759b1bb4e3ab6a12bdfdf66e5c94644ec2c75ac41e88e7
MAILPIT_SHA256=fe4b092100e272da10d2fe1b94af2dbc72265c9809b2fa8231cd33ad85d784ff

PAQ=/home/$ADMIN/fp-staging-https
ARCHIVOS_PAQUETE="publicar-https.sh Caddyfile.api-staging ponquesito-mailpit.service ponquesito-mailpit-renovar.service ponquesito-mailpit-renovar.timer $MAILPIT_TGZ"
SELLO=$(date -u +%Y%m%dT%H%M%SZ)
EVID=$PAQ/evidencia-$SELLO${MODO/--/-}
RESPALDOS=/var/backups/ponquesito-staging-https
RESPALDO=$RESPALDOS/$SELLO${MODO/--/-}
CADDYFILE_DIST=$RESPALDOS/Caddyfile.dist

PUERTO_STAGING=8001
UNIDAD_STAGING=ponquesito-staging-backend.service
ENV_STAGING=/etc/ponquesito-staging/backend.env
COMENTARIO_UFW=fp-staging-https
CERTS=/var/lib/caddy/.local/share/caddy/certificates

MP_USUARIO=ponquesito-mailpit
MP_OPT=/opt/ponquesito-mailpit
MP_ETC=/etc/ponquesito-mailpit
MP_VAR=/var/lib/ponquesito-mailpit
MP_UNIDAD=ponquesito-mailpit.service
MP_RENOVAR=ponquesito-mailpit-renovar
MP_DROPIN=/etc/systemd/system/$MP_UNIDAD.d/certificado.conf
MP_SMTP_USUARIO=vercel-preview
MP_UI_USUARIO=operador
MARCA="fp-staging-https: creado por publicar-https.sh"
ENTREGA=$PAQ/entrega

CAMBIOS=()
REGISTRO_PID=

# --- Utilidades ---------------------------------------------------------------
cambio() { CAMBIOS+=("$1"); echo "   + $1"; }
lista_cambios() {
  if [ "${#CAMBIOS[@]}" -eq 0 ]; then echo "Cambios hechos: ninguno."; return; fi
  echo "${1:-Cambios hechos hasta aquí (no se revierten automáticamente; usar --retirar):}"
  printf '  - %s\n' "${CAMBIOS[@]}"
}
# Los mensajes de fallo y bloqueo van al registro aunque ocurran dentro de una
# redirección ({ …; } >archivo); fd 5 es el registro (ver main).
registro_directo() { [ -z "$REGISTRO_PID" ] || exec 1>&5 2>&5; }
fallo() {
  trap - ERR
  registro_directo
  echo "!! FALLO: $1"
  lista_cambios
  exit 1
}
bloqueo() {
  [ "${#CAMBIOS[@]}" -eq 0 ] || fallo "$1"
  trap - ERR
  registro_directo
  echo "!! BLOQUEO: $1"
  if [ -d "$EVID" ]; then echo "Nada se ha cambiado en el sistema; solo se escribió la evidencia en $EVID."
  else echo "Nada se ha cambiado."; fi
  exit 2
}
trap 'fallo "orden inesperada falló en la línea $LINENO"' ERR
# Devuelve la salida a la terminal y cierra toda copia del tubo del registro
# (bash guarda una en un descriptor ≥ 10 si se sale dentro de una redirección).
cerrar_registro() {
  local tubo fd
  tubo=$(readlink "/proc/$REGISTRO_PID/fd/0" 2>/dev/null || true)
  exec 1>&3 2>&4 3>&- 4>&-
  for fd in /proc/$BASHPID/fd/*; do
    fd=${fd##*/}
    if [ -n "$tubo" ] && [ "$(readlink "/proc/$BASHPID/fd/$fd" 2>/dev/null)" = "$tubo" ]; then eval "exec $fd>&-"; fi
  done
  wait "$REGISTRO_PID" 2>/dev/null || true
}
# Al salir, por cualquier camino: se cierra el registro y después se sella la evidencia.
al_salir() {
  [ -z "$REGISTRO_PID" ] || cerrar_registro
  if [ -d "$EVID" ]; then
    (cd "$EVID" && rm -f SHA256SUMS && sha256sum -- * >SHA256SUMS) && echo "Evidencia sellada: $EVID/SHA256SUMS"
    chown -R "$ADMIN:$ADMIN" "$EVID" 2>/dev/null || true
  fi
  true
}
trap al_salir EXIT

# Peticiones a este mismo Caddy por su nombre público, verificando el
# certificado con las raíces del sistema (sin -k).
https_local() { curl -sS --max-time 10 --resolve "$NOMBRE:443:127.0.0.1" "$@"; }
http_local() { curl -sS --max-time 10 --resolve "$NOMBRE:80:127.0.0.1" "$@"; }
valor_env() {  # valor_env <clave>: valor en el env de staging, sin mostrarlo
  python3 -I - "$ENV_STAGING" "$1" <<'PY'
import sys
k = sys.argv[2]
for linea in open(sys.argv[1], encoding="utf-8"):
    if linea.startswith(k + "="):
        print(linea.rstrip("\n").split("=", 1)[1]); sys.exit(0)
sys.exit(1)
PY
}
escucha() { ss -Hltnu | awk '{print $1, $5}' | grep -E "[:.]$1\$" || true; }
estado_unidad() { echo "$(systemctl is-active "$1" 2>/dev/null || true)/$(systemctl is-enabled "$1" 2>/dev/null || true)"; }
ufw_regla() {  # ufw_regla <puerto>: nuestra|ajena|no
  local anadidas; anadidas=$(ufw show added)
  if grep -qxF "ufw allow $1/tcp comment '$COMENTARIO_UFW'" <<<"$anadidas"; then echo nuestra
  elif grep -qE "^ufw allow ($1|$1/tcp)( |\$)" <<<"$anadidas"; then echo ajena
  else echo no; fi
}
ssh_permitido() { ufw status verbose | grep -qE '^(22(/tcp)?|OpenSSH) +ALLOW IN +Anywhere( |$)'; }
certificado() {  # ruta del certificado de $NOMBRE emitido por Caddy (vacío si no hay)
  { find "$CERTS" -mindepth 3 -maxdepth 3 -type f -path "*/$NOMBRE/$NOMBRE.crt" 2>/dev/null || true; } | sort
}
caddyfile_estado() {
  local s; s=$(sha256sum /etc/caddy/Caddyfile 2>/dev/null | cut -d' ' -f1 || true)
  if [ "$s" = "$CADDYFILE_DIST_SHA256" ]; then echo dist
  elif cmp -s /etc/caddy/Caddyfile "$PAQ/Caddyfile.api-staging"; then echo nuestro
  else echo "otro:${s:-ausente}"; fi
}
proxy_staging() { valor_env DJANGO_BEHIND_HTTPS_PROXY || echo ausente; }
reemplazar_env() {  # reemplazar_env <clave> <valor>: misma línea, mismo dueño y modo
  local tmp
  tmp=$(mktemp "$(dirname "$ENV_STAGING")/.backend.env.XXXXXX")
  python3 -I - "$ENV_STAGING" "$1" "$2" >"$tmp" <<'PY'
import sys
ruta, k, v = sys.argv[1:]
lineas = open(ruta, encoding="utf-8").read().splitlines()
n = sum(1 for l in lineas if l.startswith(k + "="))
if n != 1:
    sys.exit(f"{k} aparece {n} veces")
for l in lineas:
    print(f"{k}={v}" if l.startswith(k + "=") else l)
PY
  chown --reference="$ENV_STAGING" "$tmp"; chmod --reference="$ENV_STAGING" "$tmp"; mv "$tmp" "$ENV_STAGING"
}
esperar_staging() {
  local _
  for _ in $(seq 60); do curl -fsS --max-time 2 "http://127.0.0.1:$PUERTO_STAGING/health/" >/dev/null 2>&1 && return 0; sleep 0.5; done
  return 1
}

# --- Comprobaciones (solo lectura) --------------------------------------------
ruta_segura() {  # igual que en preparar-staging.sh
  local destino=$1 tipo=$2 d dueno modo esperado
  local -a cadena=()
  [ "$(realpath -m -s -- "$destino")" = "$destino" ] || bloqueo "ruta no normalizada: $destino."
  d=$destino
  while :; do cadena=("$d" "${cadena[@]}"); [ "$d" = / ] && break; d=$(dirname -- "$d"); done
  for d in "${cadena[@]}"; do
    [ -d "$d" ] && [ ! -L "$d" ] || bloqueo "$d no es un directorio real (¿enlace?)."
    read -r dueno modo < <(stat -c '%U %a' -- "$d")
    case "$d/" in "/home/$ADMIN/"*) esperado=$ADMIN ;; *) esperado=root ;; esac
    [ "$dueno" = "$esperado" ] || bloqueo "$d es de $dueno; se esperaba $esperado."
    [ $((8#$modo & 8#022)) = 0 ] || bloqueo "$d ($modo) admite escritura de grupo u otros."
  done
  [ "$tipo" != privado ] || [ $((8#$modo & 8#077)) = 0 ] || bloqueo "$destino ($modo) debe ser privado: sin permisos de grupo ni otros."
}
archivo_seguro() {
  local dueno modo
  [ -f "$1" ] && [ ! -L "$1" ] || bloqueo "$1 no es un archivo regular (¿enlace?)."
  read -r dueno modo < <(stat -c '%U %a' -- "$1")
  [ "$dueno" = "$ADMIN" ] && [ $((8#$modo & 8#022)) = 0 ] || bloqueo "$1 ($dueno, $modo) debe ser de $ADMIN y sin escritura de grupo u otros."
}
comprobar_ubicacion() {
  local logica fisica
  [ "$(id -u)" = 0 ] || bloqueo "ejecutar con sudo."
  [ "${SUDO_USER:-}" = "$ADMIN" ] || bloqueo "ejecutar como $ADMIN mediante sudo."
  logica=$(realpath -m -s -- "$SCRIPT_INVOCADO")
  fisica=$(realpath -e -- "$SCRIPT_INVOCADO" 2>/dev/null || true)
  [ "$logica" = "$PAQ/publicar-https.sh" ] && [ "$fisica" = "$logica" ] \
    || bloqueo "el script debe ejecutarse como $PAQ/publicar-https.sh, sin enlaces (invocado: $SCRIPT_INVOCADO)."
  ruta_segura "$PAQ" privado
}
comprobar_paquete() {
  local f
  for f in $ARCHIVOS_PAQUETE SHA256SUMS; do [ -e "$PAQ/$f" ] || bloqueo "falta $PAQ/$f."; archivo_seguro "$PAQ/$f"; done
  (cd "$PAQ" && sha256sum --quiet --strict -c SHA256SUMS) || bloqueo "SHA256SUMS del paquete no verifica."
  for f in $ARCHIVOS_PAQUETE; do grep -q "  $f\$" "$PAQ/SHA256SUMS" || bloqueo "$f no está en SHA256SUMS."; done
  [ "$(sha256sum "$PAQ/$MAILPIT_TGZ" | cut -d' ' -f1)" = "$MAILPIT_TGZ_SHA256" ] || bloqueo "$MAILPIT_TGZ no es la versión fijada."
  echo "   paquete: SHA256SUMS verifica; Mailpit $MAILPIT_TGZ fijado"
}
comprobar_host() {
  [ "$(hostname)" = "$HOST_ESPERADO" ] || bloqueo "host $(hostname); se esperaba $HOST_ESPERADO."
  . /etc/os-release
  [ "${VERSION_ID:-}" = "26.04" ] || bloqueo "Ubuntu ${VERSION_ID:-?}; se esperaba 26.04."
  local o
  for o in caddy ufw curl ss python3 openssl systemctl runuser; do command -v "$o" >/dev/null || bloqueo "falta $o."; done
  ip -4 -o addr show | grep -qF " $IP_VPS/" || bloqueo "el VPS no tiene la IPv4 $IP_VPS."
  [ "$(caddy version | cut -d' ' -f1)" = "$CADDY_VERSION" ] && [ "$(sha256sum /usr/bin/caddy | cut -d' ' -f1)" = "$CADDY_SHA256" ] \
    || bloqueo "/usr/bin/caddy no es Caddy $CADDY_VERSION con el hash esperado."
  getent passwd caddy >/dev/null || bloqueo "no existe el usuario caddy (paquete de Caddy)."
  echo "   host $HOST_ESPERADO, Ubuntu 26.04, IPv4 $IP_VPS, Caddy $CADDY_VERSION (hash fijado)"
}
# DNS tal como lo ve el VPS: solo A → IP del VPS y ningún AAAA.
comprobar_dns() {
  local a aaaa
  a=$(python3 -I -c 'import socket,sys; print(" ".join(sorted({i[4][0] for i in socket.getaddrinfo(sys.argv[1], 443, socket.AF_INET)})))' "$NOMBRE" 2>/dev/null || true)
  aaaa=$(python3 -I -c 'import socket,sys; print(" ".join(sorted({i[4][0] for i in socket.getaddrinfo(sys.argv[1], 443, socket.AF_INET6)})))' "$NOMBRE" 2>/dev/null || true)
  [ "$a" = "$IP_VPS" ] || bloqueo "$NOMBRE resuelve a '${a:-nada}'; se esperaba solo $IP_VPS (crear el registro A en Porkbun y esperar)."
  [ -z "$aaaa" ] || bloqueo "$NOMBRE tiene AAAA ($aaaa): no se publica por IPv6 sin comprobarlo."
  echo "   DNS: $NOMBRE → $IP_VPS, sin AAAA"
}
comprobar_ufw() {
  ufw status | grep -qx 'Status: active' || bloqueo "UFW no está activo."
  ufw status verbose | grep -q '^Default: deny (incoming)' || bloqueo "la política de entrada de UFW no es deny."
  ssh_permitido || bloqueo "UFW no muestra SSH (22/tcp u OpenSSH) permitido desde cualquier origen: revisar antes de tocar reglas."
  echo "   UFW activo, entrada deny, SSH permitido; 80: $(ufw_regla 80), 443: $(ufw_regla 443), 465: $(ufw_regla 465)"
}
comprobar_staging() {
  [ "$(estado_unidad "$UNIDAD_STAGING")" = active/enabled ] || bloqueo "$UNIDAD_STAGING no está active/enabled."
  esperar_staging || bloqueo "el backend de staging no responde en 127.0.0.1:$PUERTO_STAGING."
  [ "$(stat -c '%U:%G %a' "$ENV_STAGING")" = "root:ponquesito-staging 640" ] || bloqueo "$ENV_STAGING con dueño o modo inesperados."
  case ",$(valor_env DJANGO_ALLOWED_HOSTS)," in *",$NOMBRE,"*) ;; *) bloqueo "DJANGO_ALLOWED_HOSTS de staging no incluye $NOMBRE." ;; esac
  [ "$(valor_env PONQUESITO_API_PUBLIC_URL)" = "https://$NOMBRE" ] || bloqueo "PONQUESITO_API_PUBLIC_URL de staging no es https://$NOMBRE."
  case "$(proxy_staging)" in true|false) ;; *) bloqueo "DJANGO_BEHIND_HTTPS_PROXY de staging no es true/false." ;; esac
  echo "   staging: $UNIDAD_STAGING activo en 127.0.0.1:$PUERTO_STAGING; ALLOWED_HOSTS y URL pública con $NOMBRE; detrás de proxy HTTPS: $(proxy_staging)"
}
# Caddy: base C1 (inactivo, deshabilitado, Caddyfile de la distribución) o lo nuestro.
comprobar_caddy() {
  local cf; cf=$(caddyfile_estado)
  [ "$(estado_unidad caddy-api.service)" = inactive/disabled ] || bloqueo "caddy-api.service no está inactive/disabled."
  case "$cf" in
    dist) [ "$(estado_unidad caddy.service)" = inactive/disabled ] || bloqueo "caddy.service activo con el Caddyfile de la distribución." ;;
    nuestro) ;;
    *) bloqueo "/etc/caddy/Caddyfile tiene otro contenido (${cf#otro:}): revisar antes de reemplazarlo." ;;
  esac
  [ "$(find /etc/caddy -mindepth 1 | sort | tr '\n' ' ')" = "/etc/caddy/Caddyfile " ] || bloqueo "/etc/caddy contiene otros archivos: $(find /etc/caddy -mindepth 1 | tr '\n' ' ')"
  [ ! -e /etc/systemd/system/caddy.service.d ] && [ ! -e /etc/systemd/system/caddy.service ] || bloqueo "caddy.service tiene ajustes locales en /etc/systemd/system."
  local p
  for p in 80 443 2019; do
    if [ -n "$(escucha "$p")" ] && [ "$(systemctl is-active caddy.service || true)" != active ]; then bloqueo "el puerto $p ya está en uso por otro proceso."; fi
  done
  echo "   Caddy: caddy.service $(estado_unidad caddy.service), caddy-api.service inactive/disabled, Caddyfile $cf"
}
comprobar_correo() {
  if getent passwd "$MP_USUARIO" >/dev/null; then
    [ -f "$MP_ETC/.fp-staging-https" ] && [ "$(cat "$MP_ETC/.fp-staging-https")" = "$MARCA" ] || bloqueo "existe $MP_USUARIO sin la marca de este script."
  else
    for d in "$MP_OPT" "$MP_ETC" "$MP_VAR" "/etc/systemd/system/$MP_UNIDAD"; do [ ! -e "$d" ] || bloqueo "$d existe sin el usuario $MP_USUARIO."; done
    for p in 465 8025; do [ -z "$(escucha "$p")" ] || bloqueo "el puerto $p ya está en uso."; done
  fi
  echo "   correo: $MP_UNIDAD $(estado_unidad "$MP_UNIDAD"); UFW 465: $(ufw_regla 465)"
}
foto_produccion() {  # foto_produccion <archivo>: lo que esta fase no debe cambiar
  {
    echo "servicios: $(systemctl is-active ponquesito-backend.service ponquesito-web.service postgresql@18-main.service | tr '\n' ' ')"
    echo "habilitados: $(systemctl is-enabled ponquesito-backend.service ponquesito-web.service | tr '\n' ' ')"
    echo "escucha: $(ss -Hltn | awk '{print $4}' | grep -E ':(3000|5432|8000)$' | sort | tr '\n' ' ')"
    echo "backend.env: $(sha256sum /srv/ponquesito/backend.env | cut -d' ' -f1)"
    echo "unidades: $(sha256sum /etc/systemd/system/ponquesito-backend.service /etc/systemd/system/ponquesito-web.service | cut -d' ' -f1 | tr '\n' ' ')"
    echo "arbol_srv: $(find /srv/ponquesito -printf '%P %s %T@ %m %u %g\n' | sort | sha256sum | cut -d' ' -f1)"
    echo "pg_hba: $(sha256sum /etc/postgresql/18/main/pg_hba.conf | cut -d' ' -f1)"
  } >"$1"
}
estado_publico() {  # estado_publico <archivo>: puertos, UFW, Caddy, correo (sin secretos)
  {
    echo "# ss -Hltnu (dirección local, proceso omitido)"; ss -Hltnu | awk '{print $1, $5}' | sort
    echo "# ufw status verbose"; ufw status verbose
    echo "# ufw show added"; ufw show added
    echo "# unidades"
    for u in caddy.service caddy-api.service "$UNIDAD_STAGING" "$MP_UNIDAD" "$MP_RENOVAR.timer"; do echo "$u $(estado_unidad "$u")"; done
    echo "# /etc/caddy"; find /etc/caddy -printf '%p %m %u:%g %s\n' | sort; echo "Caddyfile: $(caddyfile_estado)"
    echo "# staging"; echo "DJANGO_BEHIND_HTTPS_PROXY=$(proxy_staging)"
    echo "# certificado"; certificado | sed "s|^$CERTS/||"
  } >"$1" 2>&1
}

# --- Respaldo -----------------------------------------------------------------
respaldar() {
  install -d -m 700 "$RESPALDOS" "$RESPALDO"
  tar -C / -cf "$RESPALDO/etc-caddy.tar" etc/caddy
  cp -a /etc/ufw/user.rules /etc/ufw/user6.rules "$RESPALDO/"
  ufw status numbered >"$RESPALDO/ufw-status-numbered.txt"; ufw show added >"$RESPALDO/ufw-show-added.txt"
  cp -a "$ENV_STAGING" "$RESPALDO/staging-backend.env"
  estado_publico "$RESPALDO/estado.txt"
  if [ ! -e "$CADDYFILE_DIST" ] && [ "$(caddyfile_estado)" = dist ]; then cp -a /etc/caddy/Caddyfile "$CADDYFILE_DIST"; fi
  cp "$RESPALDO/ufw-status-numbered.txt" "$EVID/ufw-antes.txt"
  echo "   respaldo en $RESPALDO (root 700): /etc/caddy, reglas de UFW, env de staging, estado"
}

# --- Pasos HTTPS --------------------------------------------------------------
abrir_ufw() {  # abrir_ufw <puerto>...
  local p
  for p in "$@"; do
    case "$(ufw_regla "$p")" in
      nuestra) echo "   UFW $p/tcp: ya permitido por esta fase" ;;
      ajena) echo "   UFW $p/tcp: ya permitido por una regla previa; no se añade ni se retirará" ;;
      no) ufw allow "$p/tcp" comment "$COMENTARIO_UFW" >/dev/null; cambio "UFW: allow $p/tcp (comentario $COMENTARIO_UFW, IPv4 e IPv6)" ;;
    esac
  done
  ssh_permitido || fallo "SSH ya no aparece permitido en UFW."
}
paso_caddy() {
  echo "Caddy"

  # Se valida como el usuario caddy (el que lo ejecutará), con una copia que
  # pueda leer: el paquete es privado de $ADMIN.
  local tmp
  tmp=$(mktemp -d); chgrp caddy "$tmp"; chmod 750 "$tmp"
  install -m 640 -o root -g caddy "$PAQ/Caddyfile.api-staging" "$tmp/Caddyfile"
  runuser -u caddy -- env HOME=/var/lib/caddy caddy validate --adapter caddyfile --config "$tmp/Caddyfile" >"$EVID/caddy-validate.txt" 2>&1 \
    || { rm -r "$tmp"; fallo "caddy validate rechazó Caddyfile.api-staging (ver caddy-validate.txt)."; }
  rm -r "$tmp"
  echo "   caddy validate (usuario caddy): $(tail -1 "$EVID/caddy-validate.txt")"
  # Aislamiento: el único destino del proxy es staging.
  caddy adapt --adapter caddyfile --config "$PAQ/Caddyfile.api-staging" 2>/dev/null | python3 -I -c '
import json, sys
d = json.load(sys.stdin)
dials = set()
def buscar(x):
    if isinstance(x, dict):
        if "dial" in x: dials.add(x["dial"])
        for v in x.values(): buscar(v)
    elif isinstance(x, list):
        for v in x: buscar(v)
buscar(d)
assert d["admin"]["disabled"] is True, "admin activo"
assert dials == {"127.0.0.1:8001"}, dials
print("   configuración: admin desactivado; único destino del proxy 127.0.0.1:8001")' || fallo "la configuración no está aislada de producción."
  local reiniciar=0
  if [ "$(caddyfile_estado)" != nuestro ]; then
    install -m 644 -o root -g root "$PAQ/Caddyfile.api-staging" /etc/caddy/Caddyfile
    cambio "/etc/caddy/Caddyfile ← Caddyfile.api-staging (original en $CADDYFILE_DIST)"
    reiniciar=1
  fi
  if [ "$(systemctl is-enabled caddy.service || true)" != enabled ]; then systemctl enable caddy.service >/dev/null 2>&1; cambio "caddy.service habilitado"; fi
  if [ "$reiniciar" = 1 ] || [ "$(systemctl is-active caddy.service || true)" != active ]; then
    systemctl restart caddy.service; cambio "caddy.service iniciado con Caddyfile.api-staging"
  else echo "   caddy.service ya activo con Caddyfile.api-staging"; fi
  echo "   esperando el certificado de $NOMBRE (hasta 180 s)…"
  local _ ok=0
  for _ in $(seq 90); do
    if [ -n "$(certificado)" ] && https_local -o /dev/null "https://$NOMBRE/health/" 2>/dev/null; then ok=1; break; fi
    sleep 2
  done
  [ "$ok" = 1 ] || { journalctl -u caddy.service --since "-5min" --no-pager -o cat 2>/dev/null | grep -E '"level":"(error|warn)"' | tail -5 | cut -c1-300 || true
    fallo "sin certificado válido para $NOMBRE: revisar DNS público, cortafuegos de Hetzner y UFW (80/443), y «journalctl -u caddy»."; }
  echo "   certificado: $(certificado | sed "s|^$CERTS/||")"
}
paso_staging_proxy() {
  echo "Django de staging detrás de HTTPS"
  if [ "$(proxy_staging)" != true ]; then
    reemplazar_env DJANGO_BEHIND_HTTPS_PROXY true
    cambio "$ENV_STAGING: DJANGO_BEHIND_HTTPS_PROXY=true (mismo dueño y modo)"
    systemctl restart "$UNIDAD_STAGING"
    cambio "$UNIDAD_STAGING reiniciado (solo staging)"
  else echo "   DJANGO_BEHIND_HTTPS_PROXY ya es true"; fi
  esperar_staging || fallo "el backend de staging no responde tras reiniciarlo."
}

# --- Verificación HTTPS ------------------------------------------------------
FALLOS_V=0
v() {  # v <descripción> <esperado> <obtenido>
  if [ "$2" = "$3" ]; then echo "   ok   $1: $3"
  else echo "   MAL  $1: obtenido «$3», esperado «$2»"; FALLOS_V=$((FALLOS_V + 1)); fi
}
codigo() { "$@" -o /dev/null -w '%{http_code}' 2>/dev/null || true; }
verificar_https() {
  echo "Verificación HTTPS (por 127.0.0.1 con el nombre público y el certificado verificado)"
  FALLOS_V=0
  local clave cuerpo r inicio uuid firma=fp-prueba-firma-no-valida
  inicio=$(date '+%Y-%m-%d %H:%M:%S')
  clave=$(valor_env PONQUESITO_INTERNAL_API_KEY)
  cuerpo='{"start_date":"2026-11-01","end_date":"2026-11-07","capacity_points":1}'
  uuid=$(python3 -I -c 'import uuid; print(uuid.uuid4())')
  r=$(https_local "https://$NOMBRE/health/" 2>/dev/null | python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(d.get("status"), d.get("database"))' 2>/dev/null || true)
  v "/health/ por HTTPS" "ok ok" "$r"
  v "HTTP → HTTPS" "308 https://$NOMBRE/health/" "$(http_local -o /dev/null -w '%{http_code} %{redirect_url}' "http://$NOMBRE/health/" 2>/dev/null || true)"
  v "/health sin barra (Django)" 301 "$(codigo https_local "https://$NOMBRE/health")"
  v "API sin credencial" 401 "$(codigo https_local -X POST -H 'Content-Type: application/json' -d "$cuerpo" "https://$NOMBRE/api/v1/internal/agenda-availability/")"
  v "API con credencial errónea" 401 "$(codigo https_local -X POST -H 'Authorization: Bearer fp-prueba-no-valida' -d "$cuerpo" "https://$NOMBRE/api/v1/internal/agenda-availability/")"
  # La clave va por stdin (-K -), no en la línea de órdenes.
  r=$(printf 'header = "Authorization: Bearer %s"\n' "$clave" | https_local -K - -X POST -H 'Content-Type: application/json' -d "$cuerpo" \
      -w '\n%{http_code}' "https://$NOMBRE/api/v1/internal/agenda-availability/" 2>/dev/null | python3 -I -c '
import json, sys
*cuerpo, codigo = sys.stdin.read().split("\n")
print(codigo, json.loads("\n".join(cuerpo)).get("ok"))' 2>/dev/null || true)
  v "API con credencial" "200 True" "$r"
  v "API con cookie y sin Bearer" 401 "$(codigo https_local -X POST -H 'Cookie: sessionid=x; csrftoken=x' -d "$cuerpo" "https://$NOMBRE/api/v1/internal/agenda-availability/")"
  v "API con GET (Django)" 405 "$(codigo https_local "https://$NOMBRE/api/v1/internal/agenda-availability/")"
  v "imagen con firma no válida (Django)" "404 application/json" "$(https_local -o /dev/null -w '%{http_code} %{content_type}' "https://$NOMBRE/api/v1/private-images/$uuid/?sig=$firma" 2>/dev/null || true)"
  r=$(https_local -D - -o /dev/null "https://$NOMBRE/health/" 2>/dev/null | tr -d '\r' | tr 'A-Z' 'a-z')
  v "cabecera nosniff" 1 "$(grep -c '^x-content-type-options: nosniff$' <<<"$r" || true)"
  v "cabecera noindex" 1 "$(grep -c '^x-robots-tag: noindex, nofollow, noarchive$' <<<"$r" || true)"
  v "sin cabecera Server" 0 "$(grep -c '^server:' <<<"$r" || true)"
  local ruta
  for ruta in / /api/v1 /api/v1/ /api/v1/internal /api/v1/x/ /api/v1x /api/v2/internal/x/ /admin/ /static/x /media/x /.env /health/x "/api/v1/internal/../../admin/"; do
    v "ruta no publicada $ruta" "404 No encontrado" "$(https_local -w ' %{http_code}' --path-as-is "https://$NOMBRE$ruta" 2>/dev/null | tr -d '\n' | sed 's/^\(.*\) \([0-9]*\)$/\2 \1/' || true)"
  done
  v "otro Host por la misma conexión TLS" 421 "$(codigo https_local -H 'Host: api.familiaponquesito.com' "https://$NOMBRE/health/")"
  v "TLS para api.familiaponquesito.com" sin-tls "$(curl -sS --max-time 5 --resolve api.familiaponquesito.com:443:127.0.0.1 -o /dev/null https://api.familiaponquesito.com/health/ 2>/dev/null && echo con-tls || echo sin-tls)"
  v "TLS por IP sin nombre (ni con -k)" sin-tls "$(curl -sSk --max-time 5 -o /dev/null https://127.0.0.1/health/ 2>/dev/null && echo con-tls || echo sin-tls)"
  local h
  for h in "$IP_VPS" api.familiaponquesito.com familiaponquesito.com www.familiaponquesito.com localhost; do
    v "HTTP con Host $h" 404 "$(codigo curl -sS --max-time 5 -H "Host: $h" "http://127.0.0.1/health/")"
  done
  v "API de administración de Caddy (2019)" "" "$(escucha 2019)"
  v "Caddy solo en TCP 80 y 443" "tcp *:443 tcp *:80" "$(ss -Hltnup 2>/dev/null | grep '"caddy"' | awk '{print $1, $5}' | sort | tr '\n' ' ' | sed 's/ $//')"
  # Ni la firma de prueba ni la clave en el journal de Caddy.
  r=$(journalctl -u caddy.service --since "$inicio" --no-pager -o cat 2>/dev/null || true)
  v "journal de Caddy sin la firma" 0 "$(grep -cF -- "$firma" <<<"$r" || true)"
  v "journal de Caddy sin la clave" 0 "$(grep -cF -- "$clave" <<<"$r" || true)"
  v "journal de Caddy con accesos" si "$(grep -q '"uri":"/api/v1/private-images/' <<<"$r" && echo si || echo no)"
  unset clave
  [ "$FALLOS_V" = 0 ] || fallo "$FALLOS_V comprobaciones HTTPS no coinciden."
}

# --- Correo de Preview (Mailpit) ---------------------------------------------
paso_correo() {
  echo "SMTP de pruebas (Mailpit)"
  local cert u antes=${#CAMBIOS[@]}
  cert=$(certificado)
  [ "$(wc -l <<<"$cert")" = 1 ] && [ -n "$cert" ] || fallo "se esperaba un único certificado de $NOMBRE en $CERTS."
  if ! getent passwd "$MP_USUARIO" >/dev/null; then
    useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --user-group "$MP_USUARIO"
    cambio "usuario de sistema $MP_USUARIO"
  fi
  if [ ! -x "$MP_OPT/mailpit" ] || [ "$(sha256sum "$MP_OPT/mailpit" | cut -d' ' -f1)" != "$MAILPIT_SHA256" ]; then
    local tmp; tmp=$(mktemp -d)
    tar -xzf "$PAQ/$MAILPIT_TGZ" -C "$tmp" --no-same-owner mailpit
    [ "$(sha256sum "$tmp/mailpit" | cut -d' ' -f1)" = "$MAILPIT_SHA256" ] || fallo "el binario de Mailpit no tiene el hash fijado."
    install -d -m 755 -o root -g root "$MP_OPT"
    install -m 755 -o root -g root "$tmp/mailpit" "$MP_OPT/mailpit"; rm -r "$tmp"
    cambio "$MP_OPT/mailpit (v1.31.4, root 755)"
  fi
  if [ ! -d "$MP_ETC" ]; then
    install -d -m 750 -o root -g "$MP_USUARIO" "$MP_ETC"
    echo "$MARCA" >"$MP_ETC/.fp-staging-https"; chmod 644 "$MP_ETC/.fp-staging-https"
    cambio "$MP_ETC (root:$MP_USUARIO 750)"
  fi
  install -d -m 700 -o "$ADMIN" -g "$ADMIN" "$ENTREGA"
  local nombre usuario
  for nombre in smtp ui; do
    [ "$nombre" = smtp ] && usuario=$MP_SMTP_USUARIO || usuario=$MP_UI_USUARIO
    if [ ! -s "$MP_ETC/$nombre-auth" ]; then
      # Contraseña aleatoria: al archivo de entrega (600) y, como hash SHA-512-crypt, a Mailpit.
      (umask 077; openssl rand -hex 24 | tr -d '\n' >"$ENTREGA/$nombre-password")
      chown "$ADMIN:$ADMIN" "$ENTREGA/$nombre-password"
      printf '%s:%s\n' "$usuario" "$(openssl passwd -6 -stdin <"$ENTREGA/$nombre-password")" >"$MP_ETC/$nombre-auth"
      chown root:"$MP_USUARIO" "$MP_ETC/$nombre-auth"; chmod 640 "$MP_ETC/$nombre-auth"
      cambio "$MP_ETC/$nombre-auth (usuario $usuario; contraseña nueva en $ENTREGA/$nombre-password, 600)"
    fi
  done
  for u in "$MP_UNIDAD" "$MP_RENOVAR.service" "$MP_RENOVAR.timer"; do
    if ! cmp -s "$PAQ/$u" "/etc/systemd/system/$u"; then install -m 644 -o root -g root "$PAQ/$u" "/etc/systemd/system/$u"; cambio "/etc/systemd/system/$u"; fi
  done
  local dropin
  dropin=$(printf '# Generado por publicar-https.sh: certificado de %s que obtiene Caddy.\n[Service]\nLoadCredential=tls.crt:%s\nLoadCredential=tls.key:%s\n' "$NOMBRE" "$cert" "${cert%.crt}.key")
  if [ "$(cat "$MP_DROPIN" 2>/dev/null || true)" != "$dropin" ]; then
    install -d -m 755 "$(dirname "$MP_DROPIN")"; printf '%s\n' "$dropin" >"$MP_DROPIN"; chmod 644 "$MP_DROPIN"
    cambio "$MP_DROPIN (LoadCredential del certificado)"
  fi
  systemctl daemon-reload
  abrir_ufw 465
  # Se reinicia solo si algo cambió en esta ejecución o no está activo.
  for u in "$MP_UNIDAD" "$MP_RENOVAR.timer"; do
    if [ "$(systemctl is-enabled "$u" 2>/dev/null || true)" != enabled ]; then systemctl enable "$u" >/dev/null 2>&1; cambio "$u habilitado"; fi
  done
  [ "$(systemctl is-active "$MP_RENOVAR.timer" || true)" = active ] || { systemctl start "$MP_RENOVAR.timer"; cambio "$MP_RENOVAR.timer iniciado"; }
  if [ "$antes" != "${#CAMBIOS[@]}" ] || [ "$(systemctl is-active "$MP_UNIDAD" || true)" != active ]; then
    systemctl restart "$MP_UNIDAD"; cambio "$MP_UNIDAD (re)iniciado"
  else echo "   $MP_UNIDAD ya activo y sin cambios"; fi
  local _
  for _ in $(seq 30); do [ -n "$(escucha 465)" ] && break; sleep 0.5; done
}
verificar_correo() {
  echo "Verificación del SMTP de pruebas"
  FALLOS_V=0
  v "Mailpit escucha" "tcp *:465 tcp 127.0.0.1:8025" "$( (escucha 465; escucha 8025) | sort | tr '\n' ' ' | sed 's/ $//')"
  v "certificado SMTP verificado por nombre" ok "$(openssl s_client -connect 127.0.0.1:465 -servername "$NOMBRE" -verify_hostname "$NOMBRE" -verify_return_error </dev/null 2>/dev/null | grep -q 'Verify return code: 0 (ok)' && echo ok || echo no)"
  local r
  r=$(python3 -I - "$NOMBRE" "$ENTREGA/smtp-password" "$MP_SMTP_USUARIO" "$SELLO" <<'PY'
import smtplib, socket, ssl, sys
nombre, archivo, usuario, sello = sys.argv[1:]
clave = open(archivo).read().strip()
ctx = ssl.create_default_context()
class SMTPS(smtplib.SMTP):
    def _get_socket(self, host, port, timeout):
        return ctx.wrap_socket(socket.create_connection(("127.0.0.1", port), timeout), server_hostname=nombre)
def sesion(con_login=True, clave_=clave):
    s = SMTPS(nombre, 465, timeout=10)
    if con_login: s.login(usuario, clave_)
    return s
def resultado(f):
    try: return str(f())
    except smtplib.SMTPRecipientsRefused as e: return "rechazado " + str(list(e.recipients.values())[0][0])
    except smtplib.SMTPSenderRefused as e: return "rechazado " + str(e.smtp_code)
    except smtplib.SMTPAuthenticationError as e: return "rechazado " + str(e.smtp_code)
    except Exception as e: return type(e).__name__
msg = f"From: preview@example.invalid\r\nTo: verificacion@example.invalid\r\nSubject: fp-staging-https {sello}\r\n\r\nPrueba del SMTP de Preview.\r\n"
print("aceptado|" + resultado(lambda: sesion().sendmail("preview@example.invalid", ["verificacion@example.invalid"], msg) or "aceptado"))
print("gmail|" + resultado(lambda: sesion().sendmail("preview@example.invalid", ["alguien@gmail.com"], msg)))
print("sin_auth|" + resultado(lambda: sesion(False).sendmail("preview@example.invalid", ["verificacion@example.invalid"], msg)))
print("clave_mala|" + resultado(lambda: sesion(True, "fp-prueba-no-valida")))
def plano():
    s = socket.create_connection(("127.0.0.1", 465), 5); s.settimeout(3)
    try: return "banner" if s.recv(100).startswith(b"220") else "sin-banner"
    except Exception: return "sin-banner"
print("plano|" + plano())
PY
)
  v "envío autenticado a @example.invalid" aceptado "$(sed -n 's/^aceptado|//p' <<<"$r")"
  v "destinatario real (gmail.com)" "rechazado 550" "$(sed -n 's/^gmail|//p' <<<"$r")"
  v "sin AUTH" "rechazado 530" "$(sed -n 's/^sin_auth|//p' <<<"$r")"
  v "contraseña errónea" "rechazado 535" "$(sed -n 's/^clave_mala|//p' <<<"$r")"
  v "SMTP sin TLS en 465" sin-banner "$(sed -n 's/^plano|//p' <<<"$r")"
  local ui; ui=$(cat "$ENTREGA/ui-password")
  v "interfaz sin credencial" 401 "$(codigo curl -sS --max-time 5 http://127.0.0.1:8025/api/v1/messages)"
  v "API de envío sin credencial" 401 "$(codigo curl -sS --max-time 5 -X POST -d '{}' http://127.0.0.1:8025/api/v1/send)"
  r=$(printf 'user = "%s:%s"\n' "$MP_UI_USUARIO" "$ui" | curl -sS --max-time 5 -K - http://127.0.0.1:8025/api/v1/webui 2>/dev/null | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["MessageRelay"]["Enabled"])' 2>/dev/null || true)
  v "reenvío (relay) desactivado" False "$r"
  r=$(printf 'user = "%s:%s"\n' "$MP_UI_USUARIO" "$ui" | curl -sS --max-time 5 -K - "http://127.0.0.1:8025/api/v1/search?query=subject:%22fp-staging-https%20$SELLO%22" 2>/dev/null | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["messages_count"])' 2>/dev/null || true)
  v "mensaje de prueba recibido" 1 "$r"
  unset ui
  [ "$FALLOS_V" = 0 ] || fallo "$FALLOS_V comprobaciones del correo no coinciden."
}

# --- Retirada -----------------------------------------------------------------
retirar() {
  echo "Retirada del correo de Preview"
  local u
  for u in "$MP_RENOVAR.timer" "$MP_UNIDAD"; do
    if [ "$(systemctl is-enabled "$u" 2>/dev/null || true)" = enabled ] || [ "$(systemctl is-active "$u" 2>/dev/null || true)" = active ]; then
      systemctl disable --now "$u" >/dev/null 2>&1; cambio "$u detenido y deshabilitado"
    fi
  done
  for u in "$MP_UNIDAD" "$MP_RENOVAR.service" "$MP_RENOVAR.timer"; do
    [ ! -e "/etc/systemd/system/$u" ] || { rm "/etc/systemd/system/$u"; cambio "/etc/systemd/system/$u borrado"; }
  done
  [ ! -e "$(dirname "$MP_DROPIN")" ] || { rm -r "$(dirname "$MP_DROPIN")"; cambio "$(dirname "$MP_DROPIN") borrado"; }
  systemctl daemon-reload
  local d
  for d in "$MP_OPT" "$MP_ETC"; do [ ! -e "$d" ] || { rm -r "$d"; cambio "$d borrado"; }; done
  [ ! -e "$MP_VAR" ] || { rm -r "$MP_VAR"; cambio "$MP_VAR borrado (buzón de pruebas, solo mensajes sintéticos)"; }
  if getent passwd "$MP_USUARIO" >/dev/null; then userdel "$MP_USUARIO"; cambio "usuario $MP_USUARIO borrado"; fi
  getent group "$MP_USUARIO" >/dev/null && groupdel "$MP_USUARIO" || true

  echo "Retirada de HTTPS"
  if [ "$(proxy_staging)" != false ]; then
    reemplazar_env DJANGO_BEHIND_HTTPS_PROXY false; cambio "$ENV_STAGING: DJANGO_BEHIND_HTTPS_PROXY=false"
    systemctl restart "$UNIDAD_STAGING"; cambio "$UNIDAD_STAGING reiniciado (solo staging)"
  fi
  esperar_staging || fallo "el backend de staging no responde tras reiniciarlo."
  if [ "$(systemctl is-enabled caddy.service || true)" = enabled ] || [ "$(systemctl is-active caddy.service || true)" = active ]; then
    systemctl disable --now caddy.service >/dev/null 2>&1; cambio "caddy.service detenido y deshabilitado (datos ACME conservados en /var/lib/caddy)"
  fi
  if [ "$(caddyfile_estado)" = nuestro ]; then
    [ "$(sha256sum "$CADDYFILE_DIST" 2>/dev/null | cut -d' ' -f1)" = "$CADDYFILE_DIST_SHA256" ] || fallo "falta el Caddyfile original verificado en $CADDYFILE_DIST."
    install -m 644 -o root -g root "$CADDYFILE_DIST" /etc/caddy/Caddyfile; cambio "/etc/caddy/Caddyfile restaurado (distribución)"
  fi
  local p
  for p in 465 443 80; do
    if [ "$(ufw_regla "$p")" = nuestra ]; then ufw delete allow "$p/tcp" comment "$COMENTARIO_UFW" >/dev/null; cambio "UFW: retirada allow $p/tcp ($COMENTARIO_UFW)"; fi
  done
  ssh_permitido || fallo "SSH ya no aparece permitido en UFW."
  [ ! -d "$ENTREGA" ] || echo "   $ENTREGA queda como está (de $ADMIN): borrar sus contraseñas si no se copiaron ya."
}
verificar_base() {
  echo "Verificación del estado base"
  FALLOS_V=0
  v "caddy.service" inactive/disabled "$(estado_unidad caddy.service)"
  v "caddy-api.service" inactive/disabled "$(estado_unidad caddy-api.service)"
  v "Caddyfile" dist "$(caddyfile_estado)"
  v "$MP_UNIDAD" "inactive/" "$(systemctl is-active "$MP_UNIDAD" 2>/dev/null || true)/$(systemctl is-enabled "$MP_UNIDAD" 2>/dev/null | grep -v '^not-found$' || true)"
  local p
  for p in 80 443 465 2019 8025; do v "sin escucha en $p" "" "$(escucha "$p")"; done
  for p in 80 443 465; do [ "$(ufw_regla "$p")" != nuestra ] || v "UFW $p/tcp de esta fase" retirada presente; done
  v "staging detrás de proxy HTTPS" false "$(proxy_staging)"
  v "staging /health/" 200 "$(codigo curl -sS --max-time 5 "http://127.0.0.1:$PUERTO_STAGING/health/")"
  [ "$FALLOS_V" = 0 ] || fallo "$FALLOS_V comprobaciones del estado base no coinciden."
}

# --- Ejecución ----------------------------------------------------------------
main() {
  comprobar_ubicacion
  mkdir -m 700 "$EVID"
  exec 3>&1 4>&2 > >(tee -a "$EVID/registro.txt") 2>&1
  REGISTRO_PID=$!
  exec 5>&1
  echo "HTTPS de staging ($MODO) — $SELLO en $(hostname)"
  echo "Comprobaciones previas (solo lectura)…"
  comprobar_paquete
  comprobar_host
  comprobar_ufw
  comprobar_staging
  comprobar_caddy
  comprobar_correo
  [ "$MODO" = --retirar ] || comprobar_dns
  foto_produccion "$EVID/produccion-antes.txt"
  estado_publico "$EVID/estado-antes.txt"
  echo "   foto de producción y estado público tomados"

  case "$MODO" in
    --comprobar)
      cat <<EOF
Cambios previstos con --aplicar (solo los que falten):
  - respaldo en $RESPALDOS/<UTC>-aplicar: /etc/caddy, reglas de UFW, env de staging, estado
  - UFW: allow 80/tcp y 443/tcp (comentario $COMENTARIO_UFW); SSH se conserva
  - /etc/caddy/Caddyfile ← Caddyfile.api-staging; caddy.service habilitado y reiniciado (certificado de Let's Encrypt)
  - $ENV_STAGING: DJANGO_BEHIND_HTTPS_PROXY=true; reinicio solo de $UNIDAD_STAGING
Con --aplicar-correo: usuario $MP_USUARIO, $MP_OPT, $MP_ETC, $MP_VAR, $MP_UNIDAD y $MP_RENOVAR.timer, UFW allow 465/tcp.
Sin cambios: producción (ponquesito-backend/web, /srv/ponquesito, base ponquesito), PostgreSQL, DNS, Vercel.
EOF
      if [ "$(caddyfile_estado)" = nuestro ] && [ "$(systemctl is-active caddy.service || true)" = active ]; then verificar_https; fi
      if [ "$(systemctl is-active "$MP_UNIDAD" 2>/dev/null || true)" = active ]; then verificar_correo; fi
      echo "Comprobación completa: sin bloqueos. Nada se ha cambiado."
      exit 0 ;;
    --aplicar)
      respaldar
      echo "UFW"; abrir_ufw 80 443
      paso_caddy
      paso_staging_proxy
      verificar_https ;;
    --aplicar-correo)
      [ "$(caddyfile_estado)" = nuestro ] && [ "$(systemctl is-active caddy.service || true)" = active ] || bloqueo "primero --aplicar (Caddy con el certificado de $NOMBRE)."
      respaldar
      paso_correo
      verificar_correo ;;
    --retirar)
      respaldar
      retirar
      verificar_base ;;
  esac

  echo "Comprobación final de producción…"
  foto_produccion "$EVID/produccion-despues.txt"
  estado_publico "$EVID/estado-despues.txt"
  cmp -s "$EVID/produccion-antes.txt" "$EVID/produccion-despues.txt" || { diff "$EVID/produccion-antes.txt" "$EVID/produccion-despues.txt" || true; fallo "el estado de producción cambió."; }
  echo "   producción: servicios, puertos, backend.env, unidades, /srv/ponquesito y pg_hba sin cambios"
  echo
  lista_cambios "Cambios hechos en esta ejecución:"
  echo "Listo ($MODO). Evidencia: $EVID"
}

main
