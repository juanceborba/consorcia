// frontend/scripts/check-ayuda.mjs — ConsorcIA
// Gate de frescura/consistencia del módulo de ayuda contextual (PRD-07-02
// §6.5). Falla (exit 1) cuando la ayuda queda inconsistente con el código:
//
//   ERRORES (exit 1):
//   - Un `topic="..."` (AyudaLink) o `abrirAyuda('...')` referencia un topic
//     que no existe en el registro (src/lib/ayuda.js).
//   - Un `relacionados` apunta a un ID inexistente.
//   - Un topic declara `pantallas` y alguna NO contiene referencia a ese
//     topic (se removió el acceso a ayuda de esa pantalla).
//   - Un topic declara `pantallas` con un archivo que no existe.
//
//   WARNINGS (exit 0, se listan):
//   - Topic huérfano: no lo referencia ningún AyudaLink/abrirAyuda del código
//     ni ningún `relacionados` de otro topic.
//
// CUÁNDO CORRE: local con `npm run check:ayuda` (desde frontend/) y en CI
// (step del job frontend-build en .github/workflows/ci.yml). Node ESM plano,
// sin dependencias: el registro se importa directo (ayuda.js es ESM puro) y
// las referencias se extraen con regex sobre los .js/.jsx de src/.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AYUDA_TOPICS } from '../src/lib/ayuda.js';

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(FRONTEND_DIR, 'src');

// Patrones de referencia a un topic: prop de AyudaLink y llamada directa al
// store. El grupo 1 es el ID referenciado.
const PATRONES_REF = [
  /topic=["']([^"']+)["']/g,
  /abrirAyuda\(\s*["']([^"']+)["']\s*\)/g,
];

// Walk recursivo de src/ devolviendo los .js/.jsx (paths absolutos).
function archivosSrc(dir) {
  const archivos = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      archivos.push(...archivosSrc(path));
    } else if (/\.jsx?$/.test(entrada.name)) {
      archivos.push(path);
    }
  }
  return archivos;
}

// Blanquea líneas de comentario conservando el conteo de líneas (los headers
// de archivo documentan la API con ejemplos tipo `topic="tu/id"` que NO son
// referencias reales). Solo cubre comentarios de línea completa: es el estilo
// de este codebase y evita parsear strings.
function limpiarComentarios(contenido) {
  return contenido
    .split('\n')
    .map((linea) => (/^\s*(\/\/|\/\*|\*|\{\/\*)/.test(linea) ? '' : linea))
    .join('\n');
}

// Referencias a topics en todo src/: [{ id, archivo (relativo), linea }].
function extraerReferencias() {
  const referencias = [];
  for (const archivo of archivosSrc(SRC_DIR)) {
    const contenido = limpiarComentarios(readFileSync(archivo, 'utf8'));
    for (const patron of PATRONES_REF) {
      patron.lastIndex = 0;
      for (const match of contenido.matchAll(patron)) {
        const linea = contenido.slice(0, match.index).split('\n').length;
        referencias.push({
          id: match[1],
          archivo: relative(FRONTEND_DIR, archivo),
          linea,
        });
      }
    }
  }
  return referencias;
}

const errores = [];
const warnings = [];
const referencias = extraerReferencias();
const idsRegistrados = new Set(Object.keys(AYUDA_TOPICS));

// 1. Referencias a topics inexistentes (con archivo:línea).
for (const ref of referencias) {
  if (!idsRegistrados.has(ref.id)) {
    errores.push(
      `${ref.archivo}:${ref.linea} — referencia al topic inexistente "${ref.id}"`,
    );
  }
}

// 2. relacionados que apuntan a IDs inexistentes.
for (const [id, topic] of Object.entries(AYUDA_TOPICS)) {
  for (const relacionado of topic.relacionados ?? []) {
    if (!idsRegistrados.has(relacionado)) {
      errores.push(
        `src/lib/ayuda.js — el topic "${id}" tiene un relacionado inexistente "${relacionado}"`,
      );
    }
  }
}

// 3 y 4. pantallas declaradas: el archivo tiene que existir y contener una
// referencia a ese topic (si se removió el AyudaLink, el gate lo detecta).
let pantallasVerificadas = 0;
for (const [id, topic] of Object.entries(AYUDA_TOPICS)) {
  for (const pantalla of topic.pantallas ?? []) {
    const path = join(FRONTEND_DIR, pantalla);
    if (!existsSync(path)) {
      errores.push(
        `src/lib/ayuda.js — el topic "${id}" declara la pantalla "${pantalla}" pero el archivo no existe`,
      );
      continue;
    }
    const contenido = limpiarComentarios(readFileSync(path, 'utf8'));
    const laReferencia = PATRONES_REF.some((patron) => {
      patron.lastIndex = 0;
      return [...contenido.matchAll(patron)].some((m) => m[1] === id);
    });
    if (!laReferencia) {
      errores.push(
        `${pantalla} — ya no referencia al topic "${id}" (¿se removió el acceso a ayuda?)`,
      );
    } else {
      pantallasVerificadas += 1;
    }
  }
}

// 5. Topics huérfanos: sin referencias en el código y sin relacionados que
// los apunten. Warning: puede ser un topic preparado para una pantalla futura.
const referenciados = new Set(referencias.map((r) => r.id));
const apuntadosPorRelacionados = new Set(
  Object.values(AYUDA_TOPICS).flatMap((t) => t.relacionados ?? []),
);
for (const id of idsRegistrados) {
  if (!referenciados.has(id) && !apuntadosPorRelacionados.has(id)) {
    warnings.push(
      `topic huérfano: "${id}" no lo referencia ninguna pantalla ni ningún relacionado`,
    );
  }
}

// ── Output ────────────────────────────────────────────────────────────────
for (const warning of warnings) console.warn(`WARN  ${warning}`);
if (errores.length > 0) {
  console.error('AYUDA FALLA: el módulo de ayuda quedó inconsistente');
  for (const error of errores) console.error(`ERROR ${error}`);
  process.exit(1);
}
const totalTopics = idsRegistrados.size;
const warningTxt = warnings.length > 0 ? ` (${warnings.length} warnings)` : '';
console.log(
  `AYUDA OK: ${totalTopics} topics, ${referencias.length} referencias, ${pantallasVerificadas} pantallas verificadas${warningTxt}`,
);
