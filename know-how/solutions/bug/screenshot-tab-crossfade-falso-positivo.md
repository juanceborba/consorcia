---
type: bug
title: "Screenshot con pill de tab 'desincronizado': cross-fade de transition-all, no bug de binding"
tags: [base-ui, tabs, transition-all, screenshot, falso-positivo, qa-visual, tailwind]
severity: low
files:
  - frontend/src/components/ui/tabs.jsx
date: 2026-07-28
sprint: S2
---

# Pill de tab "desincronizado" en screenshots de QA

## Problem

QA visual reportó que en `/edificios/:id/overview` el pill blanco del tab activo quedaba en "Unidades" aunque el contenido y `aria-selected` correspondían a "Resumen". Diagnóstico inicial: binding de estilo desincronizado. ERA FALSO: en Base UI 1.6, `data-active` y `aria-selected` salen de la misma expresión (`value === activeTabValue`, verificado en `@base-ui/react/tabs/tab/TabsTab.js`), imposible que diverjan.

La causa real: `transition-all` en el tab cross-fadea el fondo durante ~150 ms. Medido frame por frame: hay frames con AMBAS pestañas pintadas a medias (alpha 0.56 vs 0.44). Un screenshot tomado en esa ventana muestra el pill en el tab viejo — exactamente la captura del reporte.

## Solution

Cambiar `transition-all` → `transition-[color]` en el componente de tabs: el fondo del pill cambia sin cross-fade y no existen frames ambiguos. Verificado frame por frame post-fix.

## What didn't work

- Buscar el bug en el estado/binding del componente: el estado siempre fue correcto (aria-selected y contenido coincidían).
- Confiar en un screenshot único como evidencia de un bug de estilo: captura un instante dentro de una animación.

## Prevention

En componentes con indicador animado (tabs, pills, toggles), transicionar solo las propiedades necesarias (`transition-[color]`, `transition-opacity`), nunca `transition-all`. Para QA visual: antes de reportar un bug de estilo por screenshot, repetir la captura tras ~300 ms o deshabilitar animaciones (Playwright: `animations: 'disabled'` en screenshot, o `prefers-reduced-motion`) para distinguir bug real de frame intermedio.
