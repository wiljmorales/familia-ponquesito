#!/usr/bin/env bash
# Prueba local del despliegue de Next.js en el VPS, sin SSH ni root:
#
# 1. Sintaxis de los scripts, unidad systemd y modos dry-run.
# 2. URL canónica obligatoria e identidad del artefacto: dos builds del mismo
#    commit (staging y otra URL ficticia) no colisionan. Contenido del artefacto.
# 3. Servidor standalone en 127.0.0.1 (puerto temporal) solo con
#    APP_CANONICAL_URL: el caso de staging sin credenciales. El release es de
#    solo lectura; la única escritura es la caché externa.
# 4. release.sh con un "servicio" local: cambio de release, rollback
#    automático, rollback manual, identidad, URL de runtime, rechazos y limpieza.
#
# Uso: [ARTIFACT=<tarball> ARTIFACT2=<tarball>] deploy/web/test/run-local.sh
# Sin ellos construye dos de HEAD con build-artifact.sh: ARTIFACT con
# staging.build.env y ARTIFACT2 con una URL ficticia. Requiere Node de .nvmrc
# en el PATH, curl, ss y systemd-analyze.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
WEB="$ROOT/deploy/web"
TMP="$(mktemp -d)"
PIDS=()
cleanup() {
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done
  [ -f "$TMP/svc.pid" ] && kill "$(cat "$TMP/svc.pid")" 2>/dev/null
  wait 2>/dev/null; chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"
}
trap cleanup EXIT

FAIL=0
ok() { if [ "$2" == "$3" ]; then echo "  OK  $1"; else echo "  FALLA $1 — esperado [$2], obtenido [$3]"; FAIL=1; fi; }
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }
wait_http() { for _ in $(seq 60); do curl -s -o /dev/null "$1" && return 0; sleep 0.5; done; return 1; }
NODE="$(command -v node)"
STG=https://staging.familiaponquesito.com
OTRA=https://otra.ponquesito.test
fp_of() { printf 'APP_CANONICAL_URL=%s\nNEXT_PUBLIC_WHATSAPP_URL=\n' "$1" | sha256sum | cut -c1-12; }

echo "== 1. Sintaxis y dry-run"
for f in "$WEB"/*.sh "$WEB"/test/*.sh; do
  ok "bash -n ${f#$ROOT/}" "0" "$(bash -n "$f" 2>&1; echo $?)"
done
# systemd-analyze exige que ExecStart exista: se verifica una copia que solo
# cambia la ruta de Node.
sed "s#/opt/ponquesito/node/bin/node#$NODE#" "$WEB/ponquesito-web.service" > "$TMP/ponquesito-web.service"
# Solo cuentan los avisos de esta unidad (verify también revisa las del sistema).
ok "systemd-analyze verify" "" "$(systemd-analyze verify "$TMP/ponquesito-web.service" 2>&1 | grep ponquesito-web)"
ok "unidad: HOSTNAME=127.0.0.1 PORT=3000" "1" "$(grep -c '^Environment=NODE_ENV=production HOSTNAME=127.0.0.1 PORT=3000 NEXT_TELEMETRY_DISABLED=1$' "$WEB/ponquesito-web.service")"
ok "bootstrap --dry-run sin root" "0" "$(bash "$WEB/bootstrap.sh" --dry-run >"$TMP/bootstrap.log" 2>&1; echo $?)"
ok "bootstrap --dry-run solo muestra comandos" "" "$(grep -v '^+ \|^==\|^ya existe\|^AVISO\|^Listo\|^Node' "$TMP/bootstrap.log")"
ok "deploy sin VPS_HOST se niega" "1" "$(env -u VPS_HOST bash "$WEB/deploy-to-vps.sh" >/dev/null 2>&1; echo $?)"
ok "scripts ejecutables" "" "$(for f in "$WEB"/*.sh "$WEB"/test/*.sh; do [ -x "$f" ] || echo "${f#$ROOT/}"; done)"

echo "== 2. URL canónica e identidad del artefacto"
# Rechazos rápidos: antes de crear el worktree o instalar dependencias.
bad_build() {  # bad_build <etiqueta> <contenido del archivo de build | ->
  local f="$TMP/bad.build.env" rc
  if [ "$2" = - ]; then
    (cd "$ROOT" && env -u BUILD_ENV_FILE OUT_DIR="$TMP/out-bad" "$WEB/build-artifact.sh" HEAD) >"$TMP/bad.log" 2>&1; rc=$?
  else
    printf '%s\n' "$2" > "$f"
    (cd "$ROOT" && BUILD_ENV_FILE="$f" OUT_DIR="$TMP/out-bad" "$WEB/build-artifact.sh" HEAD) >"$TMP/bad.log" 2>&1; rc=$?
  fi
  ok "build $1 → rechazo sin compilar" "1 no" "$rc $([ -e "$TMP/out-bad" ] && echo sí || echo no)"
}
WT_BEFORE="$(git worktree list | wc -l)"
bad_build "sin BUILD_ENV_FILE" -
bad_build "sin APP_CANONICAL_URL" "NEXT_PUBLIC_WHATSAPP_URL=https://wa.me/000"
bad_build "con APP_CANONICAL_URL vacía" "APP_CANONICAL_URL="
bad_build "con http://" "APP_CANONICAL_URL=http://staging.familiaponquesito.com"
bad_build "con barra final" "APP_CANONICAL_URL=$STG/"
bad_build "con ruta" "APP_CANONICAL_URL=$STG/x"
bad_build "con credenciales" "APP_CANONICAL_URL=https://u:p@staging.familiaponquesito.com"
bad_build "con espacio" "APP_CANONICAL_URL=$STG x"
ok "  ningún worktree de build quedó creado" "$WT_BEFORE" "$(git worktree list | wc -l)"
ok "next.config exige la URL en standalone" "1" "$(cd "$ROOT" && env -u APP_CANONICAL_URL PONQUESITO_STANDALONE=1 \
  node --experimental-strip-types -e 'import("./next.config.ts").then(()=>console.log(0),e=>console.log(/APP_CANONICAL_URL/.test(e.message)?1:2))' 2>/dev/null)"

build() {  # build <archivo-env> <variable destino>
  OUT_DIR="$TMP/out" ARTIFACT_PATH_FILE="$TMP/path" BUILD_ENV_FILE="$1" "$WEB/build-artifact.sh" HEAD > "$TMP/build.log" 2>&1 \
    || { echo "build-artifact.sh FALLÓ"; tail -30 "$TMP/build.log"; exit 1; }
  printf -v "$2" '%s' "$(cat "$TMP/path")"
}
[ -n "${ARTIFACT:-}" ] || build "$WEB/staging.build.env" ARTIFACT
if [ -z "${ARTIFACT2:-}" ]; then
  printf 'APP_CANONICAL_URL=%s\n' "$OTRA" > "$TMP/otra.build.env"
  build "$TMP/otra.build.env" ARTIFACT2
fi
SHA="$(git rev-parse --short=12 HEAD)"; FP="$(fp_of "$STG")"; FP2="$(fp_of "$OTRA")"
ID="$SHA-$FP"; ID2="$SHA-$FP2"; NAME="ponquesito-web-$ID"
ok "nombre <commit12>-<build12> (staging)" "$NAME.tar.gz" "$(basename "$ARTIFACT")"
ok "nombre del mismo commit con otra URL" "ponquesito-web-$ID2.tar.gz" "$(basename "$ARTIFACT2")"
ok "  no colisionan" "1" "$([ "$ID" != "$ID2" ] && [ -f "$ARTIFACT" ] && [ -f "$ARTIFACT2" ] && echo 1 || echo 0)"
ok "sha256 del artefacto" "0" "$(cd "$(dirname "$ARTIFACT")" && sha256sum --quiet -c "$NAME.tar.gz.sha256" >/dev/null 2>&1; echo $?)"
tar -tzf "$ARTIFACT" > "$TMP/list"
for f in server.js REVISION NODE_VERSION BUILD_INFO BUILD_ENV .next/BUILD_ID .next/static/ public/linktree.html \
         public/favicon.svg public/assets/logo-familia-ponquesito.png src/knowledge/familia-ponquesito.md; do
  ok "incluye $f" "1" "$(grep -cx "$NAME/$f" "$TMP/list")"
done
ok "excluye backend/"         "0" "$(grep -c "^$NAME/backend/" "$TMP/list")"
ok "excluye .env*"            "0" "$(grep -cE '(^|/)\.env[^/]*$' "$TMP/list")"
ok "excluye .git"             "0" "$(grep -cE '(^|/)\.git(/|$)' "$TMP/list")"
ok "excluye .next/cache"      "0" "$(grep -c "^$NAME/.next/cache" "$TMP/list")"
ok "excluye *.pem/tsbuildinfo" "0" "$(grep -cE '\.(pem|tsbuildinfo)$' "$TMP/list")"
ok "sin código fuente salvo el knowledge" "src/knowledge/familia-ponquesito.md" \
  "$(grep "^$NAME/src/" "$TMP/list" | grep -v '/$' | sed "s#^$NAME/##" | tr '\n' ' ' | sed 's/ $//')"
mkdir -p "$TMP/x" "$TMP/x2"; tar -xzf "$ARTIFACT" -C "$TMP/x"; tar -xzf "$ARTIFACT2" -C "$TMP/x2"
X="$TMP/x/$NAME"; X2="$TMP/x2/ponquesito-web-$ID2"
ok "sin rutas locales" "" "$(grep -rlIF -e "$HOME" -e "$ROOT" "$TMP/x" "$TMP/x2" | head -3)"
ok "BUILD_INFO" "commit=$(git rev-parse HEAD) node=$(tr -d '[:space:]' < "$ROOT/.nvmrc") canonical_url=$STG build_fingerprint=$FP" \
  "$(tr '\n' ' ' < "$X/BUILD_INFO" | sed 's/ $//')"
ok "BUILD_ENV solo variables de build" "APP_CANONICAL_URL=$STG NEXT_PUBLIC_WHATSAPP_URL=" "$(tr '\n' ' ' < "$X/BUILD_ENV" | sed 's/ $//')"
ok "fingerprint = SHA-256 de BUILD_ENV" "$FP" "$(sha256sum < "$X/BUILD_ENV" | cut -c1-12)"
ok "REVISION = HEAD" "$(git rev-parse HEAD)" "$(cat "$X/REVISION")"
# La URL del build queda en las páginas estáticas; nunca la de Vercel.
IDX=.next/server/app/index.html
n1() { grep -c "$1" "$2" | sed 's/^[1-9][0-9]*$/1/'; }
ok "/ estático lleva la URL de staging" "1 0 0" \
  "$(n1 "$STG" "$X/$IDX") $(grep -c "$OTRA" "$X/$IDX") $(grep -c 'familia-ponquesito.vercel.app' "$X/$IDX")"
ok "/ estático del otro build lleva la otra URL" "1 0 0" \
  "$(n1 "$OTRA" "$X2/$IDX") $(grep -c "$STG" "$X2/$IDX") $(grep -c 'familia-ponquesito.vercel.app' "$X2/$IDX")"
echo "  tamaño: $(du -h "$ARTIFACT" | cut -f1) comprimido, $(du -sh "$X" | cut -f1) extraído"
VPS_HOST=admin@host.invalid ARTIFACT="$ARTIFACT" DRY_RUN=1 "$WEB/deploy-to-vps.sh" > "$TMP/dry.log" 2>&1
ok "deploy DRY_RUN=1 termina sin conectar" "0 1 1" \
  "$? $(grep -c '^DRY_RUN: no se conecta' "$TMP/dry.log") $(grep -c "APP_CANONICAL_URL=$STG;" "$TMP/dry.log")"

echo "== 3. Servidor standalone (solo APP_CANONICAL_URL)"
REL="$X"
mkdir -p "$TMP/cache"; ln -s "$TMP/cache" "$REL/.next/cache"
chmod -R a-w "$REL"   # el release es de solo lectura, como en el VPS
P="$(free_port)"; B="http://127.0.0.1:$P"
(cd "$REL" && exec env -i PATH="$(dirname "$NODE"):/usr/bin:/bin" NODE_ENV=production \
  HOSTNAME=127.0.0.1 PORT="$P" NEXT_TELEMETRY_DISABLED=1 APP_CANONICAL_URL="$STG" "$NODE" server.js) > "$TMP/server.log" 2>&1 & PIDS+=($!)
wait_http "$B/linktree" || { echo "el servidor no arrancó"; cat "$TMP/server.log"; exit 1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
for p in / /linktree /favicon.svg /assets/logo-familia-ponquesito.png /crea-tu-torta /agenda /asistente /agente; do
  ok "GET $p" "200" "$(code "$B$p")"
done
ok "/linktree byte a byte" "$(sha256sum < "$ROOT/public/linktree.html" | cut -c1-64)" "$(curl -s "$B/linktree" | sha256sum | cut -c1-64)"
ok "/linktree/?source=review → 308" "308 $B/linktree?source=review" \
  "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/linktree/?source=review")"
for p in /backend/requirements.txt /api/v1/test /.env /.env.example /src/knowledge/familia-ponquesito.md /REVISION; do
  ok "GET $p → 404" "404" "$(code "$B$p")"
done
# Next.js quita la barra final (308) y /health no existe. En el VPS no llega a
# Next.js: Caddy envía /health/ a Django.
ok "GET /health/ → 308 /health → 404" "404" "$(code -L "$B/health/")"
ok "GET /api/reports/weekly sin CRON_SECRET → 503" "503" "$(code "$B/api/reports/weekly")"
curl -s "$B/" > "$TMP/home.html"
ok "/ servido con la URL de staging, sin la de Vercel" "1 0" \
  "$(n1 "$STG" "$TMP/home.html") $(grep -c 'familia-ponquesito.vercel.app' "$TMP/home.html")"
CHUNK="$(grep -o '/_next/static/[^"]*\.js' "$TMP/home.html" | head -1)"
ok "estático $CHUNK" "200" "$(code "$B$CHUNK")"
ok "imagen optimizada (/_next/image)" "200" "$(code "$B/_next/image?url=%2Fimages%2Fclosing%2Fclosing-bg.jpg&w=640&q=75")"
ok "la caché de imágenes se escribe fuera del release" "1" "$([ -n "$(find "$TMP/cache/images" -type f 2>/dev/null | head -1)" ] && echo 1 || echo 0)"
ok "escucha solo en 127.0.0.1" "127.0.0.1:$P" "$(ss -Hltn "sport = :$P" | awk '{print $4}' | sort -u | tr '\n' ' ' | sed 's/ $//')"
for p in /prototipo /reporte-semanal; do echo "  info GET $p → $(code "$B$p")"; done
ok "sin errores en el log del servidor" "" "$(grep -iE 'error|EACCES|EROFS|unhandled' "$TMP/server.log" \
  | grep -v 'CRON_SECRET no está configurado' | grep -v 'Supabase no está configurado' | head -5)"
# Esperado sin credenciales: /reporte-semanal registra que falta Supabase.
echo "  info errores esperados sin credenciales: $(grep -c 'Supabase no está configurado' "$TMP/server.log")"
kill "${PIDS[-1]}"; wait "${PIDS[-1]}" 2>/dev/null; unset 'PIDS[-1]'
chmod -R u+w "$REL"

echo "== 4. Releases y rollback (release.sh sin root ni systemd)"
export WEB_ROOT="$TMP/web" CACHE_DIR="$TMP/webcache" ENV_FILE="$TMP/web.env" NODE_BIN="$NODE" \
  HEALTH_PORT="$(free_port)" HEALTH_TIMEOUT=8 KEEP=2
mkdir -p "$WEB_ROOT/releases"
web_env() { cp "$WEB/.env.example" "$ENV_FILE"; [ $# -eq 0 ] || printf '%s\n' "$@" >> "$ENV_FILE"; }
web_env "APP_CANONICAL_URL=$STG"
# "Servicio": reinicia server.js de current con la URL de web.env, como systemd.
cat > "$TMP/svc.sh" <<EOF
#!/usr/bin/env bash
if [ -f "$TMP/svc.pid" ]; then
  pid=\$(cat "$TMP/svc.pid"); kill "\$pid" 2>/dev/null
  while kill -0 "\$pid" 2>/dev/null; do sleep 0.1; done
fi
url=\$(grep '^APP_CANONICAL_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"')
cd "$WEB_ROOT/current"
setsid env -i PATH="$(dirname "$NODE"):/usr/bin:/bin" NODE_ENV=production HOSTNAME=127.0.0.1 \
  PORT=$HEALTH_PORT NEXT_TELEMETRY_DISABLED=1 APP_CANONICAL_URL="\$url" "$NODE" "$WEB_ROOT/current/server.js" \
  >> "$TMP/svc.log" 2>&1 < /dev/null &
echo \$! > "$TMP/svc.pid"
EOF
chmod +x "$TMP/svc.sh"; export RESTART_CMD="$TMP/svc.sh"

# Variantes del artefacto de staging con otro commit: buena, rota (server.js
# sale con 1), con contenido prohibido o con la identidad alterada.
variant() {  # variant <commit12> <modo>
  local n="ponquesito-web-$1-$FP" d="$TMP/v/$1"
  rm -rf "${d:?}"; mkdir -p "$d"; cp -a "$REL" "$d/$n"; rm -f "${d:?}/${n:?}/.next/cache"
  printf '%s\n' "$1" > "$d/$n/REVISION"
  sed -i "s/^commit=.*/commit=$1/" "$d/$n/BUILD_INFO"
  case "$2" in
    rota) echo 'process.exit(1)' > "$d/$n/server.js" ;;
    backend) mkdir -p "$d/$n/backend"; touch "$d/$n/backend/settings.py" ;;
    env) echo 'X=1' > "$d/$n/.env.production" ;;
    enlace) ln -s /etc/passwd "$d/$n/public/enlace" ;;
    build_env) sed -i 's#^NEXT_PUBLIC_WHATSAPP_URL=.*#NEXT_PUBLIC_WHATSAPP_URL=https://wa.me/000#' "$d/$n/BUILD_ENV" ;;
    build_info) sed -i "s#^canonical_url=.*#canonical_url=$OTRA#" "$d/$n/BUILD_INFO" ;;
  esac
  tar -C "$d" -czf "$TMP/v/$n.tar.gz" "$n"
  (cd "$TMP/v" && sha256sum "$n.tar.gz" > "$n.tar.gz.sha256")
  echo "$TMP/v/$n.tar.gz"
}
mkdir -p "$TMP/v"
A="$ARTIFACT"; Bk="$(variant bbbbbbbbbbbb rota)"; C="$(variant cccccccccccc buena)"; D="$(variant dddddddddddd buena)"
IB="bbbbbbbbbbbb-$FP"; IC="cccccccccccc-$FP"; ID_D="dddddddddddd-$FP"
R="$WEB/release.sh"
cur() { basename "$(readlink "$WEB_ROOT/current" 2>/dev/null)" 2>/dev/null; }
prev() { basename "$(readlink "$WEB_ROOT/previous" 2>/dev/null)" 2>/dev/null; }
run() { bash "$R" "$@" > "$TMP/r.log" 2>&1; echo $?; }
said() { grep -q "$1" "$TMP/r.log" && echo sí || echo no; }
serving() { curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$HEALTH_PORT/linktree"; }
sorted() { printf '%s\n' "$@" | sort | tr '\n' ' ' | sed 's/ $//'; }

ok "release roto sin anterior → error" "1 sí" "$(run deploy "$Bk") $(said 'no hay release anterior')"
rm -f "${WEB_ROOT:?}/current"; rm -rf "${WEB_ROOT:?}/releases/${IB:?}"

ok "deploy A" "0" "$(run deploy "$A")"
ok "  current = A" "$ID" "$(cur)"
ok "  sirve 200" "200" "$(serving)"
ok "  release sin permisos de escritura de grupo/otros" "" "$(find "$WEB_ROOT/releases/$ID" -perm /g+w,o+rwx ! -type l | head -1)"

ok "deploy B (roto) → rollback automático" "1 sí" "$(run deploy "$Bk") $(said 'rollback automático completado')"
ok "  current vuelve a A" "$ID" "$(cur)"
ok "  sigue sirviendo 200" "200" "$(serving)"

ok "deploy C" "0" "$(run deploy "$C")"
ok "  current = C, previous = A" "$IC $ID" "$(cur) $(prev)"
ok "rollback" "0" "$(run rollback)"
ok "  current = A, previous = C" "$ID $IC" "$(cur) $(prev)"
ok "  sirve 200" "200" "$(serving)"
ok "rollback otra vez (alterna)" "0" "$(run rollback)"
ok "  current = C, previous = A" "$IC $ID" "$(cur) $(prev)"
ok "  sin symlinks temporales" "" "$(ls -A "$WEB_ROOT" | grep '\.tmp$')"

cp "$C.sha256" "$TMP/sha.bak"; sed -i 's/^./0/' "$C.sha256"
ok "SHA-256 alterado → rechazo" "1" "$(run deploy "$C")"; cp "$TMP/sha.bak" "$C.sha256"
# Un commit distinto por variante: cada una pasa por todas las comprobaciones.
for v in e1:backend e2:env e3:enlace e4:build_env e5:build_info; do
  ok "artefacto con ${v#*:} → rechazo" "1" "$(run deploy "$(variant "${v%%:*}eeeeeeeeee" "${v#*:}")")"
done
ok "  BUILD_ENV alterado: lo detecta el fingerprint" "sí" \
  "$(run deploy "$TMP/v/ponquesito-web-e4eeeeeeeeee-$FP.tar.gz" >/dev/null; said 'BUILD_ENV no coincide con el fingerprint')"
ok "  ningún rechazo instaló nada" "" "$(ls -A "$WEB_ROOT/releases" | grep -E 'eeee|incoming')"
web_env "APP_CANONICAL_URL=$STG" 'HOSTNAME=0.0.0.0'
ok "web.env con HOSTNAME → rechazo" "1" "$(run activate "$ID")"
web_env "APP_CANONICAL_URL=$STG"
printf '#!/bin/sh\necho v18.19.1\n' > "$TMP/node18"; chmod +x "$TMP/node18"
ok "Node distinto de .nvmrc → rechazo" "1" "$(NODE_BIN="$TMP/node18" run activate "$ID")"

echo "-- URL canónica de runtime (web.env) frente a la del build"
web_env
ok "URL ausente → rechazo" "1 sí" "$(run activate "$ID") $(said 'no define APP_CANONICAL_URL')"
web_env "APP_CANONICAL_URL=$OTRA"
ok "URL distinta → rechazo" "1 sí" "$(run activate "$ID") $(said 'no coincide con la del build')"
web_env "APP_CANONICAL_URL=$STG/"
ok "URL con barra final → rechazo" "1" "$(run activate "$ID")"
web_env "APP_CANONICAL_URL=$STG" "APP_CANONICAL_URL=$OTRA"
ok "URL repetida: cuenta la última, como systemd → rechazo" "1" "$(run activate "$ID")"
ok "  current sin cambios tras los rechazos" "$IC" "$(cur)"
ok "  sigue sirviendo 200" "200" "$(serving)"
web_env "APP_CANONICAL_URL=$STG"
ok "deploy del mismo commit con otra URL → rechazo antes de activar" "1 sí" \
  "$(run deploy "$ARTIFACT2") $(said 'no coincide con la del build')"
ok "  current sin cambios" "$IC" "$(cur)"
ok "  ambos builds del commit instalados sin colisión" "$(sorted "$ID" "$ID2")" "$(sorted $(ls "$WEB_ROOT/releases" | grep "^$SHA-"))"
web_env "APP_CANONICAL_URL=\"$STG\""
ok "URL correcta (entre comillas) → activa A" "0" "$(run activate "$ID")"
ok "  current = A, previous = C" "$ID $IC" "$(cur) $(prev)"
curl -s "http://127.0.0.1:$HEALTH_PORT/" > "$TMP/home2.html"
ok "  sirve / con la URL de staging" "1 0" \
  "$(n1 "$STG" "$TMP/home2.html") $(grep -c 'familia-ponquesito.vercel.app' "$TMP/home2.html")"

ok "deploy D (KEEP=2)" "0" "$(run deploy "$D")"
# Recientes: D y el segundo build; A se conserva por ser previous.
ok "  conserva D, el otro build y A (previous)" "$(sorted "$ID_D" "$ID2" "$ID")" "$(sorted $(ls "$WEB_ROOT/releases"))"
ok "  caché de releases eliminados borrada" "$(sorted "$ID_D" "$ID2" "$ID")" "$(sorted $(ls "$CACHE_DIR"))"

echo
if [ "$FAIL" -eq 0 ]; then echo "TODAS LAS PRUEBAS OK"; else echo "HAY FALLOS"; tail -20 "$TMP/r.log"; fi
exit "$FAIL"
