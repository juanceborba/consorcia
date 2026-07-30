#!/usr/bin/env python3
"""Motor de estado de ConsorcIA — event-sourced, stdlib only.

Verdad:  app/state/events/*.jsonl (append-only)
Genera:  app/state/projections/S<n>.yaml
         app/docs/sprints/S<n>-<slug>.md (backlogs)
         vault/00_MOC/Estado de Implementación.md (dashboard)
         app/state/cache.json

Subcomandos: rebuild | status | emit | github-plan
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

STATE_DIR = Path(__file__).resolve().parent
APP_DIR = STATE_DIR.parent
# El vault vive DENTRO del repo desde 2026-07-30 (`app/vault`, incorporado con
# `git subtree`): antes era un repo aparte al lado de `app/` y sus PRDs —las
# specs canónicas— no tenían respaldo remoto. Se resuelve relativo a este
# archivo y no al cwd, igual que el resto de las rutas del motor.
VAULT_DIR = APP_DIR / "vault"
EVENTS_DIR = STATE_DIR / "events"
PROJ_DIR = STATE_DIR / "projections"
CACHE_PATH = STATE_DIR / "cache.json"
BACKLOGS_DIR = APP_DIR / "docs" / "sprints"
DASHBOARD_PATH = VAULT_DIR / "00_MOC" / "Estado de Implementación.md"

PRIORIDAD_PRD = {"P0": 3, "P1": 2, "P2": 1}
ESTADOS = ("propuesta", "stale", "ready", "in-progress", "done", "cancelada")
EVENT_TYPES = (
    "import_sprint", "import_task", "status", "claim", "release",
    "proposal_created", "proposal_rejected", "note",
)
TASK_RE = re.compile(r"^S\d+-\d{2}$")
PRD_RE = re.compile(r"PRD-\d{2}-\d{2}")
GENERADO = "GENERADO por app/state/engine.py — no editar a mano"


# ---------------------------------------------------------------- eventos

def ahora_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def cargar_eventos():
    eventos = []
    if EVENTS_DIR.is_dir():
        for path in sorted(EVENTS_DIR.glob("*.jsonl")):
            with open(path, encoding="utf-8") as fh:
                for nro, linea in enumerate(fh, 1):
                    linea = linea.strip()
                    if not linea:
                        continue
                    try:
                        eventos.append(json.loads(linea))
                    except json.JSONDecodeError as exc:
                        sys.exit(f"error: {path.name}:{nro} json inválido: {exc}")
    eventos.sort(key=lambda e: (e.get("ts", ""), e.get("id", "")))
    return eventos


# ---------------------------------------------------------------- vault

def escanear_vault():
    """Devuelve {prd_id: {priority, basename, relpath, sha1}} y {relpath: sha1}."""
    prds, shas = {}, {}
    if not VAULT_DIR.is_dir():
        return prds, shas
    for path in sorted(VAULT_DIR.rglob("*.md")):
        rel = str(path.relative_to(VAULT_DIR))
        raw = path.read_bytes()
        shas[rel] = hashlib.sha1(raw).hexdigest()
        m = re.match(r"(PRD-\d{2}-\d{2})\b", path.name)
        if not m:
            continue
        priority = None
        try:
            texto = raw.decode("utf-8", errors="replace")
            fm = re.match(r"---\n(.*?)\n---", texto, re.S)
            if fm:
                pm = re.search(r'^priority:\s*"?(P[012])"?', fm.group(1), re.M)
                if pm:
                    priority = pm.group(1)
        except OSError:
            pass
        prds[m.group(1)] = {
            "priority": priority,
            "basename": path.stem,
            "relpath": rel,
            "sha1": shas[rel],
        }
    return prds, shas


def git_head(cwd):
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=cwd,
            capture_output=True, text=True, timeout=10,
        )
        return out.stdout.strip() if out.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


# ---------------------------------------------------------------- estado

def nueva_tarea(task_id):
    return {
        "id": task_id, "sprint": None, "seccion": None, "titulo": "",
        "alcance": "", "depende_de": [], "issue": None, "lote": None,
        "fuente": [], "done_import": False, "spec_ref": None,
        "depende_nota": None, "depende_cola": None, "notas_extra": [],
        "prioridad_hint": 1, "propuesta": False, "rechazada": False,
        "ultimo_status": None, "claimed_by": None, "notas": [],
    }


def construir_estado(eventos):
    sprints = {}
    tareas = {}
    for ev in eventos:
        tipo = ev.get("type")
        data = ev.get("data") or {}
        if tipo == "import_sprint":
            sid = data.get("sprint")
            if sid:
                sprints[sid] = data
        elif tipo in ("import_task", "proposal_created"):
            tid = ev.get("task")
            if not tid:
                continue
            t = tareas.setdefault(tid, nueva_tarea(tid))
            for campo in ("sprint", "seccion", "titulo", "alcance", "depende_de",
                          "issue", "lote", "fuente", "spec_ref", "depende_nota",
                          "depende_cola", "notas_extra"):
                if data.get(campo) is not None:
                    t[campo] = data[campo]
            if data.get("done"):
                t["done_import"] = True
            if data.get("prioridad"):
                t["prioridad_hint"] = data["prioridad"]
            if tipo == "proposal_created":
                t["propuesta"] = True
        elif tipo == "note":
            tid = ev.get("task")
            if tid and tid in tareas:
                tareas[tid]["notas"].append(ev.get("motivo") or "")
        elif tid_es_tarea(ev.get("task")):
            t = tareas.setdefault(ev["task"], nueva_tarea(ev["task"]))
            if tipo == "status":
                t["ultimo_status"] = ev.get("to")
                if ev.get("to") in ("done", "cancelada"):
                    t["claimed_by"] = None
            elif tipo == "claim":
                t["claimed_by"] = ev.get("actor") or "desconocido"
            elif tipo == "release":
                t["claimed_by"] = None
            elif tipo == "proposal_rejected":
                t["rechazada"] = True
    return sprints, tareas


def tid_es_tarea(valor):
    return isinstance(valor, str) and bool(TASK_RE.match(valor))


def estado_derivado(t, tareas):
    if t["rechazada"]:
        return "cancelada"
    explicit = t["ultimo_status"] or ("done" if t["done_import"] else None)
    if explicit in ("done", "cancelada"):
        return explicit
    if t["claimed_by"] or explicit == "in-progress":
        return "in-progress"
    if explicit == "propuesta" or t["propuesta"]:
        return "propuesta"
    deps = t["depende_de"]
    if all(tareas.get(d, {}).get("_estado") == "done" for d in deps):
        return "ready"
    return "stale"


def orden_en_sprint(task_id):
    m = re.search(r"-(\d+)$", task_id)
    return int(m.group(1)) if m else 0


def enriquecer(sprints, tareas, prds_vault):
    """Estados derivados, desbloquea, score. Dos pasadas: estado, luego score."""
    for t in tareas.values():
        t["_estado"] = None
    # pasada 1: estados explícitos primero, después derivados (listo si deps done)
    for t in tareas.values():
        t["_estado"] = estado_derivado(t, tareas)
    # los que quedaron como ready/stale dependen de estados ya calculados;
    # estado_derivado es monótono, una segunda pasada estabiliza cadenas.
    for t in tareas.values():
        t["_estado"] = estado_derivado(t, tareas)

    for t in tareas.values():
        t["_desbloquea"] = sorted(
            o["id"] for o in tareas.values()
            if o["sprint"] == t["sprint"] and t["id"] in o["depende_de"]
        )
        prioridad = t["prioridad_hint"]
        for prd in t["fuente"]:
            info = prds_vault.get(prd)
            if info and info["priority"]:
                prioridad = max(prioridad, PRIORIDAD_PRD.get(info["priority"], 1))
        t["_prioridad"] = prioridad
        score = 3 * len(t["_desbloquea"]) + prioridad + 0.1 * orden_en_sprint(t["id"])
        t["_score"] = round(score, 1)


# ---------------------------------------------------------------- YAML

_BARE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")


def yaml_esc(valor):
    if valor is None:
        return "null"
    if isinstance(valor, bool):
        return "true" if valor else "false"
    if isinstance(valor, (int, float)):
        return repr(valor)
    s = str(valor)
    if _BARE_RE.match(s):
        return s
    return json.dumps(s, ensure_ascii=False)


def yaml_lista(items):
    return "[" + ", ".join(yaml_esc(i) for i in items) + "]"


def escribir_proyeccion(sid, sprint, tareas, ts):
    st = [t for t in tareas if t["sprint"] == sid]
    done = sum(1 for t in st if t["_estado"] == "done")
    lineas = [
        f"# {GENERADO}",
        f"sprint: {sid}",
        f"titulo: {yaml_esc(sprint.get('titulo', ''))}",
        f"generado: {ts}",
        f"total: {len(st)}",
        f"done: {done}",
        "tareas:",
    ]
    for t in sorted(st, key=orden_en_sprint_campo):
        lineas += [
            f"  - id: {t['id']}",
            f"    titulo: {yaml_esc(t['titulo'])}",
            f"    seccion: {yaml_esc(t['seccion'])}",
            f"    status: {t['_estado']}",
            f"    depende_de: {yaml_lista(t['depende_de'])}",
            f"    desbloquea: {yaml_lista(t['_desbloquea'])}",
            f"    issue: {yaml_esc(t['issue'])}",
            f"    lote: {yaml_esc(t['lote'])}",
            f"    fuente: {yaml_lista(t['fuente'])}",
            f"    claimed_by: {yaml_esc(t['claimed_by'])}",
            f"    score: {t['_score']}",
        ]
    path = PROJ_DIR / f"{sid}.yaml"
    path.write_text("\n".join(lineas) + "\n", encoding="utf-8")
    return path


def orden_en_sprint_campo(t):
    return orden_en_sprint(t["id"])


# ---------------------------------------------------------------- backlog md

def render_depende(t):
    partes = ""
    if t["spec_ref"]:
        partes += f"Spec: {t['spec_ref']}. "
    deps = ", ".join(t["depende_de"]) if t["depende_de"] else "nada"
    partes += f"Depende de: {deps}"
    if t["depende_nota"]:
        partes += f" ({t['depende_nota']})"
    partes += "."
    if t["depende_cola"]:
        partes += f" {t['depende_cola']}"
    return f"  - _{partes}_"


def escribir_backlog(sid, sprint, tareas):
    slug = sprint.get("slug") or sid.lower()
    labels = sprint.get("labels") or {}
    lineas = [
        f"# {sid} — {sprint.get('titulo', '')} (backlog)",
        "",
        "> GENERADO desde app/state/ — editar el estado con engine.py, no este archivo",
    ]
    if sprint.get("objetivo"):
        lineas.append(f"> **{labels.get('objetivo', 'Objetivo')}:** {sprint['objetivo']}")
    if sprint.get("specs"):
        specs = sprint["specs"]
        texto = ", ".join(specs) if isinstance(specs, list) else str(specs)
        lineas.append(f"> **{labels.get('specs', 'Specs')}:** {texto}")
    for extra in sprint.get("header_extra") or []:
        lineas.append(f"> **{extra['label']}:** {extra['text']}")
    if sprint.get("modelo"):
        lineas.append(f"> **{labels.get('modelo', 'Modelo')}:** {sprint['modelo']}")
    if sprint.get("fuera_scope"):
        lineas.append(f"> **{labels.get('fuera_scope', 'Fuera de scope')}:** {sprint['fuera_scope']}")
    lineas.append("")

    st = sorted((t for t in tareas if t["sprint"] == sid), key=orden_en_sprint_campo)
    secciones = []
    for t in st:
        if t["seccion"] not in secciones:
            secciones.append(t["seccion"])
    for seccion in secciones:
        lineas.append(f"## {seccion}")
        lineas.append("")
        for t in st:
            if t["seccion"] != seccion:
                continue
            check = "x" if t["_estado"] == "done" else " "
            lineas.append(f"- [{check}] **{t['id']} {t['titulo']}.** {t['alcance']}")
            for nota in t["notas_extra"]:
                lineas.append(f"  - _{nota}_")
            lineas.append(render_depende(t))
        lineas.append("")

    lineas.append("## Dependencias entre tareas")
    lineas.append("")
    lineas.append("```")
    for t in st:
        for dep in t["depende_de"]:
            lineas.append(f"{dep} ──► {t['id']}")
    lineas.append("```")
    lineas.append("")
    if sprint.get("lotes"):
        lineas.append(f"**Lotes paralelos sugeridos:** {sprint['lotes']}")
        lineas.append("")
    if sprint.get("dod"):
        lineas.append("## Definition of done del sprint")
        lineas.append("")
        lineas.append(sprint["dod"].rstrip("\n"))
        lineas.append("")
    if sprint.get("cierre_extra"):
        lineas.append(sprint["cierre_extra"].rstrip("\n"))
        lineas.append("")

    path = BACKLOGS_DIR / f"{sid}-{slug}.md"
    path.write_text("\n".join(lineas).rstrip("\n") + "\n", encoding="utf-8")
    return path


# ---------------------------------------------------------------- dashboard

def escribir_dashboard(sprints, tareas, prds_vault, ts):
    lineas = [
        "---",
        'title: "Estado de Implementación"',
        'description: "Dashboard generado por el motor de estado de ConsorcIA (app/state/engine.py)."',
        'author: "state-engine"',
        f"date: {ts[:10]}",
        'status: "vigente"',
        'priority: "P0"',
        "tags: [consorcIA, devops]",
        "outcomes:",
        '  - "Visibilidad del progreso por sprint y de las tareas listas para trabajar"',
        "---",
        "",
        "# Estado de Implementación",
        "",
        f"> {GENERADO}. Última corrida: {ts}.",
        "",
        "## Resumen por sprint",
        "",
        "| Sprint | Título | Total | Done | Ready | Stale | In-progress |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for sid in sorted(sprints):
        st = [t for t in tareas.values() if t["sprint"] == sid]
        conteo = {e: 0 for e in ESTADOS}
        for t in st:
            conteo[t["_estado"]] = conteo.get(t["_estado"], 0) + 1
        titulo = sprints[sid].get("titulo", "")
        lineas.append(
            f"| {sid} | {titulo} | {len(st)} | {conteo['done']} | "
            f"{conteo['ready']} | {conteo['stale']} | {conteo['in-progress']} |"
        )
    lineas += ["", "## Tareas ready", ""]
    ready = sorted(
        (t for t in tareas.values() if t["_estado"] == "ready"),
        key=lambda t: -t["_score"],
    )
    if not ready:
        lineas.append("_(ninguna tarea ready en este momento)_")
    for t in ready:
        links = []
        for prd in t["fuente"]:
            info = prds_vault.get(prd)
            if info:
                links.append(f"[[{info['basename']}]]")
            else:
                links.append(f"[[{prd}]] (pendiente)")
        fuente = f" — fuente: {', '.join(links)}" if links else ""
        lineas.append(f"- **{t['id']}** (score {t['_score']}) {t['titulo']}{fuente}")
    lineas += ["", f"_Última corrida del motor: {ts}_", ""]
    DASHBOARD_PATH.write_text("\n".join(lineas), encoding="utf-8")
    return DASHBOARD_PATH


# ---------------------------------------------------------------- cache

def escribir_cache(shas_vault, ts):
    cache = {
        "ultima_corrida": ts,
        "vault_head": git_head(VAULT_DIR),
        "app_head": git_head(APP_DIR),
        "prds": shas_vault,
    }
    CACHE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return CACHE_PATH


# ---------------------------------------------------------------- comandos

def cmd_rebuild(_args):
    ts = ahora_iso()
    PROJ_DIR.mkdir(parents=True, exist_ok=True)
    BACKLOGS_DIR.mkdir(parents=True, exist_ok=True)
    DASHBOARD_PATH.parent.mkdir(parents=True, exist_ok=True)
    eventos = cargar_eventos()
    prds_vault, shas_vault = escanear_vault()
    sprints, tareas = construir_estado(eventos)
    enriquecer(sprints, tareas, prds_vault)
    generados = []
    for sid in sorted(sprints):
        st = [t for t in tareas.values() if t["sprint"] == sid]
        generados.append(escribir_proyeccion(sid, sprints[sid], st, ts))
        generados.append(escribir_backlog(sid, sprints[sid], st))
    if sprints:
        generados.append(escribir_dashboard(sprints, tareas, prds_vault, ts))
    generados.append(escribir_cache(shas_vault, ts))
    print(f"rebuild ok: {len(eventos)} eventos, {len(sprints)} sprints, "
          f"{len(tareas)} tareas")
    for path in generados:
        print(f"  generado: {path}")
    return sprints, tareas


def cmd_status(_args):
    eventos = cargar_eventos()
    prds_vault, _ = escanear_vault()
    sprints, tareas = construir_estado(eventos)
    enriquecer(sprints, tareas, prds_vault)

    print("== Progreso por sprint ==")
    for sid in sorted(sprints):
        st = [t for t in tareas.values() if t["sprint"] == sid]
        done = sum(1 for t in st if t["_estado"] == "done")
        titulo = sprints[sid].get("titulo", "")
        print(f"  {sid} {titulo}: {done}/{len(st)} done")

    ready = sorted((t for t in tareas.values() if t["_estado"] == "ready"),
                   key=lambda t: (-t["_score"], t["id"]))
    print("\n== Tareas ready ==")
    if not ready:
        print("  (ninguna)")
    for t in ready:
        desb = f" (desbloquea: {', '.join(t['_desbloquea'])})" if t["_desbloquea"] else ""
        print(f"  {t['id']} [score {t['_score']}] {t['titulo']}{desb}")

    en_curso = [t for t in tareas.values() if t["_estado"] == "in-progress"]
    print("\n== In-progress ==")
    if not en_curso:
        print("  (ninguna)")
    for t in sorted(en_curso, key=lambda t: t["id"]):
        print(f"  {t['id']} {t['titulo']} — claimed_by: {t['claimed_by'] or '?'}")

    print("\n== Recomendación ==")
    if ready:
        t = ready[0]
        print(f"  Próxima tarea: {t['id']} {t['titulo']} (score {t['_score']})")
    else:
        print("  No hay tareas ready; revisar stale o claims activos.")


def cmd_emit(args):
    if args.type not in EVENT_TYPES:
        sys.exit(f"error: type inválido '{args.type}'. Válidos: {', '.join(EVENT_TYPES)}")
    if args.type in ("import_task", "status", "claim", "release",
                     "proposal_created", "proposal_rejected"):
        if not args.task:
            sys.exit(f"error: --task es obligatorio para {args.type}")
    if args.task and not TASK_RE.match(args.task):
        sys.exit(f"error: --task '{args.task}' no matchea S<n>-NN")
    if args.type == "status":
        if not args.to:
            sys.exit("error: --to es obligatorio para status")
        if args.to not in ESTADOS:
            sys.exit(f"error: --to inválido '{args.to}'. Válidos: {', '.join(ESTADOS)}")

    data = {}
    if args.data:
        try:
            data = json.loads(args.data)
        except json.JSONDecodeError as exc:
            sys.exit(f"error: --data json inválido: {exc}")
        if not isinstance(data, dict):
            sys.exit("error: --data debe ser un objeto json")

    eventos = cargar_eventos()
    max_n = 0
    for ev in eventos:
        m = re.match(r"evt-(\d+)$", str(ev.get("id", "")))
        if m:
            max_n = max(max_n, int(m.group(1)))
    ts = ahora_iso()
    evento = {
        "id": f"evt-{max_n + 1:06d}",
        "ts": ts,
        "actor": args.actor or "human",
        "type": args.type,
    }
    if args.task:
        evento["task"] = args.task
    if args.type == "status":
        evento["to"] = args.to
        if args.fro:
            evento["from"] = args.fro
    if args.motivo:
        evento["motivo"] = args.motivo
    if data:
        evento["data"] = data

    EVENTS_DIR.mkdir(parents=True, exist_ok=True)
    path = EVENTS_DIR / f"{ts[:7]}.jsonl"
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(evento, ensure_ascii=False) + "\n")
    print(f"evento {evento['id']} appendeado a {path.name}")
    cmd_rebuild(None)


def cmd_github_plan(_args):
    """SOLO LECTURA: compara estados derivados con labels status:* de GitHub."""
    eventos = cargar_eventos()
    prds_vault, _ = escanear_vault()
    sprints, tareas = construir_estado(eventos)
    enriquecer(sprints, tareas, prds_vault)

    try:
        out = subprocess.run(
            ["gh", "issue", "list", "--state", "open", "--limit", "200",
             "--json", "number,title,labels"],
            cwd=APP_DIR, capture_output=True, text=True, timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        sys.exit(f"error: no pude correr gh: {exc}")
    if out.returncode != 0:
        sys.exit(f"error: gh falló: {out.stderr.strip()}")
    issues = json.loads(out.stdout)

    por_numero = {t["issue"]: t for t in tareas.values() if t["issue"]}
    sin_cambios, acciones, sin_tarea = 0, [], []
    for issue in issues:
        numero = issue["number"]
        m = re.match(r"(S\d+-\d{2}):", issue.get("title", ""))
        tarea = tareas.get(m.group(1)) if m else None
        if tarea is None:
            tarea = por_numero.get(numero)
        if tarea is None:
            sin_tarea.append(numero)
            continue
        deseado = f"status:{tarea['_estado']}"
        actuales = sorted(
            l["name"] for l in issue.get("labels", [])
            if l["name"].startswith("status:")
        )
        if actuales == [deseado]:
            sin_cambios += 1
            continue
        for l in actuales:
            acciones.append(f"  #{numero} ({tarea['id']}): quitar label '{l}'")
        if deseado not in actuales:
            acciones.append(f"  #{numero} ({tarea['id']}): agregar label '{deseado}'")

    print("github-plan (solo lectura, no se aplicó nada):")
    if acciones:
        print("\n".join(acciones))
    else:
        print("  sin drift: todos los labels status:* están al día")
    print(f"  {sin_cambios} issues ya OK")
    if sin_tarea:
        print(f"  issues abiertos sin tarea asociada (ignorados): "
              f"{', '.join('#' + str(n) for n in sin_tarea)}")


# ---------------------------------------------------------------- main

def main():
    parser = argparse.ArgumentParser(description="Motor de estado de ConsorcIA")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("rebuild", help="reconstruye estado y regenera vistas")
    sub.add_parser("status", help="resumen legible del estado")

    p_emit = sub.add_parser("emit", help="appendea un evento y corre rebuild")
    p_emit.add_argument("--type", required=True)
    p_emit.add_argument("--task")
    p_emit.add_argument("--to")
    p_emit.add_argument("--from", dest="fro")
    p_emit.add_argument("--motivo")
    p_emit.add_argument("--actor")
    p_emit.add_argument("--data")

    sub.add_parser("github-plan", help="drift de labels status:* (solo lectura)")

    args = parser.parse_args()
    {"rebuild": cmd_rebuild, "status": cmd_status,
     "emit": cmd_emit, "github-plan": cmd_github_plan}[args.cmd](args)


if __name__ == "__main__":
    main()
