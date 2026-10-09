#!/usr/bin/env bash
# Despliegue recurrente de Next.js en el VPS: construye el artefacto del commit
# indicado (HEAD por defecto), lo sube al home del administrador y lo activa con
# sudo mediante ponquesito-web-release (instalado por bootstrap.sh). Si el
# release nuevo no pasa la comprobación de salud, se restaura el anterior.
#
# Uso:
#   VPS_HOST=<admin>@<host> [VPS_SSH_KEY=<ruta-llave>] \
#     BUILD_ENV_FILE=<ruta> | ARTIFACT=<tarball> [DRY_RUN=1] deploy/web/deploy-to-vps.sh [ref]
#
# VPS_HOST es obligatoria y no tiene valor por defecto. VPS_SSH_KEY es
# opcional; sin ella, ssh usa su configuración habitual (~/.ssh/config, agente).
# BUILD_ENV_FILE: variables de build (staging: deploy/web/staging.build.env).
# ARTIFACT reutiliza un artefacto ya construido (con su .sha256 al lado).
# DRY_RUN=1 construye y verifica en local y muestra lo que haría, sin conectar.
set -euo pipefail

REF="${1:-HEAD}"
HOST="${VPS_HOST:?Define VPS_HOST=<admin>@<host>}"
SSH=(ssh -o StrictHostKeyChecking=yes)
[ -n "${VPS_SSH_KEY:-}" ] && SSH+=(-i "$VPS_SSH_KEY" -o IdentitiesOnly=yes)
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -n "${ARTIFACT:-}" ]; then
  TARBALL="$ARTIFACT"
else
  PATH_FILE="$(mktemp)"; trap 'rm -f "$PATH_FILE"' EXIT
  ARTIFACT_PATH_FILE="$PATH_FILE" "$HERE/build-artifact.sh" "$REF"
  TARBALL="$(cat "$PATH_FILE")"
fi
NAME="$(basename "$TARBALL")"
(cd "$(dirname "$TARBALL")" && sha256sum --quiet -c "$NAME.sha256") \
  || { echo "El SHA-256 de $NAME no coincide" >&2; exit 1; }

CANONICAL="$(tar -xzOf "$TARBALL" "${NAME%.tar.gz}/BUILD_INFO" | grep '^canonical_url=' | cut -d= -f2-)"
echo "Artefacto $NAME (APP_CANONICAL_URL=$CANONICAL; web.env del VPS debe tener la misma)"

REMOTE_DIR='$HOME/ponquesito-web-incoming'
ACTIVATE="sudo /usr/local/sbin/ponquesito-web-release deploy \"$REMOTE_DIR/$NAME\""

if [ "${DRY_RUN:-0}" = 1 ]; then
  cat <<EOF
DRY_RUN: no se conecta a $HOST. Pasos:
  1. ${SSH[*]} $HOST 'mkdir -p -m 700 $REMOTE_DIR'
  2. subir $NAME y $NAME.sha256 a $REMOTE_DIR
  3. ${SSH[*]} -t $HOST '$ACTIVATE'
  4. borrar $REMOTE_DIR/$NAME* si la activación termina bien
EOF
  exit 0
fi

echo "Subiendo $NAME a $HOST"
"${SSH[@]}" "$HOST" "mkdir -p -m 700 $REMOTE_DIR"
for f in "$NAME" "$NAME.sha256"; do
  "${SSH[@]}" "$HOST" "cat > $REMOTE_DIR/$f.part && mv $REMOTE_DIR/$f.part $REMOTE_DIR/$f" \
    < "$(dirname "$TARBALL")/$f"
done

# -t: sudo puede pedir la contraseña del administrador.
"${SSH[@]}" -t "$HOST" "$ACTIVATE"
"${SSH[@]}" "$HOST" "rm -f $REMOTE_DIR/$NAME $REMOTE_DIR/$NAME.sha256"
echo "Desplegado $NAME. Reversión manual: ${SSH[*]} -t $HOST 'sudo ponquesito-web-release rollback'"
