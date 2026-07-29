---
type: pattern
title: "Guards de rol en UI además del 403 del backend (RequireRole + CTA condicionado)"
tags: [roles, rbac, require-role, ux, defensa-en-profundidad, react-router, frontend]
severity: low
files:
  - frontend/src/components/auth/RequireRole.jsx
  - frontend/src/main.jsx
  - frontend/src/pages/EdificiosPage.jsx
date: 2026-07-28
sprint: S2
---

# Guards de rol en UI (RequireRole)

## Problem

El backend rechazaba correctamente con 403 (Cerbos fail-closed) cuando un `gestor` intentaba crear un edificio, pero la UI mostraba el CTA "Nuevo edificio" y dejaba abrir `/edificios/nuevo` por URL: el usuario llegaba al form, completaba todo y recién ahí comía el error. Mala UX y sensación de bug, aunque la seguridad nunca estuvo rota.

## Solution

Dos capas de UI sobre la autorización del backend:
1. **CTA condicionado por rol**: el botón solo se renderiza si el rol del usuario lo permite (mismo set de roles canónico del dominio: org_admin a nivel org).
2. **Guard de ruta**: componente `RequireRole` (`frontend/src/components/auth/RequireRole.jsx`) envolviendo la ruta en el router; si el rol no alcanza, redirect a `/edificios` (no pantalla de error).

Verificado en navegador con ambas cuentas demo: gestor sin CTA (`ctaCount: 0`) y redirigido; admin conserva acceso.

## What didn't work

- Confiar solo en el 403 del backend como "protección": protege los datos pero no la experiencia; el usuario hace trabajo que se pierde.

## Prevention

Para cada feature nueva con restricción por rol (mirar la policy Cerbos correspondiente): checklist de (1) endpoint protegido, (2) CTA/botón oculto, (3) ruta guardada con RequireRole. Los roles válidos son SOLO el set canónico de AGENTS.md (superadmin, org_admin, gestor / consejo, propietario, inquilino, encargado, proveedor) — no inventar roles ad-hoc en guards.
