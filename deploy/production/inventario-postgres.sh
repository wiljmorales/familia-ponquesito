#!/usr/bin/env bash
# Inventario de SOLO LECTURA de PostgreSQL en el VPS (Familia Ponquesito).
#
# Uso, en la consola del VPS como wilfredo:  bash ~/fp-inventario-postgres.sh
# Pide sudo una vez. Solo consulta metadatos y el registro técnico de
# migraciones Django: sin filas de clientes, contraseñas ni valores secretos.
# Cada sesión SQL es una transacción de solo lectura con tiempos acotados.
# La única escritura es el informe privado (modo 600) en el home.
#
# Código de salida: 0 inventario completo; 1 algún paso falló (ver "!!");
# 2 bloqueo (sin sudo, sin pg_lsclusters o sin ningún clúster online).

set -u
umask 077

INFORME="$HOME/fp-inventario-$(date +%Y%m%d-%H%M%S)-$$.txt"
OPCIONES="-c default_transaction_read_only=on -c statement_timeout=10s -c lock_timeout=2s -c idle_in_transaction_session_timeout=15s"
# Una sola línea y siempre seguido de psql: env nunca se ejecuta solo.
PSQL=(sudo -u postgres env "PGOPTIONS=$OPCIONES" PGCONNECT_TIMEOUT=5 PGAPPNAME=fp-inventario timeout 30 psql -X -q -v ON_ERROR_STOP=1)

fallos=0
seccion() { printf '\n===== %s =====\n' "$1"; }
fallo() { echo "!! FALLO: $1"; fallos=$((fallos + 1)); }
paso() {  # paso <descripción> <comando...>
  local descripcion=$1; shift
  "$@" || fallo "$descripcion (código $?)"
}
# Tabla legible, dentro de BEGIN READ ONLY ... COMMIT.
sql() {  # sql <puerto> <base> <consulta>
  "${PSQL[@]}" -P pager=off -p "$1" -d "$2" -c 'BEGIN TRANSACTION READ ONLY' -c "$3" -c 'COMMIT' </dev/null
}
# Valores sin formato, uno por línea. El llamador comprueba el código de salida.
sql_valor() {  # sql_valor <puerto> <base> <consulta>
  "${PSQL[@]}" -At -p "$1" -d "$2" -c "$3" </dev/null
}
consulta() {  # consulta <variable>: lee el SQL del heredoc que sigue
  IFS= read -r -d '' "$1" || true
}

consulta Q_AJUSTES <<'SQL'
SELECT name, setting
FROM pg_settings
WHERE name IN ('data_directory', 'port', 'listen_addresses', 'max_connections',
               'password_encryption', 'ssl', 'server_encoding', 'TimeZone',
               'wal_level', 'archive_mode')
ORDER BY name
SQL
consulta Q_BASES <<'SQL'
SELECT d.datname AS base,
       pg_get_userbyid(d.datdba) AS propietario,
       pg_encoding_to_char(d.encoding) AS codificacion,
       d.datcollate,
       d.datallowconn AS conexiones,
       d.datconnlimit AS limite,
       pg_size_pretty(pg_database_size(d.oid)) AS tamano,
       d.datacl AS privilegios
FROM pg_database d
ORDER BY 1
SQL
consulta Q_ROLES <<'SQL'
SELECT rolname AS rol, rolsuper AS super, rolinherit AS hereda,
       rolcreaterole AS crea_roles, rolcreatedb AS crea_bd, rolcanlogin AS login,
       rolreplication AS replicacion, rolbypassrls AS bypass_rls,
       rolconnlimit AS limite, rolvaliduntil AS valido_hasta
FROM pg_roles
WHERE rolname !~ '^pg_'
ORDER BY 1
SQL
consulta Q_MIEMBROS <<'SQL'
SELECT r.rolname AS rol, m.rolname AS miembro, a.admin_option
FROM pg_auth_members a
JOIN pg_roles r ON r.oid = a.roleid
JOIN pg_roles m ON m.oid = a.member
WHERE m.rolname !~ '^pg_'
ORDER BY 1, 2
SQL
consulta Q_HBA <<'SQL'
SELECT line_number AS linea, type AS tipo, database AS bases,
       user_name AS usuarios, address AS direccion, auth_method AS metodo
FROM pg_hba_file_rules
ORDER BY 1
SQL
consulta Q_SESIONES <<'SQL'
SELECT datname AS base, usename AS usuario, application_name AS aplicacion,
       state AS estado, count(*) AS sesiones
FROM pg_stat_activity
WHERE backend_type = 'client backend'
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2
SQL
consulta Q_LISTA_BASES <<'SQL'
SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY 1
SQL
consulta Q_ESQUEMAS <<'SQL'
SELECT n.nspname AS esquema, pg_get_userbyid(n.nspowner) AS propietario,
       n.nspacl AS privilegios
FROM pg_namespace n
WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
ORDER BY 1
SQL
consulta Q_EXTENSIONES <<'SQL'
SELECT e.extname AS extension, e.extversion AS version, n.nspname AS esquema
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
ORDER BY 1
SQL
consulta Q_OBJETOS <<'SQL'
SELECT n.nspname AS esquema,
       c.relname AS objeto,
       CASE c.relkind
         WHEN 'r' THEN 'tabla' WHEN 'p' THEN 'particionada' WHEN 'v' THEN 'vista'
         WHEN 'm' THEN 'vista mat.' WHEN 'S' THEN 'secuencia' WHEN 'f' THEN 'externa'
       END AS tipo,
       pg_get_userbyid(c.relowner) AS propietario,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS tamano,
       s.n_live_tup AS filas_estimadas
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
ORDER BY 1, 3, 2
SQL
consulta Q_PERMISOS <<'SQL'
SELECT grantee AS beneficiario, table_schema AS esquema,
       string_agg(DISTINCT privilege_type, ', ' ORDER BY privilege_type) AS privilegios,
       count(DISTINCT table_name) AS objetos
FROM information_schema.role_table_grants
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
GROUP BY 1, 2
ORDER BY 1, 2
SQL
consulta Q_DEFECTO <<'SQL'
SELECT pg_get_userbyid(d.defaclrole) AS rol, n.nspname AS esquema,
       d.defaclobjtype AS tipo, d.defaclacl AS privilegios
FROM pg_default_acl d
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
ORDER BY 1, 2
SQL
consulta Q_COLISIONES <<'SQL'
SELECT nombre AS tabla_que_crearia_django,
       to_regclass('public.' || nombre) IS NOT NULL AS ya_existe
FROM unnest(ARRAY[
  'cake_requests', 'cake_designs', 'leads', 'lead_automation_events',
  'email_dispatches', 'production_day_overrides', 'cake_reservations',
  'reservation_events', 'agent_decisions', 'weekly_reports', 'recovery_throttles'
]) AS nombre
ORDER BY 1
SQL
consulta Q_HAY_MIGRACIONES <<'SQL'
SELECT to_regclass('public.django_migrations') IS NOT NULL
SQL
consulta Q_MIGRACIONES <<'SQL'
SELECT app, name AS migracion, applied AS aplicada FROM django_migrations ORDER BY id
SQL

inventariar_base() {  # inventariar_base <puerto> <base> <etiqueta del clúster>
  local puerto=$1 base=$2 etiqueta=$3 hay
  seccion "Base $base (clúster $etiqueta)"
  paso "esquemas de $base" sql "$puerto" "$base" "$Q_ESQUEMAS"
  paso "extensiones de $base" sql "$puerto" "$base" "$Q_EXTENSIONES"
  paso "tablas y objetos de $base" sql "$puerto" "$base" "$Q_OBJETOS"
  paso "permisos de $base" sql "$puerto" "$base" "$Q_PERMISOS"
  paso "privilegios por defecto de $base" sql "$puerto" "$base" "$Q_DEFECTO"
  paso "tablas que crearía Django en $base" sql "$puerto" "$base" "$Q_COLISIONES"
  if ! hay=$(sql_valor "$puerto" "$base" "$Q_HAY_MIGRACIONES"); then
    fallo "no se pudo comprobar django_migrations en $base"
  elif [ "$hay" = "t" ]; then
    paso "migraciones Django de $base" sql "$puerto" "$base" "$Q_MIGRACIONES"
  elif [ "$hay" = "f" ]; then
    echo "Sin tabla django_migrations en $base."
  else
    fallo "respuesta inesperada al buscar django_migrations en $base"
  fi
}

inventariar_cluster() {  # inventariar_cluster <versión> <nombre> <puerto>
  local version=$1 nombre=$2 puerto=$3 etiqueta="$1/$2" datadir bases base
  seccion "Clúster $etiqueta (puerto $puerto)"
  paso "versión" sql "$puerto" postgres "SELECT version()"
  paso "ajustes" sql "$puerto" postgres "$Q_AJUSTES"
  paso "bases y propietarios" sql "$puerto" postgres "$Q_BASES"
  paso "roles" sql "$puerto" postgres "$Q_ROLES"
  paso "pertenencia a roles" sql "$puerto" postgres "$Q_MIEMBROS"
  paso "reglas de acceso (pg_hba)" sql "$puerto" postgres "$Q_HBA"
  paso "sesiones" sql "$puerto" postgres "$Q_SESIONES"

  if ! datadir=$(sql_valor "$puerto" postgres "SHOW data_directory") || [ -z "$datadir" ]; then
    fallo "no se pudo leer data_directory del clúster $etiqueta"
  else
    echo "Directorio de datos: $datadir"
    paso "espacio del directorio de datos" df -h "$datadir"
    paso "tamaño del directorio de datos" sudo du -sh "$datadir"
  fi

  if ! bases=$(sql_valor "$puerto" postgres "$Q_LISTA_BASES"); then
    fallo "no se pudieron enumerar las bases del clúster $etiqueta"
    return
  fi
  if [ -z "$bases" ]; then
    fallo "el clúster $etiqueta no tiene bases conectables"
    return
  fi
  while IFS= read -r base; do
    [ -n "$base" ] && inventariar_base "$puerto" "$base" "$etiqueta"
  done <<<"$bases"
}

main() {
  local clusters version nombre puerto estado resto encontrados=0 activo habilitado s
  seccion "Contexto"
  date -u '+%Y-%m-%dT%H:%M:%SZ'; hostname; whoami
  (. /etc/os-release && echo "$PRETTY_NAME"); uname -r

  seccion "sudo (introduce tu contraseña si la pide)"
  if ! sudo -v; then
    echo "!! BLOQUEO: sin sudo no se puede consultar PostgreSQL."
    return 2
  fi

  seccion "Servicios (solo estado)"
  for s in postgresql ponquesito-backend ponquesito-web caddy caddy-api; do
    activo=$(systemctl is-active "$s" 2>/dev/null); habilitado=$(systemctl is-enabled "$s" 2>/dev/null)
    printf '%-20s activo=%-10s habilitado=%s\n' "$s" "${activo:-desconocido}" "${habilitado:-no-instalado}"
  done
  echo "Puertos en escucha relevantes:"
  sudo ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E ':(22|80|443|2019|3000|5432|8000)$' | sort -u

  seccion "Base de datos que usa el backend (sin contraseña)"
  paso "claves POSTGRES_* de backend.env" sudo grep -E '^POSTGRES_(DB|USER|HOST|PORT)=' /srv/ponquesito/backend.env
  ls -ld /srv/ponquesito/backend/commerce 2>/dev/null \
    || echo "El backend desplegado no tiene la app commerce (esperado: revisión anterior)."

  seccion "Clústeres y herramientas"
  paso "versión de psql" psql --version
  paso "versión de pg_dump" pg_dump --version
  if ! clusters=$(pg_lsclusters -h); then
    echo "!! BLOQUEO: pg_lsclusters falló; no se pueden enumerar los clústeres."
    return 2
  fi
  pg_lsclusters
  while read -r version nombre puerto estado resto; do
    [ -z "${version:-}" ] && continue
    case "$estado" in
      online*) encontrados=$((encontrados + 1)); inventariar_cluster "$version" "$nombre" "$puerto" ;;
      *) echo "Clúster $version/$nombre en estado '$estado': no se consulta." ;;
    esac
  done <<<"$clusters"
  if [ "$encontrados" -eq 0 ]; then
    echo "!! BLOQUEO: no hay ningún clúster PostgreSQL online."
    return 2
  fi

  seccion "Espacio en disco"
  df -h / /var/lib/postgresql /srv /var/backups 2>/dev/null

  seccion "Resultado"
  if [ "$fallos" -eq 0 ]; then
    echo "Inventario completo, sin fallos."
    return 0
  fi
  echo "Inventario INCOMPLETO: $fallos paso(s) con fallo (buscar '!! FALLO')."
  return 1
}

main 2>&1 | tee -a "$INFORME"
codigo=${PIPESTATUS[0]}
echo "Informe guardado en: $INFORME (código $codigo)"
exit "$codigo"
