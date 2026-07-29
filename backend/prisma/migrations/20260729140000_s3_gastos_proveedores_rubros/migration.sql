-- S3-01 · Ajustes de schema para gastos y liquidación
-- Spec: PRD-04-02 §1.1/§1.3/§1.4/§6 · PRD-02-04 §2
--
-- 1) Directorio híbrido de proveedores + árbol maestro de rubros con
--    visibilidad por organización (tablas nuevas).
-- 2) `gastos`: soft delete (`deleted_at`, Ley 941) y FKs OBLIGATORIAS a
--    proveedor y rubro. Se agregan en 3 pasos (nullable → backfill → NOT NULL)
--    para no romper instalaciones que ya tengan gastos cargados.
-- 3) `liquidaciones`: la unicidad de período pasa a índice único PARCIAL que
--    excluye ANULADA, para habilitar anular → regenerar el mismo período.
--
-- Migración escrita a mano (`migrate deploy`): Postgres no expresa índices
-- parciales en Prisma y el backfill necesita SQL imperativo.

-- ==========================================================================
-- 1. Proveedores y rubros
-- ==========================================================================

CREATE TABLE "proveedores" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT,               -- null = global de plataforma
    "razon_social" TEXT NOT NULL,
    "cuit" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "direccion" TEXT,
    "rubro_habitual_id" TEXT,
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rubros" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT,               -- null = maestro de plataforma
    "parent_id" TEXT,                     -- null = rubro nivel 1; set = subrubro
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rubros_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rubro_visibilidad" (
    "organizacion_id" TEXT NOT NULL,
    "rubro_id" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rubro_visibilidad_pkey" PRIMARY KEY ("organizacion_id","rubro_id")
);

CREATE INDEX "proveedores_organizacion_id_idx" ON "proveedores"("organizacion_id");
CREATE INDEX "rubros_organizacion_id_idx" ON "rubros"("organizacion_id");

-- Nombre único entre hermanos (declarado en schema.prisma). En Postgres un
-- UNIQUE con columnas NULLables no restringe las filas con NULL, así que este
-- índice solo alcanza de hecho a los subrubros propios de una organización.
CREATE UNIQUE INDEX "rubros_organizacion_id_parent_id_nombre_key"
    ON "rubros"("organizacion_id", "parent_id", "nombre");

-- Los tres casos que el UNIQUE de arriba deja pasar, con índices parciales:
--   maestro nivel 1, maestro nivel 2 y rubro nivel 1 propio de una org.
CREATE UNIQUE INDEX "rubros_maestro_raiz_unique"
    ON "rubros" ("nombre")
    WHERE "organizacion_id" IS NULL AND "parent_id" IS NULL;

CREATE UNIQUE INDEX "rubros_maestro_hijo_unique"
    ON "rubros" ("parent_id", "nombre")
    WHERE "organizacion_id" IS NULL AND "parent_id" IS NOT NULL;

CREATE UNIQUE INDEX "rubros_org_raiz_unique"
    ON "rubros" ("organizacion_id", "nombre")
    WHERE "organizacion_id" IS NOT NULL AND "parent_id" IS NULL;

-- Dedup de CUIT por organización (PRD-04-02 §1.3): un solo proveedor por CUIT
-- dentro de cada org. Los globales (organizacion_id NULL) los gestiona la
-- plataforma y quedan fuera de ese índice: en Postgres dos filas con NULL en
-- una columna del UNIQUE se consideran distintas, así que el dedup de los
-- globales necesita su propio índice parcial.
CREATE UNIQUE INDEX "proveedores_cuit_org_unique"
    ON "proveedores" ("organizacion_id", "cuit")
    WHERE "cuit" IS NOT NULL AND "organizacion_id" IS NOT NULL;

CREATE UNIQUE INDEX "proveedores_cuit_global_unique"
    ON "proveedores" ("cuit")
    WHERE "cuit" IS NOT NULL AND "organizacion_id" IS NULL;

ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_organizacion_id_fkey"
    FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_rubro_habitual_id_fkey"
    FOREIGN KEY ("rubro_habitual_id") REFERENCES "rubros"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rubros" ADD CONSTRAINT "rubros_organizacion_id_fkey"
    FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rubros" ADD CONSTRAINT "rubros_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "rubros"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rubro_visibilidad" ADD CONSTRAINT "rubro_visibilidad_rubro_id_fkey"
    FOREIGN KEY ("rubro_id") REFERENCES "rubros"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sin RLS: `proveedores`, `rubros` y `rubro_visibilidad` son híbridas (ítems
-- globales con organizacion_id NULL + propios por org), así que la policy
-- estándar de aislamiento del §4 las dejaría sin acceso a los globales. La
-- visibilidad se resuelve a nivel aplicación (merge maestro + propios).

-- ==========================================================================
-- 2. gastos: soft delete + proveedor/rubro obligatorios
-- ==========================================================================

ALTER TABLE "gastos" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- Paso 1: nullable, para poder backfillear lo que ya está cargado.
ALTER TABLE "gastos" ADD COLUMN "proveedor_id" TEXT;
ALTER TABLE "gastos" ADD COLUMN "rubro_id" TEXT;

-- Paso 2: backfill. Por cada organización con gastos se crea un proveedor y un
-- rubro propios "Sin especificar" y se apuntan sus gastos ahí. En una base sin
-- gastos (el caso del entorno de desarrollo con el seed actual) no crea nada.
DO $$
DECLARE
    org RECORD;
    proveedor_fallback TEXT;
    rubro_fallback TEXT;
BEGIN
    FOR org IN SELECT DISTINCT organizacion_id FROM gastos LOOP
        INSERT INTO proveedores (id, organizacion_id, razon_social, notas, updated_at)
        VALUES (gen_random_uuid()::text, org.organizacion_id, 'Sin especificar',
                'Creado por la migración S3-01 para gastos cargados antes de exigir proveedor.',
                CURRENT_TIMESTAMP)
        RETURNING id INTO proveedor_fallback;

        INSERT INTO rubros (id, organizacion_id, parent_id, nombre, updated_at)
        VALUES (gen_random_uuid()::text, org.organizacion_id, NULL, 'Sin especificar',
                CURRENT_TIMESTAMP)
        RETURNING id INTO rubro_fallback;

        UPDATE gastos
        SET proveedor_id = proveedor_fallback, rubro_id = rubro_fallback
        WHERE organizacion_id = org.organizacion_id;
    END LOOP;
END $$;

-- Paso 3: obligatorias (PRD-04-02 §1.1: ningún gasto sin proveedor ni rubro).
ALTER TABLE "gastos" ALTER COLUMN "proveedor_id" SET NOT NULL;
ALTER TABLE "gastos" ALTER COLUMN "rubro_id" SET NOT NULL;

CREATE INDEX "gastos_organizacion_id_edificio_id_proveedor_id_idx"
    ON "gastos"("organizacion_id", "edificio_id", "proveedor_id");
CREATE INDEX "gastos_organizacion_id_edificio_id_rubro_id_idx"
    ON "gastos"("organizacion_id", "edificio_id", "rubro_id");

ALTER TABLE "gastos" ADD CONSTRAINT "gastos_proveedor_id_fkey"
    FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_rubro_id_fkey"
    FOREIGN KEY ("rubro_id") REFERENCES "rubros"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ==========================================================================
-- 3. liquidaciones: unicidad de período que permite anular → regenerar
-- ==========================================================================

-- El UNIQUE total bloqueaba regenerar un período ya anulado.
DROP INDEX "liquidaciones_organizacion_id_edificio_id_periodo_key";

CREATE UNIQUE INDEX "liquidaciones_periodo_activo_unique"
    ON "liquidaciones" ("organizacion_id", "edificio_id", "periodo")
    WHERE "estado" <> 'ANULADA'::"EstadoLiquidacion";
