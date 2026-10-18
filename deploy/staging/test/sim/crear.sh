#!/usr/bin/env bash
# Crea (o recrea) la simulación del VPS con un respaldo y un paquete de staging.
# Uso: deploy/staging/test/sim/crear.sh <dir-respaldo-local> <dir-paquete>
# Contenedor privilegiado con systemd (fp-vps-sim), sin puertos publicados.
# El respaldo se copia a ~wilfredo/fp-respaldos/ y el paquete a ~wilfredo/fp-staging/
# con los permisos del VPS (700/600). Retirar con: docker rm -f fp-vps-sim
set -euo pipefail
RESPALDO=${1:?Uso: $0 <dir-respaldo-local> <dir-paquete>}
PAQUETE=${2:?Uso: $0 <dir-respaldo-local> <dir-paquete>}
SIM=$(cd "$(dirname "$0")" && pwd)
NOMBRE=$(basename "$RESPALDO")
docker build -q -t fp-vps-sim:26.04 "$SIM" >/dev/null
docker rm -f fp-vps-sim >/dev/null 2>&1 || true
docker run -d --name fp-vps-sim --hostname ubuntu-4gb-hel1-1 --privileged --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock fp-vps-sim:26.04 >/dev/null
for _ in $(seq 60); do docker exec fp-vps-sim pg_isready -q 2>/dev/null && break; sleep 1; done
docker exec fp-vps-sim install -d -m 700 -o wilfredo -g wilfredo /home/wilfredo/fp-respaldos "/home/wilfredo/fp-respaldos/$NOMBRE"
tar -C "$RESPALDO" -cf - . | docker exec -i fp-vps-sim tar -C "/home/wilfredo/fp-respaldos/$NOMBRE" -xf - --no-same-owner
docker cp "$SIM/sembrar.sh" fp-vps-sim:/root/sembrar.sh
docker exec fp-vps-sim bash /root/sembrar.sh >/dev/null
docker exec fp-vps-sim install -d -m 700 -o wilfredo -g wilfredo /home/wilfredo/fp-staging
tar -C "$PAQUETE" -cf - . | docker exec -i fp-vps-sim tar -C /home/wilfredo/fp-staging -xf - --no-same-owner
# Igual que rsync --chmod=D700,F600 hacia el VPS.
docker exec fp-vps-sim bash -c 'chown -R wilfredo:wilfredo /home/wilfredo/fp-staging
  find /home/wilfredo/fp-staging -type d -exec chmod 700 {} + ; find /home/wilfredo/fp-staging -type f -exec chmod 600 {} +'
echo "simulación lista: $(docker exec fp-vps-sim stat -c '%a %U:%G %n' / /home /home/wilfredo /home/wilfredo/fp-staging | tr '\n' ';')"
