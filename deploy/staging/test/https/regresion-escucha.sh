#!/usr/bin/env bash
# Regresión de la comparación de listeners de publicar-https.sh (Mailpit y
# Caddy), sin VPS: extrae conjunto, escucha y escucha_de del script y les
# pasa salidas simuladas de ss, con el idioma C y con el del VPS.
# Uso: deploy/staging/test/https/regresion-escucha.sh
# Origen: --aplicar-correo falló en el VPS (LANG=en_US.UTF-8) con «obtenido
# tcp 127.0.0.1:8025 tcp *:465»: sort, según el idioma, ignora la puntuación.
set -euo pipefail
SCRIPT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)/deploy/staging/publicar-https.sh
eval "$(grep -E '^(escucha|conjunto|escucha_de)\(\) \{' "$SCRIPT")"
for f in escucha conjunto escucha_de; do declare -F "$f" >/dev/null || { echo "$f no está en $SCRIPT"; exit 2; }; done
FALLOS=0
SS=""
ss() { case "$1" in -Hltnu) awk '{print $1, $2, $3, $4, $5, $6}' <<<"$SS" ;; -Hltnup) printf '%s\n' "$SS" ;; esac; }
s() { printf '%s LISTEN 0 4096 %s %s users:(("%s",pid=%d,fd=3))\n' "$1" "$2" "${4:-*:*}" "$3" $((RANDOM + 1)); }
MP="tcp *:465"$'\n'"tcp 127.0.0.1:8025"
# veredicto: las dos comprobaciones de verificar_correo
veredicto() {
  local esperado; esperado=$(printf '%s\n' "$MP" | conjunto)
  [ "$(escucha_de mailpit | conjunto)" = "$esperado" ] && [ "$( (escucha 465; escucha 8025) | conjunto)" = "$esperado" ] && echo acepta || echo rechaza
}
caso() {  # caso <nombre> <acepta|rechaza> <ss>
  local r idioma
  for idioma in C en_US.UTF-8; do
    SS=$3; r=$(LC_ALL=$idioma veredicto)
    if [ "$r" = "$2" ]; then echo "OK    $1 [$idioma] ($r)"; else FALLOS=$((FALLOS + 1)); echo "FALLO $1 [$idioma]: $r, se esperaba $2"; fi
  done
}
SSH=$(s tcp 0.0.0.0:22 sshd; s tcp '[::]:22' sshd '[::]:*')
CADDY=$(s tcp '*:80' caddy; s tcp '*:443' caddy)

caso "orden del VPS: 8025 antes que 465" acepta "$SSH
$(s tcp 127.0.0.1:8025 mailpit)
$(s tcp '*:465' mailpit)
$CADDY"
caso "orden inverso: 465 antes que 8025" acepta "$(s tcp '*:465' mailpit)
$(s tcp 127.0.0.1:8025 mailpit)
$SSH"
caso "interfaz 8025 pública (*:8025)" rechaza "$(s tcp '*:465' mailpit)
$(s tcp '*:8025' mailpit)"
caso "interfaz 8025 en 0.0.0.0" rechaza "$(s tcp '*:465' mailpit)
$(s tcp 0.0.0.0:8025 mailpit)"
caso "interfaz 8025 en IPv6 [::]" rechaza "$(s tcp '*:465' mailpit)
$(s tcp '[::]:8025' mailpit '[::]:*')"
caso "interfaz 8025 en la IP pública" rechaza "$(s tcp '*:465' mailpit)
$(s tcp 37.27.149.66:8025 mailpit)"
caso "listener adicional de Mailpit (1025)" rechaza "$(s tcp '*:465' mailpit)
$(s tcp 127.0.0.1:8025 mailpit)
$(s tcp '*:1025' mailpit)"
caso "otro proceso además en 8025 (IPv6 local)" rechaza "$(s tcp '*:465' mailpit)
$(s tcp 127.0.0.1:8025 mailpit)
$(s tcp '[::1]:8025' python3 '[::]:*')"
caso "UDP 465 además" rechaza "$(s tcp '*:465' mailpit)
$(s tcp 127.0.0.1:8025 mailpit)
$(s udp '*:465' mailpit)"
caso "465 solo en IPv4 (0.0.0.0)" rechaza "$(s tcp 0.0.0.0:465 mailpit)
$(s tcp 127.0.0.1:8025 mailpit)"
caso "falta 465" rechaza "$(s tcp 127.0.0.1:8025 mailpit)"
caso "465 de otro proceso" rechaza "$(s tcp '*:465' otro)
$(s tcp 127.0.0.1:8025 mailpit)"

# Caddy: mismo criterio, ambos órdenes y un listener de más.
caddy() { local e; e=$(printf 'tcp *:443\ntcp *:80\n' | conjunto); [ "$(escucha_de caddy | conjunto)" = "$e" ] && echo acepta || echo rechaza; }
for idioma in C en_US.UTF-8; do
  for c in "acepta|$(s tcp '*:80' caddy)
$(s tcp '*:443' caddy)" "acepta|$(s tcp '*:443' caddy)
$(s tcp '*:80' caddy)" "rechaza|$(s tcp '*:80' caddy)
$(s tcp '*:443' caddy)
$(s tcp 127.0.0.1:2019 caddy)" "rechaza|$(s tcp '*:80' caddy)
$(s tcp '*:443' caddy)
$(s udp '*:443' caddy)"; do
    SS=${c#*|}; r=$(LC_ALL=$idioma caddy)
    if [ "$r" = "${c%%|*}" ]; then echo "OK    Caddy ($(wc -l <<<"$SS") listeners) [$idioma] ($r)"; else FALLOS=$((FALLOS + 1)); echo "FALLO Caddy [$idioma]: $r"; fi
  done
done

echo
[ "$FALLOS" = 0 ] && echo "Regresión de listeners: todo OK" || { echo "Regresión de listeners: $FALLOS fallos"; exit 1; }
