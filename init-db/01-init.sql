-- init-db/01-init.sql
-- ConsorcIA: inicialización de base de datos (PRD-02-03 §9)

-- Crear schema para multi-tenancy (antes que las extensiones que lo referencian)
CREATE SCHEMA IF NOT EXISTS consorcia;

-- Las tablas de Prisma se crean sin calificar schema: el search_path del
-- usuario las dirige al schema consorcia (PRD-02-04 §1.1 "Un solo schema").
ALTER USER consorcia SET search_path = consorcia, public;

-- Crear extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- vector debe vivir en el schema consorcia: el backend conecta con
-- DATABASE_URL ...?schema=consorcia (search_path exclusivo de Prisma).
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA consorcia;

-- Función para updated_at automático
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Comentario de versión
COMMENT ON DATABASE consorcia IS 'ConsorcIA Platform DB v1.0.0';
