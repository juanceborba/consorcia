// frontend/src/pages/EdificioDetallePage.jsx — ConsorcIA
// Layout del detalle de edificio (S2-07): datos generales + tabs anidados
// (overview / unidades / configuracion) como nested routes según PRD-07-03
// §2. Carga el edificio con TanStack Query (queryKeys.edificios.detail) y lo
// pasa a los tabs por Outlet context; sincroniza el selector del header
// (edificio.store) con el edificio que se está viendo.
// Maneja 403 (sin acceso) y 404 (no existe).
import { useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Building2, MapPin } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useEdificio } from '@/hooks/useEdificio';
import { useEdificioStore } from '@/stores/edificio.store';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs';

// Tabs del detalle (rutas hijas según PRD-07-03 §2). Labels en español.
const TABS = [
  { value: 'overview', label: 'Resumen' },
  { value: 'unidades', label: 'Unidades' },
  { value: 'configuracion', label: 'Configuración' },
];

// Estado de error amigable para 403/404 y errores genéricos.
function EstadoError({ status }) {
  const mensaje =
    status === 403
      ? 'Sin acceso a este edificio'
      : status === 404
        ? 'Edificio no encontrado'
        : 'No se pudo cargar el edificio. Intentá de nuevo más tarde.';
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
      <Building2 className="size-8 text-muted-foreground" />
      <p className="font-medium">{mensaje}</p>
      <Link to="/edificios" className="text-sm text-primary underline">
        Volver al listado
      </Link>
    </div>
  );
}

export default function EdificioDetallePage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { edificio, cargando, error } = useEdificio(id);
  const setEdificioId = useEdificioStore((s) => s.setEdificioId);

  // Sincroniza el selector del header con el edificio que se está viendo.
  useEffect(() => {
    if (edificio) setEdificioId(edificio.id);
  }, [edificio, setEdificioId]);

  if (cargando) {
    return (
      <div className="flex animate-pulse flex-col gap-6">
        <div className="h-7 w-1/3 rounded bg-muted" />
        <div className="h-24 rounded-lg bg-muted" />
        <div className="h-64 rounded-lg bg-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <EstadoError status={error instanceof ApiError ? error.status : null} />
    );
  }

  // /edificios/:id a secas redirige a /unidades (ver router); el fallback
  // evita un value inválido en Tabs durante ese instante.
  const ultimoSegmento = location.pathname.split('/').pop();
  const tabActual = TABS.some((t) => t.value === ultimoSegmento)
    ? ultimoSegmento
    : 'unidades';

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/edificios"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Volver a edificios
      </Link>

      {/* Datos generales del edificio */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Building2 className="size-6 shrink-0" />
            {edificio.nombre}
          </CardTitle>
          <CardDescription className="flex items-center gap-1">
            <MapPin className="size-4 shrink-0" />
            {edificio.direccion}, {edificio.ciudad}
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Tabs anidados: la selección navega a la ruta hija */}
      <Tabs
        value={tabActual}
        onValueChange={(tab) => navigate(`/edificios/${id}/${tab}`)}
      >
        <TabsList>
          {TABS.map((tab) => (
            <TabsTab key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>

      <Outlet context={{ edificio }} />
    </div>
  );
}
