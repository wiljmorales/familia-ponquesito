#!/usr/bin/env bash
# Construye el artefacto de Next.js para el VPS desde un checkout limpio del
# commit indicado (HEAD por defecto). No usa el directorio de trabajo: ni
# .env.local, ni node_modules, ni cambios sin confirmar llegan al artefacto.
#
# Uso:
#   [BUILD_ENV_FILE=<ruta>] [OUT_DIR=<dir>] deploy/web/build-artifact.sh [ref]
#
# BUILD_ENV_FILE (opcional, fuera de Git): solo se leen de él las variables de
# build de deploy/web/.env.example; cualquier otra se ignora. El build corre
# con un entorno vacío, así que nada más de tu shell entra en el bundle.
#
# Salida en OUT_DIR (por defecto /tmp/ponquesito-web-artifacts):
#   ponquesito-web-<commit>.tar.gz y su .sha256
set -euo pipefail

REF="${1:-HEAD}"
OUT_DIR="${OUT_DIR:-/tmp/ponquesito-web-artifacts}"
BUILD_VARS=(NEXT_PUBLIC_WHATSAPP_URL APP_CANONICAL_URL)

REPO="$(git rev-parse --show-toplevel)"
cd "$REPO"
FULL_SHA="$(git rev-parse --verify "$REF^{commit}")"
SHA="${FULL_SHA:0:12}"
NODE_WANT="$(git show "$FULL_SHA:.nvmrc" | tr -d '[:space:]')"

# Node debe ser exactamente el de .nvmrc (el del VPS se comprueba al activar).
NODE_HAVE="$(node --version 2>/dev/null | sed 's/^v//')" || true
if [ "$NODE_HAVE" != "$NODE_WANT" ]; then
  echo "Node $NODE_WANT requerido (.nvmrc); en el PATH hay '${NODE_HAVE:-ninguno}'. Ejecuta: nvm use" >&2
  exit 1
fi

# Variables de build: solo las permitidas, desde un archivo explícito.
ENV_ARGS=(PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 PONQUESITO_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1)
BUILD_INFO_VARS=""
if [ -n "${BUILD_ENV_FILE:-}" ]; then
  for v in "${BUILD_VARS[@]}"; do
    line="$(grep -E "^${v}=" "$BUILD_ENV_FILE" | tail -1 || true)"
    [ -n "$line" ] || continue
    val="${line#*=}"; val="${val%\"}"; val="${val#\"}"
    [ -n "$val" ] || continue
    ENV_ARGS+=("$v=$val")
    BUILD_INFO_VARS+=" $v"
  done
fi

# Ruta de build fija y neutra: Next.js graba la ruta absoluta del proyecto en
# server.js; así no contiene el usuario ni el directorio local.
BUILD_DIR="/tmp/ponquesito-web-build/$SHA"
rm -rf "$BUILD_DIR"
git worktree prune
mkdir -p "$(dirname "$BUILD_DIR")"
git worktree add --detach --quiet "$BUILD_DIR" "$FULL_SHA"
cleanup() { git -C "$REPO" worktree remove --force "$BUILD_DIR" 2>/dev/null || rm -rf "$BUILD_DIR"; }
trap cleanup EXIT

echo "== Build $SHA (Node $NODE_HAVE; variables de build:${BUILD_INFO_VARS:- ninguna})"
(
  cd "$BUILD_DIR"
  env -i "${ENV_ARGS[@]}" npm ci --no-audit --no-fund --loglevel=error
  env -i "${ENV_ARGS[@]}" npx --no-install next build
)

# Ensamblado: servidor standalone + .next/static + public.
NAME="ponquesito-web-$SHA"
STAGE="$BUILD_DIR/.artifact/$NAME"
mkdir -p "$STAGE"
cp -a "$BUILD_DIR/.next/standalone/." "$STAGE/"
cp -a "$BUILD_DIR/.next/static" "$STAGE/.next/static"
cp -a "$BUILD_DIR/public" "$STAGE/public"
rm -rf "$STAGE/.next/cache"
printf '%s\n' "$FULL_SHA" > "$STAGE/REVISION"
printf '%s\n' "$NODE_WANT" > "$STAGE/NODE_VERSION"
{
  echo "commit=$FULL_SHA"
  echo "node=$NODE_WANT"
  echo "build_vars=${BUILD_INFO_VARS# }"
} > "$STAGE/BUILD_INFO"

# Nada que no deba viajar. Se aborta en vez de borrar en silencio.
BAD="$(cd "$STAGE" && find . \( -name '.git' -o -name '.env*' -o -name '*.pem' \
  -o -name '*.tsbuildinfo' -o -path './backend' -o -path './.next/cache' \
  -o -path './node_modules/.cache' -o -name '.DS_Store' \) -print)"
if [ -n "$BAD" ]; then
  echo "El artefacto contiene archivos prohibidos:" >&2; echo "$BAD" >&2; exit 1
fi
for f in server.js .next/BUILD_ID .next/static public/linktree.html src/knowledge/familia-ponquesito.md; do
  [ -e "$STAGE/$f" ] || { echo "Falta $f en el artefacto" >&2; exit 1; }
done
LEAK="$(grep -rlIF -e "$HOME" -e "$REPO" "$STAGE" || true)"
if [ -n "$LEAK" ]; then
  echo "El artefacto contiene rutas locales:" >&2; echo "$LEAK" >&2; exit 1
fi

# Tar reproducible: orden, dueño y fecha fijos (fecha del commit).
mkdir -p "$OUT_DIR"
MTIME="$(git show -s --format=%ct "$FULL_SHA")"
TARBALL="$OUT_DIR/$NAME.tar.gz"
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime="@$MTIME" \
  --format=gnu -C "$STAGE/.." -cf - "$NAME" | gzip -n -9 > "$TARBALL"
(cd "$OUT_DIR" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")

echo "== Artefacto: $TARBALL ($(du -h "$TARBALL" | cut -f1))"
cat "$TARBALL.sha256"
