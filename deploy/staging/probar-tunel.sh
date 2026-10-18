#!/usr/bin/env bash
# Prueba el backend de staging del VPS por túnel SSH, desde este equipo.
# Uso: deploy/staging/probar-tunel.sh <archivo-clave-interna> [destino-ssh]
#   <archivo-clave-interna>  copia privada (600) de ~/fp-staging/entrega/internal-api-key
#   [destino-ssh]            por defecto wilfredo@37.27.149.66 con ~/.ssh/familia_ponquesito
# Abre 127.0.0.1:18001 → 127.0.0.1:8001 del VPS, comprueba /health/ y la
# credencial, y ejecuta los flujos reales de Next.js (deploy/staging/test/)
# con un receptor SMTP local (.invalid) y sin red externa. Escribe datos
# sintéticos en ponquesito_staging. No toca producción ni abre puertos.
set -euo pipefail

CLAVE=${1:?Uso: $0 <archivo-clave-interna> [destino-ssh]}
DESTINO=${2:-wilfredo@37.27.149.66}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/familia_ponquesito}
KNOWN_HOSTS=${KNOWN_HOSTS:-$HOME/.ssh/known_hosts}   # la huella del VPS ya verificada
PUERTO_LOCAL=${PUERTO_LOCAL:-18001}
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
NODE_BIN=${NODE_BIN:-$HOME/.nvm/versions/node/v$(cat "$REPO/.nvmrc" | tr -d 'v[:space:]')/bin}

[ "$(stat -c %a "$CLAVE")" = 600 ] || { echo "$CLAVE debe tener modo 600"; exit 2; }
[ -x "$NODE_BIN/node" ] || { echo "No está Node $(cat "$REPO/.nvmrc") en $NODE_BIN"; exit 2; }
if ss -Hltn | awk '{print $4}' | grep -qE ":$PUERTO_LOCAL\$"; then echo "127.0.0.1:$PUERTO_LOCAL ya está en uso"; exit 2; fi

ssh -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$KNOWN_HOSTS" -o ExitOnForwardFailure=yes \
  -N -L "127.0.0.1:$PUERTO_LOCAL:127.0.0.1:8001" "$DESTINO" &
TUNEL=$!
trap 'kill "$TUNEL" 2>/dev/null; wait "$TUNEL" 2>/dev/null || true' EXIT
ORIGEN="http://127.0.0.1:$PUERTO_LOCAL"
for _ in $(seq 50); do curl -fsS "$ORIGEN/health/" >/dev/null 2>&1 && break; sleep 0.2; done
echo "health: $(curl -fsS "$ORIGEN/health/")"
echo "sin credencial: $(curl -s -o /dev/null -w '%{http_code}' -X POST "$ORIGEN/api/v1/internal/agenda-availability/")"

cd "$REPO"
# La clave se lee dentro del proceso: como argumento sería visible en ps.
env -i PATH="$NODE_BIN:/usr/bin:/bin" HOME="$HOME" NODE_ENV=test TZ=UTC PONQUESITO_API_URL="$ORIGEN" \
  bash -c 'PONQUESITO_INTERNAL_API_KEY=$(cat "$1"); export PONQUESITO_INTERNAL_API_KEY
    exec ./node_modules/.bin/vitest run --config deploy/staging/test/vitest.tunel.config.mts' _ "$CLAVE"
