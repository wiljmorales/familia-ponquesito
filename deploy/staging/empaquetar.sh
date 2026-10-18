#!/usr/bin/env bash
# Construye en local el paquete que preparar-staging.sh espera en ~/fp-staging/.
# Uso: deploy/staging/empaquetar.sh <directorio-nuevo>
# Contenido: el script, la unidad, `git archive` del backend en el SHA fijado
# en el script, los wheels exactos para Python 3.14/x86_64 con sus hashes, y
# SHA256SUMS. Sin secretos. Necesita red solo aquí (PyPI), no en el VPS.
set -euo pipefail
umask 077

DESTINO=${1:?Uso: $0 <directorio-nuevo>}
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
STAGING="$REPO/deploy/staging"
SHA=$(sed -n 's/^DEPLOY_SHA=\([0-9a-f]\{40\}\)$/\1/p' "$STAGING/preparar-staging.sh")
[ -n "$SHA" ] || { echo "DEPLOY_SHA no encontrado en preparar-staging.sh"; exit 1; }
[ "$(git -C "$REPO" cat-file -t "$SHA")" = commit ] || { echo "$SHA no es un commit"; exit 1; }
[ ! -e "$DESTINO" ] || { echo "$DESTINO ya existe"; exit 1; }
PIP="$REPO/backend/.venv/bin/python -m pip"

mkdir -p "$DESTINO/wheelhouse"
cp "$STAGING/preparar-staging.sh" "$STAGING/ponquesito-staging-backend.service" "$DESTINO/"
git -C "$REPO" archive --format=tar -o "$DESTINO/backend-$SHA.tar" "$SHA" backend
git -C "$REPO" show "$SHA:backend/requirements.txt" >"$DESTINO/.requirements.txt"
$PIP download --quiet --disable-pip-version-check --only-binary=:all: \
  --platform manylinux_2_28_x86_64 --platform manylinux_2_17_x86_64 --platform manylinux2014_x86_64 \
  --implementation cp --python-version 3.14 --abi cp314 --abi abi3 --abi none \
  -r "$DESTINO/.requirements.txt" -d "$DESTINO/wheelhouse"
rm "$DESTINO/.requirements.txt"
# typing_extensions solo se pide para Python < 3.13; el venv de producción no lo tiene.
rm -f "$DESTINO"/wheelhouse/typing_extensions-*.whl
(cd "$DESTINO/wheelhouse" && for w in *.whl; do
  echo "$(echo "$w" | cut -d- -f1 | tr '[:upper:]' '[:lower:]' | tr _ -)==$(echo "$w" | cut -d- -f2) --hash=sha256:$(sha256sum "$w" | cut -d' ' -f1)"
done) >"$DESTINO/requirements-staging.txt"
(cd "$DESTINO" && find . -type f ! -name SHA256SUMS -printf '%P\n' | LC_ALL=C sort | xargs sha256sum >SHA256SUMS)
chmod 700 "$DESTINO" "$DESTINO/wheelhouse"; chmod 600 "$DESTINO"/*.tar "$DESTINO"/*.txt "$DESTINO"/*.service "$DESTINO"/SHA256SUMS "$DESTINO"/wheelhouse/*
chmod 700 "$DESTINO/preparar-staging.sh"
echo "Paquete en $DESTINO (código $SHA)"
sha256sum "$DESTINO/preparar-staging.sh" "$DESTINO/SHA256SUMS"
