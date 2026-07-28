-- init-db/01-init.sql
-- ConsorcIA: inicialización de base de datos (PRD-02-03 §9)

-- Crear extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Crear schema para multi-tenancy
CREATE SCHEMA IF NOT EXISTS consorcia;

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
