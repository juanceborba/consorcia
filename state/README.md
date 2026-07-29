# app/state — Motor de estado de ConsorcIA

Motor de estado **event-sourced** (python3 stdlib, cero dependencias). Reemplaza la
doble fuente "GitHub issues + backlogs md sincronizados a mano" por una sola verdad
con vistas regeneradas.

## Qué es verdad y qué es generado

- **Verdad (se edita solo con eventos):** `events/*.jsonl` — log append-only, un
  evento JSON por línea. Nadie borra ni reescribe líneas; se corrige emitiendo
  eventos nuevos.
- **Generado (nadie lo toca a mano):**
  - `projections/S<n>.yaml` — estado derivado por sprint (status, score, desbloquea).
  - `app/docs/sprints/S<n>-<slug>.md` — los backlogs, regenerados desde los eventos.
  - `vault/00_MOC/Estado de Implementación.md` — dashboard para Obsidian.
  - `cache.json` — shas para detección incremental.

Los archivos generados llevan un aviso `GENERADO` arriba. Si los editás a mano,
el próximo `rebuild` te pisa los cambios.

## Comandos

```bash
python3 app/state/engine.py rebuild        # reconstruye todo desde events/
python3 app/state/engine.py status         # resumen: progreso, ready, in-progress, recomendación
python3 app/state/engine.py github-plan    # drift de labels status:* en GitHub (SOLO LECTURA)
python3 app/state/engine.py emit ...       # appendea un evento y corre rebuild
```

## Cómo trabajar una tarea (agentes y humanos)

1. **Antes de arrancar, clamá la tarea:**

   ```bash
   python3 app/state/engine.py emit --type claim --task S3-01 --actor mi-agente --motivo "arranco"
   ```

2. **Al terminar:**

   ```bash
   python3 app/state/engine.py emit --type status --task S3-01 --to done --actor mi-agente --motivo "PR #123"
   ```

3. **Si abandonás sin terminar, liberá el claim:**

   ```bash
   python3 app/state/engine.py emit --type release --task S3-01 --actor mi-agente --motivo "bloqueado por X"
   ```

Estados posibles (`--to`): `propuesta | stale | ready | in-progress | done | cancelada`.
Los estados `ready`/`stale` se **derivan** de las dependencias, casi nunca hace falta
emitirlos a mano.

Otros tipos: `note` (comentario sobre una tarea), `proposal_created` /
`proposal_rejected` (tareas propuestas y memoria de rechazos con `data.signature`).

## Reglas

- Los humanos **no editan** las vistas generadas: ni backlogs, ni proyecciones, ni
  el dashboard. El estado se cambia con `emit`.
- `github-plan` nunca modifica GitHub: solo imprime qué labels `status:*` habría
  que agregar/sacar. Aplicar es decisión humana.
- La migración inicial (`migrate.py`) ya corrió y generó
  `events/2026-07-import.jsonl`. Es one-shot; no la re-corras salvo que sepas lo
  que estás haciendo (`--force` pisa el archivo de importación).
