-- Preámbulo ConsorcIA (PRD-02-04):
-- El schema consorcia debe existir también en la shadow database de Prisma
-- (las tablas se crean sin calificar y las dirige el search_path del usuario).
CREATE SCHEMA IF NOT EXISTS consorcia;

-- pgvector se habilita vía migration SQL, no en Prisma schema (PRD-02-04 §2).
-- Debe vivir en el schema consorcia: Prisma conecta con ?schema=consorcia
-- (search_path exclusivo) y no resolvería el tipo si estuviera en public.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA consorcia;

-- CreateEnum
CREATE TYPE "RolUsuario" AS ENUM ('SUPERADMIN', 'ORG_ADMIN', 'GESTOR', 'CONSEJO', 'PROPIETARIO', 'INQUILINO', 'ENCARGADO', 'PROVEEDOR');

-- CreateEnum
CREATE TYPE "EstadoUnidad" AS ENUM ('ACTIVA', 'INACTIVA', 'EN_VENTA', 'ALQUILADA');

-- CreateEnum
CREATE TYPE "CategoriaGasto" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "EstadoLiquidacion" AS ENUM ('BORRADOR', 'PENDIENTE_APROBACION', 'APROBADA', 'ENVIADA', 'COBRADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "EstadoCobro" AS ENUM ('PENDIENTE', 'PAGADO', 'PARCIAL', 'MOROSO', 'PERDONADO');

-- CreateEnum
CREATE TYPE "EstadoTicket" AS ENUM ('NUEVO', 'ASIGNADO', 'EN_PROGRESO', 'ESPERA_PROPIETARIO', 'RESUELTO', 'CERRADO', 'REABIERTO');

-- CreateEnum
CREATE TYPE "PrioridadTicket" AS ENUM ('BAJA', 'MEDIA', 'ALTA', 'CRITICA');

-- CreateEnum
CREATE TYPE "TipoComunicacion" AS ENUM ('EMAIL', 'WHATSAPP', 'NOTIFICACION_PUSH', 'SMS');

-- CreateEnum
CREATE TYPE "TipoDocumento" AS ENUM ('RECIBO_EXPENSA', 'FACTURA', 'COMPROBANTE_PAGO', 'ACTA_ASAMBLEA', 'CONTRATO', 'SEGURO', 'OTRO');

-- CreateTable
CREATE TABLE "organizaciones" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "matricula_rpa" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizacion_usuarios" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizacion_usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gestor_edificios" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "edificio_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gestor_edificios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "telefono" TEXT,
    "rol" "RolUsuario" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edificios" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "ciudad" TEXT NOT NULL,
    "provincia" TEXT NOT NULL,
    "codigo_postal" TEXT NOT NULL,
    "reglamento_ph" TEXT,
    "fecha_inicio_admin" TIMESTAMP(3),
    "antiguedad" INTEGER,
    "total_m2" DECIMAL(10,2) NOT NULL,
    "amenities" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "edificios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidades" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "edificio_id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "m2" DECIMAL(10,2) NOT NULL,
    "coeficiente" DECIMAL(10,6) NOT NULL,
    "categoria_a" BOOLEAN NOT NULL DEFAULT true,
    "categoria_b" TEXT[],
    "categoria_c" TEXT,
    "estado" "EstadoUnidad" NOT NULL DEFAULT 'ACTIVA',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidad_usuarios" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "unidad_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "es_propietario" BOOLEAN NOT NULL DEFAULT false,
    "es_inquilino" BOOLEAN NOT NULL DEFAULT false,
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_fin" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unidad_usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gastos" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "edificio_id" TEXT NOT NULL,
    "concepto" TEXT NOT NULL,
    "descripcion" TEXT,
    "monto" DECIMAL(12,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'ARS',
    "categoria" "CategoriaGasto" NOT NULL,
    "servicio_especifico" TEXT,
    "sector_especifico" TEXT,
    "es_ordinario" BOOLEAN NOT NULL DEFAULT true,
    "comprobante_url" TEXT,
    "fecha_gasto" TIMESTAMP(3) NOT NULL,
    "periodo" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "gastos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidaciones" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "edificio_id" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "fecha_liquidacion" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoLiquidacion" NOT NULL DEFAULT 'BORRADOR',
    "total_ordinarias" DECIMAL(12,2) NOT NULL,
    "total_extraordinarias" DECIMAL(12,2) NOT NULL,
    "total_general" DECIMAL(12,2) NOT NULL,
    "matricula_rpa" TEXT NOT NULL,
    "qr_data" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),

    CONSTRAINT "liquidaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_detalles" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "liquidacion_id" TEXT NOT NULL,
    "unidad_id" TEXT NOT NULL,
    "gasto_id" TEXT NOT NULL,
    "coeficiente_aplicado" DECIMAL(10,6) NOT NULL,
    "montoAsignado" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidacion_detalles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cobros" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "liquidacion_id" TEXT NOT NULL,
    "unidad_id" TEXT NOT NULL,
    "monto_total" DECIMAL(12,2) NOT NULL,
    "monto_pagado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "monto_pendiente" DECIMAL(12,2) NOT NULL,
    "estado" "EstadoCobro" NOT NULL DEFAULT 'PENDIENTE',
    "metodo_pago" TEXT,
    "referencia_pago" TEXT,
    "fecha_pago" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cobros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "edificio_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "estado" "EstadoTicket" NOT NULL DEFAULT 'NUEVO',
    "prioridad" "PrioridadTicket" NOT NULL DEFAULT 'MEDIA',
    "categoria_ia" TEXT,
    "confianza_ia" DECIMAL(3,2),
    "creador_id" TEXT NOT NULL,
    "asignado_id" TEXT,
    "fuente" TEXT NOT NULL DEFAULT 'manual',
    "referencia_externa" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resuelto_at" TIMESTAMP(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comentarios" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "es_interno" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "ticket_comentarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comunicaciones" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "edificio_id" TEXT NOT NULL,
    "tipo" "TipoComunicacion" NOT NULL,
    "asunto" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "contenido_html" TEXT,
    "destinatarios" TEXT[],
    "enviado" BOOLEAN NOT NULL DEFAULT false,
    "fecha_envio" TIMESTAMP(3),
    "abiertos" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "comunicaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "edificio_id" TEXT NOT NULL,
    "tipo" "TipoDocumento" NOT NULL,
    "nombre" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "tamaño" INTEGER NOT NULL,
    "texto_extraido" TEXT,
    "embedding" vector(768),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" TEXT NOT NULL,

    CONSTRAINT "documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "tabla" TEXT NOT NULL,
    "registro_id" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "datos_anteriores" JSONB,
    "datos_nuevos" JSONB,
    "diff" JSONB,
    "usuario_id" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizacion_configs" (
    "id" TEXT NOT NULL,
    "organizacion_id" TEXT NOT NULL,
    "nombre_plataforma" TEXT NOT NULL,
    "dominio_email" TEXT NOT NULL,
    "enable_swarm" BOOLEAN NOT NULL DEFAULT true,
    "enable_ocr" BOOLEAN NOT NULL DEFAULT true,
    "enable_kanban" BOOLEAN NOT NULL DEFAULT false,
    "enable_benchmarking" BOOLEAN NOT NULL DEFAULT false,
    "mp_access_token" TEXT,
    "mp_public_key" TEXT,
    "wa_business_id" TEXT,
    "wa_phone_number_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizacion_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizaciones_cuit_key" ON "organizaciones"("cuit");

-- CreateIndex
CREATE INDEX "organizacion_usuarios_usuario_id_idx" ON "organizacion_usuarios"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizacion_usuarios_organizacion_id_usuario_id_key" ON "organizacion_usuarios"("organizacion_id", "usuario_id");

-- CreateIndex
CREATE INDEX "gestor_edificios_edificio_id_idx" ON "gestor_edificios"("edificio_id");

-- CreateIndex
CREATE UNIQUE INDEX "gestor_edificios_usuario_id_edificio_id_key" ON "gestor_edificios"("usuario_id", "edificio_id");

-- CreateIndex
CREATE INDEX "usuarios_organizacion_id_rol_idx" ON "usuarios"("organizacion_id", "rol");

-- CreateIndex
CREATE INDEX "usuarios_organizacion_id_activo_idx" ON "usuarios"("organizacion_id", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_organizacion_id_email_key" ON "usuarios"("organizacion_id", "email");

-- CreateIndex
CREATE INDEX "edificios_organizacion_id_idx" ON "edificios"("organizacion_id");

-- CreateIndex
CREATE INDEX "edificios_organizacion_id_ciudad_idx" ON "edificios"("organizacion_id", "ciudad");

-- CreateIndex
CREATE INDEX "unidades_organizacion_id_edificio_id_idx" ON "unidades"("organizacion_id", "edificio_id");

-- CreateIndex
CREATE INDEX "unidades_organizacion_id_edificio_id_tipo_idx" ON "unidades"("organizacion_id", "edificio_id", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "unidades_organizacion_id_edificio_id_numero_key" ON "unidades"("organizacion_id", "edificio_id", "numero");

-- CreateIndex
CREATE INDEX "unidad_usuarios_organizacion_id_usuario_id_idx" ON "unidad_usuarios"("organizacion_id", "usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "unidad_usuarios_organizacion_id_unidad_id_usuario_id_key" ON "unidad_usuarios"("organizacion_id", "unidad_id", "usuario_id");

-- CreateIndex
CREATE INDEX "gastos_organizacion_id_edificio_id_idx" ON "gastos"("organizacion_id", "edificio_id");

-- CreateIndex
CREATE INDEX "gastos_organizacion_id_edificio_id_periodo_idx" ON "gastos"("organizacion_id", "edificio_id", "periodo");

-- CreateIndex
CREATE INDEX "gastos_organizacion_id_edificio_id_categoria_idx" ON "gastos"("organizacion_id", "edificio_id", "categoria");

-- CreateIndex
CREATE INDEX "gastos_organizacion_id_edificio_id_es_ordinario_idx" ON "gastos"("organizacion_id", "edificio_id", "es_ordinario");

-- CreateIndex
CREATE INDEX "liquidaciones_organizacion_id_edificio_id_idx" ON "liquidaciones"("organizacion_id", "edificio_id");

-- CreateIndex
CREATE INDEX "liquidaciones_organizacion_id_edificio_id_estado_idx" ON "liquidaciones"("organizacion_id", "edificio_id", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "liquidaciones_organizacion_id_edificio_id_periodo_key" ON "liquidaciones"("organizacion_id", "edificio_id", "periodo");

-- CreateIndex
CREATE INDEX "liquidacion_detalles_organizacion_id_liquidacion_id_idx" ON "liquidacion_detalles"("organizacion_id", "liquidacion_id");

-- CreateIndex
CREATE INDEX "liquidacion_detalles_organizacion_id_unidad_id_idx" ON "liquidacion_detalles"("organizacion_id", "unidad_id");

-- CreateIndex
CREATE UNIQUE INDEX "liquidacion_detalles_organizacion_id_liquidacion_id_unidad__key" ON "liquidacion_detalles"("organizacion_id", "liquidacion_id", "unidad_id", "gasto_id");

-- CreateIndex
CREATE INDEX "cobros_organizacion_id_unidad_id_idx" ON "cobros"("organizacion_id", "unidad_id");

-- CreateIndex
CREATE INDEX "cobros_organizacion_id_estado_idx" ON "cobros"("organizacion_id", "estado");

-- CreateIndex
CREATE INDEX "cobros_organizacion_id_liquidacion_id_idx" ON "cobros"("organizacion_id", "liquidacion_id");

-- CreateIndex
CREATE INDEX "tickets_organizacion_id_edificio_id_idx" ON "tickets"("organizacion_id", "edificio_id");

-- CreateIndex
CREATE INDEX "tickets_organizacion_id_estado_idx" ON "tickets"("organizacion_id", "estado");

-- CreateIndex
CREATE INDEX "tickets_organizacion_id_prioridad_idx" ON "tickets"("organizacion_id", "prioridad");

-- CreateIndex
CREATE INDEX "tickets_organizacion_id_creador_id_idx" ON "tickets"("organizacion_id", "creador_id");

-- CreateIndex
CREATE INDEX "ticket_comentarios_organizacion_id_ticket_id_idx" ON "ticket_comentarios"("organizacion_id", "ticket_id");

-- CreateIndex
CREATE INDEX "comunicaciones_organizacion_id_edificio_id_idx" ON "comunicaciones"("organizacion_id", "edificio_id");

-- CreateIndex
CREATE INDEX "comunicaciones_organizacion_id_tipo_idx" ON "comunicaciones"("organizacion_id", "tipo");

-- CreateIndex
CREATE INDEX "documentos_organizacion_id_edificio_id_idx" ON "documentos"("organizacion_id", "edificio_id");

-- CreateIndex
CREATE INDEX "documentos_organizacion_id_tipo_idx" ON "documentos"("organizacion_id", "tipo");

-- CreateIndex
CREATE INDEX "audit_logs_organizacion_id_tabla_idx" ON "audit_logs"("organizacion_id", "tabla");

-- CreateIndex
CREATE INDEX "audit_logs_organizacion_id_registro_id_idx" ON "audit_logs"("organizacion_id", "registro_id");

-- CreateIndex
CREATE INDEX "audit_logs_organizacion_id_usuario_id_idx" ON "audit_logs"("organizacion_id", "usuario_id");

-- CreateIndex
CREATE INDEX "audit_logs_organizacion_id_created_at_idx" ON "audit_logs"("organizacion_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "organizacion_configs_organizacion_id_key" ON "organizacion_configs"("organizacion_id");

-- AddForeignKey
ALTER TABLE "organizacion_usuarios" ADD CONSTRAINT "organizacion_usuarios_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizacion_usuarios" ADD CONSTRAINT "organizacion_usuarios_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gestor_edificios" ADD CONSTRAINT "gestor_edificios_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gestor_edificios" ADD CONSTRAINT "gestor_edificios_edificio_id_fkey" FOREIGN KEY ("edificio_id") REFERENCES "edificios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edificios" ADD CONSTRAINT "edificios_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades" ADD CONSTRAINT "unidades_edificio_id_fkey" FOREIGN KEY ("edificio_id") REFERENCES "edificios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidad_usuarios" ADD CONSTRAINT "unidad_usuarios_unidad_id_fkey" FOREIGN KEY ("unidad_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidad_usuarios" ADD CONSTRAINT "unidad_usuarios_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_edificio_id_fkey" FOREIGN KEY ("edificio_id") REFERENCES "edificios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_edificio_id_fkey" FOREIGN KEY ("edificio_id") REFERENCES "edificios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_detalles" ADD CONSTRAINT "liquidacion_detalles_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_detalles" ADD CONSTRAINT "liquidacion_detalles_unidad_id_fkey" FOREIGN KEY ("unidad_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_detalles" ADD CONSTRAINT "liquidacion_detalles_gasto_id_fkey" FOREIGN KEY ("gasto_id") REFERENCES "gastos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobros" ADD CONSTRAINT "cobros_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobros" ADD CONSTRAINT "cobros_unidad_id_fkey" FOREIGN KEY ("unidad_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_edificio_id_fkey" FOREIGN KEY ("edificio_id") REFERENCES "edificios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_creador_id_fkey" FOREIGN KEY ("creador_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_asignado_id_fkey" FOREIGN KEY ("asignado_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comentarios" ADD CONSTRAINT "ticket_comentarios_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicaciones" ADD CONSTRAINT "comunicaciones_edificio_id_fkey" FOREIGN KEY ("edificio_id") REFERENCES "edificios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_edificio_id_fkey" FOREIGN KEY ("edificio_id") REFERENCES "edificios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizacion_configs" ADD CONSTRAINT "organizacion_configs_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
