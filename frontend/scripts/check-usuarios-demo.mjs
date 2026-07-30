// frontend/scripts/check-usuarios-demo.mjs — ConsorcIA
// Gate del catálogo de usuarios demo del login (S3-22c), en la misma línea que
// `check-ayuda.mjs`: la UI no puede prometer una identidad que el seed no crea.
//
// QUÉ VERIFICA (lo estructural, que es lo que se puede verificar sin criterio):
//
// 1. Todo email de `src/lib/usuarios-demo.js` existe en `backend/prisma/seed.js`.
//    Es el modo de falla real: el fixture de proveedores de S3-14 apuntaba a un
//    dato cargado a mano y nadie se enteró hasta dos sprints después.
// 2. Todo usuario del seed está declarado —en el catálogo o en la lista de
//    omitidos con su motivo—, así que sumar un caso al seed obliga a decidir si
//    se muestra.
// 3. La password del catálogo es la del seed.
// 4. El nombre mostrado coincide con el `nombre apellido` del seed.
//
// Lo que NO puede verificar: si "puede / no puede" sigue siendo cierto. Eso lo
// garantiza la revisión de la tarea que toca una policy o un guard (ver el
// encabezado de usuarios-demo.js).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PASSWORD_DEMO,
  USUARIOS_DEMO,
  USUARIOS_DEMO_OMITIDOS,
} from '../src/lib/usuarios-demo.js';

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(FRONTEND_DIR, '..', 'backend', 'prisma', 'seed.js');

const seed = readFileSync(SEED, 'utf8');
const errores = [];

// Los usuarios del seed se declaran como `email: 'x@demo.com', nombre: 'N', apellido: 'A',`
const usuariosDelSeed = new Map();
for (const m of seed.matchAll(
  /email:\s*'([^']+@demo\.com)',\s*nombre:\s*'([^']+)',\s*apellido:\s*'([^']+)'/g,
)) {
  usuariosDelSeed.set(m[1], `${m[2]} ${m[3]}`);
}

if (usuariosDelSeed.size === 0) {
  errores.push(
    'No se encontró ningún usuario demo en el seed: ¿cambió la forma de declararlos? Revisá el regex de este script.',
  );
}

const passwordDelSeed = seed.match(/const PASSWORD_DEMO = '([^']+)'/)?.[1];
if (passwordDelSeed !== PASSWORD_DEMO) {
  errores.push(
    `La password del catálogo ("${PASSWORD_DEMO}") no es la del seed ("${passwordDelSeed}").`,
  );
}

for (const usuario of USUARIOS_DEMO) {
  const delSeed = usuariosDelSeed.get(usuario.email);
  if (!delSeed) {
    errores.push(
      `El catálogo ofrece "${usuario.email}" pero el seed no lo crea: nadie va a poder entrar con esa cuenta.`,
    );
    continue;
  }
  if (delSeed !== usuario.nombre) {
    errores.push(
      `"${usuario.email}" figura como "${usuario.nombre}" en el catálogo y como "${delSeed}" en el seed.`,
    );
  }
}

const declarados = new Set([
  ...USUARIOS_DEMO.map((u) => u.email),
  ...USUARIOS_DEMO_OMITIDOS.map((u) => u.email),
]);
for (const email of usuariosDelSeed.keys()) {
  if (!declarados.has(email)) {
    errores.push(
      `El seed crea "${email}" y el catálogo no lo menciona: agregalo a USUARIOS_DEMO o a USUARIOS_DEMO_OMITIDOS con su motivo.`,
    );
  }
}

for (const usuario of USUARIOS_DEMO) {
  if (!usuario.puede?.length || !usuario.noPuede?.length) {
    errores.push(
      `"${usuario.email}" no declara qué puede y qué no puede hacer: es el contenido del diálogo.`,
    );
  }
}

if (errores.length > 0) {
  console.error('USUARIOS DEMO: el catálogo del login no coincide con el seed\n');
  for (const error of errores) console.error(`  ✗ ${error}`);
  process.exit(1);
}

console.log(
  `USUARIOS DEMO OK: ${USUARIOS_DEMO.length} identidades documentadas, ` +
    `${USUARIOS_DEMO_OMITIDOS.length} omitidas a propósito, ${usuariosDelSeed.size} en el seed`,
);
