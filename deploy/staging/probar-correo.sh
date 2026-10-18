#!/usr/bin/env bash
# Prueba el SMTP de pruebas de Preview (Mailpit en api-staging:465) desde este
# equipo, con el cliente de correo real de la app, y revisa el buzón por túnel.
# Uso: deploy/staging/probar-correo.sh <smtp-password> <ui-password> [destino-ssh]
#   <smtp-password>, <ui-password>  copias privadas (600) de ~/fp-staging-https/entrega/
#   [destino-ssh]  por defecto wilfredo@37.27.149.66 con ~/.ssh/familia_ponquesito
# Envía un correo a cliente.preview@example.invalid y comprueba que uno a
# example.com se rechaza. Después, por túnel 127.0.0.1:18025 → 127.0.0.1:8025,
# que el mensaje llegó y que el buzón no tiene destinatarios fuera de .invalid.
# Variables para la simulación: FP_SIM_IP, NODE_EXTRA_CA_CERTS y MAILPIT_URL
# (sin túnel).
set -euo pipefail

SMTP_PASS=${1:?Uso: $0 <smtp-password> <ui-password> [destino-ssh]}
UI_PASS=${2:?Uso: $0 <smtp-password> <ui-password> [destino-ssh]}
DESTINO=${3:-wilfredo@37.27.149.66}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/familia_ponquesito}
KNOWN_HOSTS=${KNOWN_HOSTS:-$HOME/.ssh/known_hosts}
PUERTO_LOCAL=${PUERTO_LOCAL:-18025}
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
NODE_BIN=${NODE_BIN:-$HOME/.nvm/versions/node/v$(cat "$REPO/.nvmrc" | tr -d 'v[:space:]')/bin}
ASUNTO="fp-preview-correo $(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"

for f in "$SMTP_PASS" "$UI_PASS"; do [ "$(stat -c %a "$f")" = 600 ] || { echo "$f debe tener modo 600"; exit 2; }; done
[ -x "$NODE_BIN/node" ] || { echo "No está Node $(cat "$REPO/.nvmrc") en $NODE_BIN"; exit 2; }

cd "$REPO"
# La contraseña se lee dentro del proceso: como argumento sería visible en ps.
env -i PATH="$NODE_BIN:/usr/bin:/bin" HOME="$HOME" NODE_ENV=test TZ=UTC FP_ASUNTO="$ASUNTO" \
  ${FP_SIM_IP:+FP_SIM_IP="$FP_SIM_IP"} ${NODE_EXTRA_CA_CERTS:+NODE_EXTRA_CA_CERTS="$NODE_EXTRA_CA_CERTS"} \
  SMTP_HOST=api-staging.familiaponquesito.com SMTP_PORT=465 SMTP_SECURE=true SMTP_USER=vercel-preview \
  EMAIL_FROM="Familia Ponquesito Preview <preview@example.invalid>" \
  bash -c 'SMTP_APP_PASSWORD=$(cat "$1"); export SMTP_APP_PASSWORD
    exec ./node_modules/.bin/vitest run --config deploy/staging/test/vitest.correo.config.mts correo-preview' _ "$SMTP_PASS"

if [ -z "${MAILPIT_URL:-}" ]; then
  if ss -Hltn | awk '{print $4}' | grep -qE ":$PUERTO_LOCAL\$"; then echo "127.0.0.1:$PUERTO_LOCAL ya está en uso"; exit 2; fi
  ssh -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$KNOWN_HOSTS" -o ExitOnForwardFailure=yes \
    -N -L "127.0.0.1:$PUERTO_LOCAL:127.0.0.1:8025" "$DESTINO" &
  TUNEL=$!
  trap 'kill "$TUNEL" 2>/dev/null; wait "$TUNEL" 2>/dev/null || true' EXIT
  MAILPIT_URL="http://127.0.0.1:$PUERTO_LOCAL"
  for _ in $(seq 50); do curl -s -o /dev/null "$MAILPIT_URL/" 2>/dev/null && break; sleep 0.2; done
fi
# Credencial de la interfaz por stdin (-K -), no en la línea de órdenes.
api() { printf 'user = "operador:%s"\n' "$(cat "$UI_PASS")" | curl -fsS --max-time 10 -K - "$MAILPIT_URL$1"; }
api "/api/v1/search?query=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "subject:\"$ASUNTO\"")" | python3 -c '
import json, sys
d = json.load(sys.stdin)
para = sorted({t["Address"] for m in d["messages"] for t in (m.get("To") or [])})
print("buzón: %d mensaje(s) con el asunto de esta prueba, para %s" % (d["messages_count"], para))
sys.exit(0 if d["messages_count"] == 1 and para == ["cliente.preview@example.invalid"] else 1)'
api "/api/v1/messages?limit=1000" | python3 -c '
import json, sys
d = json.load(sys.stdin)
fuera = [a for m in d["messages"] for k in ("To", "Cc", "Bcc") for a in (t["Address"] for t in (m.get(k) or [])) if not a.lower().endswith(".invalid")]
print("buzón: %d mensajes en total; destinatarios fuera de .invalid: %d" % (d["total"], len(fuera)))
sys.exit(0 if not fuera else 1)'
echo "SMTP de Preview: OK"
