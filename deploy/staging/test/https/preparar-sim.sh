#!/usr/bin/env bash
# Prepara la simulación del VPS (fp-vps-sim, con staging ya aplicado) para
# probar publicar-https.sh:
# - Caddy 2.11.7 del paquete oficial, en el estado C1 del VPS: instalado,
#   inactivo y deshabilitado, con el Caddyfile de la distribución.
# - UFW como en el VPS: entrada deny y SSH permitido.
# - La IPv4 del VPS en una interfaz ficticia y api-staging → esa IP en
#   /etc/hosts: el tráfico a 37.27.149.66 se queda dentro de la simulación.
# - Pebble (ACME de pruebas de Let's Encrypt) en 127.0.0.1:14000. Valida de
#   verdad (HTTP-01 / TLS-ALPN-01) contra el Caddy de la simulación. Su raíz se
#   añade al almacén del sistema de la simulación (no al de este equipo).
# Uso: deploy/staging/test/https/preparar-sim.sh <directorio-de-descargas>
set -euo pipefail
C=fp-vps-sim
DESCARGAS=${1:?Uso: $0 <directorio-de-descargas>}
CADDY_DEB=caddy_2.11.7_linux_amd64.deb
CADDY_DEB_SHA256=a22b914ffd1958da42bc7ab13b7b62c6100634e0798ab594891d2d61d53ba749
PEBBLE_TGZ=pebble-v2.10.1-linux-amd64.tar.gz
PEBBLE_TGZ_SHA256=4f2fcb5bca8c85c9cf73ad140fccfc0d2be40bd81ab99879c79b7b8a0b4f70ed
docker exec "$C" true 2>/dev/null || { echo "Falta la simulación (deploy/staging/test/sim/crear.sh)"; exit 2; }
mkdir -p "$DESCARGAS"
[ -f "$DESCARGAS/$CADDY_DEB" ] || curl -fsSL -o "$DESCARGAS/$CADDY_DEB" "https://dl.cloudsmith.io/public/caddy/stable/deb/debian/pool/any-version/main/c/ca/$CADDY_DEB"
[ -f "$DESCARGAS/$PEBBLE_TGZ" ] || curl -fsSL -o "$DESCARGAS/$PEBBLE_TGZ" "https://github.com/letsencrypt/pebble/releases/download/v2.10.1/pebble-linux-amd64.tar.gz"
printf '%s  %s\n%s  %s\n' "$CADDY_DEB_SHA256" "$DESCARGAS/$CADDY_DEB" "$PEBBLE_TGZ_SHA256" "$DESCARGAS/$PEBBLE_TGZ" | sha256sum --quiet -c
docker cp "$DESCARGAS/$CADDY_DEB" "$C:/root/$CADDY_DEB"
docker cp "$DESCARGAS/$PEBBLE_TGZ" "$C:/root/$PEBBLE_TGZ"
docker exec -i "$C" bash -s <<'SIM'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
command -v ufw >/dev/null && command -v openssl >/dev/null || { apt-get update -qq; apt-get install -y -qq --no-install-recommends ufw openssl >/dev/null; }
# Caddy en estado C1.
apt-get install -y -qq /root/caddy_2.11.7_linux_amd64.deb >/dev/null
systemctl disable --now caddy.service >/dev/null 2>&1
echo "caddy: $(caddy version | cut -d' ' -f1) $(systemctl is-active caddy)/$(systemctl is-enabled caddy) $(sha256sum /etc/caddy/Caddyfile | cut -c1-12)"
# UFW como en el VPS.
ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null; ufw allow 22/tcp >/dev/null
ufw --force enable >/dev/null; ufw status verbose | sed -n '1,3p'
# IPv4 del VPS y nombre de staging.
ip link show fpvps >/dev/null 2>&1 || { ip link add fpvps type dummy; ip addr add 37.27.149.66/32 dev fpvps; ip link set fpvps up; }
grep -q 'api-staging.familiaponquesito.com' /etc/hosts || echo '37.27.149.66 api-staging.familiaponquesito.com' >>/etc/hosts
# Pebble con certificado propio para su escucha (127.0.0.1).
install -d -m 700 /root/pebble; cd /root/pebble
tar -xzf /root/pebble-v2.10.1-linux-amd64.tar.gz --strip-components=0
P=$(find /root/pebble -type f -name pebble | head -1); chmod 755 "$P"; chmod 755 "$P"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout ca.key -out ca.pem -days 3 -subj "/CN=fp-sim Pebble escucha" 2>/dev/null
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout key.pem -out req.csr -subj /CN=127.0.0.1 2>/dev/null
openssl x509 -req -in req.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out cert.pem -days 3 -extfile <(printf 'subjectAltName=IP:127.0.0.1,DNS:localhost') 2>/dev/null
cat >config.json <<J
{"pebble": {"listenAddress": "127.0.0.1:14000", "managementListenAddress": "127.0.0.1:15000",
  "certificate": "/root/pebble/cert.pem", "privateKey": "/root/pebble/key.pem",
  "httpPort": 80, "tlsPort": 443, "ocspResponderURL": "", "externalAccountBindingRequired": false}}
J
systemctl stop fp-pebble 2>/dev/null || true; systemctl reset-failed fp-pebble 2>/dev/null || true
systemd-run --quiet --unit fp-pebble -p Environment=PEBBLE_VA_NOSLEEP=1 -p Environment=PEBBLE_WFE_NONCEREJECT=0 "$P" -config /root/pebble/config.json
for _ in $(seq 50); do curl -fsS --cacert ca.pem https://127.0.0.1:15000/roots/0 -o raiz.pem 2>/dev/null && break; sleep 0.2; done
cp ca.pem /usr/local/share/ca-certificates/fp-sim-pebble-escucha.crt
cp raiz.pem /usr/local/share/ca-certificates/fp-sim-pebble-raiz.crt
update-ca-certificates >/dev/null 2>&1
echo "pebble: $(systemctl is-active fp-pebble); raíz $(openssl x509 -in raiz.pem -noout -subject)"
SIM
