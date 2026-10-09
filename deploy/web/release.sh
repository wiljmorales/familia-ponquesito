#!/usr/bin/env bash
# Gestión de releases de Next.js en el VPS. Bootstrap lo instala como
# /usr/local/sbin/ponquesito-web-release (root) y deploy-to-vps.sh lo invoca
# con sudo. Ver deploy/web/README.md.
#
#   ponquesito-web-release deploy <tarball>   instala y activa un artefacto
#   ponquesito-web-release activate <id>      activa un release ya instalado
#   ponquesito-web-release rollback           vuelve al release anterior
#   ponquesito-web-release status
#
# Un release se identifica como <commit12>-<build12>: el commit y el
# fingerprint de las variables de build (BUILD_ENV del artefacto).
#
# Activar = verificar el release y que web.env tenga la misma
# APP_CANONICAL_URL con que se compiló; después, cambiar el symlink current
# de forma atómica, reiniciar el servicio y comprobar la salud. Si algo de lo
# primero falla, current no se toca. Si falla la salud, se restaura el
# release anterior automáticamente y se sale con error.
#
# Las variables de abajo solo existen para la prueba local
# (deploy/web/test/run-local.sh); sudo no las deja pasar.
set -euo pipefail
umask 022

WEB_ROOT="${WEB_ROOT:-/opt/ponquesito/web}"
CACHE_DIR="${CACHE_DIR:-/var/cache/ponquesito-web}"
ENV_FILE="${ENV_FILE:-/etc/ponquesito/web.env}"
NODE_BIN="${NODE_BIN:-/opt/ponquesito/node/bin/node}"
SERVICE_USER="${SERVICE_USER:-ponquesito-web}"
RESTART_CMD="${RESTART_CMD:-systemctl restart ponquesito-web}"
HEALTH_PORT="${HEALTH_PORT:-3000}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-30}"
KEEP="${KEEP:-3}"

RELEASES="$WEB_ROOT/releases"
log() { echo "[web-release] $*" >&2; }
die() { echo "[web-release] ERROR: $*" >&2; exit 1; }

# Valores que fija la unidad systemd: si web.env los redefiniera, ganaría el
# archivo (EnvironmentFile tiene prioridad) y Next podría escuchar en 0.0.0.0.
check_env_file() {
  [ -f "$ENV_FILE" ] || die "falta $ENV_FILE (ejecuta bootstrap)"
  if grep -Eq '^[[:space:]]*(export[[:space:]]+)?(HOSTNAME|PORT|NODE_ENV)=' "$ENV_FILE"; then
    die "$ENV_FILE no puede definir HOSTNAME, PORT ni NODE_ENV (los fija la unidad)"
  fi
}

# Identidad del release: REVISION, BUILD_ENV y BUILD_INFO deben coincidir con
# su nombre <commit12>-<build12>.
verify_release() {
  local dir="$1" id="$2" sha="${2%-*}" fp="${2#*-}" info
  info="$dir/BUILD_INFO"
  [ -f "$dir/REVISION" ] && [ -f "$dir/BUILD_ENV" ] && [ -f "$info" ] || die "$id: faltan REVISION, BUILD_ENV o BUILD_INFO"
  [ "$(cut -c1-12 "$dir/REVISION")" = "$sha" ] || die "$id: REVISION no coincide con el commit $sha"
  [ "$(sha256sum < "$dir/BUILD_ENV" | cut -c1-12)" = "$fp" ] || die "$id: BUILD_ENV no coincide con el fingerprint $fp"
  [ "$(info_value build_fingerprint "$info")" = "$fp" ] || die "$id: BUILD_INFO tiene otro fingerprint"
  [ "$(info_value commit "$info")" = "$(cat "$dir/REVISION")" ] || die "$id: BUILD_INFO tiene otro commit"
  [ "$(info_value canonical_url "$info")" = "$(info_value APP_CANONICAL_URL "$dir/BUILD_ENV")" ] \
    || die "$id: BUILD_INFO y BUILD_ENV tienen URL canónica distinta"
}

info_value() { grep -E "^$1=" "$2" | tail -1 | cut -d= -f2-; }

# La URL canónica de runtime debe ser exactamente la del build: las páginas
# estáticas llevan la del build y los correos usan la de runtime. Sin ella,
# Next.js caería en la URL de producción de Vercel.
check_canonical() {
  local want have line
  want="$(info_value canonical_url "$1/BUILD_INFO")"
  [ -n "$want" ] || die "el release no declara canonical_url"
  line="$(grep -E '^APP_CANONICAL_URL=' "$ENV_FILE" | tail -1 || true)"
  [ -n "$line" ] || die "$ENV_FILE no define APP_CANONICAL_URL (el release requiere $want)"
  have="${line#*=}"; have="${have%\"}"; have="${have#\"}"
  [ "$have" = "$want" ] || die "APP_CANONICAL_URL de $ENV_FILE ($have) no coincide con la del build ($want)"
}

check_node() {
  local want have
  want="$(cat "$1/NODE_VERSION")"
  have="$("$NODE_BIN" --version 2>/dev/null | sed 's/^v//')" || true
  [ "$have" = "$want" ] || die "el release requiere Node $want; $NODE_BIN es '${have:-inexistente}'"
}

# Cambio atómico: symlink temporal + rename(2) sobre el existente.
set_link() {
  local name="$1" target="$2"
  ln -sfn "$target" "$WEB_ROOT/.$name.tmp"
  mv -Tf "$WEB_ROOT/.$name.tmp" "$WEB_ROOT/$name"
}

link_target() { [ -L "$WEB_ROOT/$1" ] && basename "$(readlink "$WEB_ROOT/$1")" || true; }

healthy() {
  local base="http://127.0.0.1:$HEALTH_PORT" deadline=$((SECONDS + HEALTH_TIMEOUT)) p code
  until code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$base/linktree")" && [ "$code" = 200 ]; do
    [ "$SECONDS" -lt "$deadline" ] || { log "sin respuesta 200 en /linktree tras ${HEALTH_TIMEOUT}s"; return 1; }
    sleep 1
  done
  for p in / /linktree /favicon.svg /assets/logo-familia-ponquesito.png; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$base$p")" || code=000
    [ "$code" = 200 ] || { log "$p respondió $code"; return 1; }
  done
  # Solo loopback: nada debe escuchar en otra dirección en ese puerto.
  if ss -Hltn "sport = :$HEALTH_PORT" | awk '{print $4}' | grep -Ev '^(127\.0\.0\.1|\[::1\]):' | grep -q .; then
    log "el puerto $HEALTH_PORT escucha fuera de 127.0.0.1"; return 1
  fi
}

# activate <commit>: devuelve 0 si queda activo; si no, restaura el anterior.
activate() {
  local new="$1" old
  [ -f "$RELEASES/$new/server.js" ] || die "release $new no instalado"
  verify_release "$RELEASES/$new" "$new"
  check_env_file
  check_canonical "$RELEASES/$new"
  check_node "$RELEASES/$new"
  old="$(link_target current)"
  log "activando $new (anterior: ${old:-ninguno})"
  set_link current "releases/$new"
  if $RESTART_CMD && healthy; then
    [ -n "$old" ] && [ "$old" != "$new" ] && set_link previous "releases/$old"
    log "activo: $new"
    return 0
  fi
  if [ -z "$old" ] || [ "$old" = "$new" ]; then
    die "$new no pasó la comprobación y no hay release anterior al que volver"
  fi
  log "$new no pasó la comprobación: restaurando $old"
  set_link current "releases/$old"
  if $RESTART_CMD && healthy; then
    die "rollback automático completado; sigue activo $old"
  fi
  die "rollback a $old tampoco pasó la comprobación: revisar journalctl -u ponquesito-web"
}

install_tarball() {
  local tarball="$1" name id tmp bad
  [ -f "$tarball" ] && [ -f "$tarball.sha256" ] || die "faltan $tarball o su .sha256"
  name="$(basename "$tarball" .tar.gz)"
  [[ "$name" =~ ^ponquesito-web-[0-9a-f]{12}-[0-9a-f]{12}$ ]] || die "nombre de artefacto inesperado: $name"
  id="${name#ponquesito-web-}"
  (cd "$(dirname "$tarball")" && sha256sum --quiet -c "$(basename "$tarball").sha256") \
    || die "el SHA-256 no coincide"
  if [ -d "$RELEASES/$id" ]; then
    log "release $id ya instalado"; echo "$id"; return
  fi
  # Solo rutas relativas dentro de <name>/, sin enlaces ni dispositivos.
  if tar -tzvf "$tarball" | awk '{print substr($1,1,1)}' | grep -qv '[-d]'; then
    die "el artefacto contiene enlaces o archivos especiales"
  fi
  if tar -tzf "$tarball" | grep -Ev "^$name(/|$)" | grep -q . \
     || tar -tzf "$tarball" | grep -Eq '(^|/)\.\.(/|$)'; then
    die "el artefacto contiene rutas fuera de $name/"
  fi
  bad="$(tar -tzf "$tarball" | grep -E "^$name/(backend(/|$)|(.*/)?\.env[^/]*$|(.*/)?\.git(/|$)|\.next/cache(/|$))" || true)"
  [ -z "$bad" ] || die "el artefacto contiene archivos prohibidos: $(echo "$bad" | head -3)"

  tmp="$RELEASES/.incoming-$id"
  rm -rf "$tmp"; mkdir -p "$tmp"
  trap 'rm -rf "$tmp"' EXIT
  tar -xzf "$tarball" -C "$tmp" --no-same-owner --no-same-permissions
  verify_release "$tmp/$name" "$id"
  check_node "$tmp/$name"

  # Caché de Next (imágenes optimizadas) fuera del release, uno por release:
  # el release queda de solo lectura para el servicio.
  mkdir -p "$CACHE_DIR/$id"
  ln -s "$CACHE_DIR/$id" "$tmp/$name/.next/cache"
  if [ "$(id -u)" = 0 ]; then
    chown -R root:"$SERVICE_USER" "$tmp/$name"
    chown "$SERVICE_USER:$SERVICE_USER" "$CACHE_DIR/$id"
    chmod 0700 "$CACHE_DIR/$id"
  fi
  chmod -R u+rwX,g+rX,g-w,o-rwx "$tmp/$name"
  mv -T "$tmp/$name" "$RELEASES/$id"
  touch "$RELEASES/$id"   # prune ordena por fecha de instalación
  rmdir "$tmp"; trap - EXIT
  log "instalado $id"
  echo "$id"
}

# Conserva los KEEP releases más recientes y siempre current y previous.
prune() {
  local cur prev d n=0
  cur="$(link_target current)"; prev="$(link_target previous)"
  for d in $(ls -1t "$RELEASES"); do
    [ -d "$RELEASES/$d" ] || continue
    [[ "$d" == .incoming-* ]] && continue
    n=$((n + 1))
    if [ "$n" -gt "$KEEP" ] && [ "$d" != "$cur" ] && [ "$d" != "$prev" ]; then
      log "eliminando release antiguo $d"
      rm -rf "${RELEASES:?}/$d" "${CACHE_DIR:?}/$d"
    fi
  done
}

status() {
  echo "current:  $(link_target current)"
  echo "previous: $(link_target previous)"
  echo "releases: $(ls -1t "$RELEASES" | tr '\n' ' ')"
}

case "${1:-}" in
  deploy)
    [ -n "${2:-}" ] || die "uso: deploy <tarball>"
    id="$(install_tarball "$2")"
    activate "$id"
    prune
    status ;;
  activate)
    [ -n "${2:-}" ] || die "uso: activate <commit12>-<build12>"
    activate "$2"; status ;;
  rollback)
    prev="$(link_target previous)"
    [ -n "$prev" ] || die "no hay release anterior"
    activate "$prev"; status ;;
  status) status ;;
  *) die "uso: deploy <tarball> | activate <commit> | rollback | status" ;;
esac
