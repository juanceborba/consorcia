-- S3-05 · Recibos de expensas (Ley 941)
-- Spec: PRD-02-05 §4 (generador PDF + QR) · PRD-06-01 §3 (datos obligatorios) ·
--       PRD-04-03 §1 (APROBADA → ENVIADA)
--
-- Un recibo por UF de una liquidación ENVIADA. La fila es el COMPROBANTE
-- EMITIDO: copia matrícula RPA, período, totales ord/ext, fecha de emisión y el
-- payload del QR, para que el recibo siga siendo el que se emitió aunque la
-- organización cambie de administrador responsable. El PDF vive fuera de la DB
-- (`storage_driver` + `storage_key`, ver src/services/almacenamiento.js).
--
-- Escrita a mano (`migrate deploy`), igual que la de S3-01: la RLS y los
-- comentarios de tabla no se expresan en el schema de Prisma.

CREATE TABLE "recibos" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "liquidacion_id" TEXT NOT NULL,
    "unidad_id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "matricula_rpa" TEXT NOT NULL,
    "total_ordinarias" DECIMAL(12,2) NOT NULL,
    "total_extraordinarias" DECIMAL(12,2) NOT NULL,
    "total_general" DECIMAL(12,2) NOT NULL,
    "qr_data" TEXT NOT NULL,
    "fecha_emision" TIMESTAMP(3) NOT NULL,
    "storage_driver" TEXT NOT NULL DEFAULT 'filesystem',
    "storage_key" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recibos_pkey" PRIMARY KEY ("id")
);

-- Un recibo por UF y liquidación: hace idempotente cualquier reintento de
-- generación (el candado de la emisión es la transición APROBADA → ENVIADA).
CREATE UNIQUE INDEX "recibos_organizacion_id_liquidacion_id_unidad_id_key"
    ON "recibos" ("organizacion_id", "liquidacion_id", "unidad_id");

-- Numeración correlativa sin huecos ni repetidos dentro de la liquidación.
CREATE UNIQUE INDEX "recibos_organizacion_id_liquidacion_id_numero_key"
    ON "recibos" ("organizacion_id", "liquidacion_id", "numero");

CREATE INDEX "recibos_organizacion_id_liquidacion_id_idx"
    ON "recibos" ("organizacion_id", "liquidacion_id");

CREATE INDEX "recibos_organizacion_id_unidad_id_idx"
    ON "recibos" ("organizacion_id", "unidad_id");

ALTER TABLE "recibos" ADD CONSTRAINT "recibos_liquidacion_id_fkey"
    FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recibos" ADD CONSTRAINT "recibos_unidad_id_fkey"
    FOREIGN KEY ("unidad_id") REFERENCES "unidades"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS por organización, igual que el resto de las tablas tenant-scoped
-- (migración 20260728033803_rls, PRD-02-04 §4).
ALTER TABLE "recibos" ENABLE ROW LEVEL SECURITY;

CREATE POLICY organizacion_isolation_recibos ON recibos
    USING (organizacion_id = current_setting('app.current_organizacion_id', true));
