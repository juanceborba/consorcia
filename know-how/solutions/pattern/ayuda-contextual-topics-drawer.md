---
type: pattern
title: "Ayuda contextual escalable: registro de topics + store global + drawer único"
tags: [ayuda, faq, drawer, zustand, ux, ayuda-contextual, topics, base-ui]
severity: medium
files:
  - frontend/src/lib/ayuda.js
  - frontend/src/stores/ayuda.store.js
  - frontend/src/components/ayuda/AyudaDrawer.jsx
  - frontend/src/components/ayuda/AyudaLink.jsx
  - frontend/src/components/layout/AppLayout.jsx
  - frontend/src/pages/edificio/UnidadCategoriasTab.jsx
date: 2026-07-29
sprint: post-#57
---

# Patrón de ayuda contextual (FAQ embebido) — PRD-07-02 §6.5

## Problem

Los conceptos de dominio (categorías A/B/C, coeficientes, liquidación) necesitan explicación en el momento de uso, sin inventar infra de ayuda por módulo ni acoplar las pantallas al formato de almacenamiento del contenido. Se evaluó también armar el FAQ completo (hub, búsqueda, deep links, markdown) desde el inicio.

## Solution

Cuatro piezas, una sola vez para toda la app:

1. `lib/ayuda.js` — registro `AYUDA_TOPICS` keyed por ID de topic estable (path con slash, ej. `edificios/unidades/categorias-gastos`). Cada topic: `ruta` (breadcrumb), `titulo`, `secciones: [{ titulo, cuerpo, items? }]`. `getAyudaTopic(path)` devuelve null si no existe (el drawer muestra fallback, nunca rompe).
2. `stores/ayuda.store.js` — zustand efímero `{ topic, abrirAyuda, cerrarAyuda }`.
3. `AyudaDrawer` — UNA instancia montada en `AppLayout`; resuelve el topic del store y lo renderiza en el `Drawer` de Base UI. Se apila sobre modales sin mitigación (Base UI pone el último dialog abierto encima; verificado en E2E).
4. `AyudaLink` — `<AyudaLink topic="..." />` con `type="button"` (vive dentro de forms sin submitear).

Agregar ayuda a un módulo = una entrada en el registro + un AyudaLink. Nada más.

**Decisión (A vs FAQ completo):** se eligió el registro estático en frontend (versión A) sobre la infra robusta (versión B: hub `/ayuda`, búsqueda, deep links, markdown + frontmatter con `import.meta.glob`). La migración A→B es ADITIVA, no refactor, porque los consumidores dependen del ID de topic y de `getAyudaTopic`, no del almacenamiento. B costaba ~2-3x para un solo topic: infra sin contenido.

## What didn't work

- Poner el link de ayuda al pie del contenido del tab: quedó bajo el fold del modal (ver bug/accion-bajo-fold-modal-isvisible.md). Las acciones de ayuda van arriba.

## Prevention

- El ID de topic es contrato público: path con slash, no se renombra una vez publicado (es lo que permitiría deep links futuros).
- El concepto se explica inline primero (texto corto junto al control); el drawer es la profundización, no el único lugar.
- No armar hub/búsqueda/markdown hasta tener 5+ topics reales: la taxonomía de FAQ diseñada antes de contenido es adivinar.
