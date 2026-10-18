#!/usr/bin/env bash
# Regresión de la ubicación del paquete y de los permisos de sus antecesores.
# Uso: deploy/staging/test/regresion-rutas.sh   (tras sim/crear.sh, staging sin aplicar)
#
# Origen: «cd ~/fp-staging && sudo bash ./preparar-staging.sh» bloqueaba con
# «/ debe ser de wilfredo»: $0 relativo se resolvía después de «cd /».
# Antecesores como en el VPS: / y /home root 755, /home/wilfredo 750,
# fp-staging 700. Cada caso comprueba el código de salida, el mensaje, si se
# escribió evidencia, que el script no cambió dueño ni modo de /, /home,
# /home/wilfredo ni fp-staging, y que tras restaurar / y /home siguen root 755.
# Al final, --aplicar con la invocación exacta y una segunda ejecución.
set -euo pipefail

C=fp-vps-sim
docker exec "$C" true 2>/dev/null || { echo "Falta la simulación (deploy/staging/test/sim/crear.sh)"; exit 2; }
FALLOS=0

sim() { docker exec -i "$C" bash -c "$1"; }
evidencias() { sim 'ls -d /home/wilfredo/fp-staging/evidencia-* 2>/dev/null | wc -l'; }

# caso <nombre> <código> <texto esperado> <evidencia: no|si> <preparar> <invocar como wilfredo> <restaurar>
caso() {
  local nombre=$1 codigo=$2 texto=$3 evid=$4 preparar=$5 invocar=$6 restaurar=$7 antes salida real despues
  local permisos='stat -c "%a %U:%G" / /home /home/wilfredo /home/wilfredo/fp-staging 2>/dev/null | tr "\n" " "' perm_antes perm_despues sistema
  sim "$preparar"
  antes=$(evidencias); perm_antes=$(sim "$permisos")
  salida=$(docker exec -u wilfredo "$C" bash -c "$invocar"' ; echo "<<$?>>"' 2>&1)
  real=$(sed -n 's/.*<<\([0-9]*\)>>.*/\1/p' <<<"$salida" | tail -1)
  despues=$(evidencias); perm_despues=$(sim "$permisos")
  sim "$restaurar"
  sistema=$(sim 'stat -c "%a %U:%G" / /home | tr "\n" " "')
  local ok=1
  [ "$real" = "$codigo" ] || ok=0
  grep -qF -- "$texto" <<<"$salida" || ok=0
  if [ "$evid" = no ]; then [ "$despues" = "$antes" ] || ok=0; else [ "$despues" -gt "$antes" ] || ok=0; fi
  [ "$perm_antes" = "$perm_despues" ] || ok=0
  [ "$sistema" = "755 root:root 755 root:root " ] || ok=0
  if [ "$ok" = 1 ]; then echo "OK    $nombre (código $real, evidencia: $evid)"
  else
    FALLOS=$((FALLOS + 1))
    echo "FALLO $nombre: código $real (esperado $codigo), evidencia $antes→$despues, permisos $perm_antes→$perm_despues, sistema: $sistema"
    grep -E '^!!|Nada|Comprobación completa' <<<"$salida" | sed 's/^/      /' || true
  fi
}

P='cd /home/wilfredo/fp-staging && '
NADA=':'

# Invocaciones válidas (solo lectura).
caso "invocación exacta del VPS (cd + ./)" 0 "Comprobación completa: sin bloqueos" si "$NADA" "${P}sudo bash ./preparar-staging.sh --comprobar" "$NADA"
caso "ruta absoluta" 0 "Comprobación completa: sin bloqueos" si "$NADA" "sudo bash /home/wilfredo/fp-staging/preparar-staging.sh --comprobar" "$NADA"
caso "relativa desde el home" 0 "Comprobación completa: sin bloqueos" si "$NADA" "cd /home/wilfredo && sudo bash fp-staging/preparar-staging.sh --comprobar" "$NADA"
caso "ruta con ./ y .. redundantes" 0 "Comprobación completa: sin bloqueos" si "$NADA" "cd /home/wilfredo/fp-staging/wheelhouse && sudo bash ../././preparar-staging.sh --comprobar" "$NADA"

# Llegar al directorio real por un enlace del llamador: sudo entrega el
# directorio físico ($PWD = /home/wilfredo/fp-staging) y se ejecuta el archivo
# real en su ubicación real, sin redirección. Se acepta.
caso "directorio de llamada por enlace al directorio real" 0 "Comprobación completa: sin bloqueos" si \
  "ln -s fp-staging /home/wilfredo/enlace" "cd /home/wilfredo/enlace && sudo bash ./preparar-staging.sh --comprobar" "rm /home/wilfredo/enlace"

# Ubicación inesperada o con enlaces: bloqueo antes de escribir nada.
caso "script como enlace" 2 "sin enlaces" no \
  "ln -s fp-staging/preparar-staging.sh /home/wilfredo/p.sh" "sudo bash /home/wilfredo/p.sh --comprobar" "rm /home/wilfredo/p.sh"
caso "fp-staging es un enlace a otro directorio" 2 "sin enlaces" no \
  "mv /home/wilfredo/fp-staging /home/wilfredo/fp-real && ln -s fp-real /home/wilfredo/fp-staging" "${P}sudo bash ./preparar-staging.sh --comprobar" \
  "rm /home/wilfredo/fp-staging && mv /home/wilfredo/fp-real /home/wilfredo/fp-staging"
caso "copia del paquete en otra ruta" 2 "debe ejecutarse como /home/wilfredo/fp-staging/preparar-staging.sh" no \
  "cp -a /home/wilfredo/fp-staging /home/wilfredo/copia" "cd /home/wilfredo/copia && sudo bash ./preparar-staging.sh --comprobar" "rm -r /home/wilfredo/copia"
caso "script por stdin" 2 "debe ejecutarse como" no "$NADA" "${P}sudo bash -s -- --comprobar < ./preparar-staging.sh" "$NADA"
caso "sin sudo desde wilfredo (root directo)" 2 "ejecutar como wilfredo mediante sudo" no "$NADA" "${P}sudo -i bash -c 'cd /home/wilfredo/fp-staging && SUDO_USER= bash ./preparar-staging.sh --comprobar'" "$NADA"

# Escritura de terceros o permisos no privados en los antecesores.
caso "fp-staging 750" 2 "debe ser privado" no "chmod 750 /home/wilfredo/fp-staging" "${P}sudo bash ./preparar-staging.sh --comprobar" "chmod 700 /home/wilfredo/fp-staging"
caso "/home/wilfredo escribible por el grupo" 2 "/home/wilfredo (770) admite escritura" no "chmod 770 /home/wilfredo" "${P}sudo bash ./preparar-staging.sh --comprobar" "chmod 750 /home/wilfredo"
caso "/home escribible por el grupo" 2 "/home (775) admite escritura" no "chmod 775 /home" "${P}sudo bash ./preparar-staging.sh --comprobar" "chmod 755 /home"
caso "/home de otro dueño" 2 "/home es de wilfredo; se esperaba root" no "chown wilfredo /home" "${P}sudo bash ./preparar-staging.sh --comprobar" "chown root /home"
# Con fp-staging de root y 700, wilfredo no puede entrar: se invoca por ruta absoluta.
caso "fp-staging de otro dueño" 2 "/home/wilfredo/fp-staging es de root; se esperaba wilfredo" no "chown root /home/wilfredo/fp-staging" "sudo bash /home/wilfredo/fp-staging/preparar-staging.sh --comprobar" "chown wilfredo /home/wilfredo/fp-staging"

# Archivos del paquete y del respaldo (tras validar la ubicación: ya hay evidencia).
caso "archivo del paquete como enlace (mismo contenido)" 2 "no es un archivo regular" si \
  "cd /home/wilfredo/fp-staging && mv requirements-staging.txt /home/wilfredo/req && ln -s /home/wilfredo/req requirements-staging.txt" \
  "${P}sudo bash ./preparar-staging.sh --comprobar" "cd /home/wilfredo/fp-staging && rm requirements-staging.txt && mv /home/wilfredo/req requirements-staging.txt"
caso "wheel escribible por otros" 2 "sin escritura de grupo u otros" si \
  "chmod 666 /home/wilfredo/fp-staging/wheelhouse/sqlparse-*.whl" "${P}sudo bash ./preparar-staging.sh --comprobar" "chmod 600 /home/wilfredo/fp-staging/wheelhouse/sqlparse-*.whl"
caso "wheelhouse no privado" 2 "wheelhouse (755) debe ser privado" si \
  "chmod 755 /home/wilfredo/fp-staging/wheelhouse" "${P}sudo bash ./preparar-staging.sh --comprobar" "chmod 700 /home/wilfredo/fp-staging/wheelhouse"
caso "respaldo no privado" 2 "debe ser privado" si \
  "chmod 755 /home/wilfredo/fp-respaldos/ponquesito-20261018T133232Z" "${P}sudo bash ./preparar-staging.sh --comprobar" "chmod 700 /home/wilfredo/fp-respaldos/ponquesito-20261018T133232Z"
caso "paquete manipulado" 2 "SHA256SUMS del paquete no verifica" si \
  "cp -a /home/wilfredo/fp-staging/backend-*.tar /root/tar.bak && printf X | dd of=\$(ls /home/wilfredo/fp-staging/backend-*.tar) bs=1 seek=20000 conv=notrunc status=none" \
  "${P}sudo bash ./preparar-staging.sh --comprobar" "cp -a /root/tar.bak \$(ls /home/wilfredo/fp-staging/backend-*.tar)"

# Ningún bloqueo dejó cambios en el sistema.
r=$(sim 'getent passwd ponquesito-staging; runuser -u postgres -- psql -X -At -c "SELECT count(*) FROM pg_roles WHERE rolname = '\''ponquesito_staging'\''"; ls -d /opt/ponquesito-staging /etc/ponquesito-staging 2>/dev/null; true' | tr '\n' ' ')
if [ "$r" = "0 " ]; then echo "OK    sin usuario, rol ni directorios de staging tras los bloqueos"
else FALLOS=$((FALLOS + 1)); echo "FALLO quedaron recursos de staging: $r"; fi

# Ejecución real con la invocación exacta, y repetición.
caso "--aplicar con la invocación exacta" 0 "Staging listo en 127.0.0.1:8001" si "$NADA" "${P}sudo bash ./preparar-staging.sh --aplicar" "$NADA"
caso "--aplicar repetido" 0 "nada que migrar" si "$NADA" "${P}sudo bash ./preparar-staging.sh --aplicar" "$NADA"

echo
[ "$FALLOS" = 0 ] && echo "Regresión de rutas: todo OK" || { echo "Regresión de rutas: $FALLOS fallos"; exit 1; }
