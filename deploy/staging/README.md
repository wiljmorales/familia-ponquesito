# Staging privado en el VPS (solo 127.0.0.1:8001)

Backend Django de staging junto al de producción, sin compartir nada con él:
otra base y otro rol (`ponquesito_staging`), otro usuario de sistema
(`ponquesito-staging`), otro código y venv (`/opt/ponquesito-staging`), otros
secretos (`/etc/ponquesito-staging/backend.env`) y otras imágenes
(`/var/lib/ponquesito-staging/images`). Solo escucha en `127.0.0.1:8001` y se
prueba por túnel SSH. El nombre previsto `api-staging.familiaponquesito.com`
aún no se publica: esta fase no cambia DNS, Caddy, UFW, `pg_hba` ni Vercel.
La publicación por HTTPS para Vercel Preview, con su SMTP de pruebas, es una
fase aparte: [README-https.md](README-https.md).

Código desplegado: `35cfebb785e3e92dce665177e424ace08074ed33`, fijado en
`DEPLOY_SHA` de `preparar-staging.sh`. Datos de partida: el respaldo
`ponquesito-20261018T133232Z`, con el SHA-256 del volcado también fijado.

| Archivo | Función |
|---|---|
| `preparar-staging.sh` | Se ejecuta con sudo en el VPS (`--comprobar` / `--aplicar`) |
| `ponquesito-staging-backend.service` | Unidad systemd; mismo aislamiento que la de producción, `-b 127.0.0.1:8001 -w 2` |
| `empaquetar.sh` | En local: script, unidad, `git archive` del backend en el SHA y wheels con hash |
| `probar-tunel.sh`, `test/*.e2e.ts` | En local: túnel SSH y flujos reales de Next.js con SMTP local `.invalid` |
| `test/sim/crear.sh`, `test/regresion-rutas.sh` | En local: simulación del VPS (Docker con systemd) y regresión de ubicación y permisos |

## Qué hace `--aplicar`

Primero hace todas las comprobaciones, solo de lectura. Si algo no cuadra,
termina con código 2 sin cambiar nada:

- Ubicación, antes de escribir nada (ni la evidencia): sudo desde `wilfredo`, y
  el script tiene que ser `/home/wilfredo/fp-staging/preparar-staging.sh` tanto
  en la ruta pedida como en la física. Sirven `cd ~/fp-staging && sudo bash
  ./preparar-staging.sh`, la ruta absoluta o una relativa; se bloquean un
  script o un `fp-staging` que sean enlaces, una copia en otra ruta o el script
  por stdin. Cada antecesor tiene que ser un directorio real y no admitir
  escritura de grupo ni de otros. Los del sistema (`/`, `/home`) deben ser de
  root; desde `/home/wilfredo`, de `wilfredo`. `fp-staging`, `wheelhouse` y el
  respaldo deben ser privados; sus archivos, regulares (no enlaces), de
  `wilfredo` y sin escritura de terceros. No se cambian dueños ni permisos.
- Host `ubuntu-4gb-hel1-1`, Ubuntu 26.04, un único clúster online `18/main/5432`
  y ejecución como `wilfredo` mediante sudo.
- `SHA256SUMS` del paquete y del respaldo. El tar debe llevar el commit
  fijado y no contener rutas inseguras.
- Ajustes por base/rol (`pg_db_role_setting`), ACL de las bases, atributos y
  pertenencias de los roles, y `pg_hba`. Se guardan en
  `~/fp-respaldos/ponquesito-20261018T133232Z-ajustes/`, sin valores (solo el
  nombre y `sha256[:12]`). Si hay ajustes para `ponquesito`, `ponquesito_app`
  o staging, se bloquea: el respaldo no los incluye.
- Foto de producción: servicios, puertos, `backend.env`, unidad, árbol de
  `/srv/ponquesito`, atributos y credencial de `ponquesito_app` (comparada en
  memoria) y huellas de `ponquesito`.
- Recursos con los nombres de staging. Se reutilizan solo si llevan la marca
  del script y coinciden con lo esperado; si no, bloqueo. Nunca se borran.

Después aplica, en este orden, solo lo que falte. Antes de cada operación
sobre la base comprueba el clúster, que la base sea `ponquesito_staging`, su
propietario y la marca:

1. Usuario de sistema `ponquesito-staging` (nologin, sin home). `/opt` y `/etc`
   de staging como `root:ponquesito-staging 750`; `/var/lib/ponquesito-staging`
   e `images` como `ponquesito-staging 700`.
2. `backend.env` con secretos nuevos (`root:ponquesito-staging 640`), que
   nunca se muestran. Si ya existe completo, se conserva.
3. Rol `ponquesito_staging`: `LOGIN NOSUPERUSER INHERIT NOCREATEDB NOCREATEROLE
   NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20`. La contraseña se envía como
   verificador SCRAM, así que el texto claro no llega al servidor ni a sus logs.
4. `CREATE DATABASE ponquesito_staging OWNER ponquesito_staging TEMPLATE template0`
   UTF8, `en_US.UTF-8`, libc; `REVOKE ALL ON DATABASE … FROM PUBLIC`;
   `GRANT CONNECT, TEMPORARY … TO ponquesito_staging`. ACL resultante:
   `{ponquesito_staging=CTc/ponquesito_staging}`.
5. `pg_restore --no-owner --no-acl --role=ponquesito_staging --single-transaction`
   sin `--create`, solo si la base está vacía.
6. Huellas: las 9 tablas deben coincidir exactamente con `huellas-antes.txt`, y
   el catálogo con `8a2f0f7d…`, que es el del respaldo con el propietario y el
   ACL de staging.
7. Aislamiento: sin `CONNECT`/`CREATE`/`TEMP` cruzados, sin pertenencias de rol,
   sin ACL ni objetos del otro rol en cada base. Además, una conexión real por TCP:
   `ponquesito_staging` → `ponquesito` debe dar `permission denied for database`.
8. Código en `releases/<SHA>` y `current`. venv con
   `pip --no-index --require-hashes`; los paquetes deben ser exactamente los
   esperados.
9. Migraciones como `ponquesito-staging`. Django debe conectarse a
   `ponquesito_staging ponquesito_staging 5432`. Muestra `migrate --plan` y
   migra solo si el plan es exactamente `commerce.0001`–`0004`. Si el plan está
   vacío, comprueba que las 4 ya estén aplicadas; con cualquier otro plan, se
   detiene sin migrar.
10. Unidad habilitada e iniciada; `/health/` con BD; escucha solo en
    `127.0.0.1:8001`; la API responde 401 sin credencial y 200 con ella.

Al final repite la foto de producción y falla si algo cambió. Deja la evidencia
en `~/fp-staging/evidencia-<UTC>-aplicar/` (sin secretos) y la clave interna
en `~/fp-staging/entrega/internal-api-key` (600), para copiarla y borrarla.

La evidencia se sella al salir, por cualquier camino (éxito, bloqueo o fallo):
primero se cierra el registro (la salida vuelve a la terminal y se espera a
`tee`) y después se calcula `SHA256SUMS`. La terminal muestra entonces
`Evidencia sellada: …/SHA256SUMS`, que no queda en `registro.txt`. Para
verificarla: `cd <evidencia> && sha256sum --strict -c SHA256SUMS`.

La primera ejecución real (`evidencia-20261018T162130Z-aplicar`) se selló antes
del resumen final, así que su `registro.txt` no verifica. Sus primeras 109
líneas (7378 bytes) sí coinciden con el hash sellado; las 20 siguientes son el
resumen («Cambios hechos…» y «Staging listo…»). La explicación está junto a la
copia privada (`VERIFICACION-evidencia-20261018T162130Z.txt`), y esa evidencia
se conserva sin tocar.

Puede volver a ejecutarse: lo que ya existe y es suyo se reutiliza. Un fallo a
mitad deja los cambios hechos listados y no revierte nada.

## Procedimiento

En local:

```bash
deploy/staging/empaquetar.sh <dir-nuevo>
rsync -a --chmod=D700,F600 -e "ssh -i ~/.ssh/familia_ponquesito" <dir-nuevo>/ wilfredo@37.27.149.66:fp-staging/
```

En el VPS, en una terminal de `wilfredo`:

```bash
cd ~/fp-staging
sudo bash ./preparar-staging.sh --comprobar   # opcional, solo lectura
sudo bash ./preparar-staging.sh --aplicar
```

En local, después: traer la evidencia y los ajustes, mover la clave a
almacenamiento privado (600), borrarla del VPS y probar por túnel:

```bash
deploy/staging/probar-tunel.sh <clave-privada>
```

## Retirada manual (no automatizada)

En este orden, revisando cada paso. Ninguno toca producción.

```bash
sudo systemctl disable --now ponquesito-staging-backend.service
sudo rm /etc/systemd/system/ponquesito-staging-backend.service && sudo systemctl daemon-reload
sudo -u postgres psql -c 'DROP DATABASE ponquesito_staging' -c 'DROP ROLE ponquesito_staging'
sudo rm -r /opt/ponquesito-staging /etc/ponquesito-staging /var/lib/ponquesito-staging
sudo userdel ponquesito-staging
```

## Probado

```bash
deploy/staging/test/sim/crear.sh <respaldo-local> <paquete>
deploy/staging/test/regresion-rutas.sh
```

En una simulación del VPS: Ubuntu 26.04 con systemd, PostgreSQL
`18.6-0ubuntu0.26.04.1`, Python 3.14.4, el mismo `pg_hba`, `ponquesito` restaurada
del respaldo real con su ACL y servicios de producción ficticios en 8000 y 3000.

- Pasada completa: código 0 en unos 23 s; producción idéntica antes y después.
- Regresión de rutas (24 casos), con los antecesores como en el VPS (`/` y
  `/home` root 755, `/home/wilfredo` 750, `fp-staging` 700). Origen: el primer
  intento real con `cd ~/fp-staging && sudo bash ./preparar-staging.sh` se
  bloqueó con «/ debe ser de wilfredo», porque `$0` relativo se resolvía después
  de `cd /`.
- Sellado, en los 14 casos que escriben evidencia (comprobación, bloqueos y
  `--aplicar` dos veces): `SHA256SUMS` verifica, también un segundo después, y
  lista exactamente los archivos; `registro.txt` contiene el mensaje final y no
  la línea del sello. Control negativo: con el script anterior, la evidencia de
  `--aplicar` no verifica.
- Nueva ejecución tras completar: código 0, nada que migrar.
- Reanudación después de un fallo a mitad: continúa.
- Bloqueos con código 2 y nada cambiado: rol, base o `/opt` ajenos con el
  mismo nombre, puerto 8001 ocupado, ajuste por rol en `ponquesito_app` (en el
  archivo aparecen el nombre y el hash, nunca el valor) y paquete manipulado.
- Plan de migración distinto del previsto: se detiene sin migrar.
- Túnel SSH real: `probar-tunel.sh` pasa 7/7 dos veces seguidas, con correos
  solo a `.invalid` y sin red externa. Imágenes 0600 del usuario de staging; el
  journal no contiene firmas, tokens ni la clave.

- Fallo dentro de una redirección (`{ …; } >archivo`): termina con código 1, el
  fallo queda en el registro y la evidencia se sella. Antes del arreglo, el
  sellado esperaba a `tee` y se quedaba bloqueado.

No probado en este paso: TLS/Caddy y Vercel (ver [README-https.md](README-https.md)),
Gmail ni Gemini. El VPS real: aplicado el 2026-10-18 (evidencia
`evidencia-20261018T162130Z-aplicar`) y probado por túnel, 7/7.
