---
title: "PRD-05-04: Cerbos RBAC"
description: "Especificación de la capa de autorización con Cerbos: políticas como código, RBAC, ABAC, audit log y multi-tenancy a nivel de organización."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [cerbos, rbac, abac, autorizacion, seguridad, politicas, multi-tenant, consorcIA]
outcomes:
  - "Definir modelo de roles y permisos para todos los actores del sistema"
  - "Especificar políticas de Cerbos en YAML para cada recurso"
  - "Diseñar ABAC con contexto dinámico (horario, UF asignada, etc.)"
  - "Establecer audit log de decisiones de autorización"
  - "Documentar integración con Express middleware"
---

# PRD-05-04: Cerbos RBAC

> **Cerbos es la capa de autorización de ConsorcIA. En lugar de if/else dispersos en el código, las políticas de acceso se definen como código YAML versionable, auditables y evaluables en <1ms. Soporta RBAC tradicional y ABAC (context-aware) para casos complejos como "solo podés ver expensas de TU unidad funcional".**

---

## 1. Arquitectura de Autorización

### 1.1 Diagrama de flujo

```
Request (API REST)
        │
        ▼
┌─────────────────┐
│ Auth Middleware │ → JWT validation
│ (Express)       │   Extraer: userId, roles, org_id
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Cerbos PDP      │ → Evaluar políticas YAML
│ (Policy Decision│   Input: principal + resource + action
│  Point)         │   Output: ALLOW / DENY
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐  ┌──────────┐
│ ALLOW │  │ DENY     │
│       │  │ 403      │
│ Siguiente│          │
│ middleware│         │
└───────┘  └──────────┘
```

### 1.2 Stack de autorización

| Componente | Tecnología | Rol |
|------------|------------|-----|
| **Auth** | JWT (jsonwebtoken) | Autenticación. Quién sos. |
| **Cerbos PDP** | Cerbos (Docker) | Autorización. Qué podés hacer. |
| **Policies** | YAML versionable | Reglas de acceso como código. |
| **Audit** | PostgreSQL + pgvector | Log de cada decisión de autorización. |

---

## 2. Modelo de Roles

### 2.1 Roles del sistema

| Rol | Descripción | Scope |
|-----|-------------|-------|
| `superadmin` | Equipo de ConsorcIA | Global (todas las organizaciones) |
| `org_admin` | Dueño de la organización (administración/estudio) | Toda la organización: N edificios, facturación, alta de edificios y usuarios |
| `gestor` | Staff de la organización | Edificios asignados de su organización |
| `consejo` | Miembro del Consejo de Propietarios | Reportes y votaciones de su edificio |
| `propietario` | Dueño de UF | Su UF + datos agregados de su edificio |
| `inquilino` | Habitante (locatario) | Su UF (acceso limitado) |
| `encargado` | Encargado del edificio | Tareas asignadas de su edificio |
| `proveedor` | Contratista externo | Tickets y facturas de su edificio |

### 2.2 Jerarquía de roles

```
superadmin
    └── org_admin              ← nivel organización (cliente del SaaS)
            └── gestor
                    ├── consejo      ← nivel edificio
                    ├── propietario
                    ├── inquilino
                    ├── encargado
                    └── proveedor
```

> **Regla:** Un rol superior hereda todos los permisos de los roles inferiores en su rama, salvo excepciones explícitas.
>
> **Dos niveles de scope:** los roles `org_admin` y `gestor` pertenecen a la **organización** (la administración/estudio, cliente del SaaS) y operan sobre sus N edificios. Los roles `consejo`, `propietario`, `inquilino`, `encargado` y `proveedor` pertenecen a un **edificio** puntual (y, en el caso de propietario/inquilino, a una unidad funcional dentro de él).

---

## 3. Políticas de Cerbos

### 3.1 Estructura de policies

```yaml
# /policies/edificio.yaml
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  version: "default"
  resource: "edificio"
  rules:
    # Superadmin puede todo
    - actions: ['*']
      effect: EFFECT_ALLOW
      roles:
        - superadmin

    # Org admin ve todos los edificios de su organización
    - actions: ['read', 'update']
      effect: EFFECT_ALLOW
      roles:
        - org_admin
      condition:
        match:
          expr: request.resource.attr.organizacion_id == request.principal.attr.organizacion_id

    # Gestor solo ve los edificios asignados dentro de su organización
    - actions: ['read', 'update']
      effect: EFFECT_ALLOW
      roles:
        - gestor
      condition:
        match:
          all:
            of:
              - expr: request.resource.attr.organizacion_id == request.principal.attr.organizacion_id
              - expr: request.resource.attr.id in request.principal.attr.edificios_asignados

    # Propietario solo ve su edificio
    - actions: ['read']
      effect: EFFECT_ALLOW
      roles:
        - propietario
        - inquilino
      condition:
        match:
          expr: request.resource.attr.id == request.principal.attr.edificio_id
```

> **Sin regla DENY global.** En Cerbos un `EFFECT_DENY` matcheado tiene
> precedencia sobre cualquier `EFFECT_ALLOW`, así que una regla catch-all de
> deny terminaría denegando todo; el default cuando ninguna regla matchea ya
> es DENY. Además, desde Cerbos 0.54 toda regla debe declarar `roles` (o
> `derivedRoles`) y las condiciones compuestas usan `all/any/none: of:`.

### 3.2 Políticas por recurso

| Recurso | Archivo | Reglas clave |
|---------|---------|--------------|
| `organizacion` | `organizacion.yaml` | Org admin: full sobre su organización. Gestor: solo lectura. Superadmin: global. |
| `edificio` | `edificio.yaml` | Org admin: todos los de su organización. Gestor: solo asignados. Residente: solo el suyo. |
| `unidad_funcional` | `unidad_funcional.yaml` | Residente solo su UF. Org admin/gestor: todas de la organización (y su edificio). |
| `gasto` | `gasto.yaml` | Org admin/gestor: CRUD en su organización. Residente: solo lectura de gastos de su edificio. |
| `liquidacion` | `liquidacion.yaml` | Org admin/gestor: CRUD en su organización. Residente: solo ver la suya. |
| `recibo` | `recibo.yaml` | Residente: solo el de su UF. Org admin/gestor: todos de la organización. |
| `ticket` | `ticket.yaml` | Residente: CRUD sobre los suyos. Org admin/gestor: todos de la organización. Encargado: asignados. |
| `pago` | `pago.yaml` | Residente: ver solo los suyos. Org admin/gestor: todos de la organización (y su edificio). |
| `reporte` | `reporte.yaml` | Consejo: lectura. Org admin/gestor: CRUD en su organización. Superadmin: todas las organizaciones. |
| `usuario` | `usuario.yaml` | Org admin: CRUD en su organización. Gestor: usuarios de sus edificios. Residente: solo su perfil. |

### 3.3 ABAC: Contexto dinámico

```yaml
# Ejemplo: horario de atención para encargado
- actions: ['update_ticket']
  effect: EFFECT_ALLOW
  roles:
    - encargado
  condition:
    match:
      all:
        - expr: request.resource.attr.asignado_a == request.principal.id
        - expr: >
            timestamp(request.aux_data.now).getHours() >= 8 &&
            timestamp(request.aux_data.now).getHours() <= 18
```

```yaml
# Ejemplo: gastos >ARS 50.000 requieren consejo
- actions: ['approve_gasto']
  effect: EFFECT_ALLOW
  roles:
    - org_admin
  condition:
    match:
      expr: request.resource.attr.monto < 50000

- actions: ['approve_gasto']
  effect: EFFECT_ALLOW
  roles:
    - consejo
  condition:
    match:
      expr: request.resource.attr.monto >= 50000
```

---

## 4. Integración con Express

### 4.1 Middleware de autorización

La integración es por **HTTP plano** contra el PDP (`fetch` nativo de Node 20,
sin SDK ni dependencia extra): `POST http://cerbos:3592/api/check/resources`.
Es el endpoint vigente en Cerbos 0.54 (el singular `/api/check/resource` no
existe). Implementación real en `backend/src/middleware/rbac.middleware.js`:

```javascript
// middleware/rbac.middleware.js (simplificado)
export function autorizar(kind, action, resolverRecurso) {
  return async (req, res, next) => {
    const recurso = resolverRecurso(req);
    const respuesta = await fetch(`${CERBOS_URL}/api/check/resources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({
        requestId: randomUUID(),
        principal: {
          id: req.user.id,
          roles: req.user.roles,
          attr: {
            organizacion_id: req.user.organizacionId,
            edificios_asignados: req.user.edificiosAsignados,
          },
        },
        resources: [
          { resource: { kind, id: recurso.id, attr: recurso.attr }, actions: [action] },
        ],
      }),
    });
    const efecto = (await respuesta.json())?.results?.[0]?.actions?.[action];
    if (respuesta.ok && efecto === 'EFFECT_ALLOW') return next();
    return res.status(403).json({ error: { code: 'ACCESO_DENEGADO', message: '...' } });
  };
}

// Uso en rutas:
// router.get('/edificios/:id', requireAuth, tenant, validarEdificio,
//   autorizar('edificio', 'read', (req) => ({ id: req.edificio.id, attr: { ... } })), detalle);
```

El middleware es **fail-closed**: PDP caído, timeout, respuesta ambigua o
`EFFECT_DENY` se traducen en 403.

### 4.2 Tenant isolation

```typescript
// Cada request DEBE incluir org_id (extraído del JWT)
// El middleware de Cerbos valida que el usuario tenga acceso a esa organización

// Además, todas las queries a DB scopean por organizacion_id
// (+ edificio_id cuando operan sobre un edificio puntual):
// prisma.gasto.findMany({ where: { organizacionId: req.orgId, edificioId } })
// Esto es defensa en profundidad: Cerbos + query scopeada
```

---

## 5. Audit Log

### 5.1 Estructura del log

```typescript
interface AuthDecisionLog {
  id: string;
  timestamp: Date;
  requestId: string;

  principal: {
    id: string;
    roles: string[];
    orgId: string;
    edificioId: string;
  };

  resource: {
    kind: string;
    id: string;
    orgId: string;
    edificioId: string;
  };

  action: string;
  decision: 'ALLOW' | 'DENY';
  policyMatched: string;      // Qué política de YAML se aplicó

  // Contexto
  ipAddress: string;
  userAgent: string;
}
```

### 5.2 Retención y análisis

- **Retención:** 2 años (requerimiento legal).
- **Análisis:** Dashboard de intentos de acceso denegados. Detección de patrones sospechosos (fuerza bruta, escalación de privilegios).
- **Exportación:** CSV/PDF para auditorías externas.

---

## 6. Decisiones de Diseño Clave

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **Cerbos vs casero** | Cerbos | Políticas como código, ABAC nativo, audit log, <1ms. |
| **YAML versionable** | Git | Cada cambio de permiso es un PR revisado. |
| **RBAC + ABAC** | Ambos | RBAC para roles estándar. ABAC para casos complejos (horario, monto). |
| **Deny by default** | Sí | Si no hay política explícita → DENY. Principio de mínimo privilegio. |
| **Tenant isolation** | Organización como tenant raíz: Cerbos + query scopeada por `organizacion_id` (+ `edificio_id`) | Defensa en profundidad. Nunca confiar en una sola capa. |
| **Hot reload** | Sí | Cambios en políticas se aplican sin reiniciar el servicio. |
| **GRPC** | Sí | Más rápido que HTTP para el PDP. |

---

*Documento relacionado:* [[PRD-02-04 Base de Datos]]  
*Documento relacionado:* [[PRD-04-01 Gestión de Edificios]]  
*Documento relacionado:* [[PRD-04-05 Portal del Residente]]  
*Documento relacionado:* [[PRD-08-05 Seguridad]]  
*Documento relacionado:* [[PRD-09-01 Decisiones de Arquitectura]]