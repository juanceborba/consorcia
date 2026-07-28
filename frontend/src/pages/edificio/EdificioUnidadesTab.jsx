// frontend/src/pages/edificio/EdificioUnidadesTab.jsx — ConsorcIA
// Tab "Unidades" del detalle de edificio (S2-07): tabla simple con las
// unidades incluidas en GET /api/edificios/:id (placeholder hasta que S2-08
// lo reemplace por la DataTable paginada de /api/edificios/:id/unidades).
// Las unidades siguen el schema de PRD-02-04: numero, tipo, m2, coeficiente
// y categorías de distribución A/B/C (no existe "piso" en el modelo).
import { useOutletContext } from 'react-router';
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

export default function EdificioUnidadesTab() {
  const { edificio } = useOutletContext();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unidades</CardTitle>
        <CardDescription>
          {edificio.unidades.length}{' '}
          {edificio.unidades.length === 1 ? 'unidad' : 'unidades'} del edificio
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
                  <TableCell className="font-medium">{unidad.numero}</TableCell>
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
  );
}
