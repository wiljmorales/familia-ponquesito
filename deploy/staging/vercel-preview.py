#!/usr/bin/env python3
"""Variables de Vercel Preview para la rama de staging.

  python3 -I deploy/staging/vercel-preview.py revisar           (solo lectura)
  python3 -I deploy/staging/vercel-preview.py aplicar
  python3 -I deploy/staging/vercel-preview.py canonica https://<alias-de-rama>
  python3 -I deploy/staging/vercel-preview.py revertir <evidencia-de-aplicar>

- La rama recibe exactamente las variables de vercel-preview.env.example.
  Los «<…>» se leen de los archivos privados (SECRETOS) y se guardan como
  Sensitive; los valores nunca pasan por argv ni se imprimen.
- Las variables de Preview para TODAS las ramas (gitBranch vacío) se aparcan
  en la rama RESGUARDO: así la rama no hereda nada, sin depender de que una
  variable de rama sobrescriba a la general y sin borrar valores que Vercel no
  deja leer. `revertir` las devuelve a todas las ramas.
- Vercel solo acepta variables de una rama que ya está en GitHub, y el push
  despliega solo. Orden: `aplicar` (aparca; sin la rama en GitHub se detiene
  ahí, código 3), push, `aplicar` (crea), `canonica` y redespliegue. Bloquea
  cualquier despliegue de la rama que pudo heredar variables generales: si
  aún las hay, o si es anterior al aparcamiento.
- Nunca se toca una variable con target production o development.
- Evidencia (solo nombres, ids, tipos y alcance) en EVIDENCIAS/vercel-<UTC>-<modo>.
Códigos: 0 listo, 3 cambios pendientes (los hace `aplicar`), 2 bloqueo.
"""
import hashlib, json, os, re, secrets, subprocess, sys, time
from pathlib import Path

CLI = "vercel@62.2.0"
PROYECTO = "prj_zxK7ts18LEujWWrBbtY28ZgKlEcp"
EQUIPO = "team_T8pirYVPOiiNziT1jvYOyAOK"
REPO = ("wiljmorales", "familia-ponquesito")
RAMA = "feature/supabase-to-django-local"
RESGUARDO = "reto-8/agenda-ponquesito"
RAIZ = Path(__file__).resolve().parents[2]
EJEMPLO = RAIZ / "deploy/staging/vercel-preview.env.example"
PRIVADO = Path(os.environ.get("FP_PRIVADO", RAIZ.parent / "respaldos-privado/staging-vps"))
SECRETOS = PRIVADO / "secretos"
# clave → (archivo privado, longitud en hex); CRON_SECRET se genera si falta.
ARCHIVOS = {
    "PONQUESITO_INTERNAL_API_KEY": ("internal-api-key", 64),
    "SMTP_APP_PASSWORD": ("mailpit-smtp-password", 48),
    "CRON_SECRET": ("vercel-preview-cron-secret", 64),
}
ALIAS = re.compile(r"^https://familia-ponquesito-git-[a-z0-9-]+-wiljmorales-projects\.vercel\.app$")
registro = []
ESTADO = {"en_github": False}


def di(msg=""):
    print(msg, flush=True)
    registro.append(msg)


class Bloqueo(Exception):
    pass


def api(ruta, metodo="GET", cuerpo=None):
    sep = "&" if "?" in ruta else "?"
    cmd = ["npx", "--no-install", CLI, "api", f"{ruta}{sep}teamId={EQUIPO}", "--raw", "--non-interactive"]
    if metodo != "GET":
        cmd += ["-X", metodo]
    if metodo == "DELETE":
        cmd.append("--dangerously-skip-permissions")
    if cuerpo is not None:
        cmd += ["--input", "-"]
    p = subprocess.run(cmd, input=None if cuerpo is None else json.dumps(cuerpo), capture_output=True, text=True,
                       cwd=RAIZ, env={**os.environ, "VERCEL_TELEMETRY_DISABLED": "1"}, timeout=120)
    try:
        d = json.loads(p.stdout) if p.stdout.strip() else {}
    except ValueError:
        d = {}
    if p.returncode != 0 or (isinstance(d, dict) and "error" in d):
        e = d.get("error", {}) if isinstance(d, dict) else {}
        msg = e.get("message") or (p.stderr.strip().splitlines() or [""])[-1][:300]
        raise Bloqueo(f"API {metodo} {ruta.split('?')[0]}: {e.get('code', p.returncode)} {msg}".strip())
    return d


def esperado():
    """Variables de la rama según el ejemplo: clave → (valor o None si es secreto, tipo)."""
    r = {}
    for linea in EJEMPLO.read_text().splitlines():
        m = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", linea)
        if m:
            secreto = re.fullmatch(r"<[^>]*>", m[2]) is not None
            if secreto and m[1] not in ARCHIVOS:
                raise Bloqueo(f"{m[1]} es secreto en el ejemplo pero no tiene archivo privado")
            r[m[1]] = (None, "sensitive") if secreto else (m[2], "encrypted")
    return r


def valor_ok(clave, actual, previsto):
    """APP_CANONICAL_URL vale el origen inerte del ejemplo o, tras `canonica`, el alias de la rama."""
    return actual == previsto or (clave == "APP_CANONICAL_URL" and bool(ALIAS.fullmatch(actual or "")))


def valor_de(e):
    return api(f"/v1/projects/{PROYECTO}/env/{e['id']}").get("value")


def secreto(clave, generar=False):
    nombre, largo = ARCHIVOS[clave]
    f = SECRETOS / nombre
    if not f.exists() and generar and clave == "CRON_SECRET":
        fd = os.open(f, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as h:
            h.write(secrets.token_hex(32) + "\n")
        di(f"   generado {f} (600)")
    if not f.exists():
        return None, f"falta {f}"
    if f.stat().st_mode & 0o077:
        return None, f"{f} no tiene permisos 600"
    v = f.read_text().strip()
    if not re.fullmatch(rf"[0-9a-f]{{{largo}}}", v):
        return None, f"{f} no son {largo} caracteres hexadecimales"
    return v, None


def variables():
    return api(f"/v10/projects/{PROYECTO}/env")["envs"]


def meta(e):
    return {k: e.get(k) for k in ("id", "key", "target", "gitBranch", "type", "customEnvironmentIds", "updatedAt")}


def no_preview(envs):
    return sorted((meta(e) for e in envs if e.get("target") != ["preview"]), key=lambda e: e["id"])


def revisar():
    """Devuelve (bloqueos, pendientes, envs)."""
    bloqueos, pendientes = [], []
    v = subprocess.run(["npx", "--no-install", CLI, "--version"], capture_output=True, text=True, cwd=RAIZ,
                       env={**os.environ, "VERCEL_TELEMETRY_DISABLED": "1"}).stdout
    if CLI.split("@")[1] not in v:
        bloqueos.append(f"la CLI no es {CLI}")
    p = api(f"/v9/projects/{PROYECTO}")
    link = p.get("link") or {}
    di(f"proyecto {p['name']}: {link.get('type')} {link.get('org')}/{link.get('repo')}, producción ← {link.get('productionBranch')}, "
       f"Node {p.get('nodeVersion')}, raíz {p.get('rootDirectory') or '/'}, protección {(p.get('ssoProtection') or {}).get('deploymentType')}")
    if (link.get("type"), link.get("org"), link.get("repo"), link.get("productionBranch")) != ("github", *REPO, "main"):
        bloqueos.append("el proyecto no está vinculado a github wiljmorales/familia-ponquesito con producción en main")
    if (p.get("ssoProtection") or {}).get("deploymentType") not in ("all_except_custom_domains", "all", "preview"):
        bloqueos.append("Preview sin Vercel Authentication (Standard Protection)")
    if p.get("rootDirectory") or p.get("framework") != "nextjs":
        bloqueos.append("el proyecto no es Next.js en la raíz del repositorio")
    ramas = subprocess.run(["git", "ls-remote", "--heads", "origin", RAMA, RESGUARDO], capture_output=True, text=True, cwd=RAIZ)
    if ramas.returncode != 0:
        bloqueos.append("git ls-remote origin falló")
    ESTADO["en_github"] = f"refs/heads/{RAMA}" in ramas.stdout
    if f"refs/heads/{RESGUARDO}" not in ramas.stdout:
        bloqueos.append(f"la rama de resguardo {RESGUARDO} no está en GitHub")
    despl = api(f"/v6/deployments?projectId={PROYECTO}&limit=100").get("deployments", [])
    propios = [d for d in despl if (d.get("meta") or {}).get("githubCommitRef") == RAMA]

    envs = variables()
    generales = [e for e in envs if "preview" in (e.get("target") or []) and not e.get("gitBranch")]
    aparcado = max((e.get("updatedAt") or 0 for e in envs if e.get("gitBranch") == RESGUARDO), default=0)
    for d in propios:
        creado = d.get("createdAt") or d.get("created") or 0
        di(f"despliegue de {RAMA}: {d.get('uid')} {d.get('state') or d.get('readyState')} "
           f"{(d.get('meta') or {}).get('githubCommitSha', '')[:7]} {time.strftime('%FT%TZ', time.gmtime(creado / 1000))}")
        if modo in ("revisar", "aplicar") and (generales or creado <= aparcado):
            bloqueos.append(f"el despliegue {d.get('uid')} pudo heredar variables generales de Preview")
    for e in generales:
        if e["target"] != ["preview"] or e.get("customEnvironmentIds"):
            bloqueos.append(f"{e['key']} general de Preview comparte entrada con {e['target']}: no se aparca")
        else:
            pendientes.append(f"aparcar {e['key']} ({e['type']}) de «todas las ramas» en {RESGUARDO}")
    exp = esperado()
    rama = {e["key"]: e for e in envs if e.get("gitBranch") == RAMA}
    for k in sorted(set(rama) - set(exp)):
        bloqueos.append(f"{k} existe para {RAMA} y no está en el ejemplo")
    for k, (valor, tipo) in exp.items():
        if valor is None:
            _, error = secreto(k)
            if error and not (k == "CRON_SECRET" and error.startswith("falta")):
                bloqueos.append(error)
        e = rama.get(k)
        if not e:
            pendientes.append(f"crear {k} para {RAMA} ({tipo})" + ("" if ESTADO["en_github"] else ", tras el push"))
        elif e["type"] != tipo or e["target"] != ["preview"]:
            bloqueos.append(f"{k} de {RAMA} es {e['type']} {e['target']}, se esperaba {tipo} [preview]")
        elif valor is not None and not valor_ok(k, valor_de(e), valor):
            pendientes.append(f"corregir el valor de {k} para {RAMA}")
    di(f"variables: {len(envs)}; generales de Preview: {len(generales)}; de {RAMA}: {len(rama)}/{len(exp)}; "
       f"production/development (no se tocan): {len(no_preview(envs))}")
    return bloqueos, pendientes, envs


def evidencia(nombre, datos):
    (EVID / nombre).write_text(json.dumps(datos, indent=1, ensure_ascii=False) + "\n")


def sellar():
    (EVID / "registro.txt").write_text("\n".join(registro) + "\n")
    sumas = "".join(f"{hashlib.sha256(f.read_bytes()).hexdigest()}  {f.name}\n"
                    for f in sorted(EVID.iterdir()) if f.name != "SHA256SUMS")
    (EVID / "SHA256SUMS").write_text(sumas)
    print(f"evidencia: {EVID} (SHA256SUMS {hashlib.sha256(sumas.encode()).hexdigest()})")


def comprobar_final(antes):
    envs = variables()
    exp = esperado()
    rama = {e["key"]: e for e in envs if e.get("gitBranch") == RAMA}
    fallos = []
    if [e for e in envs if "preview" in (e.get("target") or []) and not e.get("gitBranch")]:
        fallos.append("quedan variables generales de Preview")
    if set(rama) != set(exp):
        fallos.append(f"la rama tiene {sorted(rama)}")
    for k, (valor, tipo) in exp.items():
        e = rama.get(k)
        if e and (e["type"] != tipo or (valor is not None and not valor_ok(k, valor_de(e), valor))):
            fallos.append(f"{k}: tipo o valor distinto")
    if no_preview(envs) != no_preview(antes):
        fallos.append("cambiaron variables de production/development")
    for f in fallos:
        di(f"   FALLO {f}")
    di(f"   {'ok' if not fallos else 'FALLO'}   rama con {len(rama)} variables exactas, 0 generales de Preview, "
       f"production/development intactas ({len(no_preview(envs))})")
    evidencia("despues.json", [meta(e) for e in envs])
    return not fallos


def aplicar(envs):
    exp = esperado()
    hechos = {"aparcadas": [], "creadas": [], "corregidas": []}
    evidencia("antes.json", [meta(e) for e in envs])
    for e in envs:
        if e.get("target") == ["preview"] and not e.get("gitBranch"):
            api(f"/v9/projects/{PROYECTO}/env/{e['id']}", "PATCH", {"gitBranch": RESGUARDO})
            hechos["aparcadas"].append({"id": e["id"], "key": e["key"]})
            evidencia("hechos.json", hechos)
            di(f"   aparcada {e['key']} → {RESGUARDO}")
    rama = {e["key"]: e for e in envs if e.get("gitBranch") == RAMA}
    evidencia("hechos.json", hechos)
    if not ESTADO["en_github"] and set(exp) - set(rama):
        evidencia("despues.json", [meta(e) for e in variables()])
        di(f"   0 generales de Preview; {RAMA} no está en GitHub y Vercel no acepta aún sus variables:")
        di("   haz el push (desplegará sin variables heredadas) y vuelve a ejecutar `aplicar`.")
        return 3
    for k, (valor, tipo) in exp.items():
        if valor is None:
            valor, error = secreto(k, generar=True)
            if error:
                raise Bloqueo(error)
        if k in rama:
            if tipo == "encrypted" and not valor_ok(k, valor_de(rama[k]), valor):
                api(f"/v9/projects/{PROYECTO}/env/{rama[k]['id']}", "PATCH", {"value": valor})
                hechos["corregidas"].append({"id": rama[k]["id"], "key": k})
                di(f"   corregida {k}")
            continue
        r = api(f"/v10/projects/{PROYECTO}/env", "POST",
                {"key": k, "value": valor, "type": tipo, "target": ["preview"], "gitBranch": RAMA})
        if r.get("failed"):
            raise Bloqueo(f"no se creó {k}: {[x.get('error', {}).get('code') for x in r['failed']]}")
        creada = r.get("created")
        creada = creada[0] if isinstance(creada, list) else creada
        hechos["creadas"].append({"id": creada.get("id"), "key": k})
        evidencia("hechos.json", hechos)
        di(f"   creada {k} ({tipo})")
    evidencia("hechos.json", hechos)
    return 0 if comprobar_final(envs) else 1


def canonica(url, envs):
    if not ALIAS.fullmatch(url):
        raise Bloqueo("no es un alias https://familia-ponquesito-git-…-wiljmorales-projects.vercel.app")
    a = api(f"/v4/aliases/{url.removeprefix('https://')}")
    d = api(f"/v13/deployments/{a['deploymentId']}")
    if (d.get("meta") or {}).get("githubCommitRef") != RAMA or d.get("target") not in (None, "preview"):
        raise Bloqueo(f"el alias no apunta a un despliegue Preview de {RAMA}")
    e = next((e for e in envs if e.get("gitBranch") == RAMA and e["key"] == "APP_CANONICAL_URL"), None)
    if not e:
        raise Bloqueo("falta APP_CANONICAL_URL de la rama: ejecuta `aplicar` antes")
    evidencia("antes.json", [meta(x) for x in envs])
    api(f"/v9/projects/{PROYECTO}/env/{e['id']}", "PATCH", {"value": url})
    ok = valor_de(e) == url and comprobar_final(envs)
    di(f"   {'ok' if ok else 'FALLO'}   APP_CANONICAL_URL = {url}; redespliega la rama para que se aplique")
    return ok


def revertir(origen, envs):
    hechos = json.loads((Path(origen) / "hechos.json").read_text())
    evidencia("antes.json", [meta(e) for e in envs])
    ids = {e["id"]: e for e in envs}
    for h in hechos["creadas"]:
        if h["id"] in ids and ids[h["id"]].get("gitBranch") == RAMA:
            api(f"/v9/projects/{PROYECTO}/env/{h['id']}", "DELETE")
            di(f"   borrada {h['key']} de {RAMA}")
    for h in hechos["aparcadas"]:
        if h["id"] in ids and ids[h["id"]].get("gitBranch") == RESGUARDO:
            api(f"/v9/projects/{PROYECTO}/env/{h['id']}", "PATCH", {"gitBranch": None})
            di(f"   devuelta {h['key']} a todas las ramas de Preview")
    despues = variables()
    ok = no_preview(despues) == no_preview(envs)
    evidencia("despues.json", [meta(e) for e in despues])
    di(f"   {'ok' if ok else 'FALLO'}   production/development intactas")
    return ok


if __name__ == "__main__":
    modo = sys.argv[1] if len(sys.argv) > 1 else ""
    if modo not in ("revisar", "aplicar", "canonica", "revertir") or (modo in ("canonica", "revertir")) != (len(sys.argv) == 3):
        sys.exit(__doc__)
    base = f"vercel-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{modo}"
    for n in range(100):
        EVID = PRIVADO / (base if n == 0 else f"{base}-{n}")
        try:
            EVID.mkdir(mode=0o700)
            break
        except FileExistsError:
            continue
    di(f"Vercel Preview ({modo}) para {RAMA}")
    codigo = 2
    try:
        bloqueos, pendientes, envs = revisar()
        for b in bloqueos:
            di(f"   BLOQUEO {b}")
        for c in pendientes:
            di(f"   pendiente: {c}")
        if modo == "revertir":
            codigo = 0 if revertir(sys.argv[2], envs) else 1
        elif bloqueos:
            di("Bloqueado: nada se ha cambiado.")
        elif modo == "revisar":
            codigo = 3 if pendientes else 0
            di("Revisión: " + ("cambios pendientes; los hace `aplicar`." if pendientes else "listo para el push.") + " Nada se ha cambiado.")
        elif modo == "aplicar":
            codigo = aplicar(envs)
        else:
            codigo = 0 if canonica(sys.argv[2], envs) else 1
    except Bloqueo as b:
        di(f"   BLOQUEO {b}")
    finally:
        sellar()
    sys.exit(codigo)
