// src/app.js — ConsorcIA Backend
// Spec: PRD-02-02 Stack Tecnológico (NodeJS 20 + Express 5)
// Expone los endpoints de infraestructura (health/metrics para docker-compose
// y Prometheus) y monta la API del sprint S1: auth JWT (S1-04), aislamiento
// multi-tenant (S1-05), autorización Cerbos (S1-06), organizaciones (S1-07)
// y edificios (S1-08).
//
// Este módulo NO hace listen: exporta la app para que server.js la sirva y
// los tests de integración (S1-09, tests/) la levanten en un puerto efímero.

import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import organizacionesRoutes from './routes/organizaciones.routes.js';
import edificiosRoutes from './routes/edificios.routes.js';
import unidadesRoutes from './routes/unidades.routes.js';
import proveedoresRoutes from './routes/proveedores.routes.js';
import rubrosRoutes from './routes/rubros.routes.js';
import gastosRoutes from './routes/gastos.routes.js';
import liquidacionesRoutes from './routes/liquidaciones.routes.js';
import meRoutes from './routes/me.routes.js';
import invitacionesRoutes from './routes/invitaciones.routes.js';
import { errorHandler, rutaNoEncontrada } from './middleware/error.middleware.js';

const app = express();
const startedAt = Date.now();

// CORS — el frontend Vite (:5173) y nginx (:80) llaman a la API cross-origin
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',')
  : ['http://localhost:5173', 'http://localhost'];
app.use(cors({ origin: corsOrigins, credentials: true }));

app.use(express.json());

// Health check — requerido por el healthcheck de docker-compose y `make health`
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'consorcia-backend',
    uptime: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
});

// Métricas para Prometheus (formato texto plano, PRD-02-03 §8)
app.get('/metrics', (req, res) => {
  res.type('text/plain').send(
    [
      '# HELP consorcia_backend_up Backend disponible (1 = up)',
      '# TYPE consorcia_backend_up gauge',
      'consorcia_backend_up 1',
      '# HELP consorcia_backend_uptime_seconds Segundos desde el arranque',
      '# TYPE consorcia_backend_uptime_seconds counter',
      `consorcia_backend_uptime_seconds ${Math.round((Date.now() - startedAt) / 1000)}`,
      '',
    ].join('\n')
  );
});

// Raíz informativa
app.get('/', (req, res) => {
  res.json({
    name: 'ConsorcIA API',
    version: '0.1.0',
    docs: 'ver vault/02_Arquitectura y Stack/PRD-02-02 Stack Tecnológico.md',
  });
});

// API del sprint S1 (contrato: docs/sprints/S1-fundacion.md)
app.use('/api/auth', authRoutes);
app.use('/api/organizaciones', organizacionesRoutes);
app.use('/api/edificios', edificiosRoutes);
app.use('/api/unidades', unidadesRoutes);

// Sprint S3 — insumos del gestor de gastos (PRD-04-02 §1.3/§1.4). Son
// directorios de ORGANIZACIÓN (no cuelgan de un edificio) e híbridos: suman al
// dato propio de la org el catálogo global de plataforma.
app.use('/api/proveedores', proveedoresRoutes);
app.use('/api/rubros', rubrosRoutes);

// Gastos (S3-02). El alta y la lista viven bajo `/api/edificios/:id/gastos`
// (montadas en edificios.routes.js) porque el gasto SIEMPRE es de un edificio;
// acá cuelgan las operaciones sobre un gasto ya identificado.
app.use('/api/gastos', gastosRoutes);

// Liquidaciones (S3-04). El cálculo y la lista viven bajo
// `/api/edificios/:id/liquidaciones` (montadas en edificios.routes.js) porque
// una liquidación SIEMPRE es de un edificio y un período; acá cuelgan el preview
// y las transiciones de estado sobre una liquidación ya identificada.
app.use('/api/liquidaciones', liquidacionesRoutes);

// Contexto propio del usuario (S4-12, #58): scopeado por `usuarioId`, no por
// organización — es el único camino de lectura del residente puro, que por
// diseño no tiene org activa (PRD-04-11 §5.5).
app.use('/api/me', meRoutes);

// Activación por invitación (S4-02) — público: el token del link es la
// credencial, el invitado todavía no tiene sesión.
app.use('/api/invitaciones', invitacionesRoutes);

// 404 para rutas /api no matcheadas + handler central de errores
app.use('/api', rutaNoEncontrada);
app.use(errorHandler);

export default app;
