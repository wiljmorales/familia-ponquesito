#!/usr/bin/env bash
# Copia al VPS la configuración de Caddy (deploy/caddy/) tal como está en el
# commit indicado (HEAD por defecto), a ~/ponquesito-caddy del administrador.
# Caddy no sirve contenido propio: solo enruta a Django y a Next.js.
#
# Instalar la configuración en /etc/caddy y recargar Caddy requiere sudo; el
# script indica los comandos al final.
#
# Uso:
#   VPS_HOST=<admin>@<host> [VPS_SSH_KEY=<ruta-llave>] deploy/caddy/sync-to-vps.sh [ref]
set -euo pipefail

REF="${1:-HEAD}"
HOST="${VPS_HOST:?Define VPS_HOST=<admin>@<host>}"
SSH=(ssh -o StrictHostKeyChecking=yes)
[ -n "${VPS_SSH_KEY:-}" ] && SSH+=(-i "$VPS_SSH_KEY" -o IdentitiesOnly=yes)

cd "$(git rev-parse --show-toplevel)"
COMMIT=$(git rev-parse --short "$REF")
echo "Enviando deploy/caddy/ @ $COMMIT a $HOST"

git archive --format=tar "$REF" deploy/caddy \
  | "${SSH[@]}" "$HOST" "bash -c 'set -euo pipefail; umask 022
      D=\$HOME/ponquesito-caddy; rm -rf \"\$D.new\"; mkdir -p \"\$D.new\"
      tar -x -C \"\$D.new\" --strip-components=2
      rm -rf \"\$D\"; mv \"\$D.new\" \"\$D\"; echo $COMMIT > \"\$D/REVISION\"
      echo \"Listo: \$D (\$(cat \"\$D/REVISION\"))\"'"

cat <<'NEXT'
Para instalar la configuración de Caddy (sudo), ver deploy/caddy/README.md:
  sudo install -m 644 ~/ponquesito-caddy/ponquesito.caddy /etc/caddy/ponquesito.caddy
  sudo install -m 644 ~/ponquesito-caddy/Caddyfile.staging /etc/caddy/Caddyfile
  sudo bash -c 'set -a; . /etc/caddy/staging.env; set +a; caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile' && sudo systemctl reload caddy
NEXT
