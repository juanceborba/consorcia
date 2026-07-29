# Bandeja de propuestas

Acá caen las cards de trabajo detectado **sin cobertura de tareas** (PRDs nuevos,
alcances que aparecieron, gaps). Las crea el agente custodio de estado
(`/state`, ver `.agents/skills/state/SKILL.md`). **Ninguna propuesta se convierte
en issue de GitHub sin aprobación humana.**

## Ciclo de vida

```
propuesta ──(humano aprueba: /state activar <id>)──► activated/ + issue creado
    │
    └──(humano rechaza)──► proposal_rejected + firma en app/state/rejected.json
                           (no se vuelve a proponer)
```

Una propuesta puede nacer **bloqueada por PRD no aprobado** si el PRD fuente
está en `borrador`/`revisión` (ver ciclo de vida de PRDs en `vault/AGENTS.md`).
Se desbloquea sola cuando el PRD pasa a `aprobado`/`vigente`.

## Formato de card

Archivo: `<sprint>-<nn>-<slug>.md` (ej. `S3-18-importacion-gastos-csv.md`).

```markdown
# S<n>-NN: <título>

- **Fuente:** PRD-XX-YY — [[PRD-XX-YY Título]]
- **Estado:** propuesta | bloqueada por PRD no aprobado
- **Alcance:** <qué se construye>
- **Criterios de aceptación:** <lista>
- **Depende de:** <tareas> | nada
- **Lote sugerido:** <A-G>
- **Sprint sugerido:** S<n>
- **Firma:** `<sha1(título+fuente)[:8]>`
```

La **firma** identifica la propuesta de forma estable: si el humano la rechaza,
la firma queda en `app/state/rejected.json` y el agente no la repropone.

## Directorios

- `proposals/*.md` — bandeja pendiente de decisión.
- `proposals/activated/*.md` — aceptadas y convertidas en tarea + issue.
- Las rechazadas no se archivan: su memoria vive en `app/state/rejected.json`.
