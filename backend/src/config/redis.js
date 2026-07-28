// src/config/redis.js — Cliente Redis compartido (ioredis)
// Spec: PRD-02-03 Infraestructura Docker (servicio redis:7)
// Uso actual: refresh tokens opacos (PRD-08-05 §1). Más adelante: cache con
// keys prefijadas `org:{id}:` (PRD-02-01 §6.2).

import { Redis } from 'ioredis';
import { config } from './index.js';

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  // Reintenta con backoff acotado para no tumbar el event loop si Redis cae
  retryStrategy: (intentos) => Math.min(intentos * 200, 2000),
});

redis.on('error', (err) => {
  console.error('Error de conexión a Redis:', err.message);
});

export default redis;
