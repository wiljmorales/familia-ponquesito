#!/usr/bin/env bash
# Dentro de la simulación: deja PostgreSQL, /srv, servicios y permisos de
# los antecesores (/ y /home root 755, /home/wilfredo 750) como en el VPS.
set -euo pipefail
R=/home/wilfredo/fp-respaldos/ponquesito-20261018T133232Z
chown -R wilfredo:wilfredo /home/wilfredo/fp-respaldos; chmod 600 $R/*
chown root:root / /home; chmod 755 / /home; chown wilfredo:wilfredo /home/wilfredo; chmod 750 /home/wilfredo
P="runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1"
grep -v '^CREATE ROLE postgres;$' $R/roles.sql | $P -d postgres
$P -d postgres -c "ALTER ROLE ponquesito_app PASSWORD 'sim-prod-$(openssl rand -hex 8)'"
$P -d postgres -c "CREATE DATABASE ponquesito OWNER ponquesito_app TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8'"
$P -d postgres -c "REVOKE ALL ON DATABASE ponquesito FROM PUBLIC"
runuser -u postgres -- pg_restore -d ponquesito --exit-on-error --single-transaction < $R/ponquesito.dump
groupadd --system ponquesito; useradd --system -g ponquesito -d /nonexistent -s /usr/sbin/nologin ponquesito
install -d -m 2750 -o wilfredo -g ponquesito /srv/ponquesito /srv/ponquesito/backend
printf 'POSTGRES_DB=ponquesito\nPOSTGRES_USER=ponquesito_app\n' > /srv/ponquesito/backend.env; chown wilfredo:ponquesito /srv/ponquesito/backend.env; chmod 640 /srv/ponquesito/backend.env
for s in backend:8000 web:3000; do n=${s%:*}; p=${s#*:}
cat > /etc/systemd/system/ponquesito-$n.service <<U
[Unit]
Description=Simulación ponquesito-$n
[Service]
User=ponquesito
ExecStart=/usr/bin/python3 -m http.server -b 127.0.0.1 $p -d /nonexistent
[Install]
WantedBy=multi-user.target
U
done
systemctl daemon-reload; systemctl enable --now ponquesito-backend ponquesito-web
sleep 1; ss -Hltn | awk '{print $4}' | sort
runuser -u postgres -- psql -X -At -c "select datname, datacl from pg_database where datname='ponquesito'"
