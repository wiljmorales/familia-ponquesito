#!/usr/bin/env bash
# Verificación pública, solo lectura, desde fuera del VPS (este equipo; mejor
# desde una red sin proxy en el puerto 80, p. ej. datos del móvil).
# Uso: deploy/staging/verificar-publico.sh antes|dns|despues [archivo-clave-interna]
#   antes    DNS de la zona como el 2026-10-18 y api-staging sin publicar.
#   dns      zona igual y api-staging → 37.27.149.66 sin AAAA (tras crear el A).
#   despues  además: api-staging → 37.27.149.66 (sin AAAA), certificado de
#            Let's Encrypt válido para el nombre, API, rutas y aislamiento.
# DNS por DNS sobre HTTPS (Cloudflare 1.1.1.1 y Google 8.8.8.8), sin dig. Con la
# clave (600), también comprueba 200 con credencial. No escribe nada.
# Simulación del VPS: FP_SIM_IP y NODE_EXTRA_CA_CERTS (raíz de Pebble); se
# omite el DNS público.
set -euo pipefail
FASE=${1:?Uso: $0 antes|dns|despues [archivo-clave-interna]}
case "$FASE" in antes|dns|despues) ;; *) echo "Uso: $0 antes|dns|despues [archivo-clave-interna]"; exit 2 ;; esac
CLAVE=${2:-}
NOMBRE=api-staging.familiaponquesito.com
IP=37.27.149.66
FALLOS=0
SIM_IP=${FP_SIM_IP:-}
if [ -n "$SIM_IP" ]; then
  IP=$SIM_IP; CA=${NODE_EXTRA_CA_CERTS:?}; EMISOR=Pebble
  C=(--resolve "$NOMBRE:443:$IP" --resolve "$NOMBRE:80:$IP" --cacert "$CA"); OSSL=(-CAfile "$CA")
else C=(); OSSL=(); EMISOR="Let's Encrypt"; fi
v() { if [ "$2" = "$3" ]; then echo "ok   $1: $3"; else echo "MAL  $1: obtenido «$3», esperado «$2»"; FALLOS=$((FALLOS + 1)); fi; }
doh() {  # doh <servidor> <nombre> <tipo>: respuestas ordenadas, separadas por «;»
  local url
  case "$1" in cf) url=https://cloudflare-dns.com/dns-query ;; google) url=https://dns.google/resolve ;; esac
  curl -fsS --max-time 10 -H 'accept: application/dns-json' "$url?name=$2&type=$3" | python3 -c '
import json, sys
d = json.load(sys.stdin); t = {"A": 1, "AAAA": 28, "CNAME": 5, "MX": 15, "TXT": 16, "NS": 2, "CAA": 257, "DS": 43}[sys.argv[1]]
print(";".join(sorted(a["data"].strip("\"").lower().rstrip(".") for a in d.get("Answer", []) if a["type"] == t)))' "$3"
}

if [ -z "$SIM_IP" ]; then
echo "DNS de la zona (debe seguir como el 2026-10-18)"
for s in cf google; do
  v "[$s] apex A" "162.159.143.30;172.66.3.26" "$(doh $s familiaponquesito.com A)"
  v "[$s] apex AAAA" "" "$(doh $s familiaponquesito.com AAAA)"
  v "[$s] www CNAME" "custom-domains.chatgpt.site" "$(doh $s www.familiaponquesito.com CNAME)"
  v "[$s] MX (reenvío de Porkbun)" "10 fwd1.porkbun.com;20 fwd2.porkbun.com" "$(doh $s familiaponquesito.com MX)"
  v "[$s] TXT (SPF)" "v=spf1 include:_spf.porkbun.com ~all" "$(doh $s familiaponquesito.com TXT)"
  v "[$s] NS" "curitiba.ns.porkbun.com;fortaleza.ns.porkbun.com;maceio.ns.porkbun.com;salvador.ns.porkbun.com" "$(doh $s familiaponquesito.com NS)"
  v "[$s] CAA" "" "$(doh $s familiaponquesito.com CAA)"
  v "[$s] api (producción, sin publicar)" "" "$(doh $s api.familiaponquesito.com A)$(doh $s api.familiaponquesito.com AAAA)"
done

if [ "$FASE" = antes ]; then
  for s in cf google; do v "[$s] $NOMBRE aún sin registros" "" "$(doh $s $NOMBRE A)$(doh $s $NOMBRE AAAA)$(doh $s $NOMBRE CNAME)"; done
  echo; [ "$FALLOS" = 0 ] && echo "Antes: todo OK" || { echo "Antes: $FALLOS diferencias"; exit 1; }
  exit 0
fi

for s in cf google; do
  v "[$s] $NOMBRE A" "$IP" "$(doh $s $NOMBRE A)"
  v "[$s] $NOMBRE sin AAAA ni CNAME" "" "$(doh $s $NOMBRE AAAA)$(doh $s $NOMBRE CNAME)"
done
fi
if [ "$FASE" = dns ]; then echo; [ "$FALLOS" = 0 ] && echo "DNS: todo OK" || { echo "DNS: $FALLOS diferencias"; exit 1; }; exit 0; fi

echo "Certificado (sin -k; raíces del sistema)"
cert=$(openssl s_client "${OSSL[@]}" -connect "$IP:443" -servername "$NOMBRE" -verify_hostname "$NOMBRE" -verify_return_error </dev/null 2>/dev/null || true)
v "cadena y nombre verificados" "0 (ok)" "$(sed -n 's/^ *Verify return code: \(.*\)$/\1/p' <<<"$cert" | head -1)"
v "emisor $EMISOR" si "$(openssl x509 -noout -issuer <<<"$cert" 2>/dev/null | grep -qF "$EMISOR" && echo si || echo no)"
v "nombres del certificado" "DNS:$NOMBRE" "$(openssl x509 -noout -ext subjectAltName <<<"$cert" 2>/dev/null | tail -1 | tr -d ' ')"
v "válido al menos 30 días" si "$(openssl x509 -noout -checkend 2592000 <<<"$cert" >/dev/null 2>&1 && echo si || echo no)"
echo "   caduca: $(openssl x509 -noout -enddate <<<"$cert" 2>/dev/null | cut -d= -f2)"

echo "API"
U=https://$NOMBRE
v "/health/" '{"status": "ok", "database": "ok"}' "$(curl -fsS --max-time 10 "${C[@]}" "$U/health/" || true)"
v "sin credencial" 401 "$(curl -sS --max-time 10 "${C[@]}" -o /dev/null -w '%{http_code}' -X POST "$U/api/v1/internal/agenda-availability/" || true)"
if [ -n "$CLAVE" ]; then
  [ "$(stat -c %a "$CLAVE")" = 600 ] || { echo "$CLAVE debe tener modo 600"; exit 2; }
  v "con credencial" 200 "$( (printf 'header = "Authorization: Bearer '; tr -d '\n' <"$CLAVE"; printf '"\n') | curl -sS --max-time 10 "${C[@]}" -K - -o /dev/null -w '%{http_code}' \
      -X POST -H 'Content-Type: application/json' -d '{"start_date":"2026-11-01","end_date":"2026-11-07","capacity_points":1}' "$U/api/v1/internal/agenda-availability/" || true)"
fi
v "imagen con firma no válida" 404 "$(curl -sS --max-time 10 "${C[@]}" -o /dev/null -w '%{http_code}' "$U/api/v1/private-images/00000000-0000-4000-8000-000000000000/?sig=x" || true)"
for r in / /api/v1/ /admin/ /.env; do v "ruta no publicada $r" 404 "$(curl -sS --max-time 10 "${C[@]}" -o /dev/null -w '%{http_code}' "$U$r" || true)"; done
v "HTTP → HTTPS" "308 $U/health/" "$(curl -sS --max-time 10 "${C[@]}" -o /dev/null -w '%{http_code} %{redirect_url}' "http://$NOMBRE/health/" || true)"
v "sin cabecera Server" 0 "$(curl -sS --max-time 10 "${C[@]}" -D - -o /dev/null "$U/health/" | grep -ci '^server:' || true)"

echo "Aislamiento"
v "TLS por IP sin nombre" sin-tls "$(curl -sSk --max-time 10 -o /dev/null "https://$IP/" 2>/dev/null && echo con-tls || echo sin-tls)"
v "TLS para api.familiaponquesito.com" sin-tls "$(curl -sS --max-time 10 --resolve "api.familiaponquesito.com:443:$IP" -o /dev/null https://api.familiaponquesito.com/health/ 2>/dev/null && echo con-tls || echo sin-tls)"
v "otro Host por la conexión de staging" 421 "$(curl -sS --max-time 10 "${C[@]}" -o /dev/null -w '%{http_code}' -H 'Host: api.familiaponquesito.com' "$U/health/" || true)"
v "HTTP por IP" 404 "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "http://$IP/health/" || true)"
for p in 2019 3000 5432 8000 8001 8025; do
  v "puerto $p cerrado desde fuera" cerrado "$(timeout 5 bash -c "exec 3<>/dev/tcp/$IP/$p" 2>/dev/null && echo abierto || echo cerrado)"
done
echo "   puerto 465 (SMTP de Preview): $(timeout 5 bash -c "exec 3<>/dev/tcp/$IP/465" 2>/dev/null && echo abierto || echo cerrado)"
echo; [ "$FALLOS" = 0 ] && echo "Después: todo OK" || { echo "Después: $FALLOS diferencias"; exit 1; }
