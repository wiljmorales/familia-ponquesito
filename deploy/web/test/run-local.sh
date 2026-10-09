#!/usr/bin/env bash
# Prueba local del despliegue de Next.js en el VPS, sin SSH ni root:
#
# 1. Sintaxis de los scripts, unidad systemd y modos dry-run.
# 2. Contenido del artefacto (qué incluye y qué no).
# 3. Servidor standalone en 127.0.0.1 (puerto temporal) sin ninguna variable
#    de entorno de la app: el caso de staging sin credenciales. El release es
#    de solo lectura; la única escritura es la caché externa.
# 4. release.sh con un "servicio" local: cambio de release, rollback
#    automático, rollback manual, rechazos y limpieza.
#
# Uso: [ARTIFACT=<tarball>] deploy/web/test/run-local.sh
# Sin ARTIFACT construye uno de HEAD con build-artifact.sh. Requiere Node de
# .nvmrc en el PATH, curl, ss y systemd-analyze.
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

echo "== 2. Artefacto"
if [ -z "${ARTIFACT:-}" ]; then
  OUT_DIR="$TMP/out" "$WEB/build-artifact.sh" HEAD > "$TMP/build.log" 2>&1 \
    || { echo "build-artifact.sh FALLÓ"; tail -30 "$TMP/build.log"; exit 1; }
  ARTIFACT="$(ls "$TMP"/out/ponquesito-web-*.tar.gz)"
fi
NAME="$(basename "$ARTIFACT" .tar.gz)"
SHA="${NAME#ponquesito-web-}"
ok "nombre con el commit" "$(git rev-parse --short=12 HEAD)" "$SHA"
ok "sha256 del artefacto" "0" "$(cd "$(dirname "$ARTIFACT")" && sha256sum --quiet -c "$NAME.tar.gz.sha256" >/dev/null 2>&1; echo $?)"
tar -tzf "$ARTIFACT" > "$TMP/list"
for f in server.js REVISION NODE_VERSION BUILD_INFO .next/BUILD_ID .next/static/ public/linktree.html \
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
mkdir -p "$TMP/x"; tar -xzf "$ARTIFACT" -C "$TMP/x"
ok "sin rutas locales" "" "$(grep -rlIF -e "$HOME" -e "$ROOT" "$TMP/x" | head -3)"
ok "REVISION = HEAD" "$(git rev-parse HEAD)" "$(cat "$TMP/x/$NAME/REVISION")"
ok "NODE_VERSION = .nvmrc" "$(tr -d '[:space:]' < "$ROOT/.nvmrc")" "$(cat "$TMP/x/$NAME/NODE_VERSION")"
echo "  tamaño: $(du -h "$ARTIFACT" | cut -f1) comprimido, $(du -sh "$TMP/x/$NAME" | cut -f1) extraído"
VPS_HOST=admin@host.invalid ARTIFACT="$ARTIFACT" DRY_RUN=1 "$WEB/deploy-to-vps.sh" > "$TMP/dry.log" 2>&1
ok "deploy DRY_RUN=1 termina sin conectar" "0 1" "$? $(grep -c '^DRY_RUN: no se conecta' "$TMP/dry.log")"

echo "== 3. Servidor standalone (sin variables de la app)"
REL="$TMP/x/$NAME"
mkdir -p "$TMP/cache"; ln -s "$TMP/cache" "$REL/.next/cache"
chmod -R a-w "$REL"   # el release es de solo lectura, como en el VPS
P="$(free_port)"; B="http://127.0.0.1:$P"
(cd "$REL" && exec env -i PATH="$(dirname "$NODE"):/usr/bin:/bin" NODE_ENV=production \
  HOSTNAME=127.0.0.1 PORT="$P" NEXT_TELEMETRY_DISABLED=1 "$NODE" server.js) > "$TMP/server.log" 2>&1 & PIDS+=($!)
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
CHUNK="$(curl -s "$B/" | grep -o '/_next/static/[^"]*\.js' | head -1)"
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
cp "$WEB/.env.example" "$ENV_FILE"
# "Servicio": reinicia server.js de current, como haría systemd.
cat > "$TMP/svc.sh" <<EOF
#!/usr/bin/env bash
if [ -f "$TMP/svc.pid" ]; then
  pid=\$(cat "$TMP/svc.pid"); kill "\$pid" 2>/dev/null
  while kill -0 "\$pid" 2>/dev/null; do sleep 0.1; done
fi
cd "$WEB_ROOT/current"
setsid env -i PATH="$(dirname "$NODE"):/usr/bin:/bin" NODE_ENV=production HOSTNAME=127.0.0.1 \
  PORT=$HEALTH_PORT NEXT_TELEMETRY_DISABLED=1 "$NODE" "$WEB_ROOT/current/server.js" \
  >> "$TMP/svc.log" 2>&1 < /dev/null &
echo \$! > "$TMP/svc.pid"
EOF
chmod +x "$TMP/svc.sh"; export RESTART_CMD="$TMP/svc.sh"

# Variantes del artefacto con otro commit: buena, rota (server.js sale con 1),
# y con contenido prohibido.
variant() {  # variant <sha12> <modo>
  local n="ponquesito-web-$1" d="$TMP/v/$1"
  rm -rf "$d"; mkdir -p "$d"; cp -a "$REL" "$d/$n"; rm -f "$d/$n/.next/cache"
  printf '%s\n' "$1" > "$d/$n/REVISION"
  case "$2" in
    rota) echo 'process.exit(1)' > "$d/$n/server.js" ;;
    backend) mkdir -p "$d/$n/backend"; touch "$d/$n/backend/settings.py" ;;
    env) echo 'X=1' > "$d/$n/.env.production" ;;
    enlace) ln -s /etc/passwd "$d/$n/public/enlace" ;;
  esac
  tar -C "$d" -czf "$TMP/v/$n.tar.gz" "$n"
  (cd "$TMP/v" && sha256sum "$n.tar.gz" > "$n.tar.gz.sha256")
  echo "$TMP/v/$n.tar.gz"
}
mkdir -p "$TMP/v"
A="$ARTIFACT"; Bk="$(variant bbbbbbbbbbbb rota)"; C="$(variant cccccccccccc buena)"; D="$(variant dddddddddddd buena)"
R="$WEB/release.sh"
cur() { basename "$(readlink "$WEB_ROOT/current" 2>/dev/null)" 2>/dev/null; }
prev() { basename "$(readlink "$WEB_ROOT/previous" 2>/dev/null)" 2>/dev/null; }
run() { bash "$R" "$@" > "$TMP/r.log" 2>&1; echo $?; }
serving() { curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$HEALTH_PORT/linktree"; }

ok "release roto sin anterior → error" "1" "$(run deploy "$Bk")"
grep -q 'no hay release anterior' "$TMP/r.log"; ok "  mensaje: no hay anterior" "0" "$?"
rm -f "$WEB_ROOT/current"; rm -rf "$WEB_ROOT/releases/bbbbbbbbbbbb"

ok "deploy A" "0" "$(run deploy "$A")"
ok "  current = A" "$SHA" "$(cur)"
ok "  sirve 200" "200" "$(serving)"
ok "  release sin permisos de escritura de grupo/otros" "" "$(find "$WEB_ROOT/releases/$SHA" -perm /g+w,o+rwx ! -type l | head -1)"

ok "deploy B (roto) → error" "1" "$(run deploy "$Bk")"
grep -q 'rollback automático completado' "$TMP/r.log"; ok "  rollback automático" "0" "$?"
ok "  current vuelve a A" "$SHA" "$(cur)"
ok "  sigue sirviendo 200" "200" "$(serving)"

ok "deploy C" "0" "$(run deploy "$C")"
ok "  current = C" "cccccccccccc" "$(cur)"
ok "  previous = A" "$SHA" "$(prev)"
ok "rollback" "0" "$(run rollback)"
ok "  current = A" "$SHA" "$(cur)"
ok "  previous = C" "cccccccccccc" "$(prev)"
ok "  sirve 200" "200" "$(serving)"
ok "rollback otra vez (alterna)" "0" "$(run rollback)"
ok "  current = C" "cccccccccccc" "$(cur)"
ok "  sin symlinks temporales" "" "$(ls -A "$WEB_ROOT" | grep '\.tmp$')"

cp "$C.sha256" "$TMP/sha.bak"; sed -i 's/^./0/' "$C.sha256"
ok "SHA-256 alterado → rechazo" "1" "$(run deploy "$C")"; cp "$TMP/sha.bak" "$C.sha256"
# Un commit distinto por variante: cada una pasa por todas las comprobaciones.
for v in e1:backend e2:env e3:enlace; do
  ok "artefacto con ${v#*:} → rechazo" "1" "$(run deploy "$(variant "${v%%:*}eeeeeeeeee" "${v#*:}")")"
done
ok "  ningún rechazo instaló nada" "" "$(ls -A "$WEB_ROOT/releases" | grep -E 'eeee|incoming')"
echo 'HOSTNAME=0.0.0.0' >> "$ENV_FILE"
ok "web.env con HOSTNAME → rechazo" "1" "$(run activate "$SHA")"
cp "$WEB/.env.example" "$ENV_FILE"
printf '#!/bin/sh\necho v18.19.1\n' > "$TMP/node18"; chmod +x "$TMP/node18"
ok "Node distinto de .nvmrc → rechazo" "1" "$(NODE_BIN="$TMP/node18" run activate "$SHA")"
ok "  current sin cambios tras los rechazos" "cccccccccccc" "$(cur)"
ok "  sigue sirviendo 200" "200" "$(serving)"

ok "deploy D (KEEP=2)" "0" "$(run deploy "$D")"
ok "  conserva D, C y nada más" "cccccccccccc dddddddddddd" "$(ls "$WEB_ROOT/releases" | sort | tr '\n' ' ' | sed 's/ $//')"
ok "  caché de releases eliminados borrada" "cccccccccccc dddddddddddd" "$(ls "$CACHE_DIR" | sort | tr '\n' ' ' | sed 's/ $//')"

echo
if [ "$FAIL" -eq 0 ]; then echo "TODAS LAS PRUEBAS OK"; else echo "HAY FALLOS"; tail -20 "$TMP/r.log"; fi
exit "$FAIL"
