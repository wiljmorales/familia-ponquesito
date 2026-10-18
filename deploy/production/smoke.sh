#!/usr/bin/env bash
# Solo ejecutar tras autorización del despliegue. GET/HEAD, sin escrituras.
# No equivale a validar formularios, correo ni integración con Django.
set -euo pipefail
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
code() { curl --silent --show-error --connect-timeout 10 --max-time 30 -o "$work/body" -w '%{http_code}' "$1"; }
for path in / /linktree /agenda /crea-tu-torta; do
  test "$(code "https://familiaponquesito.com$path")" = 200
  printf 'OK web %s\n' "$path"
done
test "$(code https://api.familiaponquesito.com/health/)" = 200
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d == {"status":"ok","database":"ok"}' "$work/body"
test "$(code https://api.familiaponquesito.com/)" = 404
# El índice /api/v1/ no es un endpoint; solo existen rutas específicas.
test "$(code https://api.familiaponquesito.com/api/v1/)" = 404
test "$(code https://familiaponquesito.com/api/reports/weekly)" = 401
curl --silent --show-error --head --max-time 30 https://www.familiaponquesito.com/linktree | tr -d '\r' > "$work/headers"
grep -Eiq '^HTTP/[^ ]+ (301|302|307|308)' "$work/headers"
grep -Eiq '^location: https://familiaponquesito.com/linktree$' "$work/headers"
curl --silent --show-error --head --max-time 30 http://api.familiaponquesito.com/health/ | tr -d '\r' > "$work/headers"
grep -Eiq '^HTTP/[^ ]+ (301|302|307|308)' "$work/headers"
grep -Eiq '^location: https://api.familiaponquesito.com/health/$' "$work/headers"
printf 'OK HTTPS, redirecciones, health y cron protegido; pendiente flujo de negocio manual\n'
