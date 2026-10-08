#!/usr/bin/env bash
# Copia al VPS el backend tal como está en el commit indicado (HEAD por
# defecto), recrea las dependencias fijadas y aplica migraciones.
# El código local versionado es la fuente; el VPS nunca se edita a mano.
#
# Se ejecuta como el administrador (dueño de /srv/ponquesito), sin sudo. Recargar el servicio sí requiere sudo
# y el script indica el comando al final.
#
# Uso:
#   VPS_HOST=<admin>@<host> [VPS_SSH_KEY=<ruta-llave>] backend/scripts/sync-to-vps.sh [ref]
#
# VPS_HOST es obligatoria y no tiene valor por defecto. VPS_SSH_KEY es
# opcional; sin ella, ssh usa su configuración habitual (~/.ssh/config, agente).
set -euo pipefail

REF="${1:-HEAD}"
HOST="${VPS_HOST:?Define VPS_HOST=<admin>@<host>}"
SSH=(ssh -o StrictHostKeyChecking=yes)
[ -n "${VPS_SSH_KEY:-}" ] && SSH+=(-i "$VPS_SSH_KEY" -o IdentitiesOnly=yes)
APP=/srv/ponquesito

cd "$(git rev-parse --show-toplevel)"
COMMIT=$(git rev-parse --short "$REF")
echo "Enviando backend @ $COMMIT a $HOST"

# /srv/ponquesito es <admin>:ponquesito con setgid (2750): lo que se crea
# dentro hereda el grupo ponquesito y queda cerrado para otros usuarios.
STAGE="$APP/.stage-$COMMIT"
git archive --format=tar "$REF" backend \
  | "${SSH[@]}" "$HOST" \
      "rm -rf '$STAGE' && mkdir -p '$STAGE' && tar -x -C '$STAGE'"

"${SSH[@]}" "$HOST" "bash -s -- $COMMIT $STAGE" <<'REMOTE'
set -euo pipefail
umask 027
export PYTHONDONTWRITEBYTECODE=1
APP=/srv/ponquesito
STAGE="$2"
rm -rf "$APP/backend"
mv "$STAGE/backend" "$APP/backend"
rmdir "$STAGE"
echo "$1" > "$APP/backend/REVISION"
[ -x "$APP/venv/bin/python" ] || python3 -m venv "$APP/venv"
"$APP/venv/bin/pip" install -q --require-virtualenv -r "$APP/backend/requirements.txt"
cd "$APP/backend"
set -a; . "$APP/backend.env"; set +a
"$APP/venv/bin/python" manage.py check --deploy --fail-level ERROR
"$APP/venv/bin/python" manage.py migrate --noinput
# Al final, cuando ya no se crean archivos: el servicio lee código y venv por
# grupo, solo el administrador escribe y nadie más entra. El grupo ponquesito se hereda
# del setgid de /srv/ponquesito (el administrador no puede fijar setgid en
# ese grupo porque no es miembro).
chmod -R g+rX,g-w,o-rwx "$APP/backend" "$APP/venv"
BAD=$(find "$APP/backend" "$APP/venv" \( ! -group ponquesito -o -perm /g+w,o+rwx \) ! -type l -print -quit)
[ -z "$BAD" ] || { echo "Permisos o grupo incorrectos en $BAD"; exit 1; }
echo "Listo: $(cat REVISION)"
if systemctl is-active --quiet ponquesito-backend; then
  echo "Para cargar el código nuevo: sudo systemctl reload ponquesito-backend"
  echo "Si cambiaron dependencias:   sudo systemctl restart ponquesito-backend"
fi
REMOTE
