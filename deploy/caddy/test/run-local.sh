#!/usr/bin/env bash
# Prueba local de las rutas de Caddy con Django real (SQLite temporal, sin
# PostgreSQL ni datos reales).
#
# Fase 1: Next.js sustituido por un stub que registra lo que recibe, para
#         comprobar la precedencia de rutas (quién atiende cada una).
# Fase 2 (si se define NEXT_DIR): Next.js real (`next start`) sobre un build
#         ya hecho, para comprobar /, /linktree y sus recursos de punta a punta.
#
# Uso: CADDY=/ruta/a/caddy [NEXT_DIR=/checkout/con/build] deploy/caddy/test/run-local.sh
# Requiere backend/.venv con requirements.txt instalados y, para la fase 2,
# `node` compatible con .nvmrc en el PATH. NEXT_DIR no debe tener archivos
# .env con credenciales: la fase 2 se niega a arrancar si los encuentra.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
CADDY="${CADDY:?Define CADDY=/ruta/al/binario/caddy}"
NEXT_DIR="${NEXT_DIR:-}"
TMP="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

if [ -n "$NEXT_DIR" ]; then
  [ -d "$NEXT_DIR/.next" ] || { echo "NEXT_DIR sin build (.next): ejecuta next build"; exit 1; }
  for f in "$NEXT_DIR"/.env "$NEXT_DIR"/.env.*; do
    [ -e "$f" ] && [ "${f##*/}" != ".env.example" ] && { echo "NEXT_DIR contiene ${f##*/}: usa un checkout sin credenciales"; exit 1; }
  done
fi

export XDG_DATA_HOME="$TMP/data" XDG_CONFIG_HOME="$TMP/config"
export STAGING_BASIC_AUTH_USER=prueba
STAGING_PASS="solo-prueba-local"
export STAGING_BASIC_AUTH_HASH="$("$CADDY" hash-password --plaintext "$STAGING_PASS")"

# Django real detrás de "HTTPS" (Caddy local), con las URLs de prueba.
(
  cd "$ROOT/backend"
  DJANGO_SETTINGS_MODULE=config.tests.e2e_settings \
  E2E_SQLITE_PATH="$TMP/e2e.sqlite3" \
  DJANGO_SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(40))')" \
  DJANGO_ALLOWED_HOSTS=apex.ponquesito.test,staging.ponquesito.test \
  DJANGO_BEHIND_HTTPS_PROXY=true \
  DJANGO_CSRF_TRUSTED_ORIGINS=https://apex.ponquesito.test:18443,https://staging.ponquesito.test:18443 \
  POSTGRES_DB=x POSTGRES_USER=x POSTGRES_PASSWORD=x PYTHONDONTWRITEBYTECODE=1 \
  exec .venv/bin/gunicorn --bind 127.0.0.1:18001 --workers 1 --no-control-socket \
    --error-logfile "$TMP/gunicorn.log" --access-logfile "$TMP/access.log" config.wsgi:application
) & PIDS+=($!)
: > "$TMP/next.log"
python3 -I "$ROOT/deploy/caddy/test/next_stub.py" 18002 "$TMP/next.log" & STUB=$!; PIDS+=($STUB)

cd "$ROOT/deploy/caddy/test"
"$CADDY" validate --config Caddyfile.local --adapter caddyfile >"$TMP/validate.log" 2>&1 \
  || { echo "caddy validate FALLÓ"; cat "$TMP/validate.log"; exit 1; }
"$CADDY" run --config Caddyfile.local --adapter caddyfile >"$TMP/caddy.log" 2>&1 & PIDS+=($!)

CA="$XDG_DATA_HOME/caddy/pki/authorities/local/root.crt"
for _ in $(seq 50); do [ -f "$CA" ] && curl -s -o /dev/null --cacert "$CA" --resolve apex.ponquesito.test:18443:127.0.0.1 https://apex.ponquesito.test:18443/health/ && break; sleep 0.2; done

R=(--resolve apex.ponquesito.test:18443:127.0.0.1 --resolve www.ponquesito.test:18443:127.0.0.1
   --resolve staging.ponquesito.test:18443:127.0.0.1 --resolve apex.ponquesito.test:18080:127.0.0.1)
c() { curl -s --cacert "$CA" "${R[@]}" "$@"; }
code() { c -o /dev/null -w '%{http_code}' "$@"; }
hdr() { c -o /dev/null -D - "${@:2}" | tr -d '\r' | awk -v h="$(echo "$1" | tr A-Z a-z)" 'tolower($1)==h":"{sub(/^[^:]*: /,""); print}'; }
sha() { sha256sum | cut -c1-64; }
json() { python3 -c "import sys,json;print(json.load(sys.stdin)[\"$1\"])"; }

FAIL=0
ok() { if [ "$2" == "$3" ]; then echo "  OK  $1"; else echo "  FALLA $1 — esperado [$2], obtenido [$3]"; FAIL=1; fi; }
# Comprueba que la petición la atendió Django: Next.js (stub) no recibió nada.
nada_a_next() { ok "$1: Next.js no la recibió" "" "$(cat "$TMP/next.log")"; : > "$TMP/next.log"; }

A=https://apex.ponquesito.test:18443
W=https://www.ponquesito.test:18443
S=https://staging.ponquesito.test:18443
AUTH=(-u "prueba:$STAGING_PASS")
LT_SHA=$(sha < "$ROOT/public/linktree.html")

echo "== Fase 1: precedencia (Next.js = stub)"
echo "-- Next.js"
ok "/ → Next.js"                           "next-stub GET /" "$(c $A/)"
ok "/linktree → Next.js"                   "next-stub GET /linktree" "$(c $A/linktree)"
ok "/linktree?utm_source=qr → Next.js"     "next-stub GET /linktree?utm_source=qr" "$(c "$A/linktree?utm_source=qr")"
ok "/linktree/ → Next.js (sin tocar)"      "next-stub GET /linktree/" "$(c $A/linktree/)"
ok "/favicon.svg → Next.js"                "next-stub GET /favicon.svg" "$(c $A/favicon.svg)"
ok "/assets/logo… → Next.js"               "next-stub GET /assets/logo-familia-ponquesito.png" "$(c $A/assets/logo-familia-ponquesito.png)"
ok "/agenda → Next.js"                     "next-stub GET /agenda" "$(c $A/agenda)"
ok "POST /api/assistant → Next.js"         "next-stub POST /api/assistant" "$(c -X POST $A/api/assistant)"
ok "POST /api/agent → Next.js"             "next-stub POST /api/agent" "$(c -X POST $A/api/agent)"
ok "GET /api/reports/weekly → Next.js"     "next-stub GET /api/reports/weekly" "$(c $A/api/reports/weekly)"
ok "/api/v1x → Next.js (límite de ruta)"   "next-stub GET /api/v1x" "$(c $A/api/v1x)"
ok "/api/v10/a → Next.js"                  "next-stub GET /api/v10/a" "$(c $A/api/v10/a)"
ok "/api/v2/a → Next.js"                   "next-stub GET /api/v2/a" "$(c $A/api/v2/a)"
ok "/healthz → Next.js"                    "next-stub GET /healthz" "$(c $A/healthz)"
ok "/backend/health/ → Next.js (sin prefijo)" "next-stub GET /backend/health/" "$(c $A/backend/health/)"
: > "$TMP/next.log"

echo "-- Django"
ok "/health/ 200"                          "200" "$(code $A/health/)"
ok "/health/ cuerpo"                       '{"status": "ok", "database": "ok"}' "$(c $A/health/)"
ok "/health → /health/ (APPEND_SLASH)"     "/health/" "$(hdr Location $A/health)"
nada_a_next "/health/"
J=$(c $A/api/v1/probe/cookies/)
ok "/api/v1/probe/cookies/ → Django"       "/api/v1/probe/cookies/" "$(echo "$J" | json path)"
ok "reverse() dentro de /api/v1/"          "/api/v1/probe/cookies/" "$(echo "$J" | json probe)"
ok "URL absoluta https"                    "https://apex.ponquesito.test:18443/health/" "$(echo "$J" | json absolute)"
ok "request.is_secure() vía proxy"         "True" "$(echo "$J" | json secure)"
ok "redirect() se queda en /api/v1/"       "/api/v1/probe/cookies/" "$(hdr Location $A/api/v1/probe/redirect/)"
ok "APPEND_SLASH en /api/v1/"              "/api/v1/probe/redirect/" "$(hdr Location $A/api/v1/probe/redirect)"
COOK=$(c -o /dev/null -D - $A/api/v1/probe/cookies/ | tr -d '\r' | grep -i '^set-cookie:')
for n in csrftoken sessionid; do
  line=$(echo "$COOK" | grep -i "set-cookie: $n=")
  ok "cookie $n Path=/api/v1/"             "1" "$(echo "$line" | grep -ci 'Path=/api/v1/;\|Path=/api/v1/$')"
  ok "cookie $n Secure"                    "1" "$(echo "$line" | grep -ci '; Secure')"
done
ok "/api/v1/no-existe/ → 404 de Django"    "404" "$(code $A/api/v1/no-existe/)"
ok "/api/v1 → Django (404)"                "404" "$(code $A/api/v1)"
ok "POST /api/v1/probe/cookies/ → CSRF de Django (403)" "403" "$(code -X POST $A/api/v1/probe/cookies/)"
nada_a_next "/api/v1/*"

echo "-- Cabeceras y HTTP"
ok "nosniff"                               "nosniff" "$(hdr X-Content-Type-Options $A/health/)"
ok "sin cabecera Server"                   "" "$(hdr Server $A/health/)"
ok "http → https (308)"                    "308" "$(code http://apex.ponquesito.test:18080/linktree)"
ok "http → https conserva ruta"            "https://apex.ponquesito.test/linktree" "$(hdr Location http://apex.ponquesito.test:18080/linktree)"

echo "-- www → apex (conserva ruta y parámetros)"
ok "www /linktree?utm_source=qr&x=1 → 301" "301" "$(code "$W/linktree?utm_source=qr&x=1")"
ok "www conserva ruta+query"               "https://apex.ponquesito.test/linktree?utm_source=qr&x=1" "$(hdr Location "$W/linktree?utm_source=qr&x=1")"
ok "www ruta profunda+query"               "https://apex.ponquesito.test/agenda/reservas/FP-8-TEST?token=abc" "$(hdr Location "$W/agenda/reservas/FP-8-TEST?token=abc")"
ok "www /api/v1/…"                         "https://apex.ponquesito.test/api/v1/x?y=1" "$(hdr Location "$W/api/v1/x?y=1")"
ok "www raíz"                              "https://apex.ponquesito.test/" "$(hdr Location "$W/")"
nada_a_next "www"

echo "-- Staging restringido"
ok "sin credenciales / → 401"              "401" "$(code $S/)"
ok "sin credenciales /linktree → 401"      "401" "$(code $S/linktree)"
ok "sin credenciales /health/ → 401"       "401" "$(code $S/health/)"
ok "sin credenciales /api/v1/ → 401"       "401" "$(code $S/api/v1/probe/cookies/)"
ok "credencial errónea → 401"              "401" "$(code -u prueba:otra $S/)"
nada_a_next "staging sin credenciales"
ok "X-Robots-Tag noindex"                  "noindex, nofollow, noarchive" "$(hdr X-Robots-Tag "${AUTH[@]}" $S/health/)"
ok "/health/ con credenciales"             "200" "$(code "${AUTH[@]}" $S/health/)"
ok "/api/v1/ con credenciales → Django"    "/api/v1/probe/cookies/" "$(c "${AUTH[@]}" $S/api/v1/probe/cookies/ | json path)"
ok "POST /api/v1/ llega a Django (su CSRF)" "403" "$(code "${AUTH[@]}" -X POST $S/api/v1/probe/cookies/)"
ok "…y no es el bloqueo de Caddy"          "0" "$(c "${AUTH[@]}" -X POST $S/api/v1/probe/cookies/ | grep -c 'Deshabilitado en staging')"
ok "POST a Next.js bloqueado (403)"        "403" "$(code "${AUTH[@]}" -X POST $S/agenda)"
ok "PUT a Next.js bloqueado (403)"         "403" "$(code "${AUTH[@]}" -X PUT $S/)"
ok "POST /api/assistant bloqueado"         "403" "$(code "${AUTH[@]}" -X POST $S/api/assistant)"
ok "GET /api/reports/weekly bloqueado"     "403" "$(code "${AUTH[@]}" $S/api/reports/weekly)"
ok "GET /api/v1x bloqueado (es de Next)"   "403" "$(code "${AUTH[@]}" $S/api/v1x)"
nada_a_next "bloqueos de staging"
ok "GET / permitido → Next.js"             "next-stub GET /" "$(c "${AUTH[@]}" $S/)"
ok "GET /linktree permitido → Next.js"     "next-stub GET /linktree" "$(c "${AUTH[@]}" $S/linktree)"
: > "$TMP/next.log"

if [ -n "$NEXT_DIR" ]; then
  echo "== Fase 2: Next.js real ($(cd "$NEXT_DIR" && git rev-parse --short HEAD 2>/dev/null || echo '?'))"
  kill "$STUB"; wait "$STUB" 2>/dev/null
  ( cd "$NEXT_DIR" && NEXT_TELEMETRY_DISABLED=1 exec node_modules/.bin/next start -H 127.0.0.1 -p 18002 >"$TMP/next-real.log" 2>&1 ) & NEXT_PID=$!; PIDS+=($NEXT_PID)
  for _ in $(seq 100); do curl -s -o /dev/null http://127.0.0.1:18002/linktree && break; sleep 0.2; done
  HOME_HTML=$(c $A/)
  ok "/ 200 desde Next.js"                 "200" "$(code $A/)"
  ok "/ es el landing de Next.js"          "1" "$(echo "$HOME_HTML" | grep -c '/_next/static' | sed 's/[1-9][0-9]*/1/')"
  ok "/ no es la página de enlaces"        "1" "$([ "$(echo -n "$HOME_HTML" | sha)" != "$LT_SHA" ] && echo 1)"
  ok "/linktree byte a byte"               "$LT_SHA" "$(c $A/linktree | sha)"
  ok "/linktree content-type"              "text/html; charset=utf-8" "$(hdr Content-Type $A/linktree)"
  ok "/linktree?utm_source=qr byte a byte" "$LT_SHA" "$(c "$A/linktree?utm_source=qr" | sha)"
  ok "/linktree/?a=1 → 308"                "308" "$(code "$A/linktree/?a=1")"
  ok "/linktree/?a=1 → Location"           "/linktree?a=1" "$(hdr Location "$A/linktree/?a=1")"
  ok "/favicon.svg idéntico"               "$(sha < "$ROOT/public/favicon.svg")" "$(c $A/favicon.svg | sha)"
  ok "/favicon.svg content-type"           "image/svg+xml" "$(hdr Content-Type $A/favicon.svg)"
  ok "logo idéntico"                       "$(sha < "$ROOT/public/assets/logo-familia-ponquesito.png")" "$(c $A/assets/logo-familia-ponquesito.png | sha)"
  ok "GET /api/assistant → Next.js (405)"  "405" "$(code $A/api/assistant)"
  ok "GET /api/agent → Next.js (405)"      "405" "$(code $A/api/agent)"
  ok "/api/v1/no-existe/ → 404 de Django"  "0" "$(c $A/api/v1/no-existe/ | grep -c '_next')"
  ok "/health/ sigue en Django"            '{"status": "ok", "database": "ok"}' "$(c $A/health/)"
  ok "staging /linktree byte a byte"       "$LT_SHA" "$(c "${AUTH[@]}" $S/linktree | sha)"
  ok "staging / landing"                   "200" "$(code "${AUTH[@]}" $S/)"
  kill "$NEXT_PID"; wait "$NEXT_PID" 2>/dev/null
else
  echo "== Fase 2 omitida (define NEXT_DIR para probar con Next.js real)"
  kill "$STUB"; wait "$STUB" 2>/dev/null
fi

echo "== Next.js caído"
ok "staging Next.js caído → 503"           "503" "$(code "${AUTH[@]}" $S/agenda)"
ok "Django sigue respondiendo"             "200" "$(code "${AUTH[@]}" $S/health/)"

echo
if [ "$FAIL" -eq 0 ]; then echo "TODAS LAS PRUEBAS OK"; else echo "HAY FALLOS"; tail -20 "$TMP/caddy.log"; fi
exit "$FAIL"
