#!/usr/bin/env bash
# Construye en local el paquete que publicar-https.sh espera en ~/fp-staging-https/.
# Uso: deploy/staging/empaquetar-https.sh <directorio-nuevo>
# Contenido: el script, Caddyfile.api-staging, las unidades de Mailpit, el
# tar.gz de Mailpit fijado (descargado de GitHub y verificado) y SHA256SUMS.
# Sin secretos. Necesita red solo aquí, no en el VPS.
set -euo pipefail
umask 077

DESTINO=${1:?Uso: $0 <directorio-nuevo>}
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
STAGING="$REPO/deploy/staging"
TGZ=$(sed -n 's/^MAILPIT_TGZ=\(.*\)$/\1/p' "$STAGING/publicar-https.sh")
TGZ_SHA=$(sed -n 's/^MAILPIT_TGZ_SHA256=\([0-9a-f]\{64\}\)$/\1/p' "$STAGING/publicar-https.sh")
VERSION=$(sed -n 's/^mailpit-\(v[0-9.]*\)-linux-amd64\.tar\.gz$/\1/p' <<<"$TGZ")
[ -n "$VERSION" ] && [ -n "$TGZ_SHA" ] || { echo "MAILPIT_TGZ o su hash no encontrados en publicar-https.sh"; exit 1; }
[ ! -e "$DESTINO" ] || { echo "$DESTINO ya existe"; exit 1; }

mkdir -p "$DESTINO"
cp "$STAGING/publicar-https.sh" "$STAGING/ponquesito-mailpit.service" \
  "$STAGING/ponquesito-mailpit-renovar.service" "$STAGING/ponquesito-mailpit-renovar.timer" \
  "$REPO/deploy/caddy/Caddyfile.api-staging" "$DESTINO/"
curl -fsSL -o "$DESTINO/$TGZ" "https://github.com/axllent/mailpit/releases/download/$VERSION/mailpit-linux-amd64.tar.gz"
echo "$TGZ_SHA  $DESTINO/$TGZ" | sha256sum --quiet -c
(cd "$DESTINO" && sha256sum -- * >SHA256SUMS)
sha256sum "$DESTINO/publicar-https.sh" "$DESTINO/SHA256SUMS"
echo "Paquete en $DESTINO (Mailpit $VERSION)"
