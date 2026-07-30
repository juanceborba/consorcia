-- S3-20 · Esquemas de reparto configurables por edificio
-- Spec: PRD-02-05 Motor Contable · PRD-04-01 §1.3 · CCyC art. 2049, último párrafo
-- Diseño: docs/investigacion/esquemas-de-reparto.md
--
-- Hasta acá el reparto de un gasto salía SOLO de su categoría A/B/C: todas las
-- UF, las que tienen el servicio, o las del sector, siempre con el coeficiente
-- general renormalizado entre las alcanzadas. Eso deja afuera cuatro repartos
-- que los reglamentos de copropiedad usan todos los días: exención PARCIAL
-- ("PB abona el 50% del ascensor"), coeficiente PROPIO de un sector (la segunda
-- tabla del reglamento, que no es proporcional al general), partes IGUALES por
-- UF, y el cargo particular a UNA sola UF.
--
-- La primitiva que los expresa a todos es una sola: pesos por unidad funcional.
-- No hay condiciones ni fórmulas configurables — un enum cerrado de bases y una
-- tabla de pesos. Esa restricción es lo que mantiene el motor determinístico.
--
-- RETROCOMPATIBLE POR CONSTRUCCIÓN: sin ninguna fila en estas tablas, la
-- resolución devuelve NULL y el motor calcula exactamente lo que calculaba
-- antes. El default sale solo; configurar es la excepción.
--
-- Escrita a mano (`migrate deploy`), igual que las de S3-01, S3-05 y S3-19: la
-- RLS, los índices parciales y los CHECK no se expresan en el schema de Prisma.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "BaseReparto" AS ENUM ('COEFICIENTE', 'PARTES_IGUALES', 'PESOS_PROPIOS');
CREATE TYPE "AlcanceReparto" AS ENUM ('TODAS', 'SERVICIO', 'SECTOR', 'SELECCION');

-- ---------------------------------------------------------------------------
-- esquemas_reparto
-- ---------------------------------------------------------------------------

CREATE TABLE "esquemas_reparto" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "edificio_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "base" "BaseReparto" NOT NULL,
    "alcance" "AlcanceReparto" NOT NULL,
    "alcance_valor" TEXT,
    "clausula_reglamento" TEXT,
    "documento_url" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esquemas_reparto_pkey" PRIMARY KEY ("id"),
    -- El alcance por servicio o por sector necesita CONTRA QUÉ matchear, y los
    -- otros dos no admiten valor: un TODAS con `alcance_valor` seteado sería un
    -- filtro que el motor ignora en silencio.
    CONSTRAINT "esquemas_reparto_alcance_valor_check" CHECK (
        (("alcance" IN ('SERVICIO', 'SECTOR')) AND "alcance_valor" IS NOT NULL AND length(trim("alcance_valor")) > 0)
        OR (("alcance" IN ('TODAS', 'SELECCION')) AND "alcance_valor" IS NULL)
    ),
    CONSTRAINT "esquemas_reparto_nombre_check" CHECK (length(trim("nombre")) >= 3)
);

-- El nombre identifica al esquema en la UI y es lo que queda en el snapshot del
-- recibo: dos "Torre A" en el mismo edificio harían ilegible el comprobante.
CREATE UNIQUE INDEX "esquemas_reparto_organizacion_id_edificio_id_nombre_key"
    ON "esquemas_reparto" ("organizacion_id", "edificio_id", "nombre");

-- Determinismo del matcheo automático: un gasto de categoría B con servicio
-- "ascensor" tiene que resolver a UN esquema, no a "alguno de los dos activos".
-- Índice único PARCIAL (Prisma no los soporta) sobre los alcances que participan
-- del matcheo — TODAS y SELECCION no matchean nada por sí solos, así que pueden
-- repetirse: son plantillas que un gasto elige a mano.
CREATE UNIQUE INDEX "esquemas_reparto_alcance_activo_unique"
    ON "esquemas_reparto" ("organizacion_id", "edificio_id", "alcance", "alcance_valor")
    WHERE "activo" AND "alcance" IN ('SERVICIO', 'SECTOR');

CREATE INDEX "esquemas_reparto_organizacion_id_edificio_id_idx"
    ON "esquemas_reparto" ("organizacion_id", "edificio_id");
CREATE INDEX "esquemas_reparto_organizacion_id_edificio_id_activo_idx"
    ON "esquemas_reparto" ("organizacion_id", "edificio_id", "activo");

ALTER TABLE "esquemas_reparto" ADD CONSTRAINT "esquemas_reparto_edificio_id_fkey"
    FOREIGN KEY ("edificio_id") REFERENCES "edificios"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "esquemas_reparto" ENABLE ROW LEVEL SECURITY;

CREATE POLICY organizacion_isolation_esquemas_reparto ON esquemas_reparto
    USING (organizacion_id = current_setting('app.current_organizacion_id', true));

-- ---------------------------------------------------------------------------
-- esquema_reparto_unidades
-- ---------------------------------------------------------------------------
--
-- El peso se lee SEGÚN LA BASE del esquema (por eso no hay un solo CHECK que lo
-- acote más que a >= 0):
--   COEFICIENTE    → factor sobre el coeficiente de la UF (fila ausente = 1)
--   PARTES_IGUALES → factor sobre 1 (fila ausente = 1)
--   PESOS_PROPIOS  → el peso absoluto del reglamento (fila ausente = 0)
-- Solo existen las filas que hacen falta: "todas al 100% menos PB al 50%" es
-- UNA fila, no N.

CREATE TABLE "esquema_reparto_unidades" (
    "organizacion_id" TEXT NOT NULL,
    "esquema_id" TEXT NOT NULL,
    "unidad_id" TEXT NOT NULL,
    "peso" DECIMAL(12,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esquema_reparto_unidades_pkey" PRIMARY KEY ("esquema_id", "unidad_id"),
    -- Un peso negativo devolvería plata a una UF a costa de las demás.
    CONSTRAINT "esquema_reparto_unidades_peso_check" CHECK ("peso" >= 0)
);

CREATE INDEX "esquema_reparto_unidades_organizacion_id_esquema_id_idx"
    ON "esquema_reparto_unidades" ("organizacion_id", "esquema_id");
CREATE INDEX "esquema_reparto_unidades_unidad_id_idx"
    ON "esquema_reparto_unidades" ("unidad_id");

-- CASCADE en las dos FK: la fila no tiene vida propia sin su esquema ni sin su
-- UF. Borrar una UF del edificio saca su peso; lo ya liquidado no se toca porque
-- el reparto aplicado vive en el snapshot de `liquidacion_detalles`.
ALTER TABLE "esquema_reparto_unidades" ADD CONSTRAINT "esquema_reparto_unidades_esquema_id_fkey"
    FOREIGN KEY ("esquema_id") REFERENCES "esquemas_reparto"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "esquema_reparto_unidades" ADD CONSTRAINT "esquema_reparto_unidades_unidad_id_fkey"
    FOREIGN KEY ("unidad_id") REFERENCES "unidades"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "esquema_reparto_unidades" ENABLE ROW LEVEL SECURITY;

CREATE POLICY organizacion_isolation_esquema_reparto_unidades ON esquema_reparto_unidades
    USING (organizacion_id = current_setting('app.current_organizacion_id', true));

-- ---------------------------------------------------------------------------
-- configuracion_liquidacion
-- ---------------------------------------------------------------------------
--
-- El "setup" del edificio. Hoy una sola preferencia; S3-21 agrega acá el
-- porcentaje de fondo de reserva y S5 el día de vencimiento y el interés por
-- mora. Se crea on-demand: un edificio SIN fila liquida por coeficiente.

CREATE TABLE "configuracion_liquidacion" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "edificio_id" TEXT NOT NULL,
    "esquema_general_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_liquidacion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "configuracion_liquidacion_edificio_id_key"
    ON "configuracion_liquidacion" ("edificio_id");
CREATE INDEX "configuracion_liquidacion_organizacion_id_idx"
    ON "configuracion_liquidacion" ("organizacion_id");

ALTER TABLE "configuracion_liquidacion" ADD CONSTRAINT "configuracion_liquidacion_edificio_id_fkey"
    FOREIGN KEY ("edificio_id") REFERENCES "edificios"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT: el esquema elegido como default no se puede borrar sin antes
-- sacarlo de la configuración (el CRUD lo desactiva, no lo borra).
ALTER TABLE "configuracion_liquidacion" ADD CONSTRAINT "configuracion_liquidacion_esquema_general_id_fkey"
    FOREIGN KEY ("esquema_general_id") REFERENCES "esquemas_reparto"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "configuracion_liquidacion" ENABLE ROW LEVEL SECURITY;

CREATE POLICY organizacion_isolation_configuracion_liquidacion ON configuracion_liquidacion
    USING (organizacion_id = current_setting('app.current_organizacion_id', true));

-- ---------------------------------------------------------------------------
-- Override del gasto
-- ---------------------------------------------------------------------------
--
-- NULL = el gasto adopta lo que el edificio tenga configurado (y si no hay nada,
-- el coeficiente de siempre). La categoría A/B/C sigue clasificando el gasto para
-- el recibo, el dashboard y la Ley 941 aunque el esquema decida el cálculo: son
-- los dos trabajos que S3-20 separó.

ALTER TABLE "gastos" ADD COLUMN "esquema_reparto_id" TEXT;

ALTER TABLE "gastos" ADD CONSTRAINT "gastos_esquema_reparto_id_fkey"
    FOREIGN KEY ("esquema_reparto_id") REFERENCES "esquemas_reparto"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "gastos_organizacion_id_esquema_reparto_id_idx"
    ON "gastos" ("organizacion_id", "esquema_reparto_id");

-- ---------------------------------------------------------------------------
-- Snapshot del esquema en el detalle de la liquidación
-- ---------------------------------------------------------------------------
--
-- `esquema_reparto_id` da la trazabilidad; `esquema_nombre` es el SNAPSHOT del
-- nombre al momento de liquidar. No es redundante: renombrar "Torre A" o
-- desactivarlo NO puede reescribir un recibo ya emitido (misma regla que
-- `coeficiente_aplicado` y `cuota_numero`). NULL en los dos = reparto por
-- coeficiente según la categoría, que es lo que tienen todas las filas
-- existentes.

ALTER TABLE "liquidacion_detalles" ADD COLUMN "esquema_reparto_id" TEXT;
ALTER TABLE "liquidacion_detalles" ADD COLUMN "esquema_nombre" TEXT;

-- RESTRICT: un esquema referenciado por un recibo emitido no se borra nunca.
ALTER TABLE "liquidacion_detalles" ADD CONSTRAINT "liquidacion_detalles_esquema_reparto_id_fkey"
    FOREIGN KEY ("esquema_reparto_id") REFERENCES "esquemas_reparto"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "liquidacion_detalles_esquema_reparto_id_idx"
    ON "liquidacion_detalles" ("esquema_reparto_id");
