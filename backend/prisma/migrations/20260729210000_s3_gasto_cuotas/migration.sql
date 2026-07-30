-- S3-19 · Cuotas de gastos extraordinarios
-- Spec: PRD-04-02 §1 (gestor de gastos) · PRD-06-01 §3.2 (el mockup del recibo
--       ya dibuja "Pintura fachada (cuota 3/6)")
-- Research: docs/investigacion/ordinarias-extraordinarias-y-categorias.md (brecha 1)
--
-- Un gasto de $X en N cuotas se imputa X/N por período. El `Gasto` sigue siendo
-- LA FACTURA (su `monto` es el total del comprobante); `gasto_cuotas` son las
-- IMPUTACIONES por período. Un gasto SIN cuotas es de imputación única y se
-- comporta exactamente como antes de esta migración: el default no requiere
-- configurar nada para liquidar.
--
-- Invariante: Σ monto de las cuotas de un gasto = gasto.monto (el ajuste de
-- centavos va en la última cuota). Se valida en la aplicación y en los tests;
-- no hay CHECK en la DB porque es una invariante entre filas.
--
-- Escrita a mano (`migrate deploy`), igual que las de S3-01 y S3-05: la RLS y
-- los comentarios de tabla no se expresan en el schema de Prisma.

CREATE TABLE "gasto_cuotas" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "gasto_id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "cuotas_total" INTEGER NOT NULL,
    "periodo" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gasto_cuotas_pkey" PRIMARY KEY ("id"),
    -- Un plan tiene al menos 2 cuotas y la cuota k está dentro del plan.
    CONSTRAINT "gasto_cuotas_numero_check" CHECK ("numero" >= 1 AND "numero" <= "cuotas_total"),
    CONSTRAINT "gasto_cuotas_total_check" CHECK ("cuotas_total" >= 2),
    -- El período de imputación es "YYYY-MM", igual que gastos.periodo.
    CONSTRAINT "gasto_cuotas_periodo_check" CHECK ("periodo" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

-- Una cuota k por gasto…
CREATE UNIQUE INDEX "gasto_cuotas_organizacion_id_gasto_id_numero_key"
    ON "gasto_cuotas" ("organizacion_id", "gasto_id", "numero");

-- …y un solo período por gasto: dos cuotas del mismo gasto en el mismo período
-- romperían la unicidad de liquidacion_detalles (org, liquidación, unidad, gasto).
CREATE UNIQUE INDEX "gasto_cuotas_organizacion_id_gasto_id_periodo_key"
    ON "gasto_cuotas" ("organizacion_id", "gasto_id", "periodo");

CREATE INDEX "gasto_cuotas_organizacion_id_gasto_id_idx"
    ON "gasto_cuotas" ("organizacion_id", "gasto_id");

-- La selección de gastos del motor para un período (S3-04) filtra por acá.
CREATE INDEX "gasto_cuotas_organizacion_id_periodo_idx"
    ON "gasto_cuotas" ("organizacion_id", "periodo");

-- CASCADE: el plan no tiene vida propia sin su gasto. El borrado del gasto es
-- soft (deletedAt), así que en la práctica esto solo corre en un hard delete.
ALTER TABLE "gasto_cuotas" ADD CONSTRAINT "gasto_cuotas_gasto_id_fkey"
    FOREIGN KEY ("gasto_id") REFERENCES "gastos"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS por organización, igual que el resto de las tablas tenant-scoped
-- (migración 20260728033803_rls, PRD-02-04 §4).
ALTER TABLE "gasto_cuotas" ENABLE ROW LEVEL SECURITY;

CREATE POLICY organizacion_isolation_gasto_cuotas ON gasto_cuotas
    USING (organizacion_id = current_setting('app.current_organizacion_id', true));

-- ---------------------------------------------------------------------------
-- Snapshot de la cuota en el detalle de la liquidación
-- ---------------------------------------------------------------------------
--
-- `gasto_cuota_id` da la trazabilidad; `cuota_numero`/`cuotas_total` son el
-- SNAPSHOT del rótulo "cuota k/N" al momento de liquidar. No son redundantes: un
-- recibo emitido no puede pasar de "3/6" a "3/8" porque después se editó el plan
-- (misma regla de inmutabilidad que `coeficiente_aplicado`). NULL en los tres =
-- gasto de imputación única, que es lo que tienen todas las filas existentes.

ALTER TABLE "liquidacion_detalles" ADD COLUMN "gasto_cuota_id" TEXT;
ALTER TABLE "liquidacion_detalles" ADD COLUMN "cuota_numero" INTEGER;
ALTER TABLE "liquidacion_detalles" ADD COLUMN "cuotas_total" INTEGER;

ALTER TABLE "liquidacion_detalles" ADD CONSTRAINT "liquidacion_detalles_gasto_cuota_id_fkey"
    FOREIGN KEY ("gasto_cuota_id") REFERENCES "gasto_cuotas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "liquidacion_detalles_gasto_cuota_id_idx"
    ON "liquidacion_detalles" ("gasto_cuota_id");
