// frontend/src/pages/EdificiosPage.jsx — ConsorcIA
// Listado de edificios (S1-13): grid de cards desde GET /api/edificios,
// con skeleton de carga y estado vacío. Cada card navega al detalle.
import { Link } from 'react-router';
import { Building2, MapPin } from 'lucide-react';
import { useEdificios } from '@/hooks/useEdificios';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// Skeleton de carga: 3 cards con bloques animados.
function EdificiosSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="animate-pulse">
          <CardHeader>
            <div className="h-5 w-2/3 rounded bg-muted" />
            <div className="h-4 w-1/2 rounded bg-muted" />
          </CardHeader>
          <CardContent>
            <div className="h-4 w-1/3 rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function EdificiosPage() {
  const { edificios, cargando, error } = useEdificios();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Edificios</h1>
        <p className="text-sm text-muted-foreground">
          Edificios administrados por tu organización
        </p>
      </div>

      {cargando && <EdificiosSkeleton />}

      {!cargando && error && (
        <p className="text-sm text-destructive">
          No se pudieron cargar los edificios. Intentá de nuevo más tarde.
        </p>
      )}

      {!cargando && !error && edificios.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
          <Building2 className="size-8 text-muted-foreground" />
          <p className="font-medium">Todavía no tenés edificios</p>
          <p className="text-sm text-muted-foreground">
            Cuando tu organización cargue edificios, van a aparecer acá.
          </p>
        </div>
      )}

      {!cargando && !error && edificios.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {edificios.map((edificio) => (
            <Link key={edificio.id} to={`/edificios/${edificio.id}`}>
              <Card className="h-full transition-colors hover:border-primary">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="size-5 shrink-0" />
                    {edificio.nombre}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-1">
                    <MapPin className="size-4 shrink-0" />
                    {edificio.direccion}, {edificio.ciudad}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {edificio._count.unidades}{' '}
                    {edificio._count.unidades === 1 ? 'unidad' : 'unidades'}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
