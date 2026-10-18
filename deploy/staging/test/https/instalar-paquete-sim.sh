#!/usr/bin/env bash
# Copia a la simulación (~wilfredo/fp-staging-https, 700/600 como con rsync) el
# paquete de empaquetar-https.sh con UNA diferencia: Caddyfile.api-staging
# pide el certificado a Pebble (acme_ca) en vez de a Let's Encrypt. Comprueba
# que esa línea es la única diferencia y regenera SHA256SUMS solo en la copia.
# Uso: deploy/staging/test/https/instalar-paquete-sim.sh <paquete>
set -euo pipefail
C=fp-vps-sim
PAQUETE=${1:?Uso: $0 <paquete>}
LINEA='	acme_ca https://127.0.0.1:14000/dir'
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
cp -a "$PAQUETE/." "$TMP/"
(cd "$TMP" && sha256sum --quiet --strict -c SHA256SUMS)
awk -v l="$LINEA" '{print} /^\tadmin off$/ {print l}' "$PAQUETE/Caddyfile.api-staging" >"$TMP/Caddyfile.api-staging"
DIF=$(diff "$PAQUETE/Caddyfile.api-staging" "$TMP/Caddyfile.api-staging" | grep '^[<>]' || true)
[ "$DIF" = "> $LINEA" ] || { echo "la variante de simulación no difiere solo en acme_ca"; exit 1; }
(cd "$TMP" && sha256sum -- $(ls | grep -vx SHA256SUMS) >SHA256SUMS)
docker exec "$C" bash -c 'rm -rf /home/wilfredo/fp-staging-https.nuevo && install -d -m 700 -o wilfredo -g wilfredo /home/wilfredo/fp-staging-https.nuevo'
tar -C "$TMP" -cf - . | docker exec -i "$C" tar -C /home/wilfredo/fp-staging-https.nuevo -xf - --no-same-owner
docker exec "$C" bash -c 'D=/home/wilfredo/fp-staging-https; chown -R wilfredo:wilfredo $D.nuevo
  find $D.nuevo -type d -exec chmod 700 {} + ; find $D.nuevo -type f -exec chmod 600 {} +
  # Conserva evidencias y entrega de ejecuciones anteriores.
  if [ -d $D ]; then for x in $D/evidencia-* $D/entrega; do [ -e "$x" ] && mv "$x" $D.nuevo/; done; rm -r $D; fi
  mv $D.nuevo $D'
echo "paquete de simulación instalado (única diferencia: acme_ca de Pebble)"
