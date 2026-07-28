# Roadmap — ConsorcIA App

> Estrategia: **slices verticales**. Cada sprint termina con una funcionalidad demo-able en el browser.
> Specs canónicas: vault en `../../vault` (PRDs). Modelo de tenancy: **Organización → Edificio → Unidad → Usuario** (ver `PRD-02-04`, `PRD-05-04`, `PRD-08-05`).
> Referencia de fases comerciales: `PRD-01-02 Estrategia de MVP y Fases` (este roadmap reordena S0–S6 en slices; los agentes IA van post-beta).

## Sprints del MVP

| Sprint | Nombre | Duración est. | Demo al finalizar |
|--------|--------|---------------|-------------------|
| **S1** | Fundación visible | 1.5 sem | Login → ves las organizaciones/edificios del usuario |
| **S2** | Edificios y unidades | 1.5 sem | Alta completa de un edificio con unidades y coeficientes A/B/C |
| **S3** | Gastos + motor contable | 2 sem | Cargar gastos → liquidar → recibos PDF con QR y matrícula RPA |
| **S4** | Portal residente | 1.5 sem | Un propietario ve su expensa y descarga su recibo |
| **S5** | Cobranzas | 1.5 sem | Pago con MercadoPago sandbox → expensa marcada como cobrada |
| **S6** | Hardening beta | 1 sem | E2E, validación Ley 941, seguridad → **beta 5-10 edificios** |

**Post-beta (Fase 2 temprana):** agentes IA (Onboarding, Contable), comunicaciones AgentMail, kanban, importación inteligente.

## Reglas de trabajo

1. **Todo cuelga de la Organización.** Ninguna query sin `organizacion_id`; `edificio_id` es segundo nivel de scope.
2. **El motor contable es determinístico** (decimal.js). Los LLMs interpretan y explican, nunca calculan.
3. **Seed data rico desde S1.** Toda feature se desarrolla y demuestra contra datos realistas.
4. **Tests matemáticos del motor contable son innegociables** (100% liquidaciones sin errores).
5. **Stack local:** `make up` + `make db-migrate` + `make db-seed` como ritual diario.
6. **Cada tarea = 1 issue** en GitHub. Los agentes claman issues, trabajan en ramas `task/<n>-<slug>` y referencian el issue en el PR/commit.
7. **Sprints coordinados con conductor** (`.nanostack/conductor/`): fases think → plan → build → review/qa/security → ship.

## Cuentas externas a gestionar (no bloquean S1)

- [ ] MercadoPago sandbox (se usa en S5 — pedirla ya, la aprobación no depende de nosotros)
- [ ] AgentMail (post-beta, pero el dominio conviene configurarlo temprano)
- [ ] OpenRouter/DeepInfra API key (post-beta, agentes)

## Backlogs por sprint

- [S1 — Fundación visible](sprints/S1-fundacion.md) ✅ (cerrado 2026-07-28)
- [S2 — Edificios y unidades](sprints/S2-edificios-unidades.md) ✅ (cerrado 2026-07-28)
- S3 a S6: se detallan al cerrar el sprint anterior (las specs ya están en los PRDs).
