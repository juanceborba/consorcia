-- AlterTable
ALTER TABLE "edificios" ADD COLUMN     "activo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "tipo" TEXT NOT NULL DEFAULT 'ph';

-- CreateIndex
CREATE INDEX "edificios_organizacion_id_activo_idx" ON "edificios"("organizacion_id", "activo");
