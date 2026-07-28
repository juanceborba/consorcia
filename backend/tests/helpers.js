// tests/helpers.js — Utilidades compartidas de los tests de integración (S1-09)
// Levanta la app Express en un puerto efímero contra la DB/Redis/Cerbos del
// stack dockerizado (mismas envs del contenedor) y expone helpers de fetch.
// Cada archivo de test corre en su propio proceso (node --test), así que
// cada uno levanta su propio server y cierra sus conexiones en after().

import app from '../src/app.js';
import prisma from '../src/db/prisma.js';
import redis from '../src/config/redis.js';

// Levanta la app en un puerto efímero (0 = el SO asigna uno libre).
export function levantarApp() {
  const server = app.listen(0);
  return new Promise((resolve) => {
    server.once('listening', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// Cierra el server HTTP y las conexiones de Prisma y Redis para que el
// proceso de test termine limpio (sin handles abiertos que lo retengan).
export async function cerrarApp(server) {
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
  await redis.quit();
}

// fetch con JSON; devuelve { status, data } (data es null si no hay body).
export async function apiFetch(baseUrl, path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

// POST /api/auth/login → { status, data } con { accessToken, refreshToken, user }
export function login(baseUrl, email, password) {
  return apiFetch(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
}

export { prisma, redis };
