-- CreateEnum
CREATE TYPE "BaseFondoReserva" AS ENUM ('ORDINARIAS', 'TOTAL', 'MONTO_FIJO');

-- CreateEnum
CREATE TYPE "TipoDetalleLiquidacion" AS ENUM ('GASTO', 'FONDO_RESERVA');

-- AlterTable
ALTER TABLE "liquidacion_detalles" ADD COLUMN     "tipo" "TipoDetalleLiquidacion" NOT NULL DEFAULT 'GASTO',
ALTER COLUMN "gasto_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "liquidaciones" ADD COLUMN     "fondo_reserva_base" "BaseFondoReserva",
ADD COLUMN     "fondo_reserva_valor" DECIMAL(12,2),
ADD COLUMN     "regla_fondo_reserva_id" TEXT,
ADD COLUMN     "total_fondo_reserva" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "recibos" ADD COLUMN     "total_fondo_reserva" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "reglas_fondo_reserva" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "edificio_id" TEXT NOT NULL,
    "vigencia_desde" TEXT NOT NULL,
    "base" "BaseFondoReserva" NOT NULL DEFAULT 'ORDINARIAS',
    "porcentaje" DECIMAL(5,2),
    "monto_fijo" DECIMAL(12,2),
    "esquema_reparto_id" TEXT,
    "motivo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "reglas_fondo_reserva_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reglas_fondo_reserva_organizacion_id_edificio_id_idx" ON "reglas_fondo_reserva"("organizacion_id", "edificio_id");

-- CreateIndex
CREATE UNIQUE INDEX "reglas_fondo_reserva_edificio_id_vigencia_desde_key" ON "reglas_fondo_reserva"("edificio_id", "vigencia_desde");

-- AddForeignKey
ALTER TABLE "reglas_fondo_reserva" ADD CONSTRAINT "reglas_fondo_reserva_edificio_id_fkey" FOREIGN KEY ("edificio_id") REFERENCES "edificios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reglas_fondo_reserva" ADD CONSTRAINT "reglas_fondo_reserva_esquema_reparto_id_fkey" FOREIGN KEY ("esquema_reparto_id") REFERENCES "esquemas_reparto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_regla_fondo_reserva_id_fkey" FOREIGN KEY ("regla_fondo_reserva_id") REFERENCES "reglas_fondo_reserva"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Índice único PARCIAL para el aporte al fondo (S3-21): Prisma no lo expresa.
-- El `@@unique(organizacion_id, liquidacion_id, unidad_id, gasto_id)` no alcanza
-- porque en Postgres dos NULL son distintos entre sí, así que sin esto una
-- regeneración podría dejar dos aportes al fondo para la misma UF.
CREATE UNIQUE INDEX "liquidacion_detalles_fondo_unique"
  ON "liquidacion_detalles" ("liquidacion_id", "unidad_id")
  WHERE "gasto_id" IS NULL;
