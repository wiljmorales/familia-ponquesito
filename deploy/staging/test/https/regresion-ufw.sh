#!/usr/bin/env bash
# Regresión del control «SSH permitido en UFW» de publicar-https.sh, sin VPS:
# extrae ssh_permitido_en del script y le pasa salidas de «ufw status verbose».
# Uso: deploy/staging/test/https/regresion-ufw.sh
# Origen: en el VPS la regla se creó con el perfil OpenSSH y UFW la muestra
# como «22/tcp (OpenSSH)»; el control anterior solo aceptaba «22/tcp» o
# «OpenSSH» seguidos de espacios y bloqueó --comprobar.
set -euo pipefail
SCRIPT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)/deploy/staging/publicar-https.sh
eval "$(sed -n '/^ssh_permitido_en() {$/,/^}$/p' "$SCRIPT")"
declare -F ssh_permitido_en >/dev/null || { echo "ssh_permitido_en no está en $SCRIPT"; exit 2; }
FALLOS=0

CABECERA='Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), deny (routed)
New profiles: skip

To                         Action      From
--                         ------      ----'
# caso <nombre> <acepta|rechaza> <reglas>
caso() {
  local r
  if printf '%s\n%s\n\n' "$CABECERA" "$3" | ssh_permitido_en; then r=acepta; else r=rechaza; fi
  if [ "$r" = "$2" ]; then echo "OK    $1 ($r)"; else FALLOS=$((FALLOS + 1)); echo "FALLO $1: $r, se esperaba $2"; fi
}

# Salida exacta del VPS (2026-10-18, sudo ufw status verbose).
caso "VPS: perfil OpenSSH, IPv4 e IPv6" acepta \
'22/tcp (OpenSSH)           ALLOW IN    Anywhere
22/tcp (OpenSSH (v6))      ALLOW IN    Anywhere (v6)'
caso "VPS tras --aplicar: más 80/443 con comentario" acepta \
'22/tcp (OpenSSH)           ALLOW IN    Anywhere
80/tcp                     ALLOW IN    Anywhere                   # fp-staging-https
443/tcp                    ALLOW IN    Anywhere                   # fp-staging-https
22/tcp (OpenSSH (v6))      ALLOW IN    Anywhere (v6)
80/tcp (v6)                ALLOW IN    Anywhere (v6)              # fp-staging-https
443/tcp (v6)               ALLOW IN    Anywhere (v6)              # fp-staging-https'
caso "regla por puerto 22/tcp (simulación)" acepta \
'22/tcp                     ALLOW IN    Anywhere
22/tcp (v6)                ALLOW IN    Anywhere (v6)'
caso "regla por puerto 22 (tcp y udp)" acepta '22                         ALLOW IN    Anywhere'
caso "regla con comentario" acepta '22/tcp                     ALLOW IN    Anywhere                   # ssh'
caso "DENY de un origen concreto antes del ALLOW general" acepta \
'22/tcp                     DENY IN     203.0.113.7
22/tcp (OpenSSH)           ALLOW IN    Anywhere'

caso "SSH denegado (perfil)" rechaza '22/tcp (OpenSSH)           DENY IN     Anywhere'
caso "SSH rechazado (REJECT)" rechaza '22/tcp                     REJECT IN   Anywhere'
caso "DENY general antes del ALLOW (gana el primero)" rechaza \
'22/tcp                     DENY IN     Anywhere
22/tcp (OpenSSH)           ALLOW IN    Anywhere'
caso "todo denegado antes del ALLOW" rechaza \
'Anywhere                   DENY IN     Anywhere
22/tcp (OpenSSH)           ALLOW IN    Anywhere'
caso "solo regla de salida" rechaza '22/tcp                     ALLOW OUT   Anywhere'
caso "salida y entrada limitada a un origen" rechaza \
'22/tcp                     ALLOW OUT   Anywhere
22/tcp                     ALLOW IN    203.0.113.0/24'
caso "permitido solo desde una IP" rechaza '22/tcp (OpenSSH)           ALLOW IN    203.0.113.7'
caso "permitido solo desde una red" rechaza 'OpenSSH                    ALLOW IN    10.0.0.0/8'
caso "solo IPv6" rechaza '22/tcp (OpenSSH (v6))      ALLOW IN    Anywhere (v6)'
caso "LIMIT (no es ALLOW IN)" rechaza '22/tcp (OpenSSH)           LIMIT IN    Anywhere'
caso "otro puerto (2222)" rechaza '2222/tcp                   ALLOW IN    Anywhere'
caso "puerto 220 no es 22" rechaza '220/tcp                    ALLOW IN    Anywhere'
caso "sin reglas" rechaza ''
caso "UFW inactivo" rechaza 'Status: inactive'

echo
[ "$FALLOS" = 0 ] && echo "Regresión UFW/SSH: todo OK" || { echo "Regresión UFW/SSH: $FALLOS fallos"; exit 1; }
