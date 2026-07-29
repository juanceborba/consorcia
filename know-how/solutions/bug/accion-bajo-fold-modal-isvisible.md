---
type: bug
title: "Acción invisible bajo el fold de un modal scrolleable: isVisible de Playwright da falso verde"
tags: [playwright, is-visible, scroll, fold, modal, dialog, ux, falso-negativo, e2e]
severity: medium
files:
  - frontend/src/pages/edificio/UnidadCategoriasTab.jsx
  - frontend/src/components/ui/dialog.jsx
  - frontend/e2e/edificio-unidades.spec.js
date: 2026-07-29
sprint: post-#57
---

# Link de ayuda invisible bajo el fold del modal: el E2E pasaba y el usuario no lo veía

## Problem

El `AyudaLink` ("Más información") del tab Categorías del alta de unidad se renderizaba al pie del tab, debajo de 3 tarjetas explicativas. Con ese contenido el `Dialog` (max-h + overflow-y) corta: el link quedó en y=823 con el dialog visible solo hasta y=704 (viewport 800px). El usuario reportó "no veo el link" aunque el spec E2E que lo clickeaba pasaba en verde.

Causa del falso verde: `locator.isVisible()` y las acciones de Playwright (click con auto-scroll) NO consideran que un elemento esté clippeado por el scroll de un contenedor — para Playwright es "visible" (tiene box, no es display:none) y el click scrollea solo hasta encontrarlo. Un humano sin esa pista no lo encuentra.

## Solution

Mover la acción al tope del tab, arriba de las tarjetas (quedó en y=181, dentro del área visible). Verificado con boundingBox + screenshot en browser real antes de cerrar el fix.

## What didn't work

- Confiar en `expect(link).toBeVisible()` / click exitoso como prueba de que el usuario ve la acción: ambos pasan con el elemento fuera del área visible del contenedor scrolleable.
- Asumir que "el E2E pasa" equivale a "la UX es correcta" para layout.

## Prevention

- En modales/paneles con scroll, las acciones primarias y de ayuda van ARRIBA del contenido largo (o en un header/footer fijo), nunca al pie de contenido que puede superar el alto visible.
- Para assertions de visibilidad UX en E2E sobre contenedores scrolleables, comparar `boundingBox()` del elemento contra el del contenedor (o el viewport), no solo `toBeVisible()`. Cuando el layout es el riesgo, un screenshot de verificación vale más que una assertion de DOM.
