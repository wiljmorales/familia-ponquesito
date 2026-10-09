#!/usr/bin/env bash
# Prueba local de las rutas de Caddy con Django real (SQLite temporal, sin
# PostgreSQL ni datos reales).
#
# Fase 1: Next.js sustituido por un stub que registra lo que recibe, para
#         comprobar la precedencia de rutas (quién atiende cada una).
# Fase 2 (si se define NEXT_DIR o NEXT_RELEASE): Next.js real sobre un build
#         ya hecho, para comprobar /, /linktree y sus recursos de punta a punta.
#         NEXT_DIR: checkout con `next build` (se arranca con `next start`).
#         NEXT_RELEASE: release standalone extraído de un artefacto de
#         deploy/web (se arranca con `node server.js` y la URL de BUILD_INFO).
#
# Los sitios .test: apex (rutas completas), www, staging y fase1 (lanzamiento
# fase 1: solo /linktree, ver Caddyfile.fase1).
#
# Uso: CADDY=/ruta/a/caddy [NEXT_DIR=<checkout> | NEXT_RELEASE=<release>] deploy/caddy/test/run-local.sh
# Requiere backend/.venv con requirements.txt instalados y, para la fase 2,
# `node` compatible con .nvmrc en el PATH. El directorio de Next.js no debe
# tener archivos .env con credenciales: la fase 2 se niega a arrancar si los
# encuentra.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
CADDY="${CADDY:?Define CADDY=/ruta/al/binario/caddy}"
NEXT_DIR="${NEXT_DIR:-}"
NEXT_RELEASE="${NEXT_RELEASE:-}"
TMP="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

[ -n "$NEXT_DIR" ] && [ -n "$NEXT_RELEASE" ] && { echo "Define NEXT_DIR o NEXT_RELEASE, no ambos"; exit 1; }
[ -n "$NEXT_RELEASE" ] && { [ -f "$NEXT_RELEASE/server.js" ] && [ -f "$NEXT_RELEASE/BUILD_INFO" ] \
  || { echo "NEXT_RELEASE no es un release standalone (falta server.js o BUILD_INFO)"; exit 1; }; }
NEXT_APP="${NEXT_DIR:-$NEXT_RELEASE}"
if [ -n "$NEXT_DIR" ]; then
  [ -d "$NEXT_DIR/.next" ] || { echo "NEXT_DIR sin build (.next): ejecuta next build"; exit 1; }
fi
if [ -n "$NEXT_APP" ]; then
  for f in "$NEXT_APP"/.env "$NEXT_APP"/.env.*; do
    [ -e "$f" ] && [ "${f##*/}" != ".env.example" ] && { echo "$NEXT_APP contiene ${f##*/}: usa un directorio sin credenciales"; exit 1; }
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
  DJANGO_ALLOWED_HOSTS=apex.ponquesito.test,staging.ponquesito.test,fase1.ponquesito.test \
  DJANGO_BEHIND_HTTPS_PROXY=true \
  DJANGO_CSRF_TRUSTED_ORIGINS=https://apex.ponquesito.test:18443,https://staging.ponquesito.test:18443 \
  POSTGRES_DB=x POSTGRES_USER=x POSTGRES_PASSWORD=x PYTHONDONTWRITEBYTECODE=1 \
  exec .venv/bin/gunicorn --bind 127.0.0.1:18001 --workers 1 --no-control-socket \
    --error-logfile "$TMP/gunicorn.log" --access-logfile "$TMP/access.log" config.wsgi:application
) & PIDS+=($!)
: > "$TMP/next.log"
python3 -I "$ROOT/deploy/caddy/test/next_stub.py" 18002 "$TMP/next.log" "$TMP/ip.log" & STUB=$!; PIDS+=($STUB)

cd "$ROOT/deploy/caddy/test"
"$CADDY" validate --config Caddyfile.local --adapter caddyfile >"$TMP/validate.log" 2>&1 \
  || { echo "caddy validate FALLÓ"; cat "$TMP/validate.log"; exit 1; }
# Los Caddyfile reales importan /etc/caddy/ponquesito.caddy: se validan
# apuntando al del repositorio.
for f in Caddyfile.fase1 Caddyfile.production Caddyfile.staging; do
  sed "s#/etc/caddy/ponquesito.caddy#$ROOT/deploy/caddy/ponquesito.caddy#" "../$f" > "$TMP/$f"
  "$CADDY" validate --config "$TMP/$f" --adapter caddyfile >"$TMP/validate-$f.log" 2>&1 \
    || { echo "caddy validate de $f FALLÓ"; cat "$TMP/validate-$f.log"; exit 1; }
done
"$CADDY" run --config Caddyfile.local --adapter caddyfile >"$TMP/caddy.log" 2>&1 & PIDS+=($!)

CA="$XDG_DATA_HOME/caddy/pki/authorities/local/root.crt"
for _ in $(seq 50); do [ -f "$CA" ] && curl -s -o /dev/null --cacert "$CA" --resolve apex.ponquesito.test:18443:127.0.0.1 https://apex.ponquesito.test:18443/health/ && break; sleep 0.2; done

R=(--resolve apex.ponquesito.test:18443:127.0.0.1 --resolve www.ponquesito.test:18443:127.0.0.1
   --resolve staging.ponquesito.test:18443:127.0.0.1 --resolve apex.ponquesito.test:18080:127.0.0.1
   --resolve fase1.ponquesito.test:18443:127.0.0.1 --resolve www.fase1.ponquesito.test:18443:127.0.0.1
   --resolve fase1.ponquesito.test:18080:127.0.0.1)
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
F=https://fase1.ponquesito.test:18443
WF=https://www.fase1.ponquesito.test:18443
# Rutas de fase 1 que deben ser 404 de Caddy sin llegar a ninguna aplicación.
F_BLOQUEADAS=(/agenda /agenda/ /agenda/reservas/FP-8-TEST /crea-tu-torta /crea-tu-torta/x /agente
  /prototipo /reporte-semanal /asistente /api/assistant /api/agent /api/reports/weekly /api/v1
  /api/v1/probe/cookies/ /_next/static/chunks/x.js /_next/image /linktree.html /linktreex
  /linktree/extra /AGENDA /Api/v1/x /favicon.ico /robots.txt /sitemap.xml /assets /assets/ /assets/x.png
  /assets/cake-builder/x.png /assets/logo-familia-ponquesito.png/x /assets/logo-familia-ponquesito.pngx
  /assets/logo-familia-ponquesito /health /health/x /healthz
  /backend/requirements.txt /.env /REVISION /src/knowledge/familia-ponquesito.md /images/logo/icon-on-cream.png)
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

echo "-- IP del cliente (rate limiter de Next.js)"
# El cliente es 127.0.0.1: Next.js debe recibir esa IP, nunca la que el
# cliente escriba en las cabeceras. Direcciones de documentación (RFC 5737).
ip() { : > "$TMP/ip.log"; c -o /dev/null "$@"; cat "$TMP/ip.log"; }
LIMPIO="xff=[127.0.0.1] xri=[127.0.0.1] fwd=[]"
ok "sin cabeceras del cliente"             "$LIMPIO" "$(ip $A/ip)"
ok "X-Forwarded-For falsificado"           "$LIMPIO" "$(ip -H 'X-Forwarded-For: 203.0.113.7' $A/ip)"
ok "X-Forwarded-For múltiple y repetido"   "$LIMPIO" "$(ip -H 'X-Forwarded-For: 203.0.113.7, 198.51.100.1' -H 'X-Forwarded-For: 192.0.2.9' $A/ip)"
ok "X-Real-IP y Forwarded falsificados"    "$LIMPIO" "$(ip -H 'X-Real-IP: 203.0.113.8' -H 'Forwarded: for=203.0.113.9' $A/ip)"
ok "staging: todo falsificado"             "$LIMPIO" "$(ip "${AUTH[@]}" -H 'X-Forwarded-For: 203.0.113.7' -H 'X-Real-IP: 203.0.113.8' -H 'Forwarded: for=203.0.113.9' $S/ip)"
: > "$TMP/next.log"

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

echo "-- Lanzamiento fase 1 (solo /linktree)"
ok "fase1 / → 302"                         "302" "$(code $F/)"
ok "fase1 / → /linktree"                   "/linktree" "$(hdr Location $F/)"
ok "fase1 /?utm_source=qr conserva query"  "/linktree?utm_source=qr" "$(hdr Location "$F/?utm_source=qr")"
nada_a_next "fase1 /"
ok "fase1 /linktree → Next.js"             "next-stub GET /linktree" "$(c $F/linktree)"
ok "fase1 /linktree?utm_source=qr → Next.js" "next-stub GET /linktree?utm_source=qr" "$(c "$F/linktree?utm_source=qr")"
ok "fase1 /linktree/ → Next.js (su 308)"   "next-stub GET /linktree/" "$(c $F/linktree/)"
ok "fase1 HEAD /linktree → Next.js"        "200 HEAD /linktree" "$(code -I $F/linktree) $(tail -1 "$TMP/next.log")"
ok "fase1 /favicon.svg → Next.js"          "next-stub GET /favicon.svg" "$(c $F/favicon.svg)"
ok "fase1 /assets/logo… → Next.js"         "next-stub GET /assets/logo-familia-ponquesito.png" "$(c $F/assets/logo-familia-ponquesito.png)"
: > "$TMP/next.log"
ok "fase1 /health/ → Django"               '{"status": "ok", "database": "ok"}' "$(c $F/health/)"
nada_a_next "fase1 /health/"
for p in "${F_BLOQUEADAS[@]}"; do
  ok "fase1 GET $p → 404"                  "404 No encontrado" "$(code $F$p) $(c $F$p)"
done
ok "fase1 /assets/../agenda (sin normalizar) → 404" "404" "$(code --path-as-is $F/assets/../agenda)"
ok "fase1 /assets/%2e%2e/agenda → no es /agenda" "0" "$(c $F/assets/%2e%2e/agenda >/dev/null; grep -c ' /agenda$' "$TMP/next.log")"
ok "fase1 //agenda → 404"                  "404" "$(code --path-as-is $F//agenda)"
ok "fase1 /linktree/../agenda → 404"       "404" "$(code --path-as-is $F/linktree/../agenda)"
for m in POST PUT DELETE PATCH OPTIONS; do
  ok "fase1 $m /linktree → 405"            "405" "$(code -X $m $F/linktree)"
done
ok "fase1 405 con Allow"                   "GET, HEAD" "$(hdr Allow -X POST $F/linktree)"
ok "fase1 POST / → 405"                    "405" "$(code -X POST $F/)"
# Los demás archivos reales de public/assets/ (cake builder) tampoco pasan.
for a in $(cd "$ROOT/public" && find assets -type f ! -path "assets/logo-familia-ponquesito.png" | sort | head -5); do
  ok "fase1 GET /$a → 404"                 "404 No encontrado" "$(code "$F/$a") $(c "$F/$a")"
done
ok "fase1 POST /assets/logo… → 405"        "405" "$(code -X POST $F/assets/logo-familia-ponquesito.png)"
ok "fase1 POST /health/ → 405 (no llega a Django)" "405" "$(code -X POST $F/health/)"
ok "fase1 POST /agenda (Server Action) → 404" "404" "$(code -X POST -H 'Next-Action: x' $F/agenda)"
ok "fase1 POST /api/assistant → 404"       "404" "$(code -X POST $F/api/assistant)"
ok "fase1 POST /api/v1/probe/cookies/ → 404" "404" "$(code -X POST $F/api/v1/probe/cookies/)"
nada_a_next "fase1 bloqueos"
ok "fase1 nosniff en /linktree"            "nosniff" "$(hdr X-Content-Type-Options $F/linktree)"
ok "fase1 nosniff en 404"                  "nosniff" "$(hdr X-Content-Type-Options $F/agenda)"
ok "fase1 sin cabecera Server"             "" "$(hdr Server $F/agenda)"
ok "fase1 IP del cliente"                  "$LIMPIO" "$(ip -H 'X-Forwarded-For: 203.0.113.7' -H 'X-Real-IP: 203.0.113.8' -H 'Forwarded: for=203.0.113.9' $F/linktree)"
ok "fase1 http → https (308)"              "308 https://fase1.ponquesito.test/linktree?utm_source=qr" \
  "$(code "http://fase1.ponquesito.test:18080/linktree?utm_source=qr") $(hdr Location "http://fase1.ponquesito.test:18080/linktree?utm_source=qr")"
ok "fase1 www /linktree?utm_source=qr → 301 al apex" "301 https://fase1.ponquesito.test/linktree?utm_source=qr" \
  "$(code "$WF/linktree?utm_source=qr") $(hdr Location "$WF/linktree?utm_source=qr")"
ok "fase1 www / → apex /"                  "https://fase1.ponquesito.test/" "$(hdr Location $WF/)"
ok "fase1 www /agenda → apex (allí 404)"   "https://fase1.ponquesito.test/agenda" "$(hdr Location $WF/agenda)"
ok "fase1 POST www → 301 (sin aplicación)" "301" "$(code -X POST $WF/linktree)"
: > "$TMP/next.log"
nada_a_next "fase1 www"
# Caddyfile.fase1 usa el mismo bloque que se prueba aquí (salvo nombres,
# puertos y `log`).
norm() { sed -E 's/fase1\.ponquesito\.test/familiaponquesito.com/g; s/127\.0\.0\.1:18001/127.0.0.1:8000/; s/127\.0\.0\.1:18002/127.0.0.1:3000/' \
  | grep -vE '^\s*(#|log$|$)'; }
blk() { awk -v h="$2" '$0 ~ "^"h" \\{" {p=1} p {print} p && /^}/ {exit}' "$1"; }
ok "Caddyfile.fase1 = bloque probado (apex)" "$(blk Caddyfile.local 'fase1\\.ponquesito\\.test' | norm)" \
  "$(blk ../Caddyfile.fase1 'familiaponquesito\\.com' | norm)"
ok "Caddyfile.fase1 = bloque probado (www)" "$(blk Caddyfile.local 'www\\.fase1\\.ponquesito\\.test' | norm)" \
  "$(blk ../Caddyfile.fase1 'www\\.familiaponquesito\\.com' | norm)"

if [ -n "$NEXT_APP" ]; then
  kill "$STUB"; wait "$STUB" 2>/dev/null
  if [ -n "$NEXT_RELEASE" ]; then
    echo "== Fase 2: Next.js real (release $(basename "$NEXT_RELEASE"), $(grep '^canonical_url=' "$NEXT_RELEASE/BUILD_INFO"))"
    ( cd "$NEXT_RELEASE" && exec env -i PATH="$PATH" HOME="$TMP" NODE_ENV=production HOSTNAME=127.0.0.1 PORT=18002 \
        NEXT_TELEMETRY_DISABLED=1 APP_CANONICAL_URL="$(grep '^canonical_url=' BUILD_INFO | cut -d= -f2-)" \
        node server.js >"$TMP/next-real.log" 2>&1 ) & NEXT_PID=$!; PIDS+=($NEXT_PID)
  else
    echo "== Fase 2: Next.js real ($(cd "$NEXT_DIR" && git rev-parse --short HEAD 2>/dev/null || echo '?'))"
    ( cd "$NEXT_DIR" && NEXT_TELEMETRY_DISABLED=1 exec node_modules/.bin/next start -H 127.0.0.1 -p 18002 >"$TMP/next-real.log" 2>&1 ) & NEXT_PID=$!; PIDS+=($NEXT_PID)
  fi
  for _ in $(seq 100); do curl -s -o /dev/null http://127.0.0.1:18002/linktree && break; sleep 0.2; done
  HOME_HTML=$(c $A/)
  ok "/ 200 desde Next.js"                 "200" "$(code $A/)"
  ok "/ es el landing de Next.js"          "1" "$(echo "$HOME_HTML" | grep -c '/_next/static' | sed 's/[1-9][0-9]*/1/')"
  ok "/ no es la página de enlaces"        "1" "$([ "$(echo -n "$HOME_HTML" | sha)" != "$LT_SHA" ] && echo 1)"
  ok "/linktree byte a byte"               "$LT_SHA" "$(c $A/linktree | sha)"
  ok "/linktree content-type"              "text/html; charset=utf-8" "$(hdr Content-Type $A/linktree | tr A-Z a-z)"
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
  ok "fase1 /linktree byte a byte"         "$LT_SHA" "$(c $F/linktree | sha)"
  ok "fase1 / → /linktree (seguido)"       "$LT_SHA" "$(c -L $F/ | sha)"
  ok "fase1 /linktree/?a=1 → 308 de Next.js" "308 /linktree?a=1" "$(code "$F/linktree/?a=1") $(hdr Location "$F/linktree/?a=1")"
  # El 301 de www apunta al puerto 443 del apex; aquí es el 18443.
  ok "fase1 www → apex → /linktree (seguido)" "$LT_SHA" \
    "$(c -L --max-redirs 3 --connect-to fase1.ponquesito.test:443:127.0.0.1:18443 "$WF/" | sha)"
  # Todos los recursos que referencia la página cargan a través de fase 1.
  for r in $(grep -oE '(href|src)="\./[^"]+"' "$ROOT/public/linktree.html" | sed -E 's/.*"\.(\/[^"]+)"/\1/' | sort -u); do
    ok "fase1 recurso $r idéntico"         "$(sha < "$ROOT/public$r")" "$(c "$F$r" | sha)"
  done
  ok "fase1 /linktree sin /_next ni scripts" "0" "$(c $F/linktree | grep -cE '/_next/|<script')"
  # Caddy y la reescritura de Next.js no distinguen mayúsculas: es la misma página.
  ok "fase1 /LINKTREE → la misma página"   "$LT_SHA" "$(c $F/LINKTREE | sha)"
  ok "fase1 /agenda sigue 404 de Caddy"    "404 No encontrado" "$(code $F/agenda) $(c $F/agenda)"
  A1="$(cd "$ROOT/public" && find assets/cake-builder -type f | sort | head -1)"
  ok "fase1 asset real del cake builder (/$A1) → 404 de Caddy" "404 No encontrado" "$(code "$F/$A1") $(c "$F/$A1")"
  ok "  …que Next.js sí serviría directamente" "200" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:18002/$A1")"
  # Caddy no distingue mayúsculas; Next.js sí, para archivos estáticos.
  ok "fase1 logo en mayúsculas → 404 de Next.js" "404" "$(code "$F/ASSETS/LOGO-FAMILIA-PONQUESITO.PNG")"
  kill "$NEXT_PID"; wait "$NEXT_PID" 2>/dev/null
else
  echo "== Fase 2 omitida (define NEXT_DIR para probar con Next.js real)"
  kill "$STUB"; wait "$STUB" 2>/dev/null
fi

echo "== Next.js caído"
ok "staging Next.js caído → 503"           "503" "$(code "${AUTH[@]}" $S/agenda)"
ok "Django sigue respondiendo"             "200" "$(code "${AUTH[@]}" $S/health/)"
ok "fase1 Next.js caído → 503"             "503" "$(code $F/linktree)"
ok "fase1 /health/ sigue en Django"        "200" "$(code $F/health/)"
ok "fase1 rutas bloqueadas siguen en 404"  "404" "$(code $F/agenda)"

echo
if [ "$FAIL" -eq 0 ]; then echo "TODAS LAS PRUEBAS OK"; else echo "HAY FALLOS"; tail -20 "$TMP/caddy.log"; fi
exit "$FAIL"
