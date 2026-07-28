// tests/auth.test.js — Tests de integración de autenticación (S1-09)
// Contrato: docs/sprints/S1-fundacion.md (S1-04) y PRD-08-05 §1.
// Corre contra la DB/Redis del stack dockerizado (usuarios del seed S1-03).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarApp, cerrarApp, apiFetch, login } from './helpers.js';

describe('auth', () => {
  let server;
  let baseUrl;

  before(async () => {
    ({ server, baseUrl } = await levantarApp());
  });

  after(async () => {
    await cerrarApp(server);
  });

  it('login con credenciales válidas devuelve tokens y usuario', async () => {
    const { status, data } = await login(baseUrl, 'admin@demo.com', 'demo1234');
    assert.equal(status, 200);
    assert.ok(data.accessToken);
    assert.ok(data.refreshToken);
    assert.equal(data.user.email, 'admin@demo.com');
    assert.deepEqual(data.user.roles, ['org_admin']);
    assert.ok(data.user.organizacionId);

    // Logout para no dejar el refresh token dando vueltas en Redis
    await apiFetch(baseUrl, '/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: data.refreshToken },
    });
  });

  it('login con password incorrecta devuelve 401', async () => {
    const { status, data } = await login(baseUrl, 'admin@demo.com', 'password-incorrecta');
    assert.equal(status, 401);
    assert.equal(data.error.code, 'CREDENCIALES_INVALIDAS');
  });

  it('request sin token devuelve 401', async () => {
    const { status, data } = await apiFetch(baseUrl, '/api/edificios');
    assert.equal(status, 401);
    assert.equal(data.error.code, 'TOKEN_AUSENTE');
  });

  it('refresh rota los tokens: el viejo queda inválido y el nuevo funciona', async () => {
    const { data: sesion } = await login(baseUrl, 'admin@demo.com', 'demo1234');

    // Refresh válido → nuevo par de tokens
    const { status: statusRefresh, data: renovada } = await apiFetch(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: sesion.refreshToken },
    });
    assert.equal(statusRefresh, 200);
    assert.ok(renovada.accessToken);
    assert.ok(renovada.refreshToken);
    assert.notEqual(renovada.refreshToken, sesion.refreshToken);

    // El refresh token viejo ya fue rotado → 401
    const { status: statusViejo } = await apiFetch(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: sesion.refreshToken },
    });
    assert.equal(statusViejo, 401);

    // El nuevo access token autoriza requests
    const { status: statusEdificios } = await apiFetch(baseUrl, '/api/edificios', {
      token: renovada.accessToken,
    });
    assert.equal(statusEdificios, 200);

    await apiFetch(baseUrl, '/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: renovada.refreshToken },
    });
  });

  it('logout revoca el refresh token: un refresh posterior devuelve 401', async () => {
    const { data: sesion } = await login(baseUrl, 'admin@demo.com', 'demo1234');

    const { status: statusLogout } = await apiFetch(baseUrl, '/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: sesion.refreshToken },
    });
    assert.equal(statusLogout, 204);

    const { status: statusRefresh } = await apiFetch(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: sesion.refreshToken },
    });
    assert.equal(statusRefresh, 401);
  });
});
