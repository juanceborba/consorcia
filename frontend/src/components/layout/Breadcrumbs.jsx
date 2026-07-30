// frontend/src/components/layout/Breadcrumbs.jsx — ConsorcIA
// Breadcrumbs dinámicos (S2-11, PRD-07-03 §5): config estática por patrón de
// ruta (matchPath) + segmento dinámico del edificio resuelto desde el cache
// de TanStack Query (lista de useEdificios o detalle ya cargado), sin fetch
// extra. El último segmento es texto plano (aria-current="page"); los
// intermedios son Link de react-router.
//
// CRITERIO (unificado en S3-22b): TODA ruta del `AppLayout` entra acá. Una
// pantalla sin breadcrumb no dice dónde está parado el usuario ni cómo subir un
// nivel, y lo deja dependiendo del sidebar —que marca el módulo pero no la
// posición dentro de él—. La config no falla ruidosamente cuando falta una ruta:
// simplemente no se renderiza nada, así que el hueco se descubre mirando la
// pantalla. Reglas al agregar una:
//
// 1. **El patrón se declara acá cuando se declara la ruta en `main.jsx`**, en la
//    misma tarea. Es parte de la pantalla, no un extra.
// 2. **Cada segmento intermedio lleva `href` si la ruta existe**, y va sin él
//    cuando es solo un agrupador (`/configuracion` todavía no tiene página: sus
//    hijas lo muestran como texto). Un link a una ruta inexistente es peor que
//    un texto.
// 3. **El último segmento nunca es link** (es la página actual, `aria-current`).
// 4. **Los segmentos dinámicos se resuelven del cache**, nunca con un fetch
//    propio del breadcrumb (§5.2 del PRD): si el dato no está, se usa un
//    fallback genérico.
import { Link, matchPath, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useEdificios } from '@/hooks/useEdificios';
import { queryKeys } from '@/lib/query-keys';

const TAB_LABELS = {
  overview: 'Overview',
  unidades: 'Unidades',
  gastos: 'Gastos',
  liquidaciones: 'Liquidaciones',
  configuracion: 'Configuración',
};

// Config estática de rutas actuales (PRD-07-03 §5). El placeholder
// ':edificio' se reemplaza por el nombre del edificio; ':id' en href se
// reemplaza por el id de la URL. El orden importa: los patrones más
// específicos van primero (/edificios/nuevo antes que /edificios/:id).
const RUTAS = [
  { pattern: '/', items: [{ label: 'Inicio' }] },
  {
    pattern: '/edificios',
    items: [{ label: 'Inicio', href: '/' }, { label: 'Edificios' }],
  },
  {
    pattern: '/edificios/nuevo',
    items: [
      { label: 'Inicio', href: '/' },
      { label: 'Edificios', href: '/edificios' },
      { label: 'Nuevo' },
    ],
  },
  // La preview de una liquidación (S3-09) es ruta hija del tab, así que su
  // breadcrumb tiene un nivel más y "Liquidaciones" vuelve al listado. Va ANTES
  // del map de tabs por especificidad.
  {
    pattern: '/edificios/:id/liquidaciones/:liquidacionId',
    items: [
      { label: 'Inicio', href: '/' },
      { label: 'Edificios', href: '/edificios' },
      { label: ':edificio', href: '/edificios/:id' },
      { label: 'Liquidaciones', href: '/edificios/:id/liquidaciones' },
      { label: 'Liquidación' },
    ],
  },
  ...['overview', 'unidades', 'gastos', 'liquidaciones', 'configuracion'].map((tab) => ({
    pattern: `/edificios/:id/${tab}`,
    items: [
      { label: 'Inicio', href: '/' },
      { label: 'Edificios', href: '/edificios' },
      { label: ':edificio', href: '/edificios/:id' },
      { label: TAB_LABELS[tab] },
    ],
  })),
  // Configuración de la organización (S3-14 proveedores/rubros, S4-07 staff).
  // Regla 2: `/configuracion` todavía no tiene página propia —llega con el resto
  // de las tabs—, así que el segmento intermedio va sin href en las tres.
  ...[
    { path: 'proveedores', label: 'Proveedores' },
    { path: 'rubros', label: 'Rubros' },
    { path: 'usuarios', label: 'Usuarios' },
  ].map(({ path, label }) => ({
    pattern: `/configuracion/${path}`,
    items: [
      { label: 'Inicio', href: '/' },
      { label: 'Configuración' },
      { label },
    ],
  })),
  // Vista del residente (S4-12): su "Inicio" no existe —`/` es el dashboard de
  // staff y `RequireStaff` lo devolvería acá—, así que el breadcrumb es un solo
  // segmento, sin link a ninguna parte.
  { pattern: '/mis-unidades', items: [{ label: 'Mis unidades' }] },
  // Módulo Reportes (S3-16): el hub es una ruta real, así que desde un reporte
  // el breadcrumb es la forma de volver a él. Sin esto, entrar a un reporte
  // dejaba a la pantalla sin ninguna salida hacia arriba que no fuera el
  // sidebar, que no dice dónde estás parado.
  {
    pattern: '/reportes',
    items: [{ label: 'Inicio', href: '/' }, { label: 'Reportes' }],
  },
  {
    pattern: '/reportes/gastos',
    items: [
      { label: 'Inicio', href: '/' },
      { label: 'Reportes', href: '/reportes' },
      { label: 'Gastos' },
    ],
  },
  // /edificios/:id a secas redirige a /unidades, pero puede renderizar un
  // instante durante el redirect.
  {
    pattern: '/edificios/:id',
    items: [
      { label: 'Inicio', href: '/' },
      { label: 'Edificios', href: '/edificios' },
      { label: ':edificio' },
    ],
  },
];

export default function Breadcrumbs() {
  const location = useLocation();
  const queryClient = useQueryClient();
  // Misma queryKey que AppLayout/EdificiosPage: cache compartido, sin fetch.
  const { edificios } = useEdificios();

  const entrada = RUTAS.map((ruta) => ({
    ...ruta,
    match: matchPath({ path: ruta.pattern, end: true }, location.pathname),
  })).find((ruta) => ruta.match);

  // Resolución del nombre del edificio: primero la lista cacheada, después
  // el detalle cacheado (por si el edificio no está en la lista visible);
  // fallback genérico mientras no haya dato.
  const id = entrada?.match.params.id;
  const nombreEdificio = id
    ? (edificios.find((e) => String(e.id) === String(id))?.nombre ??
      queryClient.getQueryData(queryKeys.edificios.detail(id))?.nombre ??
      'Edificio')
    : null;

  if (!entrada) return null;

  const items = entrada.items.map((item) => ({
    label: item.label === ':edificio' ? nombreEdificio : item.label,
    href: item.href?.replace(':id', id),
  }));

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((item, i) => {
          const esUltimo = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 && (
                <ChevronRight className="size-3.5 text-muted-foreground/60" />
              )}
              {esUltimo || !item.href ? (
                <span
                  className={
                    esUltimo
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground'
                  }
                  aria-current={esUltimo ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  to={item.href}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
