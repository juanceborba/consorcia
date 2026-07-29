// src/services/almacenamiento.js — Persistencia de archivos generados (S3-05)
// Spec: PRD-02-05 §4.2 (recibos en disco) · PRD-02-03 (MinIO en el stack)
//
// DECISIÓN (S3-05): el driver por defecto es **filesystem**, no MinIO.
//
// MinIO está levantado en el compose y sus credenciales ya llegan al backend
// (`MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY`), pero HOY no hay ni cliente ni bucket
// ni bootstrap: sería infraestructura nueva completa. Y el gate de CI
// (`.github/workflows/ci.yml`) levanta solo Postgres, Redis y Cerbos — atar la
// emisión de recibos a MinIO dejaría los tests de S3-05 imposibles de correr en
// CI. El backend ya tiene el volumen `backend_uploads:/app/uploads` en el
// compose exactamente para esto.
//
// El seam queda: un recibo guarda `storageDriver` + `storageKey`, así que sumar
// un driver `minio` es agregar un caso acá y migrar las filas existentes; nada
// del dominio ni del contrato HTTP cambia (la descarga siempre es
// `GET /api/recibos/:id/descargar`, nunca una URL de storage).
//
// Raíz configurable por env: `STORAGE_DIR` (default `<cwd>/uploads`). En el
// contenedor el cwd es `/app` → `/app/uploads` (el volumen); en CI los tests
// corren con cwd `backend/` → `backend/uploads` (gitignoreado).

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

export const DRIVER = 'filesystem';

export const raizStorage = () =>
  process.env.STORAGE_DIR ?? path.join(process.cwd(), 'uploads');

// Un segmento de key seguro: solo [a-zA-Z0-9._-]. Los números de UF del dominio
// admiten espacios y barras ("Coch-1", "PB / A"), y una barra en un segmento
// sería un directorio nuevo o un `..` de escape.
export const segmentoSeguro = (valor) =>
  String(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80) || 'sin-nombre';

// Resuelve una key relativa contra la raíz, rechazando cualquier escape
// (`../`, absolutas). La key viene de la DB, pero el chequeo es barato y el
// costo de equivocarse es leer archivos arbitrarios del contenedor.
function rutaDe(key) {
  const raiz = path.resolve(raizStorage());
  const destino = path.resolve(raiz, key);
  if (destino !== raiz && !destino.startsWith(raiz + path.sep)) {
    throw new Error(`storageKey fuera de la raíz de storage: ${key}`);
  }
  return destino;
}

// Guarda un buffer bajo `key` y devuelve la metadata que persiste el registro.
export async function guardar(key, buffer) {
  const destino = rutaDe(key);
  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(destino, buffer);
  return {
    storageDriver: DRIVER,
    storageKey: key,
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

// Stream de lectura para la descarga. Devuelve null si el archivo no está
// (recibo emitido cuyo archivo se perdió: el endpoint responde 404, no 500).
export async function abrirLectura(key) {
  const destino = rutaDe(key);
  try {
    await fs.access(destino);
  } catch {
    return null;
  }
  return createReadStream(destino);
}

export async function borrar(key) {
  await fs.rm(rutaDe(key), { force: true });
}
