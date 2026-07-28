// frontend/src/pages/EdificioDetallePage.jsx — ConsorcIA
// Detalle de edificio (S1-13): datos generales + tabla de unidades desde
// GET /api/edificios/:id. Maneja 403 (sin acceso) y 404 (no existe).
// Las unidades siguen el schema de PRD-02-04: numero, tipo, m2, coeficiente
// y categorías de distribución A/B/C (no existe "piso" en el modelo).
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Building2, MapPin } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Categorías de distribución de gastos (Ley 941): A = gastos generales,
// B = servicios específicos (lista), C = sector específico.
function CategoriasUnidad({ unidad }) {
  const partes = [];
  if (unidad.categoriaA) partes.push('A');
  for (const b of unidad.categoriaB ?? []) partes.push(`B: ${b}`);
  if (unidad.categoriaC) partes.push(`C: ${unidad.categoriaC}`);
  if (partes.length === 0) return <span>—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {partes.map((p) => (
        <Badge key={p} variant="secondary">
          {p}
        </Badge>
      ))}
    </span>
  );
}

// El coeficiente viene como string decimal ("0.138" = 13,8 % de las expensas).
function formatearCoeficiente(coeficiente) {
  const numero = Number.parseFloat(coeficiente);
  if (Number.isNaN(numero)) return coeficiente;
  return `${(numero * 100).toFixed(2)} %`;
}

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
  const [edificio, setEdificio] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setError(null);
    api
      .get(`/api/edificios/${id}`)
      .then((data) => {
        if (!cancelado) setEdificio(data);
      })
      .catch((err) => {
        if (!cancelado) setError(err);
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [id]);

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

      {/* Unidades funcionales */}
      <Card>
        <CardHeader>
          <CardTitle>Unidades</CardTitle>
          <CardDescription>
            {edificio.unidades.length}{' '}
            {edificio.unidades.length === 1 ? 'unidad' : 'unidades'} del
            edificio
          </CardDescription>
        </CardHeader>
        <CardContent>
          {edificio.unidades.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Este edificio todavía no tiene unidades cargadas.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">m²</TableHead>
                  <TableHead className="text-right">Coeficiente</TableHead>
                  <TableHead>Categorías</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {edificio.unidades.map((unidad) => (
                  <TableRow key={unidad.id}>
                    <TableCell className="font-medium">
                      {unidad.numero}
                    </TableCell>
                    <TableCell>{unidad.tipo}</TableCell>
                    <TableCell className="text-right">{unidad.m2}</TableCell>
                    <TableCell className="text-right">
                      {formatearCoeficiente(unidad.coeficiente)}
                    </TableCell>
                    <TableCell>
                      <CategoriasUnidad unidad={unidad} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
