#!/usr/bin/env python3
"""Regresión de vercel-preview.py sin red ni Vercel: `npx` y `git` falsos en
PATH emulan la API (con el estado del proyecto real: 13 variables generales de
Preview, 13 de producción y APP_CANONICAL_URL de reto-8) y `git ls-remote`.
Comprueba bloqueos sin cambios, aplicar idempotente, canonica, revertir, que
production no cambia y que ningún secreto sale por argv, salida o evidencia.
Uso: python3 -I deploy/staging/test/regresion-vercel-preview.py
"""
import json, os, re, stat, subprocess, sys, tempfile, textwrap
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
HERRAMIENTA = RAIZ / "deploy/staging/vercel-preview.py"
RAMA = "feature/supabase-to-django-local"
ALIAS = "familia-ponquesito-git-feature-0a1b2c-wiljmorales-projects.vercel.app"

FALSO = textwrap.dedent(r'''
    #!/usr/bin/env python3
    import json, os, sys, urllib.parse
    E = os.environ["FP_FALSO_ESTADO"]
    s = json.load(open(E))
    open(os.environ["FP_FALSO_ARGV"], "a").write(json.dumps(sys.argv) + "\n")
    def fin(d, codigo=0):
        json.dump(s, open(E, "w")); print(json.dumps(d)); sys.exit(codigo)
    if os.path.basename(sys.argv[0]) == "git":
        a = sys.argv[1:]
        assert a[:3] == ["ls-remote", "--heads", "origin"], a
        print("".join(f"0000\trefs/heads/{r}\n" for r in s["remotas"] if r in a[3:])); sys.exit(0)
    a = sys.argv[1:]
    assert a[:2] == ["--no-install", "vercel@62.2.0"], a
    if a[2] == "--version":
        print("Vercel CLI 62.2.0"); sys.exit(0)
    assert a[2] == "api" and "--raw" in a and "--non-interactive" in a, a
    u = urllib.parse.urlsplit(a[3]); q = urllib.parse.parse_qs(u.query); r = u.path.split("/")[1:]
    assert q["teamId"] == ["team_T8pirYVPOiiNziT1jvYOyAOK"], a
    m = a[a.index("-X") + 1] if "-X" in a else "GET"
    assert (m == "DELETE") == ("--dangerously-skip-permissions" in a), a
    cuerpo = json.loads(sys.stdin.read()) if "--input" in a else None
    envs = s["envs"]; por_id = {e["id"]: e for e in envs}
    sin_valor = lambda e: {k: v for k, v in e.items() if k != "value"}
    err = lambda c: fin({"error": {"code": c, "message": c}}, 1)
    if m == "GET" and r == ["v9", "projects", s["proyecto"]["id"]]: fin(s["proyecto"])
    if m == "GET" and r == ["v6", "deployments"]: fin({"deployments": s["despliegues"]})
    if m == "GET" and r[:2] == ["v4", "aliases"]:
        fin(s["aliases"][r[2]]) if r[2] in s["aliases"] else err("not_found")
    if m == "GET" and r[:2] == ["v13", "deployments"]:
        fin(next(d for d in s["despliegues"] if d["uid"] == r[2]))
    if r[:3] == ["v10", "projects", s["proyecto"]["id"]] and r[3:] == ["env"]:
        if m == "GET": fin({"envs": [sin_valor(e) for e in envs]})
        if m == "POST":
            c = cuerpo
            if c.get("gitBranch") and c["gitBranch"] not in s["remotas"]:
                # Como la API real: 400, mensaje en stderr y nada en stdout.
                rama = c["gitBranch"]
                print(f'Error: Branch "{rama}" not found in the connected Git repository. (400)', file=sys.stderr)
                sys.exit(1)
            if any(e["key"] == c["key"] and e.get("gitBranch") == c.get("gitBranch") and set(e["target"]) & set(c["target"]) for e in envs):
                err("ENV_ALREADY_EXISTS")
            s["reloj"] += 1; e = {**c, "id": f"nuevo{len(envs)}", "updatedAt": s["reloj"]}; envs.append(e)
            fin({"created": sin_valor(e), "failed": []})
    if r[:3] == ["v1", "projects", s["proyecto"]["id"]] and m == "GET":
        e = por_id[r[4]]; fin({**sin_valor(e), "value": "" if e["type"] == "sensitive" else e["value"]})
    if r[:3] == ["v9", "projects", s["proyecto"]["id"]] and r[3] == "env":
        e = por_id.get(r[4]) or err("not_found")
        if m == "DELETE": envs.remove(e); fin(sin_valor(e))
        if m == "PATCH":
            if cuerpo.get("gitBranch") and e["target"] != ["preview"]: err("bad_request")
            s["reloj"] += 1; e.update(cuerpo); e["updatedAt"] = s["reloj"]; fin(sin_valor(e))
    err("ruta_desconocida")
''').lstrip()


def inicial():
    general = ["CRON_SECRET", "EMAIL_FROM", "GEMINI_API_KEY", "GEMINI_MODEL", "KAREM_NOTIFICATION_EMAIL",
               "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SMTP_APP_PASSWORD", "SMTP_HOST",
               "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SUPABASE_SERVICE_ROLE_KEY"]
    envs = [{"id": f"p{i}", "key": k, "value": f"prod-{k}", "type": "sensitive", "target": ["production"],
             "gitBranch": None, "updatedAt": 1} for i, k in enumerate(general)]
    envs += [{"id": f"g{i}", "key": k, "value": f"general-{k}", "type": "sensitive", "target": ["preview"],
              "gitBranch": None, "updatedAt": 1} for i, k in enumerate(general)]
    envs.append({"id": "r8", "key": "APP_CANONICAL_URL", "value": "https://reto8.example", "type": "encrypted",
                 "target": ["preview"], "gitBranch": "reto-8/agenda-ponquesito", "updatedAt": 1})
    return {
        "proyecto": {"id": "prj_zxK7ts18LEujWWrBbtY28ZgKlEcp", "name": "familia-ponquesito", "framework": "nextjs",
                     "rootDirectory": None, "nodeVersion": "24.x",
                     "ssoProtection": {"deploymentType": "all_except_custom_domains"},
                     "link": {"type": "github", "org": "wiljmorales", "repo": "familia-ponquesito", "productionBranch": "main"}},
        "envs": envs, "remotas": ["main", "reto-8/agenda-ponquesito"], "aliases": {}, "reloj": 100,
        "despliegues": [{"uid": "dpl_main", "target": "production", "createdAt": 50, "meta": {"githubCommitRef": "main"}}],
    }


class Caso:
    def __init__(self, tmp):
        self.tmp = tmp
        self.estado = tmp / "estado.json"
        self.argv = tmp / "argv.log"
        self.privado = tmp / "privado"
        (self.privado / "secretos").mkdir(parents=True, mode=0o700)
        self.secretos = {"internal-api-key": "a" * 63 + "1", "mailpit-smtp-password": "b" * 47 + "2"}
        for n, v in self.secretos.items():
            f = self.privado / "secretos" / n
            f.write_text(v + "\n"); f.chmod(0o600)
        bin_ = tmp / "bin"; bin_.mkdir()
        for n in ("npx", "git"):
            (bin_ / n).write_text(FALSO); (bin_ / n).chmod(0o755)
        self.env = {**os.environ, "PATH": f"{bin_}:{os.environ['PATH']}", "FP_PRIVADO": str(self.privado),
                    "FP_FALSO_ESTADO": str(self.estado), "FP_FALSO_ARGV": str(self.argv)}
        self.poner(inicial())

    def poner(self, s):
        self.estado.write_text(json.dumps(s))

    def leer(self):
        return json.loads(self.estado.read_text())

    def correr(self, *args):
        p = subprocess.run([sys.executable, "-I", str(HERRAMIENTA), *args], env=self.env, capture_output=True, text=True, timeout=120)
        self.ultima = p.stdout + p.stderr
        m = re.search(r"evidencia: (\S+)", p.stdout)
        self.evid = Path(m[1]) if m else None
        return p.returncode


resultados = []


def caso(nombre, cond):
    resultados.append(cond)
    print(f"   {'ok  ' if cond else 'FALLO'} {nombre}")


def huella(s):
    return sorted((e["id"], e["key"], tuple(e["target"]), e.get("gitBranch"), e["type"], e.get("value")) for e in s["envs"])


def produccion(s):
    return [x for x in huella(s) if x[2] != ("preview",)]


def rama(s):
    return {e["key"]: e for e in s["envs"] if e.get("gitBranch") == RAMA}


with tempfile.TemporaryDirectory() as t:
    c = Caso(Path(t))
    s0 = c.leer()

    # Bloqueos: código 2 y ninguna llamada de escritura.
    def bloqueo(nombre, cambiar, texto):
        c.poner(inicial()); cambiar()
        antes = huella(c.leer())
        n = c.correr("aplicar")
        caso(f"bloqueo {nombre}: código 2, sin cambios", n == 2 and huella(c.leer()) == antes and texto in c.ultima)

    def permisos():
        (c.privado / "secretos/mailpit-smtp-password").chmod(0o644)
    bloqueo("secreto con permisos 644", permisos, "no tiene permisos 600")
    (c.privado / "secretos/mailpit-smtp-password").chmod(0o600)

    def corto():
        (c.privado / "secretos/internal-api-key").write_text("abc\n")
    bloqueo("clave interna que no son 64 hex", corto, "no son 64 caracteres")
    (c.privado / "secretos/internal-api-key").write_text(c.secretos["internal-api-key"] + "\n")

    def desplegada():
        s = c.leer(); s["remotas"].append(RAMA)
        s["despliegues"].append({"uid": "d1", "target": None, "createdAt": 200, "meta": {"githubCommitRef": RAMA}}); c.poner(s)
    bloqueo("despliegue de la rama con variables generales aún presentes", desplegada, "pudo heredar")

    def anterior():
        s = c.leer(); s["remotas"].append(RAMA)
        for e in s["envs"]:
            if e["target"] == ["preview"] and not e["gitBranch"]:
                e["gitBranch"] = "reto-8/agenda-ponquesito"; e["updatedAt"] = 300
        s["despliegues"].append({"uid": "d1", "target": None, "createdAt": 250, "meta": {"githubCommitRef": RAMA}}); c.poner(s)
    bloqueo("despliegue anterior al aparcamiento", anterior, "pudo heredar")

    def compartida():
        s = c.leer(); s["envs"][13]["target"] = ["preview", "development"]; c.poner(s)
    bloqueo("variable general compartida con development", compartida, "comparte entrada")

    def ajena():
        s = c.leer(); s["envs"].append({"id": "x", "key": "GEMINI_API_KEY", "value": "k", "type": "sensitive",
                                         "target": ["preview"], "gitBranch": RAMA, "updatedAt": 1}); c.poner(s)
    bloqueo("variable de la rama fuera del ejemplo", ajena, "no está en el ejemplo")

    def sin_proteccion():
        s = c.leer(); s["proyecto"]["ssoProtection"] = None; c.poner(s)
    bloqueo("Preview sin Vercel Authentication", sin_proteccion, "Standard Protection")

    def sin_resguardo():
        s = c.leer(); s["remotas"].remove("reto-8/agenda-ponquesito"); c.poner(s)
    bloqueo("rama de resguardo ausente", sin_resguardo, "rama de resguardo")

    c.poner(inicial())
    n = c.correr("revisar")
    caso("revisar: código 3, 13 por aparcar y 13 por crear, sin cambios",
         n == 3 and c.ultima.count("pendiente: aparcar") == 13 and c.ultima.count("pendiente: crear") == 13
         and huella(c.leer()) == huella(s0))
    revisar_evid = c.evid
    caso("revisar: evidencia sellada", revisar_evid and subprocess.run(["sha256sum", "-c", "--quiet", "SHA256SUMS"], cwd=revisar_evid).returncode == 0)

    n = c.correr("aplicar")
    s05 = c.leer(); evid_aparcar = c.evid
    posts = [l for l in c.argv.read_text().splitlines() if '"POST"' in l]
    caso("aplicar sin push: código 3, 13 aparcadas, ningún POST, production intacta",
         n == 3 and not posts and not rama(s05) and produccion(s05) == produccion(s0)
         and not [e for e in s05["envs"] if e["target"] == ["preview"] and not e["gitBranch"]]
         and "haz el push" in c.ultima)
    caso("revisar sin push y ya aparcadas: código 3, sin bloqueos",
         c.correr("revisar") == 3 and "BLOQUEO" not in c.ultima and "tras el push" in c.ultima)
    # Push: la rama existe y su primer despliegue es posterior al aparcamiento.
    s = c.leer(); s["remotas"].append(RAMA)
    s["despliegues"].append({"uid": "d_rama", "target": None, "createdAt": s["reloj"] + 1, "meta": {"githubCommitRef": RAMA}})
    c.poner(s)
    n = c.correr("aplicar")
    s1 = c.leer(); r = rama(s1); aplicar_evid = c.evid
    ejemplo = dict(re.findall(r"^([A-Z][A-Z0-9_]*)=(.*)$", (RAIZ / "deploy/staging/vercel-preview.env.example").read_text(), re.M))
    caso("aplicar: código 0", n == 0)
    caso("aplicar tras el push: 0 generales de Preview, 13 aparcadas en reto-8",
         not [e for e in s1["envs"] if e["target"] == ["preview"] and not e["gitBranch"]]
         and sum(e["id"].startswith("g") and e["gitBranch"] == "reto-8/agenda-ponquesito" for e in s1["envs"]) == 13)
    caso("aplicar: la rama tiene exactamente las claves del ejemplo", set(r) == set(ejemplo))
    caso("aplicar: valores de configuración exactos y tipo encrypted",
         all(r[k]["value"] == v and r[k]["type"] == "encrypted" for k, v in ejemplo.items() if not v.startswith("<")))
    cron = (c.privado / "secretos/vercel-preview-cron-secret")
    caso("aplicar: CRON_SECRET nuevo, 64 hex, 600, el del archivo",
         cron.exists() and stat.S_IMODE(cron.stat().st_mode) == 0o600 and re.fullmatch(r"[0-9a-f]{64}\n", cron.read_text())
         and r["CRON_SECRET"]["value"] == cron.read_text().strip())
    caso("aplicar: secretos como sensitive con el contenido de los archivos",
         r["PONQUESITO_INTERNAL_API_KEY"]["value"] == c.secretos["internal-api-key"]
         and r["SMTP_APP_PASSWORD"]["value"] == c.secretos["mailpit-smtp-password"]
         and all(r[k]["type"] == "sensitive" for k in ("PONQUESITO_INTERNAL_API_KEY", "SMTP_APP_PASSWORD", "CRON_SECRET")))
    caso("aplicar: production intacta", produccion(s1) == produccion(s0))
    caso("aplicar: sin GEMINI ni SUPABASE para la rama", not [k for k in r if "GEMINI" in k or "SUPABASE" in k])
    secretos = list(c.secretos.values()) + [cron.read_text().strip()]
    expuesto = [x for x in secretos if x in c.argv.read_text() or x in c.ultima
                or any(x in f.read_text() for f in aplicar_evid.iterdir())]
    caso("aplicar: ningún secreto en argv, salida ni evidencia", not expuesto)

    llamadas = len(c.argv.read_text().splitlines())
    n = c.correr("aplicar")
    escrituras = [l for l in c.argv.read_text().splitlines()[llamadas:] if '"-X"' in l]
    caso("aplicar repetido: código 0 y ninguna escritura", n == 0 and not escrituras and huella(c.leer()) == huella(s1))
    caso("revisar tras aplicar: listo (0)", c.correr("revisar") == 0 and "listo para el push" in c.ultima)

    s = c.leer()
    s["despliegues"] += [{"uid": "d_otra", "target": None, "createdAt": 60, "meta": {"githubCommitRef": "reto-8/agenda-ponquesito"}}]
    s["aliases"] = {ALIAS: {"deploymentId": "d_rama"}, "familia-ponquesito-git-reto-8-wiljmorales-projects.vercel.app": {"deploymentId": "d_otra"}}
    c.poner(s); antes = huella(s)
    caso("canonica: URL que no es alias de rama → 2 sin cambios",
         c.correr("canonica", "https://familia-ponquesito.vercel.app") == 2 and huella(c.leer()) == antes)
    caso("canonica: alias de otra rama → 2 sin cambios",
         c.correr("canonica", "https://familia-ponquesito-git-reto-8-wiljmorales-projects.vercel.app") == 2 and huella(c.leer()) == antes)
    caso("canonica: alias de la rama → 0 y valor puesto",
         c.correr("canonica", f"https://{ALIAS}") == 0 and rama(c.leer())["APP_CANONICAL_URL"]["value"] == f"https://{ALIAS}"
         and produccion(c.leer()) == produccion(s0))
    caso("aplicar tras canonica: sin escrituras, conserva la URL",
         c.correr("aplicar") == 0 and rama(c.leer())["APP_CANONICAL_URL"]["value"] == f"https://{ALIAS}")
    caso("revisar tras canonica: listo (0)", c.correr("revisar") == 0)

    n = c.correr("revertir", str(aplicar_evid))
    s15 = c.leer()
    caso("revertir (evidencia de crear): código 0, rama sin variables", n == 0 and not rama(s15))
    n = c.correr("revertir", str(evid_aparcar))
    s2 = c.leer()
    caso("revertir (evidencia de aparcar): código 0", n == 0)
    caso("revertir: variables generales y production como al inicio",
         sorted(x for x in huella(s2)) == sorted(huella(s0)))
    caso("todas las evidencias sin secretos",
         not [x for x in secretos for d in c.privado.iterdir() if d.is_dir() and d.name.startswith("vercel-")
              for f in d.iterdir() if x in f.read_text()])

print(f"{sum(resultados)}/{len(resultados)} casos")
sys.exit(0 if all(resultados) else 1)
