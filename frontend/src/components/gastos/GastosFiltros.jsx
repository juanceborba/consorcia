// frontend/src/components/gastos/GastosFiltros.jsx — ConsorcIA
// Barra de filtros del módulo de gastos (S3-08b, extendida en S3-16). Desde
// S3-16 alimenta las DOS vistas de PRD-04-02 §3: el dashboard y el listado, que
// leen los mismos search params (ver `hooks/useFiltrosGastos.js`).
//
// Patrón de toolbar de data-table: lo frecuente a la vista, el resto en un panel,
// y lo que está activo resumido en chips.
//
// POR QUÉ NO UN FILTRO POR COLUMNA DENTRO DE LA TABLA (primer intento de
// S3-08b): siete controles metidos en una fila de cabeceras obligan a angostar
// cada uno hasta que dejan de leerse ("Todo⌄"), empujan la tabla a scroll
// horizontal y le agregan a la cabecera un peso visual que compite con los datos
// —que es lo que la pantalla vino a mostrar—. La toolbar invierte la relación:
// la tabla queda limpia y el filtrado se pide cuando se lo necesita.
//
// DECISIONES:
//
// 1. QUÉ QUEDA A LA VISTA: el edificio, el buscador de concepto y el período. Son
//    los del encabezado de §3.2 y los que se usan en casi toda sesión (el período
//    es el eje del módulo: todo el dominio de expensas se piensa por mes). Los
//    otros cuatro —proveedor, categoría, tipo y quién lo cargó— viven en el panel
//    "Filtros", con un contador en el botón para que nunca haya un filtro activo
//    escondido sin señal.
//
// 2. LOS CHIPS SON LA RED DE SEGURIDAD del panel. Un filtro que no se ve es un
//    filtro que se olvida, y "la lista no muestra el gasto que cargué" es el
//    bug fantasma clásico de los filtros colapsados. Cada chip nombra su filtro,
//    muestra su valor y se quita solo (✕); "Limpiar todo" resetea de una.
//
// 3. EL ESTADO SIGUE EN LA URL. Este componente no tiene estado propio salvo el
//    texto que se está tipeando (debounce de 300 ms, igual que el buscador de
//    proveedores de S3-14): recibe los valores y un `onFiltro` que escribe los
//    search params. Así la vista sigue siendo compartible y recargable
//    (PRD-07-03 §2.2) y el filtrado sigue siendo del backend, no del cliente.
//
// 4. EL FILTRO "CARGADO POR" SOLO PARA EL ORG_ADMIN: su combo se alimenta de la
//    nómina de staff (`/api/organizaciones/me/usuarios`), que al gestor le
//    responde 403. La COLUMNA la ve todo el staff; el filtro, no.
//
// 5. (S3-16) EL RANGO DE FECHAS ES UN MODO DEL SELECTOR DE PERÍODO, no un filtro
//    del panel. Los tres modos de §3.2 —últimos 12 meses / desde-hasta / todo el
//    período— son EXCLUYENTES en el contrato del dashboard, que responde 422 si
//    llegan combinados. Mientras el rango vivió en el panel (S3-08b) se podía
//    elegir junto con un período, algo que el listado toleraba y el dashboard no.
//    Presentarlos como un control con tres modos hace que la exclusión se lea en
//    la UI, no solo en el error de la API. Al entrar en modo rango se precarga el
//    mes corriente completo: un rango vacío no es un modo, es un formulario a
//    medio llenar.
//
// 6. (S3-16) EL SELECTOR DE EDIFICIO NAVEGA, NO FILTRA. Los gastos son de un
//    edificio (`/api/edificios/:id/gastos`) y el consolidado es otro endpoint en
//    otra pantalla (`/reportes/gastos`, Business+), así que el selector emite el
//    destino y la pantalla decide la navegación conservando los search params. La
//    opción "Todos los edificios" se muestra DESHABILITADA cuando el plan no la
//    incluye, con el motivo en el `title`: esconderla dejaría al plan starter sin
//    saber que la vista existe, y ofrecerla sin gate sería mandar a un 403.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatearPeriodo, nombreDeAutor, periodoActual } from '@/lib/formato';
import { TODOS_LOS_PERIODOS } from '@/hooks/useFiltrosGastos';
import ProveedorSelect from '@/components/gastos/ProveedorSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Select } from '@/components/ui/select';

export const CATEGORIAS = [
  { value: '', label: 'Todas' },
  { value: 'A', label: 'A — Generales' },
  { value: 'B', label: 'B — Servicio específico' },
  { value: 'C', label: 'C — Sector específico' },
];

export const TIPOS = [
  { value: '', label: 'Todos' },
  { value: 'ordinario', label: 'Ordinario' },
  { value: 'extraordinario', label: 'Extraordinario' },
];

// Valores del selector de edificio que no son un id (decisión 6).
export const TODOS_LOS_EDIFICIOS = 'todos';

// Modo rango del selector de período (decisión 5).
const MODO_RANGO = 'rango';

// Decisión 5: el mes corriente completo, para que el modo rango arranque con
// algo que devuelve datos. `toISOString().slice(0,10)` sobre una fecha local
// correría el día en UTC-3, así que se arma a mano.
function mesCorrienteEnFechas(hoy = new Date()) {
  const iso = (fecha) =>
    `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(
      fecha.getDate(),
    ).padStart(2, '0')}`;
  return {
    desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
    hasta: iso(hoy),
  };
}

// Campo del panel: label arriba, control abajo. Local al componente, como en el
// resto de los formularios del dominio (no hay wrapper compartido todavía).
function CampoFiltro({ id, label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

// Decisión 2: un chip por filtro activo, con su nombre, su valor y su ✕.
function ChipFiltro({ etiqueta, valor, onQuitar }) {
  return (
    <Badge variant="secondary" className="gap-1 py-1 pr-1 pl-2 font-normal">
      <span className="text-muted-foreground">{etiqueta}:</span>
      <span className="max-w-40 truncate font-medium">{valor}</span>
      <button
        type="button"
        aria-label={`Quitar el filtro de ${etiqueta.toLowerCase()}`}
        className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        onClick={onQuitar}
      >
        <X className="size-3" />
      </button>
    </Badge>
  );
}

export default function GastosFiltros({
  valores,
  modoPeriodo,
  periodos,
  puedeVerAutores,
  // El filtro de tipo solo aparece donde hay un listado que lo aplique: el
  // dashboard lo ignora por contrato (precisión 3 de §3.4), así que en el reporte
  // consolidado —que no tiene listado— sería un control que no mueve nada.
  mostrarTipo = true,
  // Decisión 6: contexto del selector de edificio.
  edificios = [],
  edificioSeleccionado,
  consolidado = { disponible: false, motivo: undefined },
  onEdificio,
  // Nombres legibles de los filtros que en la URL son un UUID.
  proveedorNombre,
  rubroNombre,
  onFiltro,
  onLimpiar,
}) {
  const { periodo, categoria, tipo, proveedorId, rubroId, createdBy, desde, hasta, q } =
    valores;

  // Decisión 3: lo único local es el texto en curso.
  const [busqueda, setBusqueda] = useState(q);
  useEffect(() => {
    if (busqueda === q) return undefined;
    const timer = setTimeout(() => onFiltro({ q: busqueda }), 300);
    return () => clearTimeout(timer);
  }, [busqueda, q, onFiltro]);

  // El filtro puede cambiar de afuera (link compartido, "Limpiar todo"): el
  // input tiene que seguirlo.
  useEffect(() => {
    setBusqueda((actual) => (actual === q ? actual : q));
  }, [q]);

  // Decisión 4: la nómina solo la lee el org_admin.
  const { data: staff } = useQuery({
    queryKey: queryKeys.organizaciones.staff(),
    queryFn: () => api.get('/api/organizaciones/me/usuarios'),
    enabled: puedeVerAutores,
  });
  const autores = staff ?? [];

  // Los chips muestran el valor legible, no el UUID. Si el nombre todavía no
  // está en cache, el chip dice "elegido" en vez de mentir con un id.
  const nombreAutor = (() => {
    if (!createdBy) return null;
    const autor = autores.find((a) => a.id === createdBy);
    return autor ? nombreDeAutor(autor) : 'elegido';
  })();

  // Decisión 5: el valor del select de período es el modo cuando no es un mes.
  const valorPeriodo =
    modoPeriodo === 'rango'
      ? MODO_RANGO
      : modoPeriodo === 'todo'
        ? TODOS_LOS_PERIODOS
        : periodo;

  function cambiarPeriodo(valor) {
    if (valor === MODO_RANGO) {
      // Entrar al modo rango precargando el mes corriente. `onFiltro` borra el
      // `periodo` solo (la exclusión vive en useFiltrosGastos).
      onFiltro(mesCorrienteEnFechas());
      return;
    }
    onFiltro({ periodo: valor });
  }

  // Los del panel, para el contador del botón y los chips.
  const activosDelPanel = [
    proveedorId && {
      clave: 'proveedorId',
      etiqueta: 'Proveedor',
      valor: proveedorNombre ?? 'elegido',
    },
    categoria && {
      clave: 'categoria',
      etiqueta: 'Categoría',
      valor: CATEGORIAS.find((c) => c.value === categoria)?.label ?? categoria,
    },
    mostrarTipo && tipo && {
      clave: 'tipo',
      etiqueta: 'Tipo',
      valor: TIPOS.find((t) => t.value === tipo)?.label ?? tipo,
    },
    createdBy && {
      clave: 'createdBy',
      etiqueta: 'Cargado por',
      valor: nombreAutor,
    },
  ].filter(Boolean);

  // El buscador, el rango y el rubro tienen su propio chip aunque no vivan en el
  // panel: con la lista vacía conviene que el motivo se lea en un solo lugar. El
  // rubro además se pone clickeando una barra del chart, donde no hay control que
  // muestre el estado.
  const chips = [
    ...(q ? [{ clave: 'q', etiqueta: 'Concepto', valor: q }] : []),
    ...(rubroId
      ? [{ clave: 'rubroId', etiqueta: 'Rubro', valor: rubroNombre ?? 'elegido' }]
      : []),
    ...activosDelPanel,
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Decisión 6: el edificio primero — es el alcance de todo lo demás. */}
        {onEdificio && (
          <Select
            id="filtro-edificio"
            className="w-56"
            aria-label="Elegir el edificio"
            value={edificioSeleccionado ?? ''}
            onChange={(event) => onEdificio(event.target.value)}
          >
            {edificios.map((edificio) => (
              <option key={edificio.id} value={edificio.id}>
                {edificio.nombre}
              </option>
            ))}
            <option
              value={TODOS_LOS_EDIFICIOS}
              disabled={!consolidado.disponible}
              title={consolidado.motivo}
            >
              Todos los edificios
              {!consolidado.disponible ? ' (plan Business)' : ''}
            </option>
          </Select>
        )}

        {/* Decisión 1: buscador y período, siempre visibles. */}
        <div className="relative w-full max-w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="filtro-concepto"
            className="pl-8"
            placeholder="Buscar por concepto"
            autoComplete="off"
            aria-label="Buscar por concepto"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
          />
        </div>

        <Select
          id="filtro-periodo"
          className="w-48"
          aria-label="Filtrar por período"
          value={valorPeriodo}
          onChange={(event) => cambiarPeriodo(event.target.value)}
        >
          {periodos.map((p) => (
            <option key={p} value={p}>
              {formatearPeriodo(p)}
            </option>
          ))}
          <option value={TODOS_LOS_PERIODOS}>Todos los períodos</option>
          <option value={MODO_RANGO}>Rango de fechas…</option>
        </Select>

        {/* Decisión 5: en modo rango, los dos extremos al lado del selector.
            Filtran por FECHA DEL GASTO, no por período: el rótulo lo aclara
            porque son dos ejes distintos del mismo gasto. */}
        {modoPeriodo === 'rango' && (
          <div className="flex items-center gap-1.5">
            <Label htmlFor="filtro-desde" className="text-xs text-muted-foreground">
              Fecha del gasto
            </Label>
            <Input
              id="filtro-desde"
              type="date"
              className="w-40"
              aria-label="Fecha del gasto desde"
              value={desde}
              max={hasta || undefined}
              onChange={(event) => onFiltro({ desde: event.target.value })}
            />
            <span className="text-muted-foreground">→</span>
            <Input
              id="filtro-hasta"
              type="date"
              className="w-40"
              aria-label="Fecha del gasto hasta"
              value={hasta}
              min={desde || undefined}
              onChange={(event) => onFiltro({ hasta: event.target.value })}
            />
            <Button
              variant="ghost"
              size="sm"
              // Salir del modo rango: se vuelve al período corriente, que es el
              // default de la pantalla.
              onClick={() => onFiltro({ periodo: periodoActual() })}
            >
              Volver al período
            </Button>
          </div>
        )}

        <Popover>
          <PopoverTrigger
            render={
              <Button variant="outline" className="gap-2">
                <SlidersHorizontal className="size-4" />
                Filtros
                {activosDelPanel.length > 0 && (
                  <Badge variant="secondary" className="px-1.5">
                    {activosDelPanel.length}
                  </Badge>
                )}
              </Button>
            }
          />
          <PopoverContent className="w-88 flex-col gap-4">
            <PopoverTitle>Filtrar gastos</PopoverTitle>

            <div className="mt-3 flex flex-col gap-3">
              <CampoFiltro id="filtro-proveedor" label="Proveedor">
                {/* Reusa el combobox del form de gasto (S3-14): el directorio
                    se pagina y no cabe en un <select>. Sin alta inline: crear
                    un proveedor desde un filtro no tiene sentido. */}
                <ProveedorSelect
                  id="filtro-proveedor"
                  value={proveedorId}
                  permitirAlta={false}
                  onChange={(valor) => onFiltro({ proveedorId: valor })}
                />
              </CampoFiltro>

              <div className="grid grid-cols-2 gap-3">
                <CampoFiltro id="filtro-categoria" label="Categoría">
                  <Select
                    id="filtro-categoria"
                    value={categoria}
                    onChange={(event) =>
                      onFiltro({ categoria: event.target.value })
                    }
                  >
                    {CATEGORIAS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </CampoFiltro>

                {mostrarTipo && (
                <CampoFiltro id="filtro-tipo" label="Tipo">
                  <Select
                    id="filtro-tipo"
                    value={tipo}
                    onChange={(event) => onFiltro({ tipo: event.target.value })}
                  >
                    {TIPOS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </CampoFiltro>
                )}
              </div>

              {puedeVerAutores && (
                <CampoFiltro id="filtro-autor" label="Cargado por">
                  <Select
                    id="filtro-autor"
                    value={createdBy}
                    onChange={(event) =>
                      onFiltro({ createdBy: event.target.value })
                    }
                  >
                    <option value="">Cualquiera</option>
                    {autores.map((autor) => (
                      <option key={autor.id} value={autor.id}>
                        {nombreDeAutor(autor)}
                      </option>
                    ))}
                  </Select>
                </CampoFiltro>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Decisión 2: lo activo, a la vista y quitable de a uno. */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <ChipFiltro
              key={chip.clave}
              etiqueta={chip.etiqueta}
              valor={chip.valor}
              onQuitar={() => {
                if (chip.clave === 'q') setBusqueda('');
                onFiltro({ [chip.clave]: '' });
              }}
            />
          ))}
          <Button variant="ghost" size="sm" onClick={onLimpiar}>
            Limpiar todo
          </Button>
        </div>
      )}
    </div>
  );
}
