-- Row Level Security por organizacion_id (PRD-02-04 §4)
-- Las tablas se referencian sin calificar: la conexión de Prisma usa
-- search_path=consorcia (DATABASE_URL ?schema=consorcia).
-- El aislamiento se basa en current_setting('app.current_organizacion_id', true);
-- la app debe setear esa variable de sesión por request (tenant raíz).

-- Habilitar RLS en todas las tablas tenant-scoped
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE edificios ENABLE ROW LEVEL SECURITY;
ALTER TABLE unidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE gastos ENABLE ROW LEVEL SECURITY;
ALTER TABLE liquidaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE liquidacion_detalles ENABLE ROW LEVEL SECURITY;
ALTER TABLE cobros ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE comunicaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos ENABLE ROW LEVEL SECURITY;

-- Política: usuarios solo ven datos de su organización
CREATE POLICY organizacion_isolation_usuarios ON usuarios
    USING (organizacion_id = current_setting('app.current_organizacion_id', true));

CREATE POLICY organizacion_isolation_edificios ON edificios
    USING (organizacion_id = current_setting('app.current_organizacion_id', true));

CREATE POLICY organizacion_isolation_unidades ON unidades
    USING (organizacion_id = current_setting('app.current_organizacion_id', true));

CREATE POLICY organizacion_isolation_gastos ON gastos
    USING (organizacion_id = current_setting('app.current_organizacion_id', true));

CREATE POLICY organizacion_isolation_liquidaciones ON liquidaciones
    USING (organizacion_id = current_setting('app.current_organizacion_id', true));

CREATE POLICY organizacion_isolation_liquidacion_detalles ON liquidacion_detalles
    USING (organizacion_id = current_setting('app.current_organizacion_id', true));

CREATE POLICY organizacion_isolation_cobros ON cobros
    USING (organizacion_id = current_setting('app.current_organizacion_id', true));

CREATE POLICY organizacion_isolation_tickets ON tickets
    USING (organizacion_id = current_setting('app.current_organizacion_id', true));

CREATE POLICY organizacion_isolation_comunicaciones ON comunicaciones
    USING (organizacion_id = current_setting('app.current_organizacion_id', true));

CREATE POLICY organizacion_isolation_documentos ON documentos
    USING (organizacion_id = current_setting('app.current_organizacion_id', true));
