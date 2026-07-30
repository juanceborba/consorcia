---
title: "PRD-08-05: Seguridad"
description: "Seguridad de ConsorcIA: autenticacion, autorizacion, encriptacion, OWASP, pentesting y gestion de vulnerabilidades."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [devops, seguridad, auth, owasp, pentesting, encryption, rbac, consorcIA]
outcomes:
  - "Implementar autenticacion segura con JWT + refresh tokens"
  - "Configurar autorizacion con Cerbos RBAC"
  - "Establecer encriptacion en transito y reposo"
  - "Cumplir OWASP Top 10"
  - "Documentar procedimientos de pentesting y respuesta a incidentes"
---

# PRD-08-05: Seguridad

> **La seguridad de ConsorcIA es critica: manejamos datos financieros, personales y documentos legales.** Cada capa de la aplicacion tiene controles de seguridad especificos, desde el transporte hasta el acceso a datos.

---

## 1. Autenticacion

### 1.1 JWT + Refresh Tokens

```
+-------------------------------------------------------------+
|  FLUJO DE AUTENTICACION                                     |
+-------------------------------------------------------------+
|                                                             |
|  1. Login (email + password)                               |
|        |                                                    |
|        v                                                    |
|  2. API valida credenciales                                |
|        |                                                    |
|        v                                                    |
|  3. Genera:                                                 |
|     |-- Access Token (JWT, 15 min)                          |
|     |-- Refresh Token (UUID, 7 dias)                       |
|        |                                                    |
|        v                                                    |
|  4. Cliente recibe ambos tokens                            |
|     |-- Access: localStorage (encriptado)                  |
|     |-- Refresh: httpOnly cookie                           |
|        |                                                    |
|        v                                                    |
|  5. Cada request incluye Access Token en header            |
|        |                                                    |
|        v                                                    |
|  6. Si Access expira (401):                                 |
|     |-- Cliente envia Refresh Token (cookie)               |
|     |-- API valida Refresh en BD                           |
|     |-- Genera nuevo Access Token                         |
|                                                             |
+-------------------------------------------------------------+
```

### 1.2 Implementacion

```typescript
// src/lib/auth.ts
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

export function generateTokens(user: User) {
  const accessToken = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      org_id: user.organizacionId,          // organizacion = tenant raiz
      roles: user.roles,                     // ['org_admin'], ['gestor'], ['propietario'], ...
      edificios_asignados: user.edificiosAsignados, // solo aplica a gestores
    },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );

  const refreshToken = randomUUID();

  // Guardar refresh token en Redis (con TTL)
  redis.setex(`refresh:${refreshToken}`, 7 * 24 * 3600, user.id);

  return { accessToken, refreshToken };
}

export function verifyAccessToken(token: string): JWTPayload {
  return jwt.verify(token, process.env.JWT_SECRET) as JWTPayload;
}

export async function refreshAccessToken(refreshToken: string) {
  const userId = await redis.get(`refresh:${refreshToken}`);
  if (!userId) throw new Error('Invalid refresh token');

  const user = await db.user.findById(userId);
  return generateTokens(user);
}
```

---

## 2. Autorizacion (Cerbos RBAC)

> **Ver [[PRD-05-04 Cerbos RBAC]] para detalles completos.**

Resumen de roles:

| Rol | Scope |
|-----|-------|
| **superadmin** | Global (staff ConsorcIA) |
| **org_admin** | Toda su organizacion: N edificios, facturacion, alta de edificios y usuarios |
| **gestor** | Edificios asignados de su organizacion |
| **consejo** | Reportes y votaciones de su edificio |
| **propietario** | Su UF + datos agregados de su edificio |
| **inquilino** | Su UF (acceso limitado) |
| **encargado** | Tareas asignadas de su edificio |
| **proveedor** | Tickets y facturas de su edificio |

### 2.1 Aislamiento multi-tenant

La unidad de aislamiento es la **organizacion** (la administracion/estudio, cliente del SaaS), no el edificio. Jerarquia: `Organizacion 1—N Edificio 1—N Unidad N—M Usuario`. Los residentes pertenecen a un edificio; el staff (`org_admin`, `gestor`) pertenece a la organizacion.

- El JWT porta `org_id` y el middleware de auth lo extrae en cada request.
- Cerbos scopea las decisiones por `organizacion_id` (ver [[PRD-05-04 Cerbos RBAC]]); los gestores ademas validan `edificios_asignados`.
- Todas las queries a la base filtran por `organizacionId` (+ `edificioId` cuando operan un edificio puntual).
- Como ultima linea de defensa, PostgreSQL aplica Row Level Security por organizacion (ver [[PRD-02-04 Base de Datos]]).

---

## 3. Encriptacion

### 3.1 En transito

| Capa | Protocolo |
|------|-----------|
| Browser -> CloudFront | TLS 1.3 |
| CloudFront -> ALB | TLS 1.3 |
| ALB -> ECS | TLS 1.2+ |
| ECS -> RDS | TLS 1.2+ |
| ECS -> Redis | TLS 1.2+ |

### 3.2 En reposo

| Dato | Metodo |
|------|--------|
| PostgreSQL | TDE (AES-256) |
| Redis | Encriptacion in-transit |
| S3 | SSE-S3 (AES-256) |
| Backups | SSE-KMS |
| Tokens en localStorage | AES (client-side) |

### 3.3 Hashing

| Dato | Algoritmo |
|------|-----------|
| Contrasenas | bcrypt (cost factor 12) |
| API Keys | SHA-256 + salt |
| Document IDs | HMAC-SHA256 |

---

## 4. OWASP Top 10

### 4.1 Mitigaciones

| Riesgo | Mitigacion |
|--------|------------|
| **A01: Broken Access Control** | Cerbos RBAC + middleware en cada endpoint |
| **A02: Cryptographic Failures** | TLS 1.3, AES-256, bcrypt, secret rotation |
| **A03: Injection** | Prisma ORM (parameterized queries), input validation |
| **A04: Insecure Design** | Threat modeling, security by design |
| **A05: Security Misconfiguration** | Terraform IaC, CIS benchmarks |
| **A06: Vulnerable Components** | Dependabot, npm audit, Snyk |
| **A07: Auth Failures** | JWT + refresh, rate limiting, MFA (Fase 2) |
| **A08: Data Integrity** | Signed URLs, checksums en documentos |
| **A09: Logging Failures** | Pino con redact, audit logs enmascarados |
| **A10: SSRF** | URL validation, egress filtering, no metadata access |

---

## 5. Headers de Seguridad

```typescript
// Helmet configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.consorcia.app"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// Rate limiting
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests por IP
  message: 'Too many requests, please try again later.',
}));

// CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
  credentials: true,
}));
```

---

## 6. Pentesting

### 6.1 Plan de pentesting

| Fase | Alcance | Frecuencia |
|------|---------|------------|
| **SAST** | Codigo fuente | Cada PR (CodeQL) |
| **DAST** | Aplicacion running | Semanal (OWASP ZAP) |
| **Dependency scan** | package.json | Cada PR (Snyk) |
| **Container scan** | Docker images | Cada build (Trivy) |
| **Pentest externo** | Aplicacion completa | Trimestral |

### 6.2 OWASP ZAP

```yaml
# .github/workflows/zap.yml
name: OWASP ZAP
on:
  schedule:
    - cron: '0 0 * * 0'
jobs:
  zap:
    runs-on: ubuntu-latest
    steps:
      - name: ZAP Baseline Scan
        uses: zaproxy/action-baseline@v0.12.0
        with:
          target: 'https://staging.consorcia.app'
          rules_file_name: '.zap/rules.tsv'
```

---

## 7. Respuesta a Incidentes

### 7.1 Playbook

```
DETECCION DE INCIDENTE
        |
        v
+-----------------+
|  1. Contencion  |
|  - Isolar servicio afectado
|  - Revocar tokens comprometidos
|  - Activar modo mantenimiento
+--------+--------+
         |
         v
+-----------------+
|  2. Investigacion|
|  - Revisar logs
|  - Identificar vector de ataque
|  - Evaluar datos expuestos
+--------+--------+
         |
         v
+-----------------+
|  3. Erradicacion|
|  - Aplicar parches
|  - Rotar secrets
|  - Limpiar backdoors
+--------+--------+
         |
         v
+-----------------+
|  4. Recuperacion|
|  - Restaurar servicios
|  - Monitorear anomalias
|  - Verificar integridad
+--------+--------+
         |
         v
+-----------------+
|  5. Post-mortem |
|  - Documentar lecciones
|  - Actualizar controles
|  - Comunicar a stakeholders
+-----------------+
```

---

## 8. Decisiones de Diseno

| Decision | Eleccion | Justificacion |
|----------|----------|---------------|
| **JWT + Refresh** | Sobre sessions | Stateless, escala horizontal, sin sticky sessions. Claims: `sub`, `email`, `org_id`, `roles`, `edificios_asignados`. |
| **bcrypt cost 12** | Sobre cost 10 | Balance seguridad/performance. ~250ms por hash. |
| **Helmet** | Sobre headers manual | Configuracion segura por defecto. |
| **Rate limiting** | Por IP + user | Mitiga brute force y DDoS. |
| **Secret rotation** | 90 dias | Reduce ventana de exposicion. |
| **Pentest trimestral** | Externo | Perspectiva independiente. Cumplimiento regulatorio. |

---

*Documento relacionado:* [[PRD-05-04 Cerbos RBAC]]  
*Documento relacionado:* [[PRD-06-03 Ley 25.326]]  
*Documento relacionado:* [[PRD-08-04 Monitoring]]
