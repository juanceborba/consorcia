// src/app.js — ConsorcIA Backend (scaffold inicial)
// Spec: PRD-02-02 Stack Tecnológico (NodeJS 20 + Express 5)
// El motor contable determinístico y los agentes Swarm viven en módulos
// separados que se agregan en PRDs posteriores. Este scaffold expone solo
// los endpoints de infraestructura requeridos por docker-compose y Prometheus.

import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;
const startedAt = Date.now();

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

app.listen(PORT, () => {
  console.log(`ConsorcIA backend escuchando en puerto ${PORT}`);
});
