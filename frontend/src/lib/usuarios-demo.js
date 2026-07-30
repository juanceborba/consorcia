// frontend/src/lib/usuarios-demo.js — ConsorcIA
// Catálogo de los usuarios que crea el seed (PRD-04-11 §10, los 8 casos), con
// lo que cada rol PUEDE y NO PUEDE hacer. Lo consume el diálogo "Usuarios de
// demo" del login (S3-22c).
//
// PARA QUÉ: probar la app pide saber con qué identidad entrar. El dato vivía en
// AGENTS.md (una tabla que solo lee un agente) y en una línea suelta del login
// con dos emails de los doce. Quien abría la demo no tenía forma de saber que
// existe un gestor limitado a un edificio, ni por qué ese gestor no ve el botón
// "Nuevo gasto".
//
// QUÉ ES "PUEDE / NO PUEDE": el efecto observable en la UI, no la policy. La
// autorización real es de Cerbos (`cerbos/policies/`, fail-closed) más los
// gates de plan; esto es su traducción a lo que el usuario va a ver o no ver
// después de entrar. Si una policy cambia y esta lista no, la lista miente.
//
// CÓMO SE MANTIENE VIVO (la parte que importa):
//
// 1. Los emails y la password son los del seed y NO se escriben acá a mano dos
//    veces: `npm run check:demo` (gate de CI, igual que `check:ayuda`) compara
//    este archivo contra `backend/prisma/seed.js` y falla si aparece un email
//    que el seed no crea, o si el seed crea uno que este catálogo no menciona.
//    Es exactamente el modo en que murió el fixture de proveedores en S3-14: un
//    dato de prueba escrito contra una DB cargada a mano, sin nada que avisara
//    cuando dejó de existir.
// 2. Lo que el gate NO puede verificar es el contenido de puede/noPuede: eso lo
//    garantiza la revisión de cada tarea que toque una policy o un guard de
//    ruta. La regla es la misma que la de la ayuda contextual (AGENTS.md): si la
//    tarea cambia lo que un rol puede hacer, actualiza este archivo en la misma
//    tarea.
export const PASSWORD_DEMO = 'demo1234';

// El orden es la jerarquía: de más alcance a menos. Es el que ve el usuario.
export const USUARIOS_DEMO = [
  {
    email: 'admin@demo.com',
    nombre: 'María Fernanda Ruiz',
    rol: 'Administrador de la organización',
    alcance: 'Administración Demo S.A. · sus 2 edificios',
    resumen:
      'El dueño del backoffice: administra la organización entera y es el único que carga y liquida gastos.',
    puede: [
      'Ver y editar los edificios y las unidades de su administración.',
      'Cargar, editar y eliminar gastos, y generar, aprobar y anular liquidaciones.',
      'Administrar el directorio de proveedores y el árbol de rubros.',
      'Invitar staff y residentes, y editar sus permisos.',
      'Ver el reporte de gastos consolidado de todos los edificios (plan Business).',
    ],
    noPuede: [
      'Ver ni tocar datos de otra administración: la organización es el límite de todo.',
    ],
  },
  {
    email: 'gestor@demo.com',
    nombre: 'Juan Carlos Medina',
    rol: 'Gestor (un edificio)',
    alcance: 'Solo Torre Palermo',
    resumen:
      'Opera el día a día de los edificios que tiene asignados, en modo lectura sobre la plata.',
    puede: [
      'Ver Torre Palermo con sus unidades y sus gastos.',
      'Ver el reporte de gastos de ese edificio.',
      'Consultar proveedores y rubros (los necesita para leer un gasto).',
    ],
    noPuede: [
      'Cargar, editar o eliminar gastos: el botón "Nuevo gasto" ni aparece.',
      'Generar ni aprobar liquidaciones.',
      'Ver el otro edificio de la administración, ni el consolidado de todos.',
      'Entrar a Usuarios: no accede ni a la nómina del staff.',
    ],
  },
  {
    email: 'gestor2@demo.com',
    nombre: 'Verónica Salas',
    rol: 'Gestor (dos edificios)',
    alcance: 'Torre Palermo + Edificio San Martín',
    resumen:
      'El mismo rol que el anterior con dos edificios asignados: sirve para ver el selector de edificio del header en acción.',
    puede: ['Todo lo del gestor, sobre sus dos edificios.'],
    noPuede: ['Lo mismo que el gestor: nada de escritura sobre gastos ni liquidaciones.'],
  },
  {
    email: 'multiorg@demo.com',
    nombre: 'Pablo Iriarte',
    rol: 'Staff en dos administraciones',
    alcance: 'Gestor en Administración Demo S.A. · Administrador en Administración Sur S.R.L.',
    resumen:
      'Una sola identidad con membresías en dos organizaciones: es el único login que muestra el selector de organización del header.',
    puede: [
      'Cambiar de administración sin volver a loguearse (selector del header).',
      'En Administración Sur: todo lo de un administrador de organización.',
      'En Administración Demo: solo lo de un gestor de Torre Palermo.',
    ],
    noPuede: [
      'Mezclar las dos: cada organización se ve con los permisos que tiene ahí, y los datos nunca se cruzan.',
    ],
  },
  {
    email: 'admin.sur@demo.com',
    nombre: 'Alejandro Sosa',
    rol: 'Administrador de la organización (plan Starter)',
    alcance: 'Administración Sur S.R.L. · Edificio Lomas',
    resumen:
      'El mismo rol que admin@demo.com en otra administración, con un plan menor: sirve para ver qué queda fuera del plan.',
    puede: [
      'Todo lo de un administrador, sobre su propia administración.',
      'Ver el reporte de gastos de su edificio.',
    ],
    noPuede: [
      'Ver el consolidado de "Todos los edificios": es plan Business, y la pantalla lo dice en vez de fallar.',
    ],
  },
  {
    email: 'multiconsorcio@demo.com',
    nombre: 'Andrea Quiroga',
    rol: 'Propietaria en dos consorcios',
    alcance: 'Torre Palermo 2A (Demo S.A.) + Lomas 1A (Sur S.R.L.)',
    resumen:
      'Residente sin ningún rol de administración: una persona, un login, unidades en dos consorcios de dos administraciones distintas.',
    puede: ['Ver sus dos unidades y los datos de cada edificio, en solo lectura.'],
    noPuede: [
      'Entrar a ninguna pantalla del backoffice: no tiene organización activa.',
      'Ver gastos, liquidaciones ni datos de otras unidades. El portal del residente llega en S5.',
    ],
  },
  {
    email: 'inquilino@demo.com',
    nombre: 'Sofía Martínez',
    rol: 'Inquilino',
    alcance: 'Torre Palermo 1A',
    resumen: 'El caso más acotado: un residente con una sola unidad, alquilada.',
    puede: ['Ver su unidad y su edificio, en solo lectura.'],
    noPuede: [
      'Lo mismo que cualquier residente: nada del backoffice.',
      'Se distingue del propietario en quién paga qué: las expensas extraordinarias son del propietario (art. 2049 CCyC).',
    ],
  },
  {
    email: 'propietario2@demo.com',
    nombre: 'Laura Gómez',
    rol: 'Propietaria de dos unidades',
    alcance: 'Torre Palermo 3B y 4B',
    resumen: 'Residente con más de una UF en el mismo edificio.',
    puede: ['Ver sus dos unidades del mismo consorcio.'],
    noPuede: ['Lo mismo que cualquier residente: nada del backoffice.'],
  },
  {
    email: 'encargado@demo.com',
    nombre: 'José Luis Pereyra',
    rol: 'Encargado (sin vínculos todavía)',
    alcance: 'Ninguno',
    resumen:
      'Identidad válida sin ningún vínculo: entra, y la app se lo dice sin romperse. El rol de encargado todavía no tiene modelo.',
    puede: ['Iniciar sesión.'],
    noPuede: ['Ver ninguna pantalla con datos: no tiene organización ni unidades.'],
  },
  {
    email: 'invitado@demo.com',
    nombre: 'Camila Ferrer',
    rol: 'Invitación sin aceptar',
    alcance: 'Gestor de Edificio San Martín, cuando active',
    resumen:
      'No tiene contraseña todavía: existe para probar el flujo de invitación, no para entrar.',
    sinPassword: true,
    puede: [
      'Activar su cuenta desde el link de invitación (/invitacion/seed-invitacion-pendiente) y recién ahí elegir su contraseña.',
    ],
    noPuede: ['Iniciar sesión con contraseña: todavía no tiene ninguna.'],
  },
];

// Usuarios del seed que el diálogo NO lista, y por qué. Existe para que el gate
// pueda distinguir "decidimos no mostrarlo" de "nos olvidamos": `check:demo`
// exige que TODO usuario del seed esté en `USUARIOS_DEMO` o acá.
export const USUARIOS_DEMO_OMITIDOS = [
  {
    email: 'propietario1@demo.com',
    motivo:
      'Propietario simple de Torre Palermo — mismo caso que propietario2@demo.com, con una sola UF',
  },
  {
    email: 'propietario3@demo.com',
    motivo: 'Propietario simple de Edificio San Martín — mismo caso, otro edificio',
  },
  {
    email: 'propietario.sur@demo.com',
    motivo: 'Propietario simple de Edificio Lomas — mismo caso, en la organización B',
  },
];

/** Los que pueden loguearse con la password demo (los que muestra el diálogo como "usar"). */
export const USUARIOS_DEMO_CON_PASSWORD = USUARIOS_DEMO.filter((u) => !u.sinPassword);
