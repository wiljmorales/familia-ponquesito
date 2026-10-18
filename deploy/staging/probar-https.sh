#!/usr/bin/env bash
# Prueba el backend de staging por HTTPS (Caddy en el VPS), desde este equipo y
# como lo usará Vercel Preview: los flujos reales de Next.js (deploy/staging/test/)
# con PONQUESITO_API_URL=https://api-staging.familiaponquesito.com, incluida la
# imagen de 4.000.000 bytes. Correo: receptor SMTP local (.invalid); sin otra red.
# Escribe datos sintéticos en ponquesito_staging. Requiere publicar-https.sh --aplicar.
# Uso: deploy/staging/probar-https.sh <archivo-clave-interna>
# Simulación: FP_SIM_IP (IP del contenedor) y NODE_EXTRA_CA_CERTS (raíz de Pebble).
set -euo pipefail

CLAVE=${1:?Uso: $0 <archivo-clave-interna>}
ORIGEN=https://api-staging.familiaponquesito.com
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
NODE_BIN=${NODE_BIN:-$HOME/.nvm/versions/node/v$(cat "$REPO/.nvmrc" | tr -d 'v[:space:]')/bin}
RESOLVE=()
[ -z "${FP_SIM_IP:-}" ] || RESOLVE=(--resolve "api-staging.familiaponquesito.com:443:$FP_SIM_IP" ${NODE_EXTRA_CA_CERTS:+--cacert "$NODE_EXTRA_CA_CERTS"})

[ "$(stat -c %a "$CLAVE")" = 600 ] || { echo "$CLAVE debe tener modo 600"; exit 2; }
[ -x "$NODE_BIN/node" ] || { echo "No está Node $(cat "$REPO/.nvmrc") en $NODE_BIN"; exit 2; }
# Certificado verificado (sin -k).
echo "health: $(curl -fsS "${RESOLVE[@]}" "$ORIGEN/health/")"
echo "sin credencial: $(curl -sS "${RESOLVE[@]}" -o /dev/null -w '%{http_code}' -X POST "$ORIGEN/api/v1/internal/agenda-availability/")"

cd "$REPO"
# La clave se lee dentro del proceso: como argumento sería visible en ps.
env -i PATH="$NODE_BIN:/usr/bin:/bin" HOME="$HOME" NODE_ENV=test TZ=UTC PONQUESITO_API_URL="$ORIGEN" \
  ${FP_SIM_IP:+FP_SIM_IP="$FP_SIM_IP"} ${NODE_EXTRA_CA_CERTS:+NODE_EXTRA_CA_CERTS="$NODE_EXTRA_CA_CERTS"} \
  bash -c 'PONQUESITO_INTERNAL_API_KEY=$(cat "$1"); export PONQUESITO_INTERNAL_API_KEY
    exec ./node_modules/.bin/vitest run --config deploy/staging/test/vitest.tunel.config.mts' _ "$CLAVE"
