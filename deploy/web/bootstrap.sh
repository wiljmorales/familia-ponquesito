#!/usr/bin/env bash
# Preparación única del VPS para Next.js: usuario de servicio, directorios,
# web.env (vacío), script de releases y unidad systemd. Idempotente: no
# sobrescribe web.env y no arranca el servicio (eso lo hace el primer deploy).
# No instala Node: ver "Prerrequisitos" en deploy/web/README.md.
#
# Se ejecuta EN el VPS, como root, desde una copia de deploy/web/ y .nvmrc:
#   sudo bash ~/ponquesito-web-setup/deploy/web/bootstrap.sh [--dry-run]
set -euo pipefail

DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NVMRC="$SRC/../../.nvmrc"
SERVICE_USER=ponquesito-web
NODE_BIN=/opt/ponquesito/node/bin/node

run() { if [ "$DRY" = 1 ]; then echo "+ $*"; else "$@"; fi; }

[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || { echo "Ejecuta con sudo (o --dry-run)." >&2; exit 1; }
for f in ponquesito-web.service release.sh .env.example; do
  [ -f "$SRC/$f" ] || { echo "Falta $SRC/$f" >&2; exit 1; }
done
[ -f "$NVMRC" ] || { echo "Falta .nvmrc junto a deploy/ (cópialo con git archive)" >&2; exit 1; }

echo "== Usuario de servicio $SERVICE_USER (sin login, sin home, sin sudo)"
if id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "ya existe"
else
  run useradd --system --user-group --no-create-home --home-dir /nonexistent \
    --shell /usr/sbin/nologin "$SERVICE_USER"
fi

echo "== Directorios"
run install -d -o root -g root -m 755 /opt/ponquesito /opt/ponquesito/web /opt/ponquesito/web/releases
run install -d -o root -g root -m 755 /etc/ponquesito

echo "== /etc/ponquesito/web.env (root, 600; solo lo lee systemd)"
if [ -e /etc/ponquesito/web.env ]; then
  echo "ya existe: no se modifica"
else
  run install -o root -g root -m 600 "$SRC/.env.example" /etc/ponquesito/web.env
fi

echo "== Script de releases y unidad systemd"
run install -o root -g root -m 755 "$SRC/release.sh" /usr/local/sbin/ponquesito-web-release
run install -o root -g root -m 644 "$SRC/ponquesito-web.service" /etc/systemd/system/ponquesito-web.service
run systemd-analyze verify /etc/systemd/system/ponquesito-web.service
run systemctl daemon-reload
# Habilitada pero sin arrancar: ConditionPathExists la omite hasta que exista
# un release activo.
run systemctl enable ponquesito-web.service

echo "== Prerrequisitos"
want="$(tr -d '[:space:]' < "$NVMRC")"
have="$("$NODE_BIN" --version 2>/dev/null | sed 's/^v//')" || true
if [ "$have" = "$want" ]; then
  echo "Node $have en $NODE_BIN"
else
  echo "AVISO: falta Node $want en $NODE_BIN (hay: '${have:-nada}'). Instálalo antes del primer deploy."
fi
for cmd in curl ss tar sha256sum; do
  command -v "$cmd" >/dev/null || echo "AVISO: falta $cmd"
done
echo "Listo. Siguiente: deploy/web/deploy-to-vps.sh desde tu PC."
