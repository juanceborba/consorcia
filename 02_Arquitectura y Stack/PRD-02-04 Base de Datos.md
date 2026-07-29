---
title: "PRD-02-04: Base de Datos"
description: "Schema Prisma completo, modelo de datos multi-tenant, índices, triggers de auditoría y validaciones de coeficientes."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [database, prisma, postgres, schema, multi-tenant, pgvector, auditoria]
outcomes:
  - "Definir el schema completo del modelo de datos en Prisma"
  - "Implementar multi-tenancy a nivel de fila (RLS)"
  - "Garantizar integridad referencial y validaciones de negocio"
  - "Soportar embeddings vectoriales con pgvector para RAG"
  - "Auditar todos los cambios en datos sensibles"
---

# PRD-02-04: Base de Datos

> **PostgreSQL 17 + pgvector.** Multi-tenant por diseño. El tenant raíz es la **Organización** (administración/estudio). Cada tabla tiene `organizacion_id`.  
> **Regla:** Ninguna query sin `organizacion_id`. Nunca.

---

## 1. Principios de Diseño

### 1.1 Multi-tenancy

**Jerarquía:** `Organización 1—N Edificio 1—N Unidad N—M Usuario`. La **Organización** (administración/estudio) es el cliente del SaaS y la unidad de aislamiento: lleva CUIT, plan de suscripción y la matrícula RPA del administrador responsable. El staff (`org_admin`, `gestor`) pertenece a la organización; los residentes (propietario, inquilino, encargado, proveedor, consejo) pertenecen al edificio. `edificio_id` es el segundo nivel de scope: las queries que operan sobre un edificio filtran por ambos (`organizacion_id` + `edificio_id`) y Cerbos lo valida vía ABAC.

| Nivel | Implementación | Justificación |
|-------|---------------|---------------|
| **Schema** | Un solo schema `consorcia` | Simplicidad; no se necesitan JOIN entre organizaciones |
| **Tabla** | `organizacion_id` en cada tabla | RLS (Row Level Security) filtra automáticamente |
| **Query** | Middleware inyecta `organizacion_id` | Cero riesgo de fuga de datos entre organizaciones |
| **Índice** | Índice compuesto `(organizacion_id, ...)` | Performance optimizada para queries tenant-scoped |

**Implementación del schema `consorcia`:** Prisma genera el DDL sin calificar schema, así que la conexión fija el destino: el backend usa `DATABASE_URL=postgresql://...:5432/consorcia?schema=consorcia` (el parámetro `?schema=` setea el `search_path` de Prisma de forma exclusiva; además `init-db` hace `ALTER USER consorcia SET search_path = consorcia, public` para el resto de los clientes). Consecuencia: la extensión `vector` vive en el schema `consorcia` (`CREATE EXTENSION ... WITH SCHEMA consorcia`), porque con el `search_path` exclusivo de Prisma el tipo no se resolvería si quedara en `public`.

### 1.2 Auditoría

Toda tabla con datos sensibles tiene:
- `created_at` + `created_by`
- `updated_at` + `updated_by`
- `deleted_at` (soft delete) + `deleted_by`
- Tabla de auditoría `_audit_log` con JSON diff

### 1.3 Validaciones

| Regla | Implementación |
|-------|---------------|
| Suma de coeficientes = 1 | Trigger `BEFORE INSERT/UPDATE` en `unidades` |
| Suma de montos = montoTotal | Trigger `AFTER INSERT` en `liquidacion_detalle` |
| Coeficiente >= 0 | Constraint `CHECK` en `unidades.coeficiente` |
| Monto > 0 | Constraint `CHECK` en `gastos.monto` |
| Email único por organización | Índice único compuesto `(organizacion_id, email)` (el mismo email puede existir en otra organización) |

---

## 2. Schema Prisma Completo

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ==========================================
// EXTENSIONES
// ==========================================
// pgvector se habilita vía migration SQL, no en Prisma schema

// ==========================================
// ENUMS
// ==========================================

enum RolUsuario {
  SUPERADMIN  // Staff ConsorcIA
  ORG_ADMIN   // Dueño de la organización: facturación, alta de edificios/usuarios
  GESTOR      // Staff de la organización que opera edificios asignados
  CONSEJO     // Scope edificio
  PROPIETARIO // Scope edificio/UF
  INQUILINO   // Scope edificio/UF
  ENCARGADO   // Scope edificio
  PROVEEDOR   // Scope edificio
}

enum EstadoUnidad {
  ACTIVA
  INACTIVA
  EN_VENTA
  ALQUILADA
}

enum CategoriaGasto {
  A // Gastos generales → todas las UF
  B // Servicios específicos → solo UF que los usan
  C // Sectores específicos → solo UF del sector
}

enum EstadoLiquidacion {
  BORRADOR
  PENDIENTE_APROBACION
  APROBADA
  ENVIADA
  COBRADA
  ANULADA
}

enum EstadoCobro {
  PENDIENTE
  PAGADO
  PARCIAL
  MOROSO
  PERDONADO
}

enum EstadoTicket {
  NUEVO
  ASIGNADO
  EN_PROGRESO
  ESPERA_PROPIETARIO
  RESUELTO
  CERRADO
  REABIERTO
}

enum PrioridadTicket {
  BAJA
  MEDIA
  ALTA
  CRITICA
}

enum TipoComunicacion {
  EMAIL
  WHATSAPP
  NOTIFICACION_PUSH
  SMS
}

enum TipoDocumento {
  RECIBO_EXPENSA
  FACTURA
  COMPROBANTE_PAGO
  ACTA_ASAMBLEA
  CONTRATO
  SEGURO
  OTRO
}

// ==========================================
// ORGANIZACIONES (TENANT RAÍZ)
// ==========================================

model Organizacion {
  id              String   @id @default(uuid())

  // Identificación
  nombre          String
  cuit            String   @unique // CUIT de la administración/estudio
  plan            String   @default("starter") // Plan de suscripción SaaS

  // Ley 941 CABA: la matrícula es del administrador responsable, no del edificio
  matriculaRPA    String   @map("matricula_rpa")

  // Relaciones
  edificios       Edificio[]
  miembros        OrganizacionUsuario[]
  config          OrganizacionConfig?

  // Timestamps
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("organizaciones")
}

// Membresía: usuario ↔ organización (staff: org_admin, gestor)
model OrganizacionUsuario {
  id              String   @id @default(uuid())
  organizacionId  String   @map("organizacion_id")
  usuarioId       String   @map("usuario_id")

  // Rol de organización: ORG_ADMIN o GESTOR
  rol             RolUsuario

  // Relaciones
  organizacion    Organizacion @relation(fields: [organizacionId], references: [id])
  usuario         Usuario      @relation(fields: [usuarioId], references: [id])

  // Timestamps
  createdAt       DateTime @default(now()) @map("created_at")

  @@unique([organizacionId, usuarioId])
  @@index([usuarioId])
  @@map("organizacion_usuarios")
}

// Edificios asignados a cada gestor
model GestorEdificio {
  id              String   @id @default(uuid())
  usuarioId       String   @map("usuario_id")
  edificioId      String   @map("edificio_id")

  // Relaciones
  gestor          Usuario  @relation(fields: [usuarioId], references: [id])
  edificio        Edificio @relation(fields: [edificioId], references: [id])

  // Timestamps
  createdAt       DateTime @default(now()) @map("created_at")

  @@unique([usuarioId, edificioId])
  @@index([edificioId])
  @@map("gestor_edificios")
}

// ==========================================
// USUARIOS Y AUTENTICACIÓN
// ==========================================

model Usuario {
  id              String   @id @default(uuid())
  organizacionId  String   @map("organizacion_id")
  email           String
  passwordHash    String   @map("password_hash")
  nombre          String
  apellido        String
  telefono        String?
  rol             RolUsuario
  activo          Boolean  @default(true)

  // Relaciones
  organizaciones  OrganizacionUsuario[]
  edificiosGestionados GestorEdificio[]
  unidades        UnidadUsuario[]
  ticketsCreados  Ticket[]         @relation("TicketCreador")
  ticketsAsignados Ticket[]        @relation("TicketAsignado")
  auditLogs       AuditLog[]

  // Timestamps
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  deletedAt   DateTime? @map("deleted_at")

  @@unique([organizacionId, email])
  @@index([organizacionId, rol])
  @@index([organizacionId, activo])
  @@map("usuarios")
}

// ==========================================
// EDIFICIOS Y UNIDADES
// ==========================================

model Edificio {
  id              String   @id @default(uuid())
  organizacionId  String   @map("organizacion_id")
  nombre          String
  direccion       String
  ciudad          String
  provincia       String
  codigoPostal    String   @map("codigo_postal")

  // Tipología del consorcio: "ph", "barrio_privado", "centro_comercial", "otro" (S2-01)
  tipo            String   @default("ph")

  // Soft delete (S2-01): false = dado de baja; se conserva por Ley 941
  activo          Boolean  @default(true)

  // Propiedad Horizontal
  reglamentoPH    String?  @map("reglamento_ph") // URL al documento
  fechaInicioAdmin DateTime? @map("fecha_inicio_admin")

  // Características
  antiguedad      Int?     // Años
  totalM2         Decimal  @map("total_m2") @db.Decimal(10, 2)
  amenities       String[] // pileta, gimnasio, sum, etc.

  // Relaciones
  organizacion    Organizacion @relation(fields: [organizacionId], references: [id])
  gestores        GestorEdificio[]
  unidades        Unidad[]
  gastos          Gasto[]
  liquidaciones   Liquidacion[]
  tickets         Ticket[]
  comunicaciones  Comunicacion[]
  documentos      Documento[]

  // Timestamps
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([organizacionId])
  @@index([organizacionId, ciudad])
  @@index([organizacionId, activo])
  @@map("edificios")
}

model Unidad {
  id              String   @id @default(uuid())
  organizacionId        String   @map("organizacion_id")
  edificioId      String   @map("edificio_id")

  // Identificación
  numero          String   // "3A", "PB", "Coch-12", etc.
  tipo            String   // "departamento", "local", "cochera", "baulera", "oficina"

  // Propiedad Horizontal
  m2              Decimal  @db.Decimal(10, 2)
  coeficiente     Decimal  @db.Decimal(10, 6) // 0.076543 = 7.6543%

  // Categorías de distribución
  categoriaA      Boolean  @default(true) @map("categoria_a") // Gastos generales
  categoriaB      String[] @map("categoria_b") // Servicios específicos: ["ascensor", "calefaccion"]
  categoriaC      String?  @map("categoria_c") // Sector específico: "torre_a", "pileta"

  // Estado
  estado          EstadoUnidad @default(ACTIVA)

  // Relaciones
  edificio        Edificio @relation(fields: [edificioId], references: [id])
  usuarios        UnidadUsuario[]
  liquidaciones   LiquidacionDetalle[]
  cobros          Cobro[]

  // Timestamps
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@unique([organizacionId, edificioId, numero])
  @@index([organizacionId, edificioId])
  @@index([organizacionId, edificioId, tipo])
  @@map("unidades")
}

model UnidadUsuario {
  id          String   @id @default(uuid())
  organizacionId    String   @map("organizacion_id")
  unidadId    String   @map("unidad_id")
  usuarioId   String   @map("usuario_id")

  // Rol específico en esta unidad
  esPropietario Boolean @default(false) @map("es_propietario")
  esInquilino   Boolean @default(false) @map("es_inquilino")
  fechaInicio   DateTime @map("fecha_inicio")
  fechaFin      DateTime? @map("fecha_fin")

  // Relaciones
  unidad      Unidad   @relation(fields: [unidadId], references: [id])
  usuario     Usuario  @relation(fields: [usuarioId], references: [id])

  // Timestamps
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@unique([organizacionId, unidadId, usuarioId])
  @@index([organizacionId, usuarioId])
  @@map("unidad_usuarios")
}

// ==========================================
// GASTOS
// ==========================================

model Gasto {
  id              String   @id @default(uuid())
  organizacionId        String   @map("organizacion_id")
  edificioId      String   @map("edificio_id")

  // Datos del gasto
  concepto        String
  descripcion     String?
  monto           Decimal  @db.Decimal(12, 2)
  moneda          String   @default("ARS")

  // Categorización
  categoria       CategoriaGasto
  servicioEspecifico String? @map("servicio_especifico") // Para cat B: "ascensor"
  sectorEspecifico   String? @map("sector_especifico")   // Para cat C: "torre_a"

  // Clasificación
  esOrdinario     Boolean  @default(true) @map("es_ordinario") // true = ordinario, false = extraordinario

  // Documento soporte
  comprobanteUrl  String?  @map("comprobante_url")

  // Fechas
  fechaGasto      DateTime @map("fecha_gasto")
  periodo         String   // "2026-07"

  // Relaciones
  edificio        Edificio @relation(fields: [edificioId], references: [id])
  liquidaciones   LiquidacionDetalle[]

  // Timestamps
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  createdBy       String   @map("created_by")

  @@index([organizacionId, edificioId])
  @@index([organizacionId, edificioId, periodo])
  @@index([organizacionId, edificioId, categoria])
  @@index([organizacionId, edificioId, esOrdinario])
  @@map("gastos")
}

// ==========================================
// LIQUIDACIONES
// ==========================================

model Liquidacion {
  id              String   @id @default(uuid())
  organizacionId        String   @map("organizacion_id")
  edificioId      String   @map("edificio_id")

  // Período
  periodo         String   // "2026-07"
  fechaLiquidacion DateTime @map("fecha_liquidacion")

  // Estado
  estado          EstadoLiquidacion @default(BORRADOR)

  // Totales
  totalOrdinarias Decimal  @map("total_ordinarias") @db.Decimal(12, 2)
  totalExtraordinarias Decimal @map("total_extraordinarias") @db.Decimal(12, 2)
  totalGeneral    Decimal  @map("total_general") @db.Decimal(12, 2)

  // Ley 941
  matriculaRPA    String   @map("matricula_rpa")
  qrData          String?  @map("qr_data") // JSON con datos para QR

  // Relaciones
  edificio        Edificio @relation(fields: [edificioId], references: [id])
  detalles        LiquidacionDetalle[]
  cobros          Cobro[]

  // Timestamps
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  approvedBy      String?  @map("approved_by")
  approvedAt      DateTime? @map("approved_at")

  @@unique([organizacionId, edificioId, periodo])
  @@index([organizacionId, edificioId])
  @@index([organizacionId, edificioId, estado])
  @@map("liquidaciones")
}

model LiquidacionDetalle {
  id              String   @id @default(uuid())
  organizacionId        String   @map("organizacion_id")
  liquidacionId   String   @map("liquidacion_id")
  unidadId        String   @map("unidad_id")
  gastoId         String   @map("gasto_id")

  // Distribución
  coeficienteAplicado Decimal @map("coeficiente_aplicado") @db.Decimal(10, 6)
  montoAsignado   Decimal  @db.Decimal(12, 2)

  // Relaciones
  liquidacion     Liquidacion @relation(fields: [liquidacionId], references: [id])
  unidad          Unidad   @relation(fields: [unidadId], references: [id])
  gasto           Gasto    @relation(fields: [gastoId], references: [id])

  // Timestamps
  createdAt       DateTime @default(now()) @map("created_at")

  @@unique([organizacionId, liquidacionId, unidadId, gastoId])
  @@index([organizacionId, liquidacionId])
  @@index([organizacionId, unidadId])
  @@map("liquidacion_detalles")
}

// ==========================================
// COBROS
// ==========================================

model Cobro {
  id              String   @id @default(uuid())
  organizacionId        String   @map("organizacion_id")
  liquidacionId   String   @map("liquidacion_id")
  unidadId        String   @map("unidad_id")

  // Montos
  montoTotal      Decimal  @map("monto_total") @db.Decimal(12, 2)
  montoPagado     Decimal  @default(0) @map("monto_pagado") @db.Decimal(12, 2)
  montoPendiente  Decimal  @map("monto_pendiente") @db.Decimal(12, 2)

  // Estado
  estado          EstadoCobro @default(PENDIENTE)

  // Pago
  metodoPago      String?  @map("metodo_pago") // "mercadopago", "transferencia", "efectivo"
  referenciaPago  String?  @map("referencia_pago")
  fechaPago       DateTime? @map("fecha_pago")

  // Relaciones
  liquidacion     Liquidacion @relation(fields: [liquidacionId], references: [id])
  unidad          Unidad   @relation(fields: [unidadId], references: [id])

  // Timestamps
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([organizacionId, unidadId])
  @@index([organizacionId, estado])
  @@index([organizacionId, liquidacionId])
  @@map("cobros")
}

// ==========================================
// TICKETS / KANBAN
// ==========================================

model Ticket {
  id              String   @id @default(uuid())
  organizacionId        String   @map("organizacion_id")
  edificioId      String   @map("edificio_id")

  // Datos
  titulo          String
  descripcion     String
  estado          EstadoTicket @default(NUEVO)
  prioridad       PrioridadTicket @default(MEDIA)

  // Categorización IA
  categoriaIA     String?  @map("categoria_ia") // Clasificación automática
  confianzaIA     Decimal? @map("confianza_ia") @db.Decimal(3, 2) // 0.00 - 1.00

  // Asignación
  creadorId       String   @map("creador_id")
  asignadoId      String?  @map("asignado_id")

  // Origen
  fuente          String   @default("manual") // "email", "whatsapp", "portal", "manual"
  referenciaExterna String? @map("referencia_externa") // ID de email, etc.

  // Relaciones
  edificio        Edificio @relation(fields: [edificioId], references: [id])
  creador         Usuario  @relation("TicketCreador", fields: [creadorId], references: [id])
  asignado        Usuario? @relation("TicketAsignado", fields: [asignadoId], references: [id])
  comentarios     TicketComentario[]

  // Timestamps
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  resueltoAt      DateTime? @map("resuelto_at")

  @@index([organizacionId, edificioId])
  @@index([organizacionId, estado])
  @@index([organizacionId, prioridad])
  @@index([organizacionId, creadorId])
  @@map("tickets")
}

model TicketComentario {
  id          String   @id @default(uuid())
  organizacionId    String   @map("organizacion_id")
  ticketId    String   @map("ticket_id")

  contenido   String
  esInterno   Boolean  @default(false) @map("es_interno") // true = solo admin

  // Relaciones
  ticket      Ticket   @relation(fields: [ticketId], references: [id])

  // Timestamps
  createdAt   DateTime @default(now()) @map("created_at")
  createdBy   String   @map("created_by")

  @@index([organizacionId, ticketId])
  @@map("ticket_comentarios")
}

// ==========================================
// COMUNICACIONES
// ==========================================

model Comunicacion {
  id              String   @id @default(uuid())
  organizacionId        String   @map("organizacion_id")
  edificioId      String   @map("edificio_id")

  // Datos
  tipo            TipoComunicacion
  asunto          String
  contenido       String
  contenidoHtml   String?  @map("contenido_html")

  // Destinatarios
  destinatarios   String[] // Array de emails

  // Estado
  enviado         Boolean  @default(false)
  fechaEnvio      DateTime? @map("fecha_envio")

  // Métricas
  abiertos        Int      @default(0)
  clicks          Int      @default(0)

  // Relaciones
  edificio        Edificio @relation(fields: [edificioId], references: [id])

  // Timestamps
  createdAt       DateTime @default(now()) @map("created_at")
  createdBy       String   @map("created_by")

  @@index([organizacionId, edificioId])
  @@index([organizacionId, tipo])
  @@map("comunicaciones")
}

// ==========================================
// DOCUMENTOS
// ==========================================

model Documento {
  id              String   @id @default(uuid())
  organizacionId        String   @map("organizacion_id")
  edificioId      String   @map("edificio_id")

  // Datos
  tipo            TipoDocumento
  nombre          String
  url             String
  mimeType        String   @map("mime_type")
  tamaño          Int      // Bytes

  // OCR / IA
  textoExtraido   String?  @map("texto_extraido")
  embedding       Unsupported("vector(768)")? // pgvector

  // Relaciones
  edificio        Edificio @relation(fields: [edificioId], references: [id])

  // Timestamps
  createdAt       DateTime @default(now()) @map("created_at")
  uploadedBy      String   @map("uploaded_by")

  @@index([organizacionId, edificioId])
  @@index([organizacionId, tipo])
  @@map("documentos")
}

// ==========================================
// AUDITORÍA
// ==========================================

model AuditLog {
  id          String   @id @default(uuid())
  organizacionId    String   @map("organizacion_id")

  // Qué pasó
  tabla       String
  registroId  String   @map("registro_id")
  accion      String   // "CREATE", "UPDATE", "DELETE"

  // Datos
  datosAnteriores Json?  @map("datos_anteriores")
  datosNuevos   Json?    @map("datos_nuevos")
  diff          Json?    // Solo los campos cambiados

  // Quién
  usuarioId   String   @map("usuario_id")
  ipAddress   String?  @map("ip_address")
  userAgent   String?  @map("user_agent")

  // Relaciones
  usuario     Usuario  @relation(fields: [usuarioId], references: [id])

  // Timestamp
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([organizacionId, tabla])
  @@index([organizacionId, registroId])
  @@index([organizacionId, usuarioId])
  @@index([organizacionId, createdAt])
  @@map("audit_logs")
}

// ==========================================
// CONFIGURACIÓN POR ORGANIZACIÓN
// ==========================================

model OrganizacionConfig {
  id              String   @id @default(uuid())
  organizacionId  String   @unique @map("organizacion_id")

  // Configuración general
  nombrePlataforma String  @map("nombre_plataforma")
  dominioEmail    String   @map("dominio_email") // Dominio base de la organización (consorcios.miestudio.com); los inboxes se generan por edificio (edificio-123@consorcios.miestudio.com)

  // Feature flags
  enableSwarm     Boolean  @default(true) @map("enable_swarm")
  enableOCR       Boolean  @default(true) @map("enable_ocr")
  enableKanban    Boolean  @default(false) @map("enable_kanban")
  enableBenchmarking Boolean @default(false) @map("enable_benchmarking")

  // MercadoPago (credenciales de la organización)
  mpAccessToken   String?  @map("mp_access_token")
  mpPublicKey     String?  @map("mp_public_key")

  // WhatsApp (credenciales de la organización)
  waBusinessId    String?  @map("wa_business_id")
  waPhoneNumberId String?  @map("wa_phone_number_id")

  // Relaciones
  organizacion    Organizacion @relation(fields: [organizacionId], references: [id])

  // Timestamps
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("organizacion_configs")
}
```

---

## 3. Triggers de Validación (SQL)

```sql
-- migrations/validation_triggers.sql

-- ==========================================
-- TRIGGER: Validar suma de coeficientes = 1
-- ==========================================
CREATE OR REPLACE FUNCTION validar_suma_coeficientes()
RETURNS TRIGGER AS $$
DECLARE
    suma DECIMAL(10,6);
    edificio_uuid UUID;
BEGIN
    edificio_uuid := COALESCE(NEW.edificio_id, OLD.edificio_id);

    SELECT SUM(coeficiente) INTO suma
    FROM unidades
    WHERE edificio_id = edificio_uuid
      AND organizacion_id = COALESCE(NEW.organizacion_id, OLD.organizacion_id);

    IF suma IS NOT NULL AND ABS(suma - 1.0) > 0.000001 THEN
        RAISE EXCEPTION 'Suma de coeficientes debe ser 1.0. Actual: %', suma;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validar_coeficientes
AFTER INSERT OR UPDATE OR DELETE ON unidades
FOR EACH ROW
EXECUTE FUNCTION validar_suma_coeficientes();

-- ==========================================
-- TRIGGER: Validar suma de montos = montoTotal
-- ==========================================
CREATE OR REPLACE FUNCTION validar_suma_liquidacion()
RETURNS TRIGGER AS $$
DECLARE
    total_gastos DECIMAL(12,2);
    total_detalles DECIMAL(12,2);
BEGIN
    SELECT total_general INTO total_gastos
    FROM liquidaciones
    WHERE id = NEW.liquidacion_id;

    SELECT SUM(monto_asignado) INTO total_detalles
    FROM liquidacion_detalles
    WHERE liquidacion_id = NEW.liquidacion_id;

    IF total_detalles IS NOT NULL AND ABS(total_detalles - total_gastos) > 0.01 THEN
        RAISE EXCEPTION 'Desbalance en liquidación: detalles=% vs total=%', 
            total_detalles, total_gastos;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validar_liquidacion
AFTER INSERT OR UPDATE ON liquidacion_detalles
FOR EACH ROW
EXECUTE FUNCTION validar_suma_liquidacion();

-- ==========================================
-- TRIGGER: Audit log automático
-- ==========================================
CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (
            organizacion_id, tabla, registro_id, accion,
            datos_anteriores, datos_nuevos, diff,
            usuario_id, created_at
        ) VALUES (
            OLD.organizacion_id, TG_TABLE_NAME, OLD.id, 'DELETE',
            to_jsonb(OLD), NULL, NULL,
            current_setting('app.current_user_id', true)::UUID,
            NOW()
        );
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (
            organizacion_id, tabla, registro_id, accion,
            datos_anteriores, datos_nuevos, diff,
            usuario_id, created_at
        ) VALUES (
            NEW.organizacion_id, TG_TABLE_NAME, NEW.id, 'UPDATE',
            to_jsonb(OLD), to_jsonb(NEW),
            jsonb_diff_val(to_jsonb(OLD), to_jsonb(NEW)),
            current_setting('app.current_user_id', true)::UUID,
            NOW()
        );
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (
            organizacion_id, tabla, registro_id, accion,
            datos_anteriores, datos_nuevos, diff,
            usuario_id, created_at
        ) VALUES (
            NEW.organizacion_id, TG_TABLE_NAME, NEW.id, 'CREATE',
            NULL, to_jsonb(NEW), to_jsonb(NEW),
            current_setting('app.current_user_id', true)::UUID,
            NOW()
        );
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Aplicar a tablas sensibles
CREATE TRIGGER audit_gastos
AFTER INSERT OR UPDATE OR DELETE ON gastos
FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER audit_liquidaciones
AFTER INSERT OR UPDATE OR DELETE ON liquidaciones
FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER audit_cobros
AFTER INSERT OR UPDATE OR DELETE ON cobros
FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

---

## 4. Row Level Security (RLS)

```sql
-- migrations/rls_policies.sql

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
```

---

## 5. Decisiones de Diseño

| Decisión | Contexto | Justificación |
|----------|----------|---------------|
| **Prisma ORM** | Type safety + migrations | Shared types con frontend, migraciones versionadas, validaciones declarativas |
| **pgvector en PostgreSQL** | Embeddings para RAG | Sin servicio adicional, backups unificados, queries JOIN |
| **Soft delete** | Datos históricos | Ley 941 exige conservación. `deleted_at` + `deleted_by` |
| **Decimal(12,2)** | Montos en ARS | Precisión exacta. Nunca float para dinero |
| **Decimal(10,6)** | Coeficientes | 6 decimales suficientes para precisión de PH |
| **Organización como tenant raíz** | Multi-tenancy | El cliente del SaaS es la administración/estudio, que gestiona N edificios; la Ley 14.701 PBA contempla la persona jurídica administradora. `edificio_id` queda como segundo nivel de scope |
| **Matrícula RPA a nivel organización** | Ley 941 CABA | La matrícula es del administrador responsable, no del edificio; se hereda a todas las liquidaciones de su cartera |
| **UUID primary keys** | Multi-tenant | Evita colisiones, no revela secuencia |
| **JSON diff en audit** | Trazabilidad | Solo guardar cambios, no todo el registro |
| **Periodo como String** | Liquidaciones | Formato "YYYY-MM" para fácil sorting y grouping |

---

*Documento relacionado:* [[PRD-02-01 Arquitectura General]]  
*Documento relacionado:* [[PRD-02-03 Infraestructura Docker]]  
*Documento relacionado:* [[PRD-04-01 Gestión de Edificios]]  
*Documento relacionado:* [[PRD-04-03 Liquidación de Expensas]]
