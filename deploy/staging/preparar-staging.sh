#!/usr/bin/env bash
# Staging privado de Familia Ponquesito en el VPS (solo 127.0.0.1:8001).
#
# Uso, en la consola del VPS como wilfredo, con el paquete en ~/fp-staging/:
#   sudo bash ~/fp-staging/preparar-staging.sh --comprobar   # solo lectura
#   sudo bash ~/fp-staging/preparar-staging.sh --aplicar
#
# Crea, sin tocar la base ponquesito, su rol, el backend actual ni los respaldos:
#   rol y base ponquesito_staging (restaurada del respaldo con --no-owner
#   --no-acl --role), usuario de sistema ponquesito-staging, código fijado
#   por SHA en /opt/ponquesito-staging, venv sin red (wheels con hash),
#   secretos nuevos en /etc/ponquesito-staging/backend.env, imágenes en
#   /var/lib/ponquesito-staging/images y ponquesito-staging-backend.service.
# Migra SOLO ponquesito_staging y solo si el plan es exactamente el previsto.
# No cambia DNS, Caddy, UFW, pg_hba ni Vercel. No muestra secretos.
#
# Recursos existentes con estos nombres: se reutilizan solo si llevan la
# marca de este script y coinciden con lo esperado; si no, bloqueo. Nunca
# se borra nada. Ver deploy/staging/README.md (incluye la retirada manual).
#
# Código de salida: 0 completo y verificado; 1 fallo después de empezar a
# cambiar (se listan los cambios hechos, no se revierte nada); 2 bloqueo
# previo (nada cambiado; con --comprobar, 0 si no hay bloqueos).

set -Eeuo pipefail
umask 077
# Ruta del script tal como se invocó, tomada ANTES de cambiar de directorio:
# con «bash ./preparar-staging.sh», $0 es relativo al directorio de llamada.
case "$0" in /*) SCRIPT_INVOCADO=$0 ;; *) SCRIPT_INVOCADO=$PWD/$0 ;; esac
cd /

MODO=${1:-}
case "$MODO" in --comprobar|--aplicar) ;; *) echo "Uso: sudo bash $0 --comprobar|--aplicar"; exit 2 ;; esac

# --- Valores fijados ----------------------------------------------------------
HOST_ESPERADO=ubuntu-4gb-hel1-1
ADMIN=wilfredo
DEPLOY_SHA=35cfebb785e3e92dce665177e424ace08074ed33
RESPALDO=/home/wilfredo/fp-respaldos/ponquesito-20261018T133232Z
DUMP_SHA256=f9f49943f6155264ae268346559241c3100b45d3545c1ca45ef532564baf8eb2
# Huella del catálogo de ponquesito_staging tras restaurar y fijar permisos,
# = catálogo del respaldo con ponquesito_app → ponquesito_staging y su ACL de base
# (comprobado en la simulación del VPS: Ubuntu 26.04, PostgreSQL 18.6).
CATALOGO_STAGING_ESPERADO=8a2f0f7dc9bbb2dcd43f2d2b150b8d0c
PLAN_ESPERADO="commerce.0001_initial
commerce.0002_recoverythrottle_cakereservation_recovery_count_and_more
commerce.0003_cakereservation_reservation_code_present_and_more
commerce.0004_cakereservation_reservation_token_sha256_and_more"
PAQUETES_ESPERADOS="asgiref==3.12.1
django==5.2.18
gunicorn==26.2.0
psycopg-binary==3.3.6
psycopg==3.3.6
sqlparse==0.6.0"

PUERTO_PG=5432
BASE_PROD=ponquesito
ROL_PROD=ponquesito_app
BD=ponquesito_staging
ROL=ponquesito_staging
USUARIO=ponquesito-staging
PUERTO=8001
OPT=/opt/ponquesito-staging
RELEASE=$OPT/releases/$DEPLOY_SHA
VENV=$OPT/venv
ETC=/etc/ponquesito-staging
ENVF=$ETC/backend.env
VAR=/var/lib/ponquesito-staging
IMAGENES=$VAR/images
UNIDAD=ponquesito-staging-backend.service
UNIDAD_RUTA=/etc/systemd/system/$UNIDAD
MARCA="fp-staging: creado por preparar-staging.sh"
MARCA_RESTAURADA="fp-staging: restaurada de ponquesito-20261018T133232Z"
CLAVES_ENV="DJANGO_SECRET_KEY DJANGO_DEBUG DJANGO_ALLOWED_HOSTS DJANGO_BEHIND_HTTPS_PROXY POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD POSTGRES_HOST POSTGRES_PORT PONQUESITO_INTERNAL_API_KEY PONQUESITO_PRIVATE_IMAGE_ROOT PONQUESITO_API_PUBLIC_URL"

# Ubicación fija del paquete; comprobar_ubicacion exige que el script se
# ejecute exactamente desde aquí, sin enlaces.
PAQ=/home/$ADMIN/fp-staging
ARCHIVOS_PAQUETE="preparar-staging.sh ponquesito-staging-backend.service backend-$DEPLOY_SHA.tar requirements-staging.txt"
SELLO=$(date -u +%Y%m%dT%H%M%SZ)
EVID=/home/$ADMIN/fp-staging/evidencia-$SELLO${MODO/--/-}
AJUSTES=/home/$ADMIN/fp-respaldos/ponquesito-20261018T133232Z-ajustes

OPC_RO="-c default_transaction_read_only=on -c statement_timeout=120s -c lock_timeout=5s -c idle_in_transaction_session_timeout=60s -c TimeZone=UTC -c DateStyle=ISO,MDY -c IntervalStyle=postgres -c extra_float_digits=1 -c bytea_output=hex"
OPC_RW="-c statement_timeout=300s -c lock_timeout=5s -c idle_in_transaction_session_timeout=60s"

CAMBIOS=()
BLOQUEOS=()

# --- Utilidades ---------------------------------------------------------------
cambio() { CAMBIOS+=("$1"); echo "   + $1"; }
lista_cambios() {  # lista_cambios [título]
  if [ "${#CAMBIOS[@]}" -eq 0 ]; then echo "Cambios hechos: ninguno."; return; fi
  echo "${1:-Cambios hechos hasta aquí (no se revierten automáticamente):}"
  printf '  - %s\n' "${CAMBIOS[@]}"
}
fallo() {
  trap - ERR
  echo "!! FALLO: $1"
  lista_cambios
  exit 1
}
bloqueo() {
  [ "${#CAMBIOS[@]}" -eq 0 ] || fallo "$1"
  trap - ERR
  echo "!! BLOQUEO: $1"
  if [ -d "$EVID" ]; then echo "Nada se ha cambiado en el sistema; solo se escribió la evidencia en $EVID."
  else echo "Nada se ha cambiado."; fi
  exit 2
}
trap 'fallo "orden inesperada falló en la línea $LINENO"' ERR
REGISTRO_PID=
# Al salir, por cualquier camino: se cierra el registro (se devuelve la salida
# a la terminal y se espera a que tee termine) y solo entonces se sella la
# evidencia, para que ningún archivo cambie después de SHA256SUMS.
al_salir() {
  if [ -n "$REGISTRO_PID" ]; then
    exec 1>&3 2>&4 3>&- 4>&-
    wait "$REGISTRO_PID" 2>/dev/null || true
  fi
  if [ -d "$EVID" ]; then
    (cd "$EVID" && rm -f SHA256SUMS && sha256sum -- * >SHA256SUMS) && echo "Evidencia sellada: $EVID/SHA256SUMS"
    chown -R "$ADMIN:$ADMIN" "$EVID" 2>/dev/null || true
  fi
  [ -d "$AJUSTES" ] && chown -R "$ADMIN:$ADMIN" "$AJUSTES" 2>/dev/null
  true
}
trap al_salir EXIT

sql_ro() {  # sql_ro <base> [args psql]: sesión de solo lectura como postgres
  local base=$1; shift
  runuser -u postgres -- env PGOPTIONS="$OPC_RO" PGAPPNAME=fp-staging PGCONNECT_TIMEOUT=5 \
    timeout 300 psql -X -q -v ON_ERROR_STOP=1 -At -F '|' -p "$PUERTO_PG" -d "$base" "$@"
}
sql_rw() {  # sql_rw <base>: SQL por stdin, como postgres
  local base=$1; shift
  runuser -u postgres -- env PGOPTIONS="$OPC_RW" PGAPPNAME=fp-staging PGCONNECT_TIMEOUT=5 \
    timeout 600 psql -X -q -v ON_ERROR_STOP=1 -At -p "$PUERTO_PG" -d "$base" "$@"
}
valor_env() {  # valor_env <clave>: lee una clave del env de staging sin mostrarla
  python3 -I - "$ENVF" "$1" <<'PY'
import sys
k = sys.argv[2]
for linea in open(sys.argv[1], encoding="utf-8"):
    if linea.startswith(k + "="):
        print(linea.rstrip("\n").split("=", 1)[1]); break
else:
    sys.exit(1)
PY
}
como_servicio() {  # como_servicio <args de manage.py>: Django de staging como su usuario
  runuser -u "$USUARIO" -- env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 HOME=/nonexistent \
    bash -c 'set -a; . "$1"; set +a; cd "$2/backend"; shift 2; exec "'"$VENV"'/bin/python" manage.py "$@"' _ "$ENVF" "$OPT/current" "$@"
}
destino_django() {  # Conexión real que usaría Django de staging
  runuser -u "$USUARIO" -- env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 HOME=/nonexistent \
    bash -c 'set -a; . "$1"; set +a; cd "$2/backend"; exec "'"$VENV"'/bin/python" -c "
import os, django
os.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"config.settings\")
django.setup()
from django.db import connection
c = connection.cursor()
c.execute(\"SELECT current_database(), current_user, inet_server_port()\")
print(*c.fetchone())"' _ "$ENVF" "$OPT/current"
}
huellas() {  # huellas <base> <archivo>: catálogo + recuento y md5 por tabla (sin filas)
  sql_ro "$1" -F ' ' -f - >"$2" <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'catalogo', count(*), md5(string_agg(linea, E'\n' ORDER BY linea COLLATE "C"))
FROM (
  SELECT format('col %s.%s.%s %s %s %s', table_schema, table_name, column_name, data_type, is_nullable, coalesce(column_default, '')) AS linea
  FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  UNION ALL
  SELECT format('con %s.%s %s', n.nspname, c.conname, pg_get_constraintdef(c.oid))
  FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL
  SELECT format('idx %s.%s %s', schemaname, indexname, indexdef)
  FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  UNION ALL
  SELECT format('obj %s.%s %s %s %s', n.nspname, c.relname, c.relkind, pg_get_userbyid(c.relowner), coalesce(c.relacl::text, ''))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'i')
  UNION ALL
  SELECT format('nsp %s %s %s', nspname, pg_get_userbyid(nspowner), coalesce(nspacl::text, ''))
  FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
  UNION ALL
  SELECT format('ext %s %s', extname, extversion) FROM pg_extension
  UNION ALL
  SELECT format('seq %s.%s %s', schemaname, sequencename, coalesce(last_value::text, 'null'))
  FROM pg_sequences WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  UNION ALL
  SELECT format('db %s %s %s', pg_get_userbyid(datdba), pg_encoding_to_char(encoding), coalesce(datacl::text, ''))
  FROM pg_database WHERE datname = current_database()
) AS catalogo;
SELECT format(
  'SELECT %L, count(*), md5(coalesce(string_agg(t::text, E''\n'' ORDER BY t::text COLLATE "C"), '''')) FROM %I.%I AS t',
  n.nspname || '.' || c.relname, n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
ORDER BY 1
\gexec
COMMIT;
SQL
}
existe_bd() { [ "$(sql_ro postgres -c "SELECT count(*) FROM pg_database WHERE datname = '$1'")" = 1 ]; }
existe_rol() { [ "$(sql_ro postgres -c "SELECT count(*) FROM pg_roles WHERE rolname = '$1'")" = 1 ]; }
atributos_rol() {
  sql_ro postgres -c "SELECT rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = '$1'"
}
ATRIBUTOS_STAGING="f|t|f|f|t|f|f"

# Antes de cada operación sobre la base: clúster correcto y destino = staging.
destino_cluster() {
  local online
  online=$(pg_lsclusters -h | awk '$4 ~ /^online/ {print $1"/"$2"/"$3}')
  [ "$online" = "18/main/$PUERTO_PG" ] || fallo "el clúster online no es 18/main/$PUERTO_PG (es: ${online:-ninguno})."
}
destino_bd() {
  destino_cluster
  [ "$BD" != "$BASE_PROD" ] && [ "$ROL" != "$ROL_PROD" ] || fallo "el destino coincide con producción."
  local fila
  fila=$(sql_ro postgres -c "SELECT pg_get_userbyid(datdba), coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = '$BD'")
  case "$fila" in
    "$ROL|$MARCA"|"$ROL|$MARCA_RESTAURADA") echo "   destino: base $BD, propietario $ROL, marca de staging presente" ;;
    *) fallo "la base $BD no tiene el propietario o la marca esperados." ;;
  esac
}

# --- Comprobaciones previas (solo lectura) ------------------------------------
# ruta_segura <directorio> <privado|compartido>: cada componente desde / es un
# directorio real (no un enlace) en el que nadie más puede escribir. Los del
# sistema (/, /home) deben ser de root; desde /home/$ADMIN, de $ADMIN. Si es
# privado, el último además no da ningún permiso a grupo ni a otros.
ruta_segura() {
  local destino=$1 tipo=$2 d dueno modo esperado
  local -a cadena=()
  [ "$(realpath -m -s -- "$destino")" = "$destino" ] || bloqueo "ruta no normalizada: $destino."
  d=$destino
  while :; do cadena=("$d" "${cadena[@]}"); [ "$d" = / ] && break; d=$(dirname -- "$d"); done
  for d in "${cadena[@]}"; do
    [ -d "$d" ] && [ ! -L "$d" ] || bloqueo "$d no es un directorio real (¿enlace?)."
    read -r dueno modo < <(stat -c '%U %a' -- "$d")
    case "$d/" in "/home/$ADMIN/"*) esperado=$ADMIN ;; *) esperado=root ;; esac
    [ "$dueno" = "$esperado" ] || bloqueo "$d es de $dueno; se esperaba $esperado."
    [ $((8#$modo & 8#022)) = 0 ] || bloqueo "$d ($modo) admite escritura de grupo u otros."
  done
  [ "$tipo" != privado ] || [ $((8#$modo & 8#077)) = 0 ] || bloqueo "$destino ($modo) debe ser privado: sin permisos de grupo ni otros."
}
archivo_seguro() {  # archivo_seguro <archivo>: regular, no enlace, de $ADMIN, sin escritura de terceros
  local dueno modo
  [ -f "$1" ] && [ ! -L "$1" ] || bloqueo "$1 no es un archivo regular (¿enlace?)."
  read -r dueno modo < <(stat -c '%U %a' -- "$1")
  [ "$dueno" = "$ADMIN" ] && [ $((8#$modo & 8#022)) = 0 ] || bloqueo "$1 ($dueno, $modo) debe ser de $ADMIN y sin escritura de grupo u otros."
}
# Antes de escribir nada: sudo desde $ADMIN y script en $PAQ por una ruta sin enlaces.
comprobar_ubicacion() {
  local logica fisica
  [ "$(id -u)" = 0 ] || bloqueo "ejecutar con sudo."
  [ "${SUDO_USER:-}" = "$ADMIN" ] || bloqueo "ejecutar como $ADMIN mediante sudo."
  logica=$(realpath -m -s -- "$SCRIPT_INVOCADO")
  fisica=$(realpath -e -- "$SCRIPT_INVOCADO" 2>/dev/null || true)
  [ "$logica" = "$PAQ/preparar-staging.sh" ] && [ "$fisica" = "$logica" ] \
    || bloqueo "el script debe ejecutarse como $PAQ/preparar-staging.sh, sin enlaces (invocado: $SCRIPT_INVOCADO)."
  ruta_segura "$PAQ" privado
}
comprobar_host() {
  [ "$(hostname)" = "$HOST_ESPERADO" ] || bloqueo "host $(hostname); se esperaba $HOST_ESPERADO."
  . /etc/os-release
  [ "${VERSION_ID:-}" = "26.04" ] || bloqueo "Ubuntu ${VERSION_ID:-?}; se esperaba 26.04."
  local online n
  n=$(pg_lsclusters -h | awk '$4 ~ /^online/' | wc -l)
  online=$(pg_lsclusters -h | awk '$4 ~ /^online/ {print $1"/"$2"/"$3}')
  [ "$n" = 1 ] && [ "$online" = "18/main/$PUERTO_PG" ] || bloqueo "se esperaba un único clúster online 18/main/$PUERTO_PG (hay: ${online:-ninguno})."
  for o in python3 runuser pg_restore systemctl ss sha256sum; do command -v "$o" >/dev/null || bloqueo "falta $o."; done
  python3 -c 'import venv, ensurepip' 2>/dev/null || bloqueo "python3-venv no está instalado."
  echo "   host $HOST_ESPERADO, Ubuntu 26.04, clúster 18/main/$PUERTO_PG online, $(python3 --version)"
}
comprobar_paquete() {
  local f
  for f in $ARCHIVOS_PAQUETE SHA256SUMS; do [ -e "$PAQ/$f" ] || bloqueo "falta $PAQ/$f."; archivo_seguro "$PAQ/$f"; done
  [ -e "$PAQ/wheelhouse" ] || bloqueo "falta $PAQ/wheelhouse."
  ruta_segura "$PAQ/wheelhouse" privado
  for f in "$PAQ"/wheelhouse/*; do archivo_seguro "$f"; done
  (cd "$PAQ" && sha256sum --quiet --strict -c SHA256SUMS) || bloqueo "SHA256SUMS del paquete no verifica."
  for f in $ARCHIVOS_PAQUETE; do grep -q "  $f\$" "$PAQ/SHA256SUMS" || bloqueo "$f no está en SHA256SUMS."; done
  [ "$(grep -c '  wheelhouse/' "$PAQ/SHA256SUMS")" = "$(find "$PAQ/wheelhouse" -type f | wc -l)" ] \
    || bloqueo "wheelhouse contiene archivos fuera de SHA256SUMS."
  python3 -I - "$PAQ/backend-$DEPLOY_SHA.tar" "$DEPLOY_SHA" <<'PY' || bloqueo "el tar del backend no corresponde al commit fijado o tiene rutas inseguras."
import sys, tarfile
t = tarfile.open(sys.argv[1])
assert t.pax_headers.get("comment") == sys.argv[2], "commit"
for m in t.getmembers():
    assert m.name == "backend" or m.name.startswith("backend/"), m.name
    assert ".." not in m.name.split("/") and not m.name.startswith("/"), m.name
    assert m.isfile() or m.isdir(), m.name
PY
  echo "   paquete verificado; código del commit $DEPLOY_SHA"
}
comprobar_respaldo() {
  [ -f "$RESPALDO/SHA256SUMS" ] && [ ! -e "$RESPALDO/INCOMPLETO" ] || bloqueo "respaldo ausente o INCOMPLETO."
  ruta_segura "$RESPALDO" privado
  local f; for f in "$RESPALDO"/*; do archivo_seguro "$f"; done
  (cd "$RESPALDO" && sha256sum --quiet --strict -c SHA256SUMS) || bloqueo "SHA256SUMS del respaldo no verifica."
  [ "$(sha256sum "$RESPALDO/ponquesito.dump" | cut -d' ' -f1)" = "$DUMP_SHA256" ] || bloqueo "el volcado no tiene el SHA-256 fijado."
  echo "   respaldo verificado; volcado $DUMP_SHA256"
}

# Ajustes por base/rol (ALTER DATABASE/ROLE … SET): no los recoge pg_dump sin
# --create. Solo nombres y un prefijo de sha256 del valor; nunca el valor.
registrar_ajustes() {
  mkdir -p -m 700 "$AJUSTES"
  local f="$AJUSTES/ajustes-$SELLO.txt"
  {
    echo "# Ajustes específicos de base/rol y metadatos asociados — $SELLO"
    echo "# Valores omitidos: solo nombre del parámetro y sha256(valor)[:12]."
    echo "## pg_db_role_setting (base | rol | parámetro | sha256-12)"
    sql_ro postgres -c "SELECT coalesce(d.datname, '(todas)'), coalesce(r.rolname, '(todos)'), split_part(cfg, '=', 1),
        left(encode(sha256(convert_to(substr(cfg, strpos(cfg, '=') + 1), 'UTF8')), 'hex'), 12)
      FROM pg_db_role_setting s LEFT JOIN pg_database d ON d.oid = s.setdatabase
      LEFT JOIN pg_roles r ON r.oid = s.setrole, unnest(s.setconfig) AS cfg ORDER BY 1, 2, 3"
    echo "## total de entradas"
    sql_ro postgres -c "SELECT count(*) FROM pg_db_role_setting s, unnest(s.setconfig)"
    echo "## bases (nombre | propietario | codificación | collate | ctype | proveedor | conexiones | límite | plantilla | acl)"
    sql_ro postgres -c "SELECT datname, pg_get_userbyid(datdba), pg_encoding_to_char(encoding), datcollate, datctype, datlocprovider, datallowconn, datconnlimit, datistemplate, coalesce(datacl::text, '') FROM pg_database ORDER BY 1"
    echo "## roles (nombre | super | hereda | crea_roles | crea_bd | login | replicación | bypassrls | límite | caduca | con_contraseña)"
    sql_ro postgres -c "SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls, rolconnlimit, coalesce(rolvaliduntil::text, ''), rolpassword IS NOT NULL FROM pg_authid WHERE rolname !~ '^pg_' ORDER BY 1"
    echo "## pertenencias (rol | miembro)"
    sql_ro postgres -c "SELECT r.rolname, m.rolname FROM pg_auth_members a JOIN pg_roles r ON r.oid = a.roleid JOIN pg_roles m ON m.oid = a.member WHERE m.rolname !~ '^pg_' ORDER BY 1, 2"
    echo "## pg_hba vigente (línea | tipo | bases | usuarios | dirección | método)"
    sql_ro postgres -c "SELECT line_number, type, database, user_name, coalesce(address, ''), auth_method FROM pg_hba_file_rules ORDER BY 1"
  } >"$f"
  (cd "$AJUSTES" && sha256sum "$(basename "$f")" >"$(basename "$f").sha256")
  chmod 600 "$AJUSTES"/*
  local prod
  prod=$(sql_ro postgres -c "SELECT count(*) FROM pg_db_role_setting s LEFT JOIN pg_database d ON d.oid = s.setdatabase LEFT JOIN pg_roles r ON r.oid = s.setrole
    WHERE d.datname IN ('$BASE_PROD', '$BD') OR r.rolname IN ('$ROL_PROD', '$ROL')")
  echo "   ajustes registrados en $f; entradas que afectan a $BASE_PROD/$ROL_PROD/staging: $prod"
  AJUSTES_PROD=$prod
}

# Producción: foto para comprobar al final que no cambió.
foto_produccion() {  # foto_produccion <archivo>
  local f=$1
  {
    echo "servicios: $(systemctl is-active ponquesito-backend.service ponquesito-web.service postgresql@18-main.service | tr '\n' ' ')"
    echo "escucha: $(ss -Hltn | awk '{print $4}' | grep -E ':(3000|5432|8000)$' | sort | tr '\n' ' ')"
    echo "backend.env: $(sha256sum /srv/ponquesito/backend.env | cut -d' ' -f1)"
    echo "unidad: $(sha256sum /etc/systemd/system/ponquesito-backend.service | cut -d' ' -f1)"
    echo "arbol_srv: $(find /srv/ponquesito -printf '%P %s %T@ %m %u %g\n' | sort | sha256sum | cut -d' ' -f1)"
    echo "rol_app: $(atributos_rol "$ROL_PROD")"
    echo "respaldo: $(cd "$RESPALDO" && sha256sum SHA256SUMS | cut -d' ' -f1) $(cd "$RESPALDO" && sha256sum --quiet --strict -c SHA256SUMS && echo ok)"
  } >"$f"
  huellas "$BASE_PROD" "$f.huellas"
  # La credencial del rol de producción se compara en memoria; no se escribe.
  sql_ro postgres -c "SELECT sha256(convert_to(coalesce(rolpassword, ''), 'UTF8')) FROM pg_authid WHERE rolname = '$ROL_PROD'"
}

# Recursos de staging ya existentes: reutilizar solo si son nuestros.
inspeccionar_existentes() {
  local fila
  if existe_rol "$ROL"; then
    fila="$(atributos_rol "$ROL")|$(sql_ro postgres -c "SELECT coalesce(shobj_description(oid, 'pg_authid'), '') FROM pg_roles WHERE rolname = '$ROL'")"
    if [ "$fila" = "$ATRIBUTOS_STAGING|$MARCA" ] && [ "$(sql_ro postgres -c "SELECT count(*) FROM pg_auth_members a JOIN pg_roles r ON r.oid IN (a.roleid, a.member) WHERE r.rolname = '$ROL'")" = 0 ]; then
      echo "   rol $ROL existe con la marca y atributos esperados: se reutiliza"
    else
      BLOQUEOS+=("el rol $ROL ya existe y no coincide con lo esperado (atributos|comentario: $fila).")
    fi
  else echo "   rol $ROL: no existe"; fi
  if existe_bd "$BD"; then
    fila=$(sql_ro postgres -c "SELECT pg_get_userbyid(datdba), pg_encoding_to_char(encoding), datcollate, datctype, datlocprovider, coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = '$BD'")
    case "$fila" in
      "$ROL|UTF8|en_US.UTF-8|en_US.UTF-8|c|$MARCA") echo "   base $BD existe, creada por este script y aún sin restaurar: se reutiliza" ;;
      "$ROL|UTF8|en_US.UTF-8|en_US.UTF-8|c|$MARCA_RESTAURADA") echo "   base $BD existe y ya fue restaurada por este script: no se vuelve a restaurar" ;;
      *) BLOQUEOS+=("la base $BD ya existe y no coincide con lo esperado ($fila).") ;;
    esac
  else echo "   base $BD: no existe"; fi
  if getent passwd "$USUARIO" >/dev/null; then
    fila=$(getent passwd "$USUARIO" | awk -F: '{print ($3 < 1000 ? "sistema" : "normal") ":" $6 ":" $7}'):$(id -gn "$USUARIO"):$(id -Gn "$USUARIO")
    if [ "$fila" = "sistema:/nonexistent:/usr/sbin/nologin:$USUARIO:$USUARIO" ]; then
      echo "   usuario $USUARIO existe como usuario de sistema esperado: se reutiliza"
    else BLOQUEOS+=("el usuario $USUARIO ya existe y no coincide ($fila)."); fi
  elif getent group "$USUARIO" >/dev/null; then BLOQUEOS+=("existe el grupo $USUARIO sin el usuario.")
  else echo "   usuario $USUARIO: no existe"; fi
  for d in "$OPT" "$ETC" "$VAR"; do
    if [ -e "$d" ]; then
      if [ -f "$d/.fp-staging" ] && [ "$(cat "$d/.fp-staging")" = "$MARCA" ]; then echo "   $d existe con la marca: se reutiliza"
      else BLOQUEOS+=("$d ya existe sin la marca de este script."); fi
    else echo "   $d: no existe"; fi
  done
  if [ -e "$UNIDAD_RUTA" ]; then
    if cmp -s "$UNIDAD_RUTA" "$PAQ/$UNIDAD"; then echo "   $UNIDAD existe y es idéntica: se reutiliza"
    else BLOQUEOS+=("$UNIDAD_RUTA ya existe con otro contenido."); fi
  else echo "   $UNIDAD: no existe"; fi
  if ss -Hltn | awk '{print $4}' | grep -qE ":$PUERTO\$"; then
    if [ "$(systemctl is-active "$UNIDAD" 2>/dev/null)" = active ]; then echo "   puerto $PUERTO: lo usa $UNIDAD"
    else BLOQUEOS+=("el puerto $PUERTO ya está en uso por otro proceso."); fi
  else echo "   puerto $PUERTO: libre"; fi
}

# --- Pasos que cambian el sistema ---------------------------------------------
paso_usuario() {
  echo "1/10 Usuario de sistema"
  if ! getent passwd "$USUARIO" >/dev/null; then
    useradd --system --user-group --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin "$USUARIO"
    cambio "usuario de sistema $USUARIO (uid $(id -u "$USUARIO"))"
  fi
  for d in "$OPT" "$ETC" "$VAR"; do
    if [ ! -e "$d" ]; then
      mkdir -m 750 "$d"; printf '%s' "$MARCA" >"$d/.fp-staging"; chmod 640 "$d/.fp-staging"; cambio "directorio $d"
    fi
  done
  chown root:"$USUARIO" "$OPT" "$ETC"; chmod 750 "$OPT" "$ETC"
  chown "$USUARIO:$USUARIO" "$VAR"; chmod 700 "$VAR"; chown root:root "$VAR/.fp-staging"
  if [ ! -d "$IMAGENES" ]; then install -d -m 700 -o "$USUARIO" -g "$USUARIO" "$IMAGENES"; cambio "directorio de imágenes $IMAGENES (700)"; fi
}

paso_secretos() {
  echo "2/10 Secretos propios de staging"
  if [ -f "$ENVF" ]; then
    [ "$(stat -c '%U:%G %a' "$ENVF")" = "root:$USUARIO 640" ] || fallo "$ENVF existe con dueño o modo inesperados."
    local k; for k in $CLAVES_ENV; do valor_env "$k" >/dev/null || fallo "$ENVF existe pero le falta $k."; done
    [ "$(valor_env POSTGRES_DB)" = "$BD" ] && [ "$(valor_env POSTGRES_USER)" = "$ROL" ] || fallo "$ENVF no apunta a $BD/$ROL."
    echo "   $ENVF existe y es completo: se conservan sus secretos"
    return
  fi
  local tmp
  tmp=$(mktemp "$ETC/.backend.env.XXXXXX")
  python3 -I - >"$tmp" <<PY
import secrets
print("DJANGO_SECRET_KEY=" + secrets.token_urlsafe(50))
print("DJANGO_DEBUG=false")
print("DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost,api-staging.familiaponquesito.com")
print("DJANGO_BEHIND_HTTPS_PROXY=false")
print("POSTGRES_DB=$BD")
print("POSTGRES_USER=$ROL")
print("POSTGRES_PASSWORD=" + secrets.token_hex(24))
print("POSTGRES_HOST=127.0.0.1")
print("POSTGRES_PORT=$PUERTO_PG")
print("PONQUESITO_INTERNAL_API_KEY=" + secrets.token_hex(32))
print("PONQUESITO_PRIVATE_IMAGE_ROOT=$IMAGENES")
print("PONQUESITO_API_PUBLIC_URL=https://api-staging.familiaponquesito.com")
PY
  chown root:"$USUARIO" "$tmp"; chmod 640 "$tmp"; mv "$tmp" "$ENVF"
  cambio "$ENVF (root:$USUARIO 640; secretos nuevos, no mostrados)"
}

paso_rol() {
  echo "3/10 Rol $ROL"
  destino_cluster
  local verificador
  # Se envía el verificador SCRAM, no la contraseña: nunca aparece en logs del servidor.
  verificador=$(valor_env POSTGRES_PASSWORD | python3 -I -c '
import base64, hashlib, hmac, os, sys
pw = sys.stdin.read().strip().encode(); sal = os.urandom(16); it = 4096
s = hashlib.pbkdf2_hmac("sha256", pw, sal, it)
ck = hmac.new(s, b"Client Key", "sha256").digest()
b = lambda x: base64.b64encode(x).decode()
print(f"SCRAM-SHA-256${it}:{b(sal)}${b(hashlib.sha256(ck).digest())}:{b(hmac.new(s, b"Server Key", "sha256").digest())}")')
  if ! existe_rol "$ROL"; then
    sql_rw postgres >/dev/null <<SQL
CREATE ROLE $ROL LOGIN NOSUPERUSER INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20 PASSWORD '$verificador';
COMMENT ON ROLE $ROL IS '$MARCA';
SQL
    cambio "rol $ROL (LOGIN, sin SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS, límite 20 conexiones)"
  else
    sql_rw postgres >/dev/null <<SQL
ALTER ROLE $ROL PASSWORD '$verificador';
SQL
    cambio "contraseña del rol $ROL alineada con $ENVF"
  fi
  [ "$(atributos_rol "$ROL")" = "$ATRIBUTOS_STAGING" ] || fallo "atributos del rol $ROL inesperados tras crearlo."
}

paso_bd() {
  echo "4/10 Base $BD y sus permisos"
  destino_cluster
  if ! existe_bd "$BD"; then
    sql_rw postgres >/dev/null <<SQL
CREATE DATABASE $BD OWNER $ROL TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8';
COMMENT ON DATABASE $BD IS '$MARCA';
SQL
    cambio "base $BD (propietario $ROL, UTF8, en_US.UTF-8, libc, template0)"
  fi
  destino_bd
  sql_rw postgres >/dev/null <<SQL
REVOKE ALL ON DATABASE $BD FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE $BD TO $ROL;
SQL
  cambio "permisos de $BD: REVOKE ALL FROM PUBLIC; CONNECT, TEMPORARY a $ROL"
  [ "$(sql_ro postgres -c "SELECT datacl::text FROM pg_database WHERE datname = '$BD'")" = "{$ROL=CTc/$ROL}" ] \
    || fallo "el ACL de $BD no es {$ROL=CTc/$ROL}."
}

paso_restaurar() {
  echo "5/10 Restauración del respaldo en $BD (sin --create; --no-owner --no-acl --role=$ROL)"
  destino_bd
  local comentario relaciones
  comentario=$(sql_ro postgres -c "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = '$BD'")
  relaciones=$(sql_ro "$BD" -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'")
  if [ "$comentario" = "$MARCA_RESTAURADA" ]; then echo "   ya restaurada por este script"; return; fi
  [ "$relaciones" = 0 ] || fallo "$BD tiene $relaciones relaciones sin marca de restauración: no se restaura encima."
  (cd "$RESPALDO" && sha256sum --quiet --strict -c SHA256SUMS) || fallo "el respaldo cambió."
  runuser -u postgres -- env PGAPPNAME=fp-staging timeout 1800 \
    pg_restore -p "$PUERTO_PG" -d "$BD" --no-owner --no-acl --role="$ROL" --exit-on-error --single-transaction \
    <"$RESPALDO/ponquesito.dump" || fallo "pg_restore terminó con error (transacción única: nada aplicado)."
  sql_rw postgres >/dev/null <<SQL
COMMENT ON DATABASE $BD IS '$MARCA_RESTAURADA';
SQL
  cambio "restaurado ponquesito.dump en $BD (objetos de $ROL, sin ACL del origen)"
}

paso_verificar_restauracion() {
  echo "6/10 Huellas de $BD frente al respaldo"
  destino_bd
  if [ -n "$(sql_ro "$BD" -c "SELECT 1 FROM django_migrations WHERE app = 'commerce' LIMIT 1")" ]; then
    echo "   $BD ya está migrada (ejecución anterior): se omite la comparación con el respaldo"; return
  fi
  huellas "$BD" "$EVID/huellas-staging-restaurada.txt"
  diff <(tail -n +2 "$RESPALDO/huellas-antes.txt") <(tail -n +2 "$EVID/huellas-staging-restaurada.txt") >/dev/null \
    || fallo "las 9 tablas restauradas no coinciden con huellas-antes.txt."
  echo "   9 tablas: recuento y md5 idénticos al respaldo"
  local cat
  cat=$(head -1 "$EVID/huellas-staging-restaurada.txt" | cut -d' ' -f3)
  [ "$cat" = "$CATALOGO_STAGING_ESPERADO" ] || fallo "huella del catálogo de $BD = $cat; se esperaba $CATALOGO_STAGING_ESPERADO."
  echo "   catálogo: huella esperada ($cat)"
}

paso_aislamiento() {
  echo "7/10 Aislamiento entre $BD y $BASE_PROD"
  destino_bd
  local r
  r=$(sql_ro postgres -c "SELECT
      has_database_privilege('$ROL', '$BASE_PROD', 'CONNECT'), has_database_privilege('$ROL', '$BASE_PROD', 'CREATE'), has_database_privilege('$ROL', '$BASE_PROD', 'TEMPORARY'),
      has_database_privilege('$ROL_PROD', '$BD', 'CONNECT'), has_database_privilege('$ROL_PROD', '$BD', 'CREATE'), has_database_privilege('$ROL_PROD', '$BD', 'TEMPORARY')")
  [ "$r" = "f|f|f|f|f|f" ] || fallo "privilegios cruzados de base: $r."
  r=$(sql_ro postgres -c "SELECT count(*) FROM pg_auth_members a JOIN pg_roles r ON r.oid IN (a.roleid, a.member) WHERE r.rolname IN ('$ROL', '$ROL_PROD')")
  [ "$r" = 0 ] || fallo "hay pertenencias de rol que implican a $ROL o $ROL_PROD."
  local acl_sql="SELECT count(*) FROM (
      SELECT relacl AS acl FROM pg_class UNION ALL SELECT nspacl FROM pg_namespace UNION ALL SELECT proacl FROM pg_proc
      UNION ALL SELECT defaclacl FROM pg_default_acl UNION ALL SELECT typacl FROM pg_type) x, aclexplode(x.acl) e
    WHERE e.grantee = (SELECT oid FROM pg_roles WHERE rolname = '%s')"
  r=$(sql_ro "$BD" -c "$(printf "$acl_sql" "$ROL_PROD")")
  [ "$r" = 0 ] || fallo "$ROL_PROD tiene $r permisos dentro de $BD."
  r=$(sql_ro "$BASE_PROD" -c "$(printf "$acl_sql" "$ROL")")
  [ "$r" = 0 ] || fallo "$ROL tiene $r permisos dentro de $BASE_PROD."
  r=$(sql_ro "$BASE_PROD" -c "SELECT count(*) FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = '$ROL')")
  [ "$r" = 0 ] || fallo "$ROL es dueño de $r objetos en $BASE_PROD."
  r=$(sql_ro "$BD" -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) <> '$ROL'")
  [ "$r" = 0 ] || fallo "en $BD hay $r objetos de public que no son de $ROL."
  echo "   sin privilegios de base, pertenencias, ACL ni propiedad cruzados"
  # Prueba real con la contraseña de staging por TCP (pg_hba: host all all 127.0.0.1 scram-sha-256).
  local pw salida
  pw=$(valor_env POSTGRES_PASSWORD)
  salida=$(PGPASSWORD=$pw PGCONNECT_TIMEOUT=5 psql -X -At "host=127.0.0.1 port=$PUERTO_PG dbname=$BASE_PROD user=$ROL" -c 'SELECT 1' 2>&1) \
    && fallo "$ROL PUDO conectarse a $BASE_PROD."
  case "$salida" in *"permission denied for database"*) echo "   $ROL → $BASE_PROD: rechazado (permission denied for database)" ;;
    *) fallo "la conexión de $ROL a $BASE_PROD falló por otra causa: $salida" ;; esac
  salida=$(PGPASSWORD=$pw PGCONNECT_TIMEOUT=5 psql -X -At "host=127.0.0.1 port=$PUERTO_PG dbname=$BD user=$ROL" -F ' ' -c 'SELECT current_database(), current_user' 2>&1) \
    || fallo "$ROL no puede conectarse a $BD: $salida"
  [ "$salida" = "$BD $ROL" ] || fallo "conexión de staging inesperada: $salida"
  echo "   $ROL → $BD: conecta por TCP con scram-sha-256"
}

paso_codigo() {
  echo "8/10 Código $DEPLOY_SHA y venv sin red"
  local tmp listado
  tmp=$(mktemp -d "$OPT/.entrante.XXXXXX")
  tar -x --no-same-owner --no-same-permissions -C "$tmp" -f "$PAQ/backend-$DEPLOY_SHA.tar"
  printf '%s\n' "$DEPLOY_SHA" >"$tmp/REVISION"
  listado=$(cd "$tmp" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)
  mkdir -p -m 750 "$OPT/releases"; chown root:"$USUARIO" "$OPT/releases"
  if [ -d "$RELEASE" ]; then
    [ "$(cd "$RELEASE" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)" = "$listado" ] \
      || fallo "$RELEASE existe con otro contenido."
    rm -rf --one-file-system "$tmp"
    echo "   $RELEASE ya existe y es idéntica"
  else
    chown -R root:"$USUARIO" "$tmp"
    find "$tmp" -type d -exec chmod 750 {} + ; find "$tmp" -type f -exec chmod 640 {} +
    mv "$tmp" "$RELEASE"
    cambio "código en $RELEASE (root:$USUARIO, 750/640)"
  fi
  if [ "$(readlink "$OPT/current" 2>/dev/null)" != "$RELEASE" ]; then
    [ ! -e "$OPT/current" ] || [ -L "$OPT/current" ] || fallo "$OPT/current existe y no es un enlace."
    ln -sfn "$RELEASE" "$OPT/current"; cambio "enlace $OPT/current → $RELEASE"
  fi
  if [ ! -d "$VENV" ]; then
    # umask 022: el usuario del servicio debe poder leer el venv (no contiene secretos).
    (umask 022
     python3 -m venv "$VENV"
     "$VENV/bin/pip" install --quiet --no-index --no-cache-dir --disable-pip-version-check --only-binary=:all: \
       --require-hashes --find-links "$PAQ/wheelhouse" -r "$PAQ/requirements-staging.txt")
    chown -R root:root "$VENV"; chmod -R go-w "$VENV"
    cambio "venv $VENV (sin red; wheels verificados por hash)"
  fi
  [ "$("$VENV/bin/pip" freeze --disable-pip-version-check | tr '[:upper:]' '[:lower:]' | tr '_' '-' | LC_ALL=C sort)" = "$PAQUETES_ESPERADOS" ] \
    || fallo "los paquetes del venv no son los esperados."
  echo "   venv: $(echo "$PAQUETES_ESPERADOS" | tr '\n' ' ')"
}

paso_migrar() {
  echo "9/10 Migraciones sobre $BD"
  destino_bd
  local destino plan migraciones
  destino=$(destino_django) || fallo "Django de staging no pudo conectarse."
  [ "$destino" = "$BD $ROL $PUERTO_PG" ] || fallo "Django de staging apunta a: $destino."
  echo "   destino de Django: $destino"
  echo "\$ manage.py migrate --plan" | tee "$EVID/migrate-plan.txt"
  plan=$(como_servicio migrate --plan) || fallo "migrate --plan falló."
  echo "$plan" | tee -a "$EVID/migrate-plan.txt"
  migraciones=$(echo "$plan" | grep -E '^[a-z_]+\.[0-9]{4}_[A-Za-z0-9_]+$' || true)
  if [ -z "$migraciones" ] && echo "$plan" | grep -q 'No planned migration operations'; then
    [ "$(como_servicio showmigrations commerce | grep -c '\[X\]')" = 4 ] || fallo "plan vacío pero commerce no está completa."
    echo "   nada que migrar: commerce 0001–0004 ya aplicadas"
  elif [ "$migraciones" = "$PLAN_ESPERADO" ]; then
    destino=$(destino_django); [ "$destino" = "$BD $ROL $PUERTO_PG" ] || fallo "el destino cambió: $destino."
    como_servicio migrate --noinput 2>&1 | tee "$EVID/migrate-aplicar.txt"
    cambio "migraciones commerce 0001–0004 aplicadas en $BD"
  else
    echo "Migraciones planeadas:"; echo "${migraciones:-(ninguna reconocible)}"
    fallo "el plan de migración no es exactamente commerce 0001–0004."
  fi
  como_servicio makemigrations --check --dry-run >"$EVID/makemigrations-check.txt" 2>&1 || fallo "hay cambios de modelo sin migración."
  como_servicio check >"$EVID/check.txt" 2>&1 || fallo "manage.py check falló."
  como_servicio check --deploy >"$EVID/check-deploy.txt" 2>&1 || true
  [ "$(sql_ro "$BD" -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) <> '$ROL'")" = 0 ] \
    || fallo "tras migrar hay objetos de public que no son de $ROL."
  echo "   check sin problemas; tablas en public: $(sql_ro "$BD" -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
}

paso_servicio() {
  echo "10/10 Servicio $UNIDAD en 127.0.0.1:$PUERTO"
  if [ ! -e "$UNIDAD_RUTA" ]; then
    install -m 644 -o root -g root "$PAQ/$UNIDAD" "$UNIDAD_RUTA"; cambio "unidad $UNIDAD_RUTA"
  fi
  systemctl daemon-reload
  if [ "$(systemctl is-enabled "$UNIDAD" 2>/dev/null)" != enabled ]; then systemctl enable --quiet "$UNIDAD"; cambio "$UNIDAD habilitada"; fi
  if [ "$(systemctl is-active "$UNIDAD")" != active ]; then systemctl start "$UNIDAD"; cambio "$UNIDAD iniciada"
  else systemctl restart "$UNIDAD"; cambio "$UNIDAD reiniciada"; fi
  local salud="" i
  for i in $(seq 30); do
    salud=$(python3 -I -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:'"$PUERTO"'/health/", timeout=3).read().decode())' 2>/dev/null) && break
    sleep 1
  done
  [ "$salud" = '{"status": "ok", "database": "ok"}' ] || fallo "health de staging: ${salud:-sin respuesta}."
  echo "   /health/: $salud"
  local escucha
  escucha=$(ss -Hltn | awk '{print $4}' | grep -E ":$PUERTO\$" | sort -u | tr '\n' ' ')
  [ "$escucha" = "127.0.0.1:$PUERTO " ] || fallo "el puerto $PUERTO escucha en: $escucha."
  echo "   escucha solo en 127.0.0.1:$PUERTO"
  python3 -I - "$ENVF" "$PUERTO" <<'PY' || fallo "la API interna no responde como se espera."
import json, sys, urllib.error, urllib.request
env = dict(l.rstrip("\n").split("=", 1) for l in open(sys.argv[1]) if "=" in l)
url = f"http://127.0.0.1:{sys.argv[2]}/api/v1/internal/agenda-availability/"
body = json.dumps({"start_date": "2026-11-01", "end_date": "2026-11-07", "capacity_points": 1}).encode()
def post(headers):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, body, {"Content-Type": "application/json", **headers}), timeout=5)
        return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, None
sin, _ = post({})
con, datos = post({"Authorization": "Bearer " + env["PONQUESITO_INTERNAL_API_KEY"]})
print(f"   API interna: sin credencial {sin}; con credencial {con} ok={datos and datos.get('ok')}")
sys.exit(0 if sin == 401 and con == 200 and datos and datos.get("ok") else 1)
PY
}

entregar_clave() {
  # Para el frontend local por túnel: copia de la clave interna solo para wilfredo.
  local d=/home/$ADMIN/fp-staging/entrega
  install -d -m 700 -o "$ADMIN" -g "$ADMIN" "$d"
  (umask 077; valor_env PONQUESITO_INTERNAL_API_KEY >"$d/internal-api-key")
  chown "$ADMIN:$ADMIN" "$d/internal-api-key"; chmod 600 "$d/internal-api-key"
  echo "   clave interna para el túnel en $d/internal-api-key (600; copiarla y borrarla)"
}

# --- Ejecución ----------------------------------------------------------------
main() {
  # Nada se escribe (ni la evidencia) hasta validar la ubicación del paquete.
  comprobar_ubicacion
  mkdir -m 700 "$EVID"
  exec 3>&1 4>&2 > >(tee -a "$EVID/registro.txt") 2>&1
  REGISTRO_PID=$!
  echo "Staging Familia Ponquesito ($MODO) — $SELLO en $(hostname)"
  echo "Comprobaciones previas (solo lectura)…"
  echo "   ubicación: $PAQ/preparar-staging.sh; antecesores de root o $ADMIN, sin enlaces ni escritura de terceros"
  comprobar_host
  comprobar_paquete
  comprobar_respaldo
  registrar_ajustes
  local cred_antes cred_despues
  cred_antes=$(foto_produccion "$EVID/produccion-antes.txt")
  echo "   foto de producción tomada (servicios, archivos, rol, huellas de $BASE_PROD)"
  inspeccionar_existentes
  # El respaldo no incluye ajustes por base/rol: si existen, staging no los
  # reproduciría. Se revisan (nombres en el archivo de ajustes) antes de seguir.
  [ "$AJUSTES_PROD" = 0 ] || BLOQUEOS+=("hay $AJUSTES_PROD ajustes por base/rol en $BASE_PROD/$ROL_PROD o staging que el respaldo no incluye; revisar $AJUSTES.")
  if [ "${#BLOQUEOS[@]}" -gt 0 ]; then
    printf '!! %s\n' "${BLOQUEOS[@]}"
    bloqueo "revisar lo anterior antes de decidir; los recursos existentes no se reutilizan ni se borran automáticamente."
  fi
  cat <<EOF
Cambios previstos (solo los que falten):
  - usuario de sistema $USUARIO; $OPT, $ETC (root:$USUARIO 750), $VAR e $IMAGENES ($USUARIO 700)
  - $ENVF con secretos nuevos (root:$USUARIO 640)
  - rol $ROL y base $BD (propietario $ROL; REVOKE ALL FROM PUBLIC; CONNECT, TEMPORARY a $ROL)
  - restauración de ponquesito.dump en $BD con --no-owner --no-acl --role=$ROL
  - código $DEPLOY_SHA en $RELEASE, venv $VENV
  - migrate de commerce 0001–0004 SOLO en $BD, si el plan coincide
  - $UNIDAD_RUTA habilitada e iniciada en 127.0.0.1:$PUERTO
Sin cambios: $BASE_PROD, $ROL_PROD, ponquesito-backend/web, /srv/ponquesito, respaldos, pg_hba, DNS, Caddy, UFW, Vercel.
EOF
  if [ "$MODO" = --comprobar ]; then echo "Comprobación completa: sin bloqueos. Nada se ha cambiado."; exit 0; fi

  paso_usuario
  paso_secretos
  paso_rol
  paso_bd
  paso_restaurar
  paso_verificar_restauracion
  paso_aislamiento
  paso_codigo
  paso_migrar
  paso_servicio
  entregar_clave

  echo "Comprobación final de producción…"
  cred_despues=$(foto_produccion "$EVID/produccion-despues.txt")
  [ "$cred_antes" = "$cred_despues" ] || fallo "la credencial de $ROL_PROD cambió."
  cmp -s "$EVID/produccion-antes.txt" "$EVID/produccion-despues.txt" || { diff "$EVID/produccion-antes.txt" "$EVID/produccion-despues.txt" || true; fallo "el estado de producción cambió."; }
  if cmp -s "$EVID/produccion-antes.txt.huellas" "$EVID/produccion-despues.txt.huellas"; then
    echo "   $BASE_PROD: huellas idénticas antes y después"
  else
    echo "   AVISO: las huellas de $BASE_PROD cambiaron durante la ejecución (¿tráfico del backend actual?):"
    diff <(cut -d' ' -f1,2 "$EVID/produccion-antes.txt.huellas") <(cut -d' ' -f1,2 "$EVID/produccion-despues.txt.huellas") || true
  fi
  echo "   servicios, backend.env, unidad, /srv/ponquesito, rol y credencial de $ROL_PROD y respaldo: sin cambios"
  echo
  lista_cambios "Cambios hechos en esta ejecución:"
  echo "Staging listo en 127.0.0.1:$PUERTO. Evidencia: $EVID"
}

main
