#!/usr/bin/env bash
# Prueba publicar-https.sh de principio a fin en la simulación del VPS.
# Requiere, en este orden: sim/crear.sh, regresion-rutas.sh (deja staging
# aplicado) y https/preparar-sim.sh.
# Uso: deploy/staging/test/https/probar-sim.sh <paquete> <directorio-privado-nuevo>
#   <paquete>  salida de deploy/staging/empaquetar-https.sh
#   <directorio-privado-nuevo>  para la llave SSH de la simulación, sus
#              contraseñas y la raíz de Pebble (solo valen para la simulación)
# Comprueba bloqueos sin cambios, --comprobar, --aplicar (y su repetición),
# --aplicar-correo (y su repetición), --retirar (dos veces) y una nueva
# aplicación tras retirar; desde fuera del contenedor: puertos, certificado,
# cabeceras de proxy, límite de cuerpo, backend caído, HTTP-01 por el bloque
# http://, los flujos de Next.js por HTTPS (con la imagen de 4.000.000 bytes)
# y el cliente de correo de la app contra Mailpit. Producción simulada no
# debe recibir ninguna petición.
set -euo pipefail

C=fp-vps-sim
PAQUETE=${1:?Uso: $0 <paquete> <directorio-privado-nuevo>}
T=${2:?Uso: $0 <paquete> <directorio-privado-nuevo>}
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
AQUI=$REPO/deploy/staging/test/https
NOMBRE=api-staging.familiaponquesito.com
docker exec "$C" true 2>/dev/null || { echo "Falta la simulación"; exit 2; }
[ ! -e "$T" ] || { echo "$T ya existe"; exit 2; }
mkdir -m 700 "$T"
IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$C")
FALLOS=0

sim() { docker exec -i "$C" bash -c "$1"; }
ok() { echo "OK    $1"; }
mal() { FALLOS=$((FALLOS + 1)); echo "FALLO $1"; }
comprobar() { if [ "$2" = "$3" ]; then ok "$1"; else mal "$1: obtenido «$3», esperado «$2»"; fi; }
estado() { sim 'ufw show added; systemctl is-active caddy ponquesito-mailpit 2>/dev/null; systemctl is-enabled caddy 2>/dev/null; sha256sum /etc/caddy/Caddyfile; ss -Hltn | awk "{print \$4}" | sort; grep ^DJANGO_BEHIND /etc/ponquesito-staging/backend.env; getent passwd ponquesito-mailpit; ls /etc/systemd/system | grep -c mailpit; true' | sha256sum | cut -c1-16; }
sellada() {
  docker exec -i "$C" bash -s -- "$1" <<'SH'
set -u
d=$(ls -d /home/wilfredo/fp-staging-https/evidencia-* | sort | tail -1); cd "$d" || exit 1
sha256sum --quiet --strict -c SHA256SUMS || { echo "SHA256SUMS no verifica"; exit 1; }
[ "$(ls -A | grep -vx SHA256SUMS | sort)" = "$(sed 's/^[0-9a-f]\{64\}  //' SHA256SUMS | sort)" ] || { echo "SHA256SUMS no lista exactamente los archivos"; exit 1; }
grep -qF -- "$1" registro.txt || { echo "registro.txt sin «$1»"; exit 1; }
[ -z "$(find . ! -user wilfredo)" ] || { echo "archivos que no son de wilfredo"; exit 1; }
! grep -rqiE 'Bearer [0-9a-f]{20}|sig=[A-Za-z0-9_:-]{20}' . || { echo "la evidencia contiene una credencial"; exit 1; }
SH
}
# caso <nombre> <modo> <código> <texto> [preparar] [restaurar]
caso() {
  local nombre=$1 modo=$2 codigo=$3 texto=$4 preparar=${5:-:} restaurar=${6:-:} salida real antes despues s
  sim "$preparar"
  antes=$(estado)
  salida=$(docker exec -u wilfredo "$C" timeout 900 bash -c "cd ~/fp-staging-https && sudo bash ./publicar-https.sh $modo"' ; echo "<<$?>>"' 2>&1)
  real=$(sed -n 's/.*<<\([0-9]*\)>>.*/\1/p' <<<"$salida" | tail -1)
  despues=$(estado)
  sim "$restaurar"
  local ok_=1 motivo=""
  [ "$real" = "$codigo" ] || { ok_=0; motivo="código $real (esperado $codigo)"; }
  grep -qF -- "$texto" <<<"$salida" || { ok_=0; motivo="$motivo; falta «$texto»"; }
  if [ "$codigo" = 2 ]; then [ "$antes" = "$despues" ] || { ok_=0; motivo="$motivo; el estado cambió con un bloqueo"; }; fi
  if grep -q '^Evidencia sellada: ' <<<"$salida"; then s=$(sellada "$texto") || { ok_=0; motivo="$motivo; $s"; }
  else ok_=0; motivo="$motivo; sin evidencia sellada"; fi
  if [ "$ok_" = 1 ]; then ok "$nombre (código $real, evidencia sellada)"
  else mal "$nombre: $motivo"; { grep -E '^!!|MAL|FALLO' <<<"$salida" || true; } | head -5 | sed 's/^/      /'; fi
}

echo "== Preparación"
"$AQUI/instalar-paquete-sim.sh" "$PAQUETE"
# Llave SSH solo para la simulación (túnel al buzón de Mailpit).
ssh-keygen -q -t ed25519 -N '' -f "$T/clave" -C fp-sim
docker cp "$T/clave.pub" "$C:/root/fp-sim.pub"
sim 'install -d -m 700 -o wilfredo -g wilfredo /home/wilfredo/.ssh && install -m 600 -o wilfredo -g wilfredo /root/fp-sim.pub /home/wilfredo/.ssh/authorized_keys && systemctl start ssh'
for _ in $(seq 20); do ssh-keyscan -t ed25519 "$IP" >"$T/known_hosts" 2>/dev/null && [ -s "$T/known_hosts" ] && break; sleep 0.5; done
sim 'cat /root/pebble/raiz.pem' >"$T/pebble-raiz.pem"
sim 'cp -a /etc/caddy/Caddyfile /root/Caddyfile.base'
BASE_UFW=$(sim 'ufw show added')
INICIO=$(sim 'date "+%Y-%m-%d %H:%M:%S"')

echo "== Bloqueos (código 2, sin cambios)"
# /etc/hosts es un montaje de Docker: se reescribe en su sitio (sed -i no puede renombrarlo).
# Con api-staging ya en el DNS público, quitarlo de /etc/hosts no simula su
# ausencia: se apunta a otra IP (documentación, RFC 5737), que /etc/hosts fija.
caso "DNS hacia otra IP" --aplicar 2 "resuelve a '203.0.113.10'" \
  "grep -v '$NOMBRE' /etc/hosts >/root/hosts; echo '203.0.113.10 $NOMBRE' >>/root/hosts; cat /root/hosts >/etc/hosts" \
  "grep -v '$NOMBRE' /etc/hosts >/root/hosts; echo '37.27.149.66 $NOMBRE' >>/root/hosts; cat /root/hosts >/etc/hosts"
caso "DNS con AAAA" --aplicar 2 "tiene AAAA" "echo '2001:db8::1 $NOMBRE' >>/etc/hosts" "grep -v '^2001:db8::1 ' /etc/hosts >/root/hosts; cat /root/hosts >/etc/hosts"
caso "UFW inactivo" --aplicar 2 "UFW no está activo" "ufw disable >/dev/null" "ufw --force enable >/dev/null"
caso "SSH no permitido en UFW" --aplicar 2 "UFW no muestra SSH" "ufw delete allow OpenSSH >/dev/null" "ufw allow OpenSSH >/dev/null"
caso "SSH solo desde un origen" --aplicar 2 "UFW no muestra SSH" \
  "ufw delete allow OpenSSH >/dev/null; ufw allow from 203.0.113.7 to any app OpenSSH >/dev/null" \
  "ufw delete allow from 203.0.113.7 to any app OpenSSH >/dev/null; ufw allow OpenSSH >/dev/null"
caso "SSH denegado antes del permiso" --aplicar 2 "UFW no muestra SSH" "ufw insert 1 deny 22/tcp >/dev/null" "ufw delete deny 22/tcp >/dev/null"
caso "Caddyfile ajeno" --aplicar 2 "tiene otro contenido" "echo '# ajeno' >>/etc/caddy/Caddyfile" "cp -a /root/Caddyfile.base /etc/caddy/Caddyfile"
caso "puerto 80 ocupado" --aplicar 2 "el puerto 80 ya está en uso" \
  "systemd-run --quiet --unit fp-ocupa80 python3 -m http.server -b 127.0.0.1 80 -d /nonexistent; sleep 1" "systemctl stop fp-ocupa80"
caso "paquete manipulado" --aplicar 2 "SHA256SUMS del paquete no verifica" \
  "cp -a /home/wilfredo/fp-staging-https/Caddyfile.api-staging /root/cf.bak; echo '# x' >>/home/wilfredo/fp-staging-https/Caddyfile.api-staging" \
  "cp -a /root/cf.bak /home/wilfredo/fp-staging-https/Caddyfile.api-staging"
caso "--aplicar-correo antes de --aplicar" --aplicar-correo 2 "primero --aplicar"
comprobar "UFW intacto tras los bloqueos" "$BASE_UFW" "$(sim 'ufw show added')"
comprobar "sin respaldos tras los bloqueos" 0 "$(sim 'ls /var/backups/ponquesito-staging-https 2>/dev/null | wc -l')"

echo "== Aplicación"
caso "--comprobar" --comprobar 0 "Comprobación completa: sin bloqueos"
caso "--aplicar" --aplicar 0 "Listo (--aplicar)"
caso "--aplicar repetido" --aplicar 0 "Cambios hechos: ninguno."
caso "--comprobar tras aplicar (verifica HTTPS)" --comprobar 0 "ok   journal de Caddy sin la clave"

echo "== Desde fuera del contenedor ($IP)"
R=(--resolve "$NOMBRE:443:$IP" --resolve "$NOMBRE:80:$IP" --cacert "$T/pebble-raiz.pem")
U=https://$NOMBRE
for p in 22 80 443; do comprobar "puerto $p accesible" abierto "$(timeout 3 bash -c "exec 3<>/dev/tcp/$IP/$p" 2>/dev/null && echo abierto || echo cerrado)"; done
for p in 465 2019 3000 5432 8000 8001 8025; do comprobar "puerto $p no accesible" cerrado "$(timeout 3 bash -c "exec 3<>/dev/tcp/$IP/$p" 2>/dev/null && echo abierto || echo cerrado)"; done
comprobar "certificado verificado por nombre" 200 "$(curl -sS "${R[@]}" -o /dev/null -w '%{http_code}' "$U/health/")"
comprobar "HTTP → HTTPS" "308 $U/health/" "$(curl -sS "${R[@]}" -o /dev/null -w '%{http_code} %{redirect_url}' "http://$NOMBRE/health/")"
# Cabeceras que recibe el backend: eco en 127.0.0.1:8001 en lugar de Django.
sim 'cat >/root/eco.py <<PY
import http.server, json
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self): self.r()
    def do_POST(self): self.r()
    def r(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n: self.rfile.read(n)
        b = json.dumps({"path": self.path, "headers": dict(self.headers.items())}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", 8001), H).serve_forever()
PY
systemctl stop ponquesito-staging-backend; systemctl reset-failed fp-eco 2>/dev/null || true; systemd-run --quiet --unit fp-eco python3 /root/eco.py; sleep 1'
r=$(curl -sS "${R[@]}" -H 'X-Forwarded-For: 203.0.113.9' -H 'X-Real-IP: 203.0.113.9' -H 'Forwarded: for=203.0.113.9;proto=http' \
  -H 'X-Forwarded-Proto: http' -H 'X-Forwarded-Host: otro.example' "$U/health/" | python3 -c '
import json, sys
h = json.load(sys.stdin)["headers"]
print(h.get("Host"), h.get("X-Forwarded-For"), h.get("X-Real-Ip"), h.get("X-Forwarded-Proto"), h.get("X-Forwarded-Host"), "Forwarded" in h)')
GW=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}' "$C")
comprobar "cabeceras de proxy (Host, XFF, X-Real-IP, Proto, X-Forwarded-Host, Forwarded)" "$NOMBRE $GW $GW https $NOMBRE False" "$r"
head -c 4500000 /dev/zero >"$T/cuerpo"
comprobar "cuerpo de 4.500.000 bytes llega al backend" 200 "$(curl -sS "${R[@]}" -o /dev/null -w '%{http_code}' -X POST --data-binary @"$T/cuerpo" "$U/api/v1/internal/cake-request/")"
printf x >>"$T/cuerpo"
comprobar "cuerpo de 4.500.001 bytes: 413 de Caddy" 413 "$(curl -sS "${R[@]}" -o /dev/null -w '%{http_code}' -X POST --data-binary @"$T/cuerpo" "$U/api/v1/internal/cake-request/")"
rm "$T/cuerpo"
sim 'systemctl stop fp-eco'
r=$(curl -sS "${R[@]}" -o "$T/caido" -w '%{http_code}' "$U/api/v1/private-images/00000000-0000-4000-8000-000000000000/?sig=fp-firma-caido")
comprobar "backend caído: 503" "503 Servicio no disponible" "$r $(cat "$T/caido")"
comprobar "journal sin la firma con el backend caído" 0 "$(sim 'journalctl -u caddy --since "-2min" --no-pager -o cat | grep -c fp-firma-caido || true')"
sim 'systemctl start ponquesito-staging-backend; for i in $(seq 40); do curl -fs http://127.0.0.1:8001/health/ >/dev/null && break; sleep 0.5; done'
# HTTP-01 a través del bloque http:// (el despliegue real puede usar ese desafío).
r=$(sim 'systemctl stop caddy; mkdir -p /root/http01
sed "s|^\t\tissuer acme\$|\t\tissuer acme {\n\t\t\tdisable_tlsalpn_challenge\n\t\t}|; s|^\tadmin off\$|\tadmin off\n\tstorage file_system /root/http01/datos|" /etc/caddy/Caddyfile >/root/http01/Caddyfile
caddy run --adapter caddyfile --config /root/http01/Caddyfile >/root/http01/log 2>&1 & P=$!
for i in $(seq 60); do grep -q "certificate obtained successfully" /root/http01/log && break; sleep 1; done
[ "$(grep -c "\"challenge\":\"http-01\"" /root/http01/log)" -ge 1 ] && echo -n "desafío servido; " || echo -n "sin desafío; "
grep -q "certificate obtained successfully" /root/http01/log && echo certificado || echo "sin certificado"
kill $P; wait $P 2>/dev/null; rm -r /root/http01; systemctl start caddy; sleep 2')
comprobar "HTTP-01 por el bloque http://" "desafío servido; certificado" "$r"
comprobar "Caddy de nuevo activo" 200 "$(curl -sS "${R[@]}" -o /dev/null -w '%{http_code}' "$U/health/")"
# Flujos reales de Next.js por HTTPS, incluida la imagen de 4.000.000 bytes.
sim 'grep ^PONQUESITO_INTERNAL_API_KEY= /etc/ponquesito-staging/backend.env | cut -d= -f2' >"$T/clave-interna"; chmod 600 "$T/clave-interna"
if FP_SIM_IP=$IP NODE_EXTRA_CA_CERTS="$T/pebble-raiz.pem" "$REPO/deploy/staging/probar-https.sh" "$T/clave-interna" >"$T/flujos.log" 2>&1; then
  ok "flujos de Next.js por HTTPS: $(grep -oE 'Tests +[0-9]+ passed' "$T/flujos.log" | tr -s ' ')"
  grep -oE '"imagen_maxima":\{[^}]*\}' "$T/flujos.log" | sed 's/^/      /'
else mal "flujos de Next.js por HTTPS (ver $T/flujos.log)"; fi
if FP_SIM_IP=$IP NODE_EXTRA_CA_CERTS="$T/pebble-raiz.pem" "$REPO/deploy/staging/verificar-publico.sh" despues "$T/clave-interna" >"$T/publico.log" 2>&1; then
  ok "verificar-publico.sh despues: $(grep -c '^ok ' "$T/publico.log") comprobaciones"
else mal "verificar-publico.sh despues (ver $T/publico.log)"; grep '^MAL' "$T/publico.log" | sed 's/^/      /'; fi

echo "== Correo de Preview"
caso "--aplicar-correo" --aplicar-correo 0 "Listo (--aplicar-correo)"
caso "--aplicar-correo repetido" --aplicar-correo 0 "Cambios hechos: ninguno."
comprobar "puerto 465 accesible desde fuera" abierto "$(timeout 3 bash -c "exec 3<>/dev/tcp/$IP/465" 2>/dev/null && echo abierto || echo cerrado)"
comprobar "puerto 8025 (buzón) no accesible desde fuera" cerrado "$(timeout 3 bash -c "exec 3<>/dev/tcp/$IP/8025" 2>/dev/null && echo abierto || echo cerrado)"
sim 'cat /home/wilfredo/fp-staging-https/entrega/smtp-password' >"$T/smtp-password"; sim 'cat /home/wilfredo/fp-staging-https/entrega/ui-password' >"$T/ui-password"
chmod 600 "$T/smtp-password" "$T/ui-password"
if FP_SIM_IP=$IP NODE_EXTRA_CA_CERTS="$T/pebble-raiz.pem" SSH_KEY="$T/clave" KNOWN_HOSTS="$T/known_hosts" \
    "$REPO/deploy/staging/probar-correo.sh" "$T/smtp-password" "$T/ui-password" "wilfredo@$IP" >"$T/correo.log" 2>&1; then
  ok "cliente de correo de la app contra Mailpit (TLS, AUTH, .invalid sí, example.com no; buzón por túnel)"
else mal "cliente de correo de la app (ver $T/correo.log)"; fi
# Preview simulada: Server Action con las variables de Preview (API por HTTPS,
# SMTP de pruebas) y la imagen de 4.000.000 bytes; luego el verificador de la
# prueba de Preview, con el buzón por túnel y la descarga por HTTPS.
NB=${NODE_BIN:-$HOME/.nvm/versions/node/v$(tr -d 'v[:space:]' <"$REPO/.nvmrc")/bin}
"$NB/node" "$REPO/deploy/staging/test/png-exacto.mjs" "$T/maxima.png" >/dev/null
DESDE=$(date -u +%Y-%m-%dT%H:%M:%SZ); sleep 1
if (cd "$REPO" && env -i PATH="$NB:/usr/bin:/bin" HOME="$HOME" NODE_ENV=test TZ=UTC FP_SIM_IP="$IP" NODE_EXTRA_CA_CERTS="$T/pebble-raiz.pem" \
    FP_IMAGEN="$T/maxima.png" FP_FECHA="$(date -u -d '+20 days' +%Y-%m-%d)" \
    PONQUESITO_API_URL="https://$NOMBRE" APP_CANONICAL_URL=https://preview-simulada.example.invalid \
    SMTP_HOST="$NOMBRE" SMTP_PORT=465 SMTP_SECURE=true SMTP_USER=vercel-preview \
    EMAIL_FROM="Familia Ponquesito Preview <preview@example.invalid>" KAREM_NOTIFICATION_EMAIL=propietaria.preview@example.invalid \
    bash -c 'PONQUESITO_INTERNAL_API_KEY=$(cat "$1"); SMTP_APP_PASSWORD=$(cat "$2"); export PONQUESITO_INTERNAL_API_KEY SMTP_APP_PASSWORD
      exec ./node_modules/.bin/vitest run --config deploy/staging/test/vitest.correo.config.mts preview-imagen' _ "$T/clave-interna" "$T/smtp-password") >"$T/preview.log" 2>&1 \
  && FP_SIM_IP=$IP NODE_EXTRA_CA_CERTS="$T/pebble-raiz.pem" SSH_KEY="$T/clave" KNOWN_HOSTS="$T/known_hosts" \
    "$REPO/deploy/staging/verificar-imagen-preview.sh" "$T/ui-password" "$T/maxima.png" "$DESDE" "wilfredo@$IP" >>"$T/preview.log" 2>&1; then
  ok "Preview simulada: imagen de 4.000.000 bytes por HTTPS, correos por Mailpit, descarga idéntica"
else mal "Preview simulada (ver $T/preview.log)"; fi
antes=$(sim 'systemctl show -p InvocationID --value ponquesito-mailpit')
sim 'systemctl start ponquesito-mailpit-renovar.service'
comprobar "renovación: Mailpit reiniciado por el temporizador" distinto "$([ "$(sim 'systemctl show -p InvocationID --value ponquesito-mailpit')" != "$antes" ] && echo distinto || echo igual)"
caso "--comprobar con correo (verifica ambos)" --comprobar 0 "ok   mensaje de prueba recibido"
caso "--comprobar sin las copias de entrega" --comprobar 0 "omitidas (contraseñas de entrega ya retiradas" \
  "mv /home/wilfredo/fp-staging-https/entrega /root/entrega.sim" "mv /root/entrega.sim /home/wilfredo/fp-staging-https/entrega"
comprobar "idioma de la simulación como en el VPS" en_US.UTF-8 "$(docker exec -u wilfredo "$C" bash -c 'sudo bash -c "echo \$LANG"')"

echo "== Retirada"
caso "--retirar" --retirar 0 "Listo (--retirar)"
comprobar "UFW como al principio" "$BASE_UFW" "$(sim 'ufw show added')"
comprobar "Caddyfile de la distribución" "$(sim 'sha256sum </root/Caddyfile.base')" "$(sim 'sha256sum </etc/caddy/Caddyfile')"
comprobar "caddy.service" "inactive disabled" "$(sim 'echo $(systemctl is-active caddy) $(systemctl is-enabled caddy)' || true)"
comprobar "sin escucha en 80, 443, 465, 2019, 8025" "" "$(sim 'ss -Hltn | awk "{print \$4}" | grep -E ":(80|443|465|2019|8025)\$" || true')"
comprobar "sin usuario ni archivos de Mailpit" "0 0" "$(sim 'echo $(getent passwd ponquesito-mailpit | wc -l) $(ls -d /opt/ponquesito-mailpit /etc/ponquesito-mailpit /var/lib/ponquesito-mailpit /etc/systemd/system/ponquesito-mailpit* 2>/dev/null | wc -l)')"
comprobar "staging sin proxy HTTPS" DJANGO_BEHIND_HTTPS_PROXY=false "$(sim 'grep ^DJANGO_BEHIND_HTTPS_PROXY= /etc/ponquesito-staging/backend.env')"
comprobar "datos ACME conservados" 1 "$(sim "find /var/lib/caddy/.local/share/caddy/certificates -name '$NOMBRE.crt' | wc -l")"
caso "--retirar repetido" --retirar 0 "Cambios hechos: ninguno."
caso "--aplicar tras retirar" --aplicar 0 "Listo (--aplicar)"
caso "--retirar final" --retirar 0 "Listo (--retirar)"
comprobar "UFW como al principio (final)" "$BASE_UFW" "$(sim 'ufw show added')"

echo "== Producción simulada"
comprobar "ninguna petición a ponquesito-backend (8000) ni ponquesito-web (3000)" 0 \
  "$(sim "journalctl -u ponquesito-backend -u ponquesito-web --since '$INICIO' --no-pager -o cat | grep -c 'HTTP/1' || true")"
comprobar "producción activa" "active active" "$(sim 'echo $(systemctl is-active ponquesito-backend ponquesito-web)')"

echo
[ "$FALLOS" = 0 ] && echo "publicar-https en la simulación: todo OK" || { echo "publicar-https en la simulación: $FALLOS fallos"; exit 1; }
