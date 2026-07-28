// frontend/src/components/layout/Breadcrumbs.jsx — ConsorcIA
// Breadcrumbs dinámicos (S2-11, PRD-07-03 §5): config estática por patrón de
// ruta (matchPath) + segmento dinámico del edificio resuelto desde el cache
// de TanStack Query (lista de useEdificios o detalle ya cargado), sin fetch
// extra. El último segmento es texto plano (aria-current="page"); los
// intermedios son Link de react-router.
import { Link, matchPath, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useEdificios } from '@/hooks/useEdificios';
import { queryKeys } from '@/lib/query-keys';

const TAB_LABELS = {
  overview: 'Overview',
  unidades: 'Unidades',
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
  ...['overview', 'unidades', 'configuracion'].map((tab) => ({
    pattern: `/edificios/:id/${tab}`,
    items: [
      { label: 'Inicio', href: '/' },
      { label: 'Edificios', href: '/edificios' },
      { label: ':edificio', href: '/edificios/:id' },
      { label: TAB_LABELS[tab] },
    ],
  })),
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
