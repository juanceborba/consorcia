---
type: bug
title: "TOCTOU en invariante de coeficientes: validar y escribir dentro de una transacción con lock"
tags: [toctou, concurrencia, prisma, transaccion, coeficientes, invariante, decimaljs, for-update]
severity: high
files:
  - backend/src/routes/edificios.routes.js
  - backend/src/routes/unidades.routes.js
  - backend/src/services/coeficientes.js
date: 2026-07-28
sprint: S2
---

# TOCTOU en invariante de coeficientes

## Problem

La invariante financiera del slice edificios/unidades (Σcoeficiente = 1.000000 por edificio, decimal.js) se validaba leyendo la suma ANTES de escribir y FUERA de una transacción. Dos requests concurrentes (bulk create, PATCH o DELETE de unidad) leían el mismo estado, ambas pasaban la validación y commiteaban → suma ≠ 1.000000, corrupción silenciosa de un dato regulado (Ley 941). Detectado independientemente por /review y /security (SEC-01) en S2.

Segundo hueco encontrado al fixear: en PATCH/DELETE la re-lectura de la unidad dentro del lock podía devolver `null` si un DELETE concurrente ganaba la carrera → `actual.coeficiente` tiraba TypeError y la API devolvía 500 en vez de un error del contrato.

## Solution

- Meter validación + escritura en una transacción interactiva de Prisma (`prisma.$transaction(async (tx) => ...)`) con lock de la fila del edificio: `SELECT ... FOR UPDATE` vía `tx.$queryRaw` (helper `lockEdificio`) — o `pg_advisory_xact_lock` como alternativa.
- Re-leer la unidad DENTRO del lock; si viene `null`, devolver `404 UNIDAD_NO_ENCONTRADA` (contrato `{ error: { code, message } }`), nunca dejar que explote en 500.
- Test de concurrencia real: dos PATCH paralelos → uno debe fallar con 422 `COEFICIENTES_NO_CUADRAN`. Se verificó que el test falla si se deshabilita el lock (no pasa por casualidad).

## What didn't work

- Validar la suma antes de la escritura sin transacción (diseño original): race window entre check y commit.
- Confiar en que la re-lectura dentro de la transacción siempre devuelve la fila: bajo concurrencia puede no existir más.

## Prevention

Toda invariante multi-fila (sumas, saldos, contadores del motor contable de S3+) se valida DENTRO de la misma transacción que escribe, con lock explícito de la fila padre. Regla de review: si un handler lee-agrega-escribe sobre varias filas, buscar el `$transaction` interactivo y el lock; si no están, es un hallazgo should-fix mínimo. Test de concurrencia obligatorio para invariantes financieras.
