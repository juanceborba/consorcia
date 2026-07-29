---
type: bug
title: "Tests con conteos absolutos contra el seed son flaky con actividad paralela"
tags: [testing, flaky, seed, concurrencia, node-test, aislamiento]
severity: medium
files:
  - backend/tests/edificios.test.js
  - backend/package.json
date: 2026-07-28
sprint: S2
---

# Tests con conteos absolutos contra seed compartido

## Problem

`backend/tests/edificios.test.js` afirmaba que la org demo tenía exactamente 2 edificios. Los tests comparten la DB demo con otras corridas (smoke E2E, specs Playwright, agentes trabajando en paralelo): cuando un edificio de prueba de otra corrida estaba activo, el test fallaba con `3 !== 2` intermitentemente. Detectado en vivo durante el /review de S2 (falló 2 veces, pasó 23/23 con DB limpia).

## Solution

- Nunca afirmar totales absolutos sobre datos compartidos: filtrar por los edificios del seed (por ids/nombres conocidos) o por los que crea el propio test, y afirmar sobre ese subconjunto.
- `npm test` del backend corre con `--test-concurrency=1` (en `package.json`): los archivos de test comparten la org demo y en paralelo pisaban los asserts de conteo entre sí.
- Los tests limpian los datos que crean (verificado: seed intacto, 2 edificios/20 unidades, tras las corridas).

## What didn't work

- Correr archivos de test en paralelo (default de node:test) con asserts de conteo sobre la misma org: fallos aleatorios según timing.
- Asumir que la DB de test está vacía salvo el seed: en este entorno hay agentes y smoke tests corriendo contra la misma DB en cualquier momento.

## Prevention

Regla para todo test nuevo de API: (1) el test crea sus propios datos y limpia al final; (2) los asserts sobre colecciones filtran por lo propio o por el seed conocido, nunca por totales globales; (3) si un test depende del orden/aislamiento, documentarlo en el archivo (este archivo ya documentaba el patrón en un test pero no lo aplicaba en otro — revisar consistencia al agregar tests).
