# Simulación del VPS para probar deploy/staging (ver crear.sh): Ubuntu 26.04,
# systemd, PostgreSQL 18 y Python 3.14 del archivo de Ubuntu, sshd para el túnel.
FROM ubuntu:26.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends systemd systemd-sysv dbus sudo locales \
      postgresql-18 postgresql-common python3 python3-venv iproute2 curl ca-certificates openssh-server \
    && sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen en_US.UTF-8 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
RUN userdel -r ubuntu 2>/dev/null; useradd -m -u 1000 -G sudo -s /bin/bash wilfredo && echo 'wilfredo ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/w \
    && echo ubuntu-4gb-hel1-1 > /etc/hostname
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
