// frontend/src/lib/ayuda.js — ConsorcIA
// Registro estático de topics de ayuda contextual (S2 refinamiento #57, patrón
// nuevo de PRD-07-02). Es el núcleo del "módulo de FAQ": un mapa de topics que
// cualquier pantalla abre con `AyudaLink topic="..."` o el store de ayuda,
// y un único drawer global (AyudaDrawer, montado en AppLayout) que lo muestra.
//
// CÓMO AGREGAR UN TOPIC NUEVO:
//   1. Elegí un ID estable con formato de path (segmentos con slash, p. ej.
//      'gastos/categorias' o 'edificios/unidades/coeficientes'). El ID es el
//      contrato con los consumidores: no se renombra una vez publicado.
//   2. Agregá una entrada en AYUDA_TOPICS con:
//        ruta: breadcrumb legible (array, se muestra con ›),
//        titulo: título del drawer,
//        secciones: [{ titulo, cuerpo, items? }] — items es una lista opcional
//        de viñetas,
//        relacionados: [ids] opcional — otros topics que el drawer muestra al
//        pie como "Temas relacionados" (clickear navega dentro del drawer),
//        pantallas: [paths] opcional — archivos (relativos a frontend/) que
//        DEBEN contener una referencia a este topic; el gate
//        `npm run check:ayuda` (scripts/check-ayuda.mjs, corre también en CI)
//        falla si alguna deja de referenciarlo o el archivo no existe.
//   3. En la pantalla, renderizá <AyudaLink topic="tu/id" /> (variante link
//      con texto, o variant="icon" junto al título de la pantalla) o llamá
//      abrirAyuda('tu/id') del store.
// Un topic inexistente NUNCA rompe la UI: el drawer muestra un fallback.
//
// El contenido vive estático en el frontend (todo el copy es es-AR
// hardcodeado, no hay infra de contenido ni i18n). La evolución a FAQ
// completo (hub /ayuda, búsqueda, deep links, markdown) es aditiva: cambia
// los internals de este registro, no la API que consumen los componentes.

export const AYUDA_TOPICS = {
  // Concepto de alto nivel del módulo Edificios (PRD-04-01). Es el topic de
  // las pantallas de listado, alta, resumen y configuración de edificio.
  edificios: {
    ruta: ['Edificios'],
    titulo: 'Edificios',
    relacionados: ['edificios/unidades'],
    pantallas: [
      'src/pages/EdificiosPage.jsx',
      'src/pages/EdificioNuevoPage.jsx',
      'src/pages/edificio/EdificioOverviewTab.jsx',
      'src/pages/edificio/EdificioConfiguracionTab.jsx',
    ],
    secciones: [
      {
        titulo: '¿Qué es un edificio?',
        cuerpo:
          'Cada consorcio que administra tu organización. Es la unidad de trabajo principal de la app: todo cuelga del edificio — sus unidades, sus gastos y, más adelante, sus liquidaciones y cobranzas. Tu organización puede administrar varios edificios.',
      },
      {
        titulo: 'Los datos del edificio',
        cuerpo:
          'Además del nombre y la dirección, cada edificio tiene un tipo y una superficie total.',
        items: [
          'Tipo: PH / Consorcio, Barrio privado, Centro comercial u Otro.',
          'Superficie total (m²): la suma de los m² de todo el edificio. Es la base del coeficiente sugerido de cada unidad (m² de la unidad ÷ m² totales), así que conviene cargarla bien desde el alta.',
        ],
      },
      {
        titulo: '¿Quién puede hacer qué?',
        items: [
          'Crear y eliminar edificios: solo el administrador de la organización (org_admin).',
          'Editar los datos: el org_admin y el gestor que tenga el edificio asignado.',
          'Eliminar es una baja lógica: el edificio deja de listarse pero los datos se conservan (la Ley 941 exige conservar la documentación del consorcio).',
        ],
      },
    ],
  },

  // Unidades funcionales y coeficientes (PRD-04-01 §1.2/§1.3, invariante
  // informativa desde #57). Topic del tab Unidades del detalle de edificio.
  'edificios/unidades': {
    ruta: ['Edificios', 'Unidades'],
    titulo: 'Unidades y coeficientes',
    relacionados: ['edificios', 'edificios/unidades/categorias-gastos'],
    pantallas: ['src/pages/edificio/EdificioUnidadesTab.jsx'],
    secciones: [
      {
        titulo: '¿Qué es una unidad funcional?',
        cuerpo:
          'Cada parte del edificio que paga expensas por separado. Los tipos disponibles son departamento, local, cochera, baulera, oficina y subconsorcio (un sector con régimen propio, como una torre).',
      },
      {
        titulo: 'El coeficiente de cada unidad',
        cuerpo:
          'Es la proporción de la unidad sobre el total del edificio: m² de la unidad ÷ m² totales. Se escribe con 6 decimales (por ejemplo 0.027742) y define qué porción de cada gasto paga esa unidad. Al cargar los m² la app lo sugiere automáticamente, y podés editarlo si el reglamento define otros valores.',
      },
      {
        titulo: 'La suma tiene que cerrar en 1.000000',
        cuerpo:
          'Los coeficientes de todas las unidades del edificio tienen que sumar exactamente 1.000000. Mientras cargás unidades la app solo te avisa si la suma no cierra (podés guardar igual y cargar de a poco); el control estricto está al liquidar las expensas: si la suma no cierra, la liquidación no se puede emitir.',
      },
      {
        titulo: 'Alta individual y carga rápida',
        cuerpo:
          'Hay dos formas de cargar unidades. "Agregar unidad" carga una por vez con todos sus datos, incluidas las categorías de gastos. "Carga rápida" carga varias a la vez con los datos mínimos: les deja la categoría A marcada y sin categorías B ni C, que podés ajustar después unidad por unidad.',
      },
    ],
  },

  // Esquemas de reparto (S3-20, PRD-02-05 · CCyC art. 2049, último párrafo).
  // Topic de la sección de Configuración del edificio. Es el concepto más denso
  // de S3: la semántica del peso cambia con la base y no se puede deducir
  // mirando la pantalla, así que se explica con los tres casos completos.
  'edificios/esquemas-reparto': {
    ruta: ['Edificios', 'Esquemas de reparto'],
    titulo: 'Esquemas de reparto',
    relacionados: [
      'edificios/unidades',
      'edificios/unidades/categorias-gastos',
      'gastos/carga',
    ],
    pantallas: ['src/components/esquemas/EsquemasRepartoSection.jsx'],
    secciones: [
      {
        titulo: '¿Para qué sirven?',
        cuerpo:
          'Por default cada gasto se reparte según el coeficiente de cada unidad, y en la mayoría de los consorcios eso alcanza. Un esquema de reparto es la excepción que define el reglamento de copropiedad: "planta baja abona el 50% del ascensor", "la Torre A tiene su propia tabla", "esto se paga por unidad y no por coeficiente". Si tu edificio no necesita ninguna de esas cosas, no configures nada: sin esquemas, la app liquida por coeficiente.',
      },
      {
        titulo: 'La autoridad es el reglamento, no la administración',
        cuerpo:
          'El Código Civil y Comercial (art. 2049, último párrafo) permite eximir parcialmente a las unidades que no tienen acceso a un servicio o a un sector, pero quien lo define es el reglamento de copropiedad. Por eso cada esquema tiene un campo para la cláusula que lo habilita y un link al documento: es lo primero que se pide cuando un propietario impugna lo que se le cobró.',
      },
      {
        titulo: 'La base: qué significa el peso que cargás',
        cuerpo:
          'Cada esquema elige una base, y la base cambia cómo se lee la tabla de pesos. Es lo único que conviene tener claro antes de crear el primero.',
        items: [
          'Coeficiente: el peso es un factor sobre el coeficiente de la unidad. 0,5 hace que esa unidad pague la mitad de lo que le tocaría, 0 la exime del todo. Una unidad sin peso cargado paga el 100% de su coeficiente.',
          'Partes iguales: el peso es un factor sobre 1, y el reparto va por unidad y no por coeficiente (todas pagan lo mismo). Una unidad sin peso cargado paga una parte entera.',
          'Pesos propios: el peso es el valor absoluto que trae el reglamento — la "segunda tabla de coeficientes", que no es proporcional a la general. Acá una unidad sin peso cargado NO participa del reparto.',
        ],
      },
      {
        titulo: 'El alcance: a quiénes les llega',
        cuerpo:
          'El alcance se aplica antes que la base: la unidad que queda afuera no paga nada, sea cual sea su peso. Además es lo que hace que el esquema se aplique solo.',
        items: [
          'Todas las unidades: es el alcance del esquema general del edificio.',
          'Servicio (categoría B): los gastos de ese servicio lo usan automáticamente.',
          'Sector (categoría C): los gastos de ese sector lo usan automáticamente.',
          'Solo las unidades de la tabla: ningún gasto lo toma solo — hay que elegirlo a mano en el gasto. Es el caso del cargo por una rotura que pagan tres unidades.',
        ],
      },
      {
        titulo: 'Cargá solo las excepciones',
        cuerpo:
          'La tabla muestra todas las unidades del edificio, pero se completan únicamente las que se apartan del reparto normal. El esquema "todas al 100% menos planta baja al 50%" es un solo peso cargado: el de planta baja. El resto queda vacío y va con el default de la base.',
      },
      {
        titulo: 'Qué esquema usa cada gasto',
        cuerpo:
          'La app elige solo, en este orden, y el primero que aplica gana.',
        items: [
          'El que hayas elegido a mano en el gasto (el campo "Esquema de reparto" del formulario).',
          'El esquema del servicio o del sector del gasto, si el edificio tiene uno para ese servicio o sector.',
          'El esquema general del edificio, y solo para los gastos de categoría A. Un gasto de categoría B sin esquema propio no cae al general: se reparte por coeficiente entre las unidades que tienen el servicio.',
          'Si nada de lo anterior aplica, el coeficiente de siempre.',
        ],
      },
      {
        titulo: 'Editar un esquema no cambia lo ya emitido',
        cuerpo:
          'Cada liquidación guarda el reparto con el que se calculó, así que editar o desactivar un esquema no reescribe un recibo emitido: cambia lo que se va a liquidar de acá en adelante. Por eso un esquema que ya se usó no se borra — queda desactivado, y deja de ofrecerse y de aplicarse solo. Los gastos que lo habían elegido a mano lo siguen usando: cambiarles el reparto por debajo sería mover plata sin que nadie lo pida.',
      },
      {
        titulo: '¿Quién puede hacer qué?',
        items: [
          'Crear, editar y eliminar esquemas y elegir el general: el administrador de la organización.',
          'El gestor los ve (los necesita para entender un importe) pero no los modifica: cambian cuánto paga cada propietario en todas las liquidaciones futuras.',
        ],
      },
    ],
  },

  // Roles y accesos (PRD-04-11 §2/§3: identidad global, staff vs residentes,
  // multi-organización). Topic del backoffice de staff (/configuracion/usuarios).
  'usuarios/roles': {
    ruta: ['Usuarios', 'Roles y accesos'],
    titulo: 'Roles y accesos',
    relacionados: ['usuarios/invitaciones'],
    pantallas: ['src/pages/configuracion/ConfiguracionUsuariosPage.jsx'],
    secciones: [
      {
        titulo: 'Una persona, un solo login',
        cuerpo:
          'En ConsorcIA cada persona existe una sola vez, identificada por su email. Con ese único login puede acumular vínculos en distintos consorcios e incluso en distintas administraciones: ser gestor de un edificio, propietario en otro y administrador de una segunda organización, todo con la misma cuenta.',
      },
      {
        titulo: 'Roles de la organización (staff)',
        cuerpo:
          'Son los que operan el backoffice. Se administran desde Configuración → Usuarios.',
        items: [
          'Administrador (org_admin): ve y puede todo en su organización — edificios, unidades, gastos y la gestión de usuarios.',
          'Gestor: trabaja solo en los edificios que le asignan. Puede operar las unidades y los gastos de esos edificios, pero no crea edificios ni usuarios.',
        ],
      },
      {
        titulo: 'Roles del edificio (residentes)',
        cuerpo:
          'Propietarios e inquilinos se vinculan desde cada unidad (tab Unidades → fila → Residentes) y usan el portal, no el backoffice: ahí ven sus unidades —de todos sus consorcios—, sus expensas y sus recibos. Una misma unidad puede tener varios residentes vinculados, y una misma persona varias unidades.',
      },
      {
        titulo: 'Varias organizaciones',
        cuerpo:
          'Si una persona es staff de más de una administración, al entrar elige con cuál trabajar desde el selector de organización del header. Cambiar de organización no cierra la sesión: es el mismo login con otro contexto de trabajo.',
      },
    ],
  },

  // Workflows de habilitación de usuarios (PRD-04-11 §4/§5/§6.3). Topic del
  // drawer de residentes de la unidad.
  'usuarios/invitaciones': {
    ruta: ['Usuarios', 'Cómo se habilitan los usuarios'],
    titulo: 'Cómo se habilitan los usuarios',
    relacionados: ['usuarios/roles'],
    pantallas: ['src/pages/edificio/ResidentesDrawer.jsx'],
    secciones: [
      {
        titulo: 'Nadie se registra por su cuenta',
        cuerpo:
          'Los usuarios entran siempre invitados por la administración, que es quien conoce la titularidad de cada unidad. Hay dos caminos según el tipo de persona, y ambos terminan en un link de invitación que la app muestra para copiar y enviar.',
        items: [
          'Staff (gestores y administradores): el org_admin lo invita desde Configuración → Usuarios → "Invitar staff".',
          'Residentes (propietarios e inquilinos): se vinculan desde la unidad — tab Unidades → fila → Residentes → "Vincular persona".',
        ],
      },
      {
        titulo: 'Qué hace el link de invitación',
        cuerpo:
          'Depende de si la persona ya tenía cuenta en ConsorcIA.',
        items: [
          'Si no tenía cuenta: al abrir el link define su contraseña y su cuenta queda activa.',
          'Si ya tenía cuenta (porque ya es usuaria de otro consorcio o administración): entra con la contraseña que ya tenía — el link no se la cambia ni hace falta que lo abra para quedar vinculada.',
        ],
      },
      {
        titulo: 'Pendientes y reenvío',
        cuerpo:
          'El link es de un solo uso y vence a los 7 días. Si la persona todavía no activó su cuenta la app lo muestra como pendiente ("Invitado" en el staff, "Todavía no activó su cuenta" en la unidad): reenviá la invitación desde el mismo lugar donde la creaste y se genera un link nuevo.',
      },
    ],
  },

  // Directorio híbrido de proveedores (PRD-04-02 §1.3). Topic de
  // /configuracion/proveedores.
  'gastos/proveedores': {
    ruta: ['Gastos', 'Proveedores'],
    titulo: 'Proveedores',
    relacionados: ['gastos/rubros'],
    pantallas: ['src/pages/configuracion/ProveedoresPage.jsx'],
    secciones: [
      {
        titulo: '¿Para qué sirve el directorio?',
        cuerpo:
          'Todo gasto se carga a nombre de un proveedor: no se puede guardar un gasto sin elegir uno. El directorio es la lista de con quiénes trabaja tu organización, y tenerlo cargado es lo que después permite ver cuánto se le pagó a cada uno en el período.',
      },
      {
        titulo: 'Globales y propios',
        cuerpo:
          'El directorio mezcla dos orígenes, y cada fila lo aclara con un badge.',
        items: [
          'Global: viene del catálogo de la plataforma y lo comparten todas las administraciones. Lo podés usar en tus gastos, pero no editarlo ni borrarlo — lo mantiene ConsorcIA.',
          'Propio: lo cargó tu organización. Solo lo ve tu organización y lo podés editar y dar de baja.',
        ],
      },
      {
        titulo: 'El CUIT y los duplicados',
        cuerpo:
          'El CUIT es opcional (el plomero del barrio suele no tener uno a mano), pero si lo cargás tiene que ir con el formato 30-12345678-9 y no puede repetirse en tu directorio: es lo que evita terminar con el mismo proveedor dos veces y los totales partidos entre ambos. Si el CUIT ya existe, la app te lo avisa en el campo.',
      },
      {
        titulo: 'Rubro habitual',
        cuerpo:
          'Es opcional y funciona como atajo: al cargar un gasto de ese proveedor, la app propone ese rubro y te ahorra elegirlo. Siempre lo podés cambiar en el gasto.',
      },
      {
        titulo: 'Dar de baja no siempre borra',
        cuerpo:
          'Si el proveedor todavía no tiene gastos, se elimina. Si ya tiene, no se borra: queda desactivado. Los gastos son documentación del consorcio que la Ley 941 obliga a conservar, y borrar al proveedor dejaría gastos históricos sin poder decir a quién se le pagaron. Un proveedor desactivado deja de ofrecerse al cargar gastos nuevos, y podés reactivarlo cuando quieras (tildá "Mostrar desactivados" para encontrarlo).',
      },
      {
        titulo: '¿Quién puede hacer qué?',
        items: [
          'Crear, editar y dar de baja proveedores: el administrador de la organización.',
          'El gestor ve el directorio (lo necesita para cargar gastos) pero no lo modifica.',
        ],
      },
    ],
  },

  // Árbol de rubros: maestro + visibilidad + propios (PRD-04-02 §1.4). Topic de
  // /configuracion/rubros.
  'gastos/rubros': {
    ruta: ['Gastos', 'Rubros'],
    titulo: 'Rubros y subrubros',
    relacionados: ['gastos/proveedores', 'edificios/unidades/categorias-gastos'],
    pantallas: ['src/pages/configuracion/RubrosPage.jsx'],
    secciones: [
      {
        titulo: '¿Qué es un rubro?',
        cuerpo:
          'Es la clasificación del gasto por su naturaleza: plomería, energía eléctrica, sueldos. Sirve para analizar en qué se gasta la plata del consorcio — es lo que después alimenta el "gasto por rubro" del dashboard.',
      },
      {
        titulo: 'No confundir con las categorías A/B/C',
        cuerpo:
          'Son dos clasificaciones distintas y ninguna reemplaza a la otra. El rubro dice QUÉ se compró (plomería); la categoría dice QUIÉN lo paga (todas las unidades, solo las que tienen ese servicio, o solo las del sector). Un mismo rubro puede aparecer en gastos de categorías distintas: una reparación de plomería general es A, la del ascensor es B.',
      },
      {
        titulo: 'Dos niveles: rubro y subrubro',
        cuerpo:
          'El árbol tiene exactamente dos niveles: el rubro agrupa (Mantenimiento) y el subrubro precisa (Plomería, Electricidad, Pintura). El gasto se carga siempre contra el nivel más específico — un subrubro, o un rubro que no tenga subrubros.',
      },
      {
        titulo: 'El árbol de la plataforma y el tuyo',
        cuerpo:
          'Arrancás con un árbol que trae ConsorcIA, marcado como "Maestro": está pensado para un consorcio típico y se actualiza con el producto. No se edita ni se borra, pero lo adaptás de dos maneras.',
        items: [
          'Ocultar lo que no usás (el ícono del ojo): deja de aparecer al cargar gastos, sin tocar los gastos ya cargados con ese rubro. Ocultar un rubro oculta también sus subrubros.',
          'Agregar los tuyos: un rubro nuevo de primer nivel, o un subrubro propio colgado de un rubro de la plataforma. Quedan marcados como "Propio" y esos sí los editás y los borrás.',
        ],
      },
      {
        titulo: 'Nombres repetidos',
        cuerpo:
          'No puede haber dos rubros con el mismo nombre en el mismo nivel, ni siquiera si uno es de la plataforma y el otro tuyo: en el selector del gasto serían indistinguibles. Si el nombre ya está tomado, la app te lo avisa en el campo — revisá si el que buscás ya existe en el maestro y está oculto.',
      },
      {
        titulo: 'Eliminar no siempre borra',
        cuerpo:
          'Un rubro propio sin gastos se elimina. Si ya tiene gastos, no se borra: queda oculto, para que los gastos históricos sigan diciendo a qué rubro pertenecen (Ley 941). Y un rubro con subrubros no se elimina hasta sacar los subrubros: borrarlo ascendería a sus hijos a primer nivel y desarmaría la clasificación con la que se cargaron los gastos.',
      },
      {
        titulo: '¿Quién puede hacer qué?',
        items: [
          'Ocultar, crear, editar y eliminar rubros: el administrador de la organización.',
          'El gestor ve el árbol (lo necesita para cargar gastos) pero no lo modifica.',
        ],
      },
    ],
  },

  // Carga de gastos (S3-08, PRD-04-02 §1.1/§4.2). Es el topic del tab `gastos`
  // del edificio: explica los cuatro datos que el formulario pide y que no son
  // obvios (proveedor, rubro, categoría, período vs fecha) y por qué un gasto
  // liquidado no se toca.
  'gastos/carga': {
    ruta: ['Gastos', 'Cargar un gasto'],
    titulo: 'Cargar un gasto',
    relacionados: [
      'edificios/unidades/categorias-gastos',
      'edificios/esquemas-reparto',
      'gastos/proveedores',
      'gastos/rubros',
      // S3-09: el destino de todo gasto es la liquidación del período.
      'liquidaciones',
    ],
    pantallas: ['src/pages/edificio/EdificioGastosTab.jsx'],
    secciones: [
      {
        titulo: '¿Qué es un gasto?',
        cuerpo:
          'Cada erogación del consorcio se carga como un gasto del edificio: el sueldo del encargado, el seguro, una reparación. Al liquidar el período, el sistema toma todos los gastos cargados y los reparte entre las unidades. Lo que no está cargado no se cobra.',
      },
      {
        titulo: 'Período y fecha no son lo mismo',
        cuerpo:
          'La fecha del gasto es cuándo se hizo (la de la factura). El período es en qué liquidación entra. Suelen coincidir, pero no siempre: una factura del 28 de junio que llegó tarde se puede cargar con fecha de junio y período de julio, y así se cobra en las expensas de julio.',
      },
      {
        titulo: 'Rubro y categoría son dos cosas distintas',
        cuerpo:
          'El rubro (Mantenimiento › Plomería) sirve para analizar en qué gasta el consorcio. La categoría A/B/C decide QUIÉNES lo pagan. Un mismo rubro puede tener gastos de categorías distintas: la reparación de un ascensor es "Mantenimiento" y categoría B; la del portón, "Mantenimiento" y categoría A.',
        items: [
          'A — lo pagan todas las unidades, según su coeficiente.',
          'B — solo las unidades que tienen ese servicio tildado.',
          'C — solo las unidades del sector.',
        ],
      },
      {
        titulo: 'Por qué el servicio y el sector son un desplegable',
        cuerpo:
          'Las opciones de las categorías B y C salen de lo que declaran las unidades del edificio. Si el gasto apuntara a un servicio que ninguna unidad tiene, no habría entre quiénes repartirlo y fallaría la liquidación de todo el mes. Si te falta una opción, agregala primero en la unidad que corresponda: aparece acá enseguida.',
      },
      {
        titulo: 'El proveedor es obligatorio',
        cuerpo:
          'Ningún gasto se carga sin proveedor: es lo que permite seguir a quién se le paga y ver el ranking de gastos por proveedor. Si el proveedor no está en el directorio, se crea desde el mismo formulario con "Crear proveedor" y queda elegido, sin perder lo que ya cargaste.',
      },
      {
        titulo: 'Cobrar una obra en cuotas',
        cuerpo:
          'Un gasto extraordinario se puede repartir en cuotas mensuales: se carga UNA vez por el total de la factura y se tilda "Cobrar en cuotas". El sistema arma el plan desde el período elegido y cada liquidación cobra la cuota que le toca, con el rótulo "cuota 3/6" en la lista y en el recibo. El monto que se muestra al filtrar por un período es el de la cuota de ese mes; el total de la factura queda debajo.',
        items: [
          'Solo los extraordinarios: una ordinaria es el gasto corriente del mes y prorratearla escondería el gasto real de cada período.',
          'Las cuotas suman siempre el total exacto de la factura; los centavos del redondeo caen en la última.',
          'Cambiar el monto, el período o la cantidad de cuotas rearma el plan completo.',
          'Si una cuota ya está en una liquidación aprobada, el gasto queda congelado como cualquier otro.',
        ],
      },
      {
        titulo: 'El esquema de reparto casi nunca se toca',
        cuerpo:
          'El campo "Esquema de reparto" viene en "Automático" y así conviene dejarlo: la app ya le aplica al gasto el esquema que el edificio tiene configurado para ese servicio o sector, el general si es de categoría A, o el coeficiente si no hay nada. Elegí uno a mano solo cuando ESTE gasto se reparte distinto de lo habitual —el típico cargo por una rotura que pagan tres unidades—, y creá antes el esquema en Configuración del edificio.',
      },
      {
        titulo: 'Un gasto liquidado ya no se edita',
        cuerpo:
          'Cuando la liquidación del período está aprobada, sus gastos quedan congelados: editar o eliminar uno cambiaría un recibo ya emitido. Las acciones de esas filas aparecen deshabilitadas. Para corregir un gasto así hay que anular la liquidación, corregirlo y volver a generarla.',
      },
      {
        titulo: 'Eliminar no borra del sistema',
        cuerpo:
          'Al eliminar un gasto deja de contarse en las liquidaciones, pero el registro se conserva: la Ley 941 exige guardar la documentación del consorcio.',
      },
    ],
  },

  // Primer topic: categorías A/B/C del alta de unidad (Ley 941,
  // PRD-04-01 §1.4). El reparto que describe es el del motor de liquidación
  // de S3 (S3-03: A → todas las UF, B → UF con ese servicio, C → UF del sector).
  'edificios/unidades/categorias-gastos': {
    ruta: ['Edificios', 'Unidades', 'Categorías de gastos'],
    titulo: 'Categorías de gastos',
    relacionados: ['edificios/unidades', 'edificios/esquemas-reparto'],
    pantallas: ['src/pages/edificio/UnidadCategoriasTab.jsx'],
    secciones: [
      {
        titulo: '¿Qué son las categorías de gastos?',
        cuerpo:
          'Cada unidad funcional se clasifica en tres categorías (A, B y C) que determinan qué gastos del consorcio le corresponde pagar. Se define una sola vez, al dar de alta la unidad, y el motor de liquidación la usa todos los meses para repartir los gastos del período.',
      },
      {
        titulo: 'Categoría A — Gastos generales',
        cuerpo:
          'Son los gastos que afectan a todo el consorcio, sin importar la ubicación o el uso de la unidad. Al liquidar se reparten entre TODAS las unidades, cada una en proporción a su coeficiente. Casi siempre todas las unidades tienen la categoría A marcada.',
        items: [
          'Sueldos y cargas sociales del encargado',
          'Seguros del edificio',
          'ABL y tasas municipales',
          'Limpieza y mantenimiento de espacios comunes',
        ],
      },
      {
        titulo: 'Categoría B — Servicios específicos',
        cuerpo:
          'Son servicios que solo usan algunas unidades. Se marca servicio por servicio y la unidad paga únicamente los que tiene tildados. Al liquidar, un gasto de categoría B se reparte solo entre las unidades que tienen ese servicio, en proporción a su coeficiente.',
        items: [
          'Ascensor (el reglamento suele exceptuar a planta baja y locales)',
          'Calefacción central',
          'Agua caliente central',
        ],
      },
      {
        titulo: 'Categoría C — Sectores',
        cuerpo:
          'Agrupa unidades que comparten un gasto propio de su sector. Se escribe el nombre del sector (por ejemplo "pileta" o "torre-a") y todas las unidades con el mismo nombre pagan juntas esos gastos. Al liquidar, un gasto de categoría C se reparte solo entre las unidades de ese sector, en proporción a su coeficiente.',
        items: ['Pileta', 'Torre A / Torre B', 'Sector comercial'],
      },
      {
        titulo: 'Cómo se reparten los gastos al liquidar',
        cuerpo:
          'Al liquidar las expensas del mes, el motor de liquidación toma cada gasto cargado y lo distribuye según su categoría: los de A entre todas las unidades, los de B solo entre las que tienen ese servicio y los de C solo entre las del sector — en proporción al coeficiente de cada unidad, salvo que el edificio tenga configurado un esquema de reparto distinto (por ejemplo, planta baja al 50% del ascensor). Por eso conviene clasificar bien desde el alta: una categoría mal puesta hace que una unidad pague de más o de menos todos los meses.',
      },
      {
        titulo: '¿Cuándo conviene cada una?',
        items: [
          'Dejá la categoría A marcada salvo que el reglamento exceptúe a la unidad de los gastos generales (poco frecuente).',
          'Usá B cuando un servicio no llega a todas las unidades: el caso típico es el ascensor, que planta baja y locales no usan.',
          'Usá C cuando el edificio tiene sectores con gastos propios (torres, pileta, sector comercial). Escribí el nombre del sector igual en todas las unidades que lo comparten.',
        ],
      },
    ],
  },

  // Concepto de liquidación (S3-09, PRD-04-03 §1/§2). Topic del tab
  // Liquidaciones: qué es, cuándo se hace, en qué estados vive y quién puede.
  liquidaciones: {
    ruta: ['Liquidaciones'],
    titulo: 'Liquidaciones',
    relacionados: [
      'liquidaciones/preview',
      'gastos/carga',
      'edificios/unidades/categorias-gastos',
    ],
    pantallas: ['src/pages/edificio/EdificioLiquidacionesTab.jsx'],
    secciones: [
      {
        titulo: '¿Qué es liquidar un período?',
        cuerpo:
          'Es repartir los gastos de un mes entre las unidades del edificio y dejar registrado cuánto le toca pagar a cada una. La app toma todos los gastos imputados a ese período —incluidas las cuotas de los gastos en cuotas que caen ahí—, los reparte según la categoría de cada gasto y el esquema de reparto que corresponda, y guarda el resultado.',
      },
      {
        titulo: 'Antes de liquidar',
        items: [
          'Que estén cargados todos los gastos del período: lo que falte no se puede agregar después sin anular y volver a generar.',
          'Que ningún gasto quede sin categoría (A, B o C): sin ella no se sabe qué unidades lo pagan.',
          'Que los coeficientes de las unidades sumen 1,000000: es el único requisito que la app exige de forma bloqueante, porque si no cierran se repartiría más o menos del 100% de cada gasto.',
        ],
      },
      {
        titulo: 'Los estados de una liquidación',
        cuerpo:
          'Una liquidación no se emite de una: pasa por estados, y cada uno dice hasta dónde llegó.',
        items: [
          'Borrador: calculada pero no aprobada. Nadie la vio fuera de la administración.',
          'Aprobada: la administración la dio por buena. Todavía no hay recibos.',
          'Enviada: con los recibos emitidos y disponibles para las unidades.',
          'Cobrada: con los cobros imputados.',
          'Anulada: sin efecto. Es lo único que libera el período para volver a generarlo.',
        ],
      },
      {
        titulo: 'Un período, una liquidación',
        cuerpo:
          'Mientras un período tenga una liquidación que no esté anulada, no se puede generar otra para el mismo mes. Si detectás un error —un gasto que faltaba, una categoría mal puesta— el camino es anular la que existe, corregir y volver a generar. No se sobrescribe: los recibos ya emitidos tienen que seguir diciendo con qué se calcularon (Ley 941).',
      },
      {
        titulo: '¿Quién puede hacer qué?',
        items: [
          'Generar y aprobar liquidaciones: solo el administrador de la organización (org_admin).',
          'Ver las liquidaciones y su detalle por unidad: también el gestor de los edificios que tiene asignados.',
        ],
      },
    ],
  },

  // Cómo se lee la preview (S3-09, PRD-04-03 §4.1). Topic de la pantalla de
  // detalle: qué significan las columnas y el desglose por gasto.
  'liquidaciones/preview': {
    ruta: ['Liquidaciones', 'Detalle'],
    titulo: 'Cómo leer una liquidación',
    relacionados: [
      'liquidaciones',
      'edificios/esquemas-reparto',
      'edificios/unidades/categorias-gastos',
    ],
    pantallas: ['src/pages/edificio/LiquidacionPreviewTab.jsx'],
    secciones: [
      {
        titulo: 'Ordinarias y extraordinarias van separadas',
        cuerpo:
          'Los gastos habituales del consorcio (sueldos, seguros, limpieza) son expensas ordinarias; las obras y los gastos no recurrentes son extraordinarias. La Ley 941 exige mostrarlas por separado, y la distinción también decide quién las absorbe cuando la unidad está alquilada: las ordinarias suelen ir al inquilino y las extraordinarias al propietario.',
      },
      {
        titulo: 'La tabla por unidad',
        cuerpo:
          'Una fila por unidad funcional, con lo que le toca de ordinarias, de extraordinarias y el total. La fila TOTAL del pie suma todas las filas y tiene que coincidir al centavo con el total general de las tarjetas de arriba; si alguna vez no coincide, la app lo avisa y esa liquidación no se aprueba.',
      },
      {
        titulo: 'El desglose de cada unidad',
        cuerpo:
          'Tocando una fila se abre el detalle: un renglón por cada gasto del período que esa unidad paga, con la participación que le tocó de ese gasto y el monto. La participación es la porción de ESE gasto, no el coeficiente de la unidad: en un gasto de categoría B o C solo participan las unidades alcanzadas, así que las participaciones se reparten entre ellas y suman 1.',
      },
      {
        titulo: 'Con qué esquema se repartió cada gasto',
        cuerpo:
          'Si un gasto se repartió con un esquema del reglamento (por ejemplo, planta baja al 50% del ascensor), el renglón lo dice con el nombre del esquema. Si no dice nada, se repartió en proporción al coeficiente según la categoría del gasto, que es lo normal. Es la forma de verificar antes de aprobar que el reparto es el que manda el reglamento de copropiedad.',
      },
      {
        titulo: 'La variación contra el período anterior',
        cuerpo:
          'Cuando el edificio ya tiene una liquidación anterior sin anular, aparece una columna con cuánto varió el total de cada unidad respecto de esa liquidación. Se compara contra la última vigente, que no siempre es el mes inmediato anterior. Una variación grande no es necesariamente un error —una obra aprobada por asamblea sube las expensas— pero es lo primero que conviene mirar.',
      },
      {
        titulo: 'Un borrador todavía no se emitió',
        cuerpo:
          'Mientras la liquidación esté en borrador no la vio nadie fuera de la administración y se puede anular sin consecuencias. Revisar el detalle acá es el último momento barato para detectar que una unidad está pagando lo que no le toca: después de aprobar, el número se convierte en un recibo con valor legal.',
      },
    ],
  },
};

// Devuelve el topic o null si no existe (el drawer muestra el fallback).
export function getAyudaTopic(path) {
  return AYUDA_TOPICS[path] ?? null;
}
