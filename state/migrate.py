#!/usr/bin/env python3
"""Migración one-shot: backlogs md + GitHub issues → app/state/events/2026-07-import.jsonl

Uso: python3 app/state/migrate.py [--force]
Después: python3 app/state/engine.py rebuild && python3 app/state/engine.py status
"""
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

STATE_DIR = Path(__file__).resolve().parent
APP_DIR = STATE_DIR.parent
VAULT_DIR = APP_DIR.parent / "vault"
EVENTS_DIR = STATE_DIR / "events"
BACKLOGS_DIR = APP_DIR / "docs" / "sprints"
OUT_PATH = EVENTS_DIR / "2026-07-import.jsonl"

SPRINTS = [
    ("S1", "S1-fundacion.md"),
    ("S2", "S2-edificios-unidades.md"),
    ("S3", "S3-gastos-liquidacion.md"),
    ("S4", "S4-usuarios-identidad.md"),
]
PRIORIDAD_PRD = {"P0": 3, "P1": 2, "P2": 1}

ITEM_RE = re.compile(r"^- \[([ xX])\] \*\*(S\d+-\d{2}) (.+?)\.\*\*\s*(.*)$")
HEADER_RE = re.compile(r"^> \*\*(.+?):\*\*\s*(.*)$")
PRD_RE = re.compile(r"PRD-\d{2}-\d{2}")
TASK_REF_RE = re.compile(r"S\d+-\d{2}")
LOTES_RE = re.compile(r"^\*\*Lotes paralelos sugeridos:\*\*\s*(.*)$")


def extraer_prds(texto):
    """PRD-XX-YY mencionados; expande shorthand PRD-07-02/03/04."""
    encontrados = []
    for m in re.finditer(r"PRD-(\d{2})-(\d{2}(?:/\d{2})*)", texto):
        for suf in m.group(2).split("/"):
            encontrados.append(f"PRD-{m.group(1)}-{suf}")
    return list(dict.fromkeys(encontrados))


def parsear_depende(texto, tarea):
    """Extrae spec_ref, depende_de, depende_nota, depende_cola de una línea italic."""
    spec_ref = None
    m = re.match(r"Spec: (.+?)\. Depende de: ", texto)
    if m:
        spec_ref = m.group(1)
        texto = texto[m.end():]
    elif not texto.startswith("Depende de: "):
        return None  # no es línea de dependencia (ej. "Hecho: ...")
    else:
        texto = texto[len("Depende de: "):]
    m = re.match(r"(.+?)\.\s*(.*)$", texto, re.S)
    cuerpo, cola = m.group(1), m.group(2).strip()
    nota = None
    mn = re.match(r"(.+?)\s*\((.+)\)$", cuerpo, re.S)
    if mn:
        cuerpo, nota = mn.group(1), mn.group(2)
    if cuerpo.strip().lower() == "nada":
        deps = []
    else:
        deps = TASK_REF_RE.findall(cuerpo)
        if not deps:
            print(f"  aviso: {tarea['id']} no pude parsear deps de '{cuerpo}'")
    tarea["spec_ref"] = spec_ref
    tarea["depende_de"] = deps
    tarea["depende_nota"] = nota
    tarea["depende_cola"] = cola or None


def parsear_backlog(sid, path):
    lineas = path.read_text(encoding="utf-8").splitlines()
    sprint = {
        "sprint": sid, "slug": path.stem.split("-", 1)[1],
        "titulo": "", "objetivo": None, "specs": None, "modelo": None,
        "fuera_scope": None, "dod": "", "lotes": None,
        "labels": {}, "header_extra": [], "cierre_extra": None,
    }
    tareas = []
    header_texto = []

    m = re.match(rf"^# {sid} — (.+?) \(backlog\)$", lineas[0])
    sprint["titulo"] = m.group(1) if m else path.stem

    i = 1
    while i < len(lineas) and not lineas[i].startswith("## "):
        mh = HEADER_RE.match(lineas[i])
        if not mh:
            i += 1
            continue
        label, texto = mh.group(1).strip(), mh.group(2).strip()
        low = label.lower()
        if low.startswith("objetivo"):
            sprint["objetivo"] = texto
            header_texto.append(texto)
            if label != "Objetivo":
                sprint["labels"]["objetivo"] = label
        elif low.startswith("spec"):
            sprint["specs"] = [texto]
            header_texto.append(texto)
            if label != "Specs":
                sprint["labels"]["specs"] = label
        elif low.startswith("modelo"):
            sprint["modelo"] = texto
            header_texto.append(texto)
            if label != "Modelo":
                sprint["labels"]["modelo"] = label
        elif low.startswith("fuera de scope"):
            # no va a header_texto: lo fuera de scope no es fuente de las tareas
            sprint["fuera_scope"] = texto
            sprint["labels"]["fuera_scope"] = label
        else:
            sprint["header_extra"].append({"label": label, "text": texto})
            header_texto.append(texto)
        i += 1

    seccion = None
    en_dod = False
    dod_lineas, extra_lineas = [], []
    while i < len(lineas):
        linea = lineas[i]
        if linea.startswith("## "):
            nombre = linea[3:].strip()
            if nombre == "Definition of done del sprint":
                en_dod = True
                seccion = None
            elif nombre == "Dependencias entre tareas":
                en_dod = False
                seccion = None
            elif en_dod:
                en_dod = False
                extra_lineas = lineas[i:]
                break
            else:
                seccion = nombre
            i += 1
            continue
        if en_dod:
            dod_lineas.append(linea)
        else:
            ml = LOTES_RE.match(linea)
            if ml:
                sprint["lotes"] = ml.group(1).strip()
            mi = ITEM_RE.match(linea)
            if mi and seccion:
                alcance = mi.group(4).strip()
                tareas.append({
                    "id": mi.group(2), "sprint": sid, "seccion": seccion,
                    "titulo": mi.group(3).strip(), "alcance": alcance,
                    "done_checkbox": mi.group(1).lower() == "x",
                    "depende_de": [], "spec_ref": None, "depende_nota": None,
                    "depende_cola": None, "notas_extra": [],
                })
                # formato inline: `... alcance. _Depende de: X._` en la misma línea
                minline = re.search(
                    r"\s+_((?:Spec: .+?\. )?Depende de: .+?)_\s*$", alcance)
                if minline:
                    tareas[-1]["alcance"] = alcance[:minline.start()].rstrip()
                    parsear_depende(minline.group(1), tareas[-1])
            elif linea.startswith("  - _") and tareas:
                contenido = linea.strip()[3:].strip("_").strip()
                antes = dict(tareas[-1])
                parsear_depende(contenido, tareas[-1])
                if all(tareas[-1][k] == antes[k] for k in
                       ("spec_ref", "depende_de", "depende_nota", "depende_cola")) \
                        and not contenido.startswith(("Depende de:", "Spec:")):
                    tareas[-1]["notas_extra"].append(contenido)
        i += 1

    sprint["dod"] = "\n".join(dod_lineas).strip("\n")
    if extra_lineas:
        sprint["cierre_extra"] = "\n".join(extra_lineas).strip("\n")
    return sprint, tareas, " ".join(header_texto)


def cargar_issues():
    out = subprocess.run(
        ["gh", "issue", "list", "--state", "all", "--limit", "200",
         "--json", "number,title,state,labels"],
        cwd=APP_DIR, capture_output=True, text=True, timeout=60,
    )
    if out.returncode != 0:
        sys.exit(f"error: gh falló: {out.stderr.strip()}")
    return json.loads(out.stdout)


def prioridades_vault():
    prios = {}
    for path in VAULT_DIR.rglob("*.md"):
        m = re.match(r"(PRD-\d{2}-\d{2})\b", path.name)
        if not m:
            continue
        try:
            texto = path.read_text(encoding="utf-8", errors="replace")[:2000]
        except OSError:
            continue
        fm = re.match(r"---\n(.*?)\n---", texto, re.S)
        if fm:
            pm = re.search(r'^priority:\s*"?(P[012])"?', fm.group(1), re.M)
            if pm:
                prios[m.group(1)] = PRIORIDAD_PRD.get(pm.group(1), 1)
    return prios


def main():
    if OUT_PATH.exists() and "--force" not in sys.argv:
        sys.exit(f"error: {OUT_PATH} ya existe; usá --force para regenerarlo")

    prios = prioridades_vault()
    issues = cargar_issues()
    por_tarea = {}
    for issue in issues:
        m = re.match(r"(S\d+-\d{2}):", issue.get("title", ""))
        if m:
            por_tarea.setdefault(m.group(1), []).append(issue)

    ts_base = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    eventos = []
    n = 0
    avisos = []

    def emit(tipo, task=None, data=None, to=None, motivo=None):
        nonlocal n
        n += 1
        ev = {"id": f"evt-{n:06d}", "ts": ts_base, "actor": "migrate", "type": tipo}
        if task:
            ev["task"] = task
        if to:
            ev["to"] = to
        if motivo:
            ev["motivo"] = motivo
        if data:
            ev["data"] = data
        eventos.append(ev)

    for sid, archivo in SPRINTS:
        sprint, tareas, header_texto = parsear_backlog(sid, BACKLOGS_DIR / archivo)
        prds_sprint = extraer_prds(header_texto)
        emit("import_sprint", data=sprint)
        for t in tareas:
            candidatos = por_tarea.get(t["id"], [])
            cerrados = [i for i in candidatos if i["state"] == "CLOSED"]
            elegido = (cerrados or candidatos or [None])[0]
            if len(candidatos) > 1:
                avisos.append(f"{t['id']} tiene {len(candidatos)} issues: "
                              + ", ".join(f"#{i['number']} ({i['state']})" for i in candidatos))
            issue_nro = elegido["number"] if elegido else None
            lote = None
            if elegido:
                for l in elegido["labels"]:
                    if l["name"].startswith("lote:"):
                        lote = l["name"].split(":", 1)[1]
            if not elegido:
                avisos.append(f"{t['id']} sin issue en GitHub")
            done = t["done_checkbox"] or bool(cerrados)

            fuente = extraer_prds(t["alcance"] + " " + (t["spec_ref"] or "")) or prds_sprint
            prioridad = max([prios.get(p, 1) for p in fuente] or [1])

            data = {
                "sprint": t["sprint"], "seccion": t["seccion"],
                "titulo": t["titulo"], "alcance": t["alcance"],
                "depende_de": t["depende_de"], "issue": issue_nro,
                "lote": lote, "fuente": fuente, "done": done,
                "prioridad": prioridad,
            }
            for k in ("spec_ref", "depende_nota", "depende_cola", "notas_extra"):
                if t[k]:
                    data[k] = t[k]
            emit("import_task", task=t["id"], data=data)
            if done:
                emit("status", task=t["id"], to="done",
                     motivo="migración: checkbox/issue cerrado")

    ids_con_tarea = set(por_tarea)
    importados = {ev["task"] for ev in eventos if ev["type"] == "import_task"}
    for tid in sorted(ids_con_tarea - importados):
        nums = ", ".join(f"#{i['number']}" for i in por_tarea[tid])
        avisos.append(f"issue {nums} ({tid}) sin tarea en los backlogs")

    EVENTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        for ev in eventos:
            fh.write(json.dumps(ev, ensure_ascii=False) + "\n")

    print(f"migración ok: {len(eventos)} eventos → {OUT_PATH}")
    print(f"  sprints: {len(SPRINTS)}, tareas: {len(importados)}")
    if avisos:
        print("avisos:")
        for a in avisos:
            print(f"  - {a}")


if __name__ == "__main__":
    main()
