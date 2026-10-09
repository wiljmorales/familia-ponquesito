#!/usr/bin/env bash
# Construye el artefacto de Next.js para el VPS desde un checkout limpio del
# commit indicado (HEAD por defecto). No usa el directorio de trabajo: ni
# .env.local, ni node_modules, ni cambios sin confirmar llegan al artefacto.
#
# Uso:
#   BUILD_ENV_FILE=<ruta> [OUT_DIR=<dir>] [ARTIFACT_PATH_FILE=<ruta>] \
#     deploy/web/build-artifact.sh [ref]
#
# BUILD_ENV_FILE es obligatoria (staging: deploy/web/staging.build.env). Solo
# se leen de ella las variables de build de deploy/web/.env.example, y
# APP_CANONICAL_URL es obligatoria. El build corre con un entorno vacío: nada
# más de tu shell entra en el bundle.
#
# Identidad: ponquesito-web-<commit12>-<build12>.tar.gz (+ .sha256), donde
# <build12> es el SHA-256 del archivo BUILD_ENV que viaja en el artefacto (las
# variables de build, todas públicas). Un mismo commit compilado con otras
# variables produce otro nombre. ARTIFACT_PATH_FILE recibe la ruta final.
set -euo pipefail

REF="${1:-HEAD}"
OUT_DIR="${OUT_DIR:-/tmp/ponquesito-web-artifacts}"
# Orden fijo: forma parte del fingerprint.
BUILD_VARS=(APP_CANONICAL_URL NEXT_PUBLIC_WHATSAPP_URL)

REPO="$(git rev-parse --show-toplevel)"
cd "$REPO"
FULL_SHA="$(git rev-parse --verify "$REF^{commit}")"
SHA="${FULL_SHA:0:12}"
NODE_WANT="$(git show "$FULL_SHA:.nvmrc" | tr -d '[:space:]')"

# Node debe ser exactamente el de .nvmrc del commit (el del VPS se comprueba
# al activar). Va primero: el resto del script ya usa node.
NODE_HAVE="$(node --version 2>/dev/null | sed 's/^v//')" || true
if [ "$NODE_HAVE" != "$NODE_WANT" ]; then
  echo "Node $NODE_WANT requerido (.nvmrc); en el PATH hay '${NODE_HAVE:-ninguno}'. Ejecuta: nvm use" >&2
  exit 1
fi

# Variables de build: solo las permitidas, desde un archivo explícito.
ENV_FILE_IN="${BUILD_ENV_FILE:?Define BUILD_ENV_FILE (staging: deploy/web/staging.build.env)}"
[ -f "$ENV_FILE_IN" ] || { echo "No existe $ENV_FILE_IN" >&2; exit 1; }
BUILD_ENV_TEXT=""
ENV_ARGS=(PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 PONQUESITO_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1)
for v in "${BUILD_VARS[@]}"; do
  line="$(grep -E "^${v}=" "$ENV_FILE_IN" | tail -1 || true)"
  val="${line#*=}"; val="${val%\"}"; val="${val#\"}"
  if [[ "$val" =~ [[:space:]\"\'\\] ]]; then
    echo "$v contiene espacios, comillas o barras invertidas" >&2; exit 1
  fi
  BUILD_ENV_TEXT+="$v=$val"$'\n'
  [ -n "$val" ] && ENV_ARGS+=("$v=$val")
  declare "BV_$v=$val"
done

# URL canónica obligatoria y exacta: origen https, sin ruta, barra final,
# credenciales ni parámetros. Sin ella Next.js usaría la de producción en
# Vercel (src/lib/site-url.ts).
CANONICAL="$BV_APP_CANONICAL_URL"
[ -n "$CANONICAL" ] || { echo "APP_CANONICAL_URL es obligatoria en $ENV_FILE_IN" >&2; exit 1; }
if ! node -e 'const v=process.argv[1];let u;try{u=new URL(v)}catch{process.exit(1)}
  process.exit(u.protocol==="https:"&&u.origin===v?0:1)' "$CANONICAL"; then
  echo "APP_CANONICAL_URL debe ser un origen https exacto, sin ruta ni barra final: $CANONICAL" >&2
  exit 1
fi
FP="$(printf '%s' "$BUILD_ENV_TEXT" | sha256sum | cut -c1-12)"
ID="$SHA-$FP"


# Ruta de build fija y neutra: Next.js graba la ruta absoluta del proyecto en
# server.js; así no contiene el usuario ni el directorio local.
BUILD_DIR="/tmp/ponquesito-web-build/$ID"
rm -rf "$BUILD_DIR"
git worktree prune
mkdir -p "$(dirname "$BUILD_DIR")"
git worktree add --detach --quiet "$BUILD_DIR" "$FULL_SHA"
cleanup() { git -C "$REPO" worktree remove --force "$BUILD_DIR" 2>/dev/null || rm -rf "$BUILD_DIR"; }
trap cleanup EXIT

echo "== Build $ID (Node $NODE_HAVE; URL canónica $CANONICAL)"
(
  cd "$BUILD_DIR"
  env -i "${ENV_ARGS[@]}" npm ci --no-audit --no-fund --loglevel=error
  env -i "${ENV_ARGS[@]}" npx --no-install next build
)

# Ensamblado: servidor standalone + .next/static + public.
NAME="ponquesito-web-$ID"
STAGE="$BUILD_DIR/.artifact/$NAME"
mkdir -p "$STAGE"
cp -a "$BUILD_DIR/.next/standalone/." "$STAGE/"
cp -a "$BUILD_DIR/.next/static" "$STAGE/.next/static"
cp -a "$BUILD_DIR/public" "$STAGE/public"
rm -rf "$STAGE/.next/cache"
printf '%s\n' "$FULL_SHA" > "$STAGE/REVISION"
printf '%s\n' "$NODE_WANT" > "$STAGE/NODE_VERSION"
printf '%s' "$BUILD_ENV_TEXT" > "$STAGE/BUILD_ENV"
{
  echo "commit=$FULL_SHA"
  echo "node=$NODE_WANT"
  echo "canonical_url=$CANONICAL"
  echo "build_fingerprint=$FP"
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
[ -z "${ARTIFACT_PATH_FILE:-}" ] || printf '%s\n' "$TARBALL" > "$ARTIFACT_PATH_FILE"
