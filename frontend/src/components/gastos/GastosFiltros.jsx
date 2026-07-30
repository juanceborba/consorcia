// frontend/src/components/gastos/GastosFiltros.jsx — ConsorcIA
// Barra de filtros del listado de gastos (S3-08b, PRD-04-02 §4.1). Patrón de
// toolbar de data-table: lo frecuente a la vista, el resto en un panel, y lo
// que está activo resumido en chips.
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
// 1. QUÉ QUEDA A LA VISTA: el buscador de concepto y el período. Son los dos
//    filtros que se usan en casi toda sesión (el período es el eje del módulo:
//    todo el dominio de expensas se piensa por mes). Los otros cinco
//    —proveedor, categoría, tipo, rango de fecha y quién lo cargó— viven en el
//    panel "Filtros", con un contador en el botón para que nunca haya un filtro
//    activo escondido sin señal.
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
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatearPeriodo, nombreDeAutor } from '@/lib/formato';
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
  filtros,
  periodos,
  todosLosPeriodos,
  puedeVerAutores,
  onFiltro,
  onLimpiar,
}) {
  const { periodo, categoria, tipo, proveedorId, createdBy, desde, hasta, q } =
    filtros;

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

  // Nombre del proveedor y del autor elegidos: los chips muestran el valor
  // legible, no el UUID. Si el dato todavía no está en cache, el chip dice
  // "elegido" en vez de mentir con un id.
  const nombreProveedor = (() => {
    if (!proveedorId) return null;
    return filtros.proveedorNombre ?? 'elegido';
  })();
  const nombreAutor = (() => {
    if (!createdBy) return null;
    const autor = autores.find((a) => a.id === createdBy);
    return autor ? nombreDeAutor(autor) : 'elegido';
  })();

  // Los del panel, para el contador del botón y los chips.
  const activosDelPanel = [
    proveedorId && {
      clave: 'proveedorId',
      etiqueta: 'Proveedor',
      valor: nombreProveedor,
    },
    categoria && {
      clave: 'categoria',
      etiqueta: 'Categoría',
      valor: CATEGORIAS.find((c) => c.value === categoria)?.label ?? categoria,
    },
    tipo && {
      clave: 'tipo',
      etiqueta: 'Tipo',
      valor: TIPOS.find((t) => t.value === tipo)?.label ?? tipo,
    },
    desde && { clave: 'desde', etiqueta: 'Desde', valor: desde },
    hasta && { clave: 'hasta', etiqueta: 'Hasta', valor: hasta },
    createdBy && {
      clave: 'createdBy',
      etiqueta: 'Cargado por',
      valor: nombreAutor,
    },
  ].filter(Boolean);

  // El buscador tiene su propio chip: está a la vista, pero con la lista vacía
  // conviene que el motivo se lea en el mismo lugar que los demás.
  const chips = [
    ...(q ? [{ clave: 'q', etiqueta: 'Concepto', valor: q }] : []),
    ...activosDelPanel,
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
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
          className="w-44"
          aria-label="Filtrar por período"
          value={periodo}
          onChange={(event) => onFiltro({ periodo: event.target.value })}
        >
          {periodos.map((p) => (
            <option key={p} value={p}>
              {formatearPeriodo(p)}
            </option>
          ))}
          <option value={todosLosPeriodos}>Todos los períodos</option>
        </Select>

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

                {/* La fecha filtra por rango: un solo día casi nunca es lo que
                    se busca. Es la fecha del gasto, no el período. */}
                <CampoFiltro id="filtro-desde" label="Fecha desde">
                  <Input
                    id="filtro-desde"
                    type="date"
                    value={desde}
                    onChange={(event) => onFiltro({ desde: event.target.value })}
                  />
                </CampoFiltro>

                <CampoFiltro id="filtro-hasta" label="Fecha hasta">
                  <Input
                    id="filtro-hasta"
                    type="date"
                    value={hasta}
                    onChange={(event) => onFiltro({ hasta: event.target.value })}
                  />
                </CampoFiltro>
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
