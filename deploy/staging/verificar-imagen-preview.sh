#!/usr/bin/env bash
# Verifica la prueba de la imagen de 4.000.000 bytes hecha desde Vercel Preview
# (o desde test/preview-imagen.smtp.ts): en el buzón de pruebas (Mailpit, por
# túnel SSH) deben estar, desde <desde>, el correo a la clienta y el aviso a la
# propietaria con el enlace firmado; la imagen descargada por HTTPS público
# (certificado verificado) debe ser idéntica byte a byte a <imagen>.
# Uso: deploy/staging/verificar-imagen-preview.sh <ui-password> <imagen> <desde-UTC> [destino-ssh]
#   <desde-UTC>  p. ej. 2026-10-20T15:00:00Z: hora anterior al envío del formulario
# Simulación: FP_SIM_IP, NODE_EXTRA_CA_CERTS. No muestra el enlace firmado.
set -euo pipefail
UI_PASS=${1:?Uso: $0 <ui-password> <imagen> <desde-UTC> [destino-ssh]}
IMAGEN=${2:?Uso: $0 <ui-password> <imagen> <desde-UTC> [destino-ssh]}
DESDE=${3:?Uso: $0 <ui-password> <imagen> <desde-UTC> [destino-ssh]}
DESTINO=${4:-wilfredo@37.27.149.66}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/familia_ponquesito}
KNOWN_HOSTS=${KNOWN_HOSTS:-$HOME/.ssh/known_hosts}
PUERTO_LOCAL=${PUERTO_LOCAL:-18025}
NOMBRE=api-staging.familiaponquesito.com
[ "$(stat -c %a "$UI_PASS")" = 600 ] || { echo "$UI_PASS debe tener modo 600"; exit 2; }
[ "$(stat -c %s "$IMAGEN")" = 4000000 ] || { echo "$IMAGEN no tiene 4.000.000 bytes"; exit 2; }
if ss -Hltn | awk '{print $4}' | grep -qE ":$PUERTO_LOCAL\$"; then echo "127.0.0.1:$PUERTO_LOCAL ya está en uso"; exit 2; fi
ssh -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$KNOWN_HOSTS" -o ExitOnForwardFailure=yes \
  -N -L "127.0.0.1:$PUERTO_LOCAL:127.0.0.1:8025" "$DESTINO" &
TUNEL=$!
TMP=$(mktemp -d); trap 'kill "$TUNEL" 2>/dev/null; wait "$TUNEL" 2>/dev/null || true; rm -rf "$TMP"' EXIT
for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$PUERTO_LOCAL/" 2>/dev/null && break; sleep 0.2; done
printf 'user = "operador:%s"\n' "$(cat "$UI_PASS")" >"$TMP/cred"; chmod 600 "$TMP/cred"
RESOLVE=()
[ -z "${FP_SIM_IP:-}" ] || RESOLVE=(--resolve "$NOMBRE:443:$FP_SIM_IP" --cacert "$NODE_EXTRA_CA_CERTS")
# El enlace firmado se extrae a un archivo privado; nunca se imprime.
python3 - "http://127.0.0.1:$PUERTO_LOCAL" "$TMP/cred" "$DESDE" "$TMP/enlace" <<'PY'
import datetime, json, re, subprocess, sys
base, cred, desde, salida = sys.argv[1:]
fecha = lambda s: datetime.datetime.fromisoformat(re.sub(r"\.\d+", "", s).replace("Z", "+00:00"))
t0 = fecha(desde)
def api(ruta):
    return json.loads(subprocess.run(["curl", "-fsS", "--max-time", "10", "-K", cred, base + ruta], check=True, capture_output=True).stdout)
def recientes(para):
    d = api("/api/v1/search?query=" + "to%3A" + para + "&limit=50")
    return [m for m in d["messages"] if fecha(m["Created"]) >= t0]
cliente, propietaria = recientes("cliente.preview@example.invalid"), recientes("propietaria.preview@example.invalid")
print(f"correos desde {desde}: a la clienta {len(cliente)}, a la propietaria {len(propietaria)}")
enlace = None
for m in propietaria:
    cuerpo = api(f"/api/v1/message/{m['ID']}")
    hallado = re.search(r"https://api-staging\.familiaponquesito\.com/api/v1/private-images/[0-9a-f-]{36}/\?sig=[^\s\"<>]+", (cuerpo.get("Text") or "") + (cuerpo.get("HTML") or ""))
    if hallado: enlace = hallado.group(0).replace("&amp;", "&"); break
if not cliente or not enlace:
    sys.exit("falta el correo a la clienta o el aviso con enlace firmado")
open(salida, "w").write(enlace)
total = api("/api/v1/messages?limit=1000")
fuera = [a for m in total["messages"] for k in ("To", "Cc", "Bcc") for a in (t["Address"] for t in (m.get(k) or [])) if not a.lower().endswith(".invalid")]
print(f"buzón: {total['total']} mensajes; destinatarios fuera de .invalid: {len(fuera)}")
sys.exit(1 if fuera else 0)
PY
codigo=$(curl -sS --max-time 30 "${RESOLVE[@]}" -D "$TMP/cabeceras" -o "$TMP/descarga" -w '%{http_code}' "$(cat "$TMP/enlace")")
cache=$(tr -d '\r' <"$TMP/cabeceras" | sed -n 's/^[Cc]ache-[Cc]ontrol: //p')
echo "descarga por HTTPS público: $codigo, $(stat -c %s "$TMP/descarga") bytes, Cache-Control: $cache"
[ "$codigo" = 200 ] && cmp -s "$IMAGEN" "$TMP/descarga" && [[ "$cache" == *no-store* ]] || { echo "La imagen descargada no coincide"; exit 1; }
echo "imagen: idéntica byte a byte (sha256 $(sha256sum "$IMAGEN" | cut -c1-16)…)"
echo "Imagen de 4.000.000 bytes desde Preview: OK"
