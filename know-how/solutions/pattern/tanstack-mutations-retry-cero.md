---
type: pattern
title: "TanStack Query: mutations.retry en 0 salvo que la operación sea idempotente"
tags: [tanstack-query, react-query, retry, idempotencia, mutations, frontend]
severity: medium
files:
  - frontend/src/lib/query-client.js
date: 2026-07-28
sprint: S2
---

# mutations.retry: 0 por defecto

## Problem

La config global del QueryClient tenía `mutations.retry: 1`: ante un error de red o 5xx POST-accidente, TanStack Query reintentaba automáticamente operaciones NO idempotentes (alta de edificio, bulk de unidades). Sin constraint unique del lado servidor, un retry puede crear duplicados silenciosos.

## Solution

`mutations.retry: 0` en la config global del QueryClient (`frontend/src/lib/query-client.js`). Las queries sí mantienen `retry: 3` con backoff (son reads, idempotentes por naturaleza). Si una mutación futura es genuinamente idempotente (p.ej. PUT con clave natural o request con idempotency-key), habilitar retry POR MUTACIÓN con `useMutation({ retry: N })`, nunca global.

## What didn't work

- Confiar en el default/retry bajo "por las dudas": el retry de mutations es opt-in peligroso, no una red de seguridad.
- Depender de constraints de DB como única defensa: no todas las entidades los tienen (edificio no tiene unique de nombre).

## Prevention

En reviews de frontend, chequear la config del QueryClient: `queries.retry` alto está bien, `mutations.retry > 0` global es should-fix. Al diseñar endpoints de escritura nuevos, considerar idempotency keys si el cliente va a querer retry (relevante para S5 cobranzas/MercadoPago, donde el retry de pagos es inevitable).
