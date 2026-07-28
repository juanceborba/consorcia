// src/db/prisma.js — PrismaClient singleton
// Spec: PRD-02-04 Base de Datos. Una única instancia por proceso para no
// agotar el pool de conexiones de Postgres.
//
// IMPORTANTE (multi-tenancy): el usuario de DB `consorcia` es owner y
// bypasea RLS. El aislamiento entre organizaciones lo garantiza la capa de
// aplicación: tenant.middleware + scope `{ organizacionId, ... }` en TODAS
// las queries (PRD-02-01 §6.2). RLS es defensa en profundidad.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default prisma;
