-- S4-02 Modelo Invitacion (PRD-04-11 §2.3)
--
-- Invitación de activación con token de un solo uso y vencimiento a 7 días.
-- `usuarios.password_hash` pasa a nullable: el alta por backoffice crea al
-- Usuario sin password y la define el invitado al aceptar la invitación.

-- CreateEnum
CREATE TYPE "TipoInvitacion" AS ENUM ('STAFF', 'RESIDENTE');

-- AlterTable
ALTER TABLE "usuarios" ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "invitaciones" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "tipo" "TipoInvitacion" NOT NULL,
    "payload" JSONB NOT NULL,
    "token" TEXT NOT NULL,
    "expira_at" TIMESTAMP(3) NOT NULL,
    "usada_at" TIMESTAMP(3),
    "invitado_por_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitaciones_token_key" ON "invitaciones"("token");

-- CreateIndex
CREATE INDEX "invitaciones_organizacion_id_email_idx" ON "invitaciones"("organizacion_id", "email");

-- CreateIndex
CREATE INDEX "invitaciones_organizacion_id_tipo_idx" ON "invitaciones"("organizacion_id", "tipo");

-- Una sola invitación PENDIENTE por (email, organización, tipo). Índice único
-- PARCIAL: las invitaciones ya usadas quedan como historial y no bloquean.
-- Prisma no expresa índices parciales, así que se crea a mano.
CREATE UNIQUE INDEX "invitaciones_pendiente_unica"
    ON "invitaciones" ("email", "organizacion_id", "tipo")
    WHERE "usada_at" IS NULL;

-- AddForeignKey
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_invitado_por_id_fkey" FOREIGN KEY ("invitado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS por organización (la invitación es un dato de la organización que invita)
ALTER TABLE invitaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY organizacion_isolation_invitaciones ON invitaciones
    USING (organizacion_id = current_setting('app.current_organizacion_id', true));
