-- S4-01 Migración a identidad global (PRD-04-11 §2.2, PRD-02-04 §2)
--
-- Usuario deja de tener tenant: `organizacion_id` y `rol` se mueven a
-- `organizacion_usuarios` (la membresía) y el email pasa a ser único global.
-- La migración es NO destructiva de datos: cada usuario existente conserva su
-- rol y su organización como membresía antes de que se dropeen las columnas.

-- ---------------------------------------------------------------------------
-- 1. Normalización de emails a lowercase (identificador global, PRD-04-11 §7)
-- ---------------------------------------------------------------------------
UPDATE usuarios SET email = lower(email) WHERE email <> lower(email);

-- Aborta si el lowercase o el paso de único-por-org a único-global genera
-- colisiones: la migración no puede decidir qué identidad conservar.
DO $$
DECLARE duplicados TEXT;
BEGIN
    SELECT string_agg(email, ', ') INTO duplicados
    FROM (SELECT email FROM usuarios GROUP BY email HAVING count(*) > 1) d;

    IF duplicados IS NOT NULL THEN
        RAISE EXCEPTION 'Emails duplicados, no se puede aplicar identidad global: %', duplicados;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Nueva columna de baja lógica de la membresía
-- ---------------------------------------------------------------------------
ALTER TABLE organizacion_usuarios ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 3. Migración de datos: rol + organización de cada Usuario → membresía
--    Idempotente respecto de las membresías que ya existen (el seed de S1 crea
--    las de org_admin y gestor): ON CONFLICT no las toca.
--    Ningún usuario queda sin membresía.
-- ---------------------------------------------------------------------------
INSERT INTO organizacion_usuarios (id, organizacion_id, usuario_id, rol, activo, created_at)
SELECT gen_random_uuid(), u.organizacion_id, u.id, u.rol, u.activo, now()
FROM usuarios u
ON CONFLICT (organizacion_id, usuario_id) DO NOTHING;

-- La membresía preexistente manda en el rol (es la fuente canónica desde ahora),
-- pero su `activo` se alinea con el del Usuario que venía de S1.
UPDATE organizacion_usuarios ou
SET activo = u.activo
FROM usuarios u
WHERE ou.usuario_id = u.id AND ou.organizacion_id = u.organizacion_id;

-- Verificación: si algún usuario quedó huérfano de membresía, abortar.
DO $$
DECLARE huerfanos INT;
BEGIN
    SELECT count(*) INTO huerfanos
    FROM usuarios u
    WHERE NOT EXISTS (SELECT 1 FROM organizacion_usuarios ou WHERE ou.usuario_id = u.id);

    IF huerfanos > 0 THEN
        RAISE EXCEPTION 'Quedaron % usuarios sin membresía en organizacion_usuarios', huerfanos;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Drop de la política RLS que scopea usuarios por organizacion_id
--    (la identidad es global; el aislamiento se aplica sobre los vínculos)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS organizacion_isolation_usuarios ON usuarios;
ALTER TABLE usuarios DISABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5. Schema: quitar tenant y rol del Usuario, email único global
-- ---------------------------------------------------------------------------
DROP INDEX "usuarios_organizacion_id_activo_idx";
DROP INDEX "usuarios_organizacion_id_email_key";
DROP INDEX "usuarios_organizacion_id_rol_idx";

ALTER TABLE "usuarios" DROP COLUMN "organizacion_id",
DROP COLUMN "rol";

CREATE INDEX "organizacion_usuarios_usuario_id_activo_idx" ON "organizacion_usuarios"("usuario_id", "activo");
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");
CREATE INDEX "usuarios_activo_idx" ON "usuarios"("activo");
