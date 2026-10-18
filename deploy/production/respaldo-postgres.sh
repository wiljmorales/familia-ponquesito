#!/usr/bin/env bash
# Respaldo de la base ponquesito del VPS (Familia Ponquesito).
#
# Uso, en la consola del VPS como wilfredo:  ~/fp-respaldo-postgres.sh
# Pide sudo una vez; pg_dump corre como postgres. No modifica la base ni
# servicios: solo lee y escribe en un directorio NUEVO y privado
# ~/fp-respaldos/ponquesito-<fecha>/ (700; archivos 600):
#
#   ponquesito.dump    pg_dump formato custom, con propietarios y permisos
#   roles.sql          roles del clúster SIN contraseñas (--no-role-passwords)
#   huellas-antes.txt  recuentos y md5 por tabla + huella del catálogo,
#   huellas-despues.txt  tomados justo antes y después del volcado
#   toc.txt            índice del archivo (pg_restore --list)
#   MANIFIESTO.txt     versiones, codificación, tamaños
#   SHA256SUMS         sha256 de todo lo anterior
#
# Las huellas no contienen filas: solo nombre de tabla, número de filas y
# un md5 del contenido. Permiten comprobar una restauración sin ver datos.
#
# Código de salida: 0 respaldo completo y verificado; 1 fallo (el directorio
# queda para diagnóstico, marcado INCOMPLETO); 2 bloqueo previo (nada escrito).

set -u -o pipefail
umask 077

BASE=ponquesito
RAIZ="$HOME/fp-respaldos"
DESTINO="$RAIZ/$BASE-$(date -u +%Y%m%dT%H%M%SZ)"
# Sesiones de lectura: solo lectura, tiempos acotados y formato de texto
# estable (UTC, ISO) para que las huellas coincidan en otro servidor.
OPCIONES="-c default_transaction_read_only=on -c statement_timeout=120s -c lock_timeout=5s -c idle_in_transaction_session_timeout=60s -c TimeZone=UTC -c DateStyle=ISO,MDY -c IntervalStyle=postgres -c extra_float_digits=1 -c bytea_output=hex"
PSQL=(sudo -u postgres env "PGOPTIONS=$OPCIONES" PGCONNECT_TIMEOUT=5 PGAPPNAME=fp-respaldo timeout 300 psql -X -q -v ON_ERROR_STOP=1)

bloqueo() { echo "!! BLOQUEO: $1"; exit 2; }
fallo() {
  echo "!! FALLO: $1"
  [ -d "$DESTINO" ] && echo "Respaldo INCOMPLETO: no usar. Directorio para diagnóstico: $DESTINO" > "$DESTINO/INCOMPLETO"
  exit 1
}

huellas() {  # huellas <puerto> <archivo>: catálogo + recuento y md5 por tabla
  "${PSQL[@]}" -At -F ' ' -p "$1" -d "$BASE" -f - >"$2" <<'SQL'
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

main() {
  local clusters version nombre puerto estado resto candidatos=0 cluster_puerto="" libre_kb tamano_bytes propiedades
  echo "Respaldo de $BASE — $(date -u '+%Y-%m-%dT%H:%M:%SZ') en $(hostname)"

  sudo -v || bloqueo "sin sudo no se puede ejecutar pg_dump como postgres."
  clusters=$(pg_lsclusters -h) || bloqueo "pg_lsclusters falló."
  while read -r version nombre puerto estado resto; do
    case "${estado:-}" in online*) candidatos=$((candidatos + 1)); cluster_puerto=$puerto ;; esac
  done <<<"$clusters"
  [ "$candidatos" -eq 1 ] || bloqueo "se esperaba exactamente un clúster online y hay $candidatos."

  tamano_bytes=$("${PSQL[@]}" -At -p "$cluster_puerto" -d postgres -c "SELECT pg_database_size(datname) FROM pg_database WHERE datname = '$BASE'" </dev/null) \
    || bloqueo "no se pudo consultar la base $BASE."
  [ -n "$tamano_bytes" ] || bloqueo "la base $BASE no existe en el clúster del puerto $cluster_puerto."
  mkdir -p -m 700 "$RAIZ" || bloqueo "no se pudo crear $RAIZ."
  chmod 700 "$RAIZ"
  libre_kb=$(df -Pk "$RAIZ" | awk 'NR == 2 {print $4}')
  [ $((libre_kb * 1024)) -gt $((tamano_bytes * 3 + 1073741824)) ] \
    || bloqueo "espacio insuficiente en $RAIZ (base: $tamano_bytes bytes; libre: ${libre_kb} KiB)."
  mkdir -m 700 "$DESTINO" || bloqueo "no se pudo crear $DESTINO (¿ya existe?)."
  echo "Destino: $DESTINO"
  echo "Clúster online en el puerto $cluster_puerto; tamaño de $BASE: $tamano_bytes bytes."

  echo "1/6 Huellas antes del volcado…"
  huellas "$cluster_puerto" "$DESTINO/huellas-antes.txt" || fallo "no se pudieron calcular las huellas previas."

  echo "2/6 pg_dump (formato custom)…"
  sudo -u postgres env PGAPPNAME=fp-respaldo timeout 1800 \
    pg_dump -p "$cluster_puerto" -d "$BASE" --format=custom --lock-wait-timeout=30s --no-password \
    >"$DESTINO/$BASE.dump" </dev/null || fallo "pg_dump terminó con error."
  [ -s "$DESTINO/$BASE.dump" ] || fallo "el volcado está vacío."

  echo "3/6 Roles sin contraseñas…"
  sudo -u postgres timeout 120 pg_dumpall -p "$cluster_puerto" --roles-only --no-role-passwords --no-password \
    >"$DESTINO/roles.sql" </dev/null || fallo "pg_dumpall --roles-only terminó con error."
  if grep -qiE "password[[:space:]]+'|SCRAM-SHA-256\\$|md5[0-9a-f]{32}" "$DESTINO/roles.sql"; then
    fallo "roles.sql contiene algo con forma de contraseña; se descarta."
  fi

  echo "4/6 Huellas después del volcado…"
  huellas "$cluster_puerto" "$DESTINO/huellas-despues.txt" || fallo "no se pudieron calcular las huellas posteriores."
  cmp -s "$DESTINO/huellas-antes.txt" "$DESTINO/huellas-despues.txt" \
    || fallo "la base cambió durante el volcado: las huellas no corresponden a la copia. Repetir el respaldo."

  echo "5/6 Comprobando el archivo con pg_restore --list…"
  pg_restore --list "$DESTINO/$BASE.dump" >"$DESTINO/toc.txt" || fallo "pg_restore no puede leer el volcado."
  grep -q "TABLE DATA public django_migrations" "$DESTINO/toc.txt" \
    || fallo "el índice no contiene los datos de django_migrations."

  echo "6/6 Manifiesto y SHA-256…"
  propiedades=$("${PSQL[@]}" -At -F ': ' -p "$cluster_puerto" -d "$BASE" -f - <<'SQL'
SELECT 'servidor', current_setting('server_version')
UNION ALL SELECT 'propietario', pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()
UNION ALL SELECT 'codificacion', pg_encoding_to_char(encoding) FROM pg_database WHERE datname = current_database()
UNION ALL SELECT 'lc_collate', datcollate FROM pg_database WHERE datname = current_database()
UNION ALL SELECT 'lc_ctype', datctype FROM pg_database WHERE datname = current_database()
UNION ALL SELECT 'proveedor_locale', datlocprovider::text FROM pg_database WHERE datname = current_database()
SQL
  ) || fallo "no se pudieron leer las propiedades de la base para el manifiesto."
  {
    echo "base: $BASE"
    echo "fecha_utc: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "host: $(hostname)"
    echo "puerto: $cluster_puerto"
    echo "tamano_base_bytes: $tamano_bytes"
    echo "pg_dump: $(pg_dump --version)"
    echo "$propiedades"
    echo "entradas_toc: $(grep -cv '^;' "$DESTINO/toc.txt")"
    echo "tablas_con_huella: $(($(wc -l <"$DESTINO/huellas-antes.txt") - 1))"
  } >"$DESTINO/MANIFIESTO.txt" || fallo "no se pudo escribir el manifiesto."
  (cd "$DESTINO" && sha256sum "$BASE.dump" roles.sql huellas-antes.txt huellas-despues.txt toc.txt MANIFIESTO.txt >SHA256SUMS) \
    || fallo "no se pudo calcular SHA-256."
  chmod 600 "$DESTINO"/* && chmod 700 "$DESTINO" || fallo "no se pudieron ajustar los permisos."
  (cd "$DESTINO" && sha256sum --quiet -c SHA256SUMS) || fallo "SHA256SUMS no verifica."

  echo
  cat "$DESTINO/MANIFIESTO.txt"
  echo
  ls -l "$DESTINO"
  echo
  echo "SHA-256 del volcado: $(cut -d' ' -f1 <(grep " $BASE.dump\$" "$DESTINO/SHA256SUMS"))"
  echo "Respaldo completo y verificado en: $DESTINO"
}

main
