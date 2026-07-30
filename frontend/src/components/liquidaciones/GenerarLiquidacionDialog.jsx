// frontend/src/components/liquidaciones/GenerarLiquidacionDialog.jsx — ConsorcIA
// Diálogo "Generar liquidación" (S3-09, PRD-04-03 §2 PASO 1-3): elegir período
// → POST /api/edificios/:id/liquidaciones → navegar a la preview del BORRADOR.
//
// DECISIONES:
//
// 1. EL PERÍODO SE ELIGE DE UNA LISTA, NO SE ESCRIBE. Son los últimos 12 meses
//    (el mismo rango que el filtro de gastos) y cada opción dice si ese período
//    ya tiene una liquidación vigente. Un `<input type="month">` dejaría al
//    usuario descubrir recién al submit que el período estaba tomado o que era
//    del año pasado. El default es el mes corriente.
//
// 2. LOS PERÍODOS YA LIQUIDADOS NO SE DESHABILITAN: se marcan. Deshabilitarlos
//    escondería la única salida (anular la que existe) detrás de un control
//    muerto. Al elegir uno, el diálogo muestra el aviso con el link a esa
//    liquidación en vez de dejar que el submit vuelva con un 409.
//
// 3. LOS 422 DEL BACKEND SE RESPONDEN CON UNA ACCIÓN, NO CON UN TOAST. Los tres
//    motivos por los que una liquidación no se puede calcular tienen arreglo y
//    el arreglo está en otra pantalla: `SIN_GASTOS` → cargar gastos de ese
//    período, `GASTOS_SIN_CATEGORIA` → completar la categoría, y
//    `COEFICIENTES_NO_CUADRAN` → corregir las UF. Cada uno se muestra como
//    Alert dentro del diálogo con el link que lleva al lugar donde se resuelve.
//    Un toast rojo con el `message` sería técnicamente cierto e inútil.
//
// 4. AL ÉXITO SE NAVEGA A LA PREVIEW. El POST devuelve la preview completa, así
//    que se siembra en la cache (`setQueryData`) antes de navegar: la pantalla
//    de destino renderiza con datos, sin un skeleton por una request que ya se
//    hizo.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatearPeriodo, periodoActual, ultimosPeriodos } from '@/lib/formato';
import { estaVigente, estadoDeLiquidacion } from '@/lib/liquidacion';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

// Cuerpo del Alert por código de error del contrato (decisión 3).
function AyudaDelError({ error, edificioId, periodo }) {
  const gastosDelPeriodo = `/edificios/${edificioId}/gastos?periodo=${periodo}`;

  if (error.code === 'SIN_GASTOS') {
    return (
      <Alert variant="warning" title="No hay gastos en ese período">
        Una liquidación reparte los gastos del período entre las unidades, así
        que sin gastos no hay nada que repartir.{' '}
        <Link to={gastosDelPeriodo} className="font-medium underline">
          Cargar los gastos de {formatearPeriodo(periodo)}
        </Link>
        .
      </Alert>
    );
  }

  if (error.code === 'GASTOS_SIN_CATEGORIA') {
    return (
      <Alert variant="warning" title="Hay gastos sin categoría">
        {error.message} La categoría (A, B o C) decide qué unidades pagan cada
        gasto: sin ella el reparto no se puede calcular.{' '}
        <Link to={gastosDelPeriodo} className="font-medium underline">
          Revisar los gastos de {formatearPeriodo(periodo)}
        </Link>
        .
      </Alert>
    );
  }

  if (error.code === 'COEFICIENTES_NO_CUADRAN') {
    return (
      <Alert variant="danger" title="Los coeficientes no suman 1,000000">
        {error.message} Mientras no cierren, el reparto asignaría más o menos
        del 100% de cada gasto.{' '}
        <Link
          to={`/edificios/${edificioId}/unidades`}
          className="font-medium underline"
        >
          Corregir las unidades
        </Link>
        .
      </Alert>
    );
  }

  if (error.code === 'PERIODO_YA_LIQUIDADO') {
    return (
      <Alert variant="warning" title="El período ya tiene liquidación">
        {error.message}
        {error.detalle?.liquidacionId && (
          <>
            {' '}
            <Link
              to={`/edificios/${edificioId}/liquidaciones/${error.detalle.liquidacionId}`}
              className="font-medium underline"
            >
              Ver la liquidación existente
            </Link>
            .
          </>
        )}
      </Alert>
    );
  }

  return (
    <Alert variant="danger" title="No se pudo generar la liquidación">
      {error.message}
    </Alert>
  );
}

export default function GenerarLiquidacionDialog({
  edificio,
  liquidaciones = [],
  isOpen,
  onClose,
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [periodo, setPeriodo] = useState(periodoActual());
  const [error, setError] = useState(null);

  const periodos = ultimosPeriodos(12);

  // Decisión 2: qué liquidación vigente ocupa cada período.
  const vigentePorPeriodo = new Map();
  for (const l of liquidaciones) {
    if (estaVigente(l) && !vigentePorPeriodo.has(l.periodo)) {
      vigentePorPeriodo.set(l.periodo, l);
    }
  }
  const ocupado = vigentePorPeriodo.get(periodo) ?? null;

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/api/edificios/${edificio.id}/liquidaciones`, { periodo }),
    onSuccess: (preview) => {
      // Decisión 4: el POST ya trae la preview; se siembra y se navega.
      queryClient.setQueryData(queryKeys.liquidaciones.detail(preview.id), preview);
      queryClient.invalidateQueries({ queryKey: queryKeys.liquidaciones.all });
      toast.success('Liquidación generada', {
        description: `${formatearPeriodo(preview.periodo)} quedó en borrador: revisala antes de aprobarla.`,
      });
      onClose();
      navigate(`/edificios/${edificio.id}/liquidaciones/${preview.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setError({ code: err.code, message: err.message, detalle: err.detalle });
        return;
      }
      toast.error('No se pudo generar la liquidación', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  const cambiarPeriodo = (valor) => {
    setPeriodo(valor);
    setError(null);
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Generar liquidación"
      description="Calcula el reparto de los gastos del período entre las unidades y lo guarda como borrador. Todavía no se emite nada: los recibos son un paso aparte."
      size="lg"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          mutation.mutate();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="liquidacion-periodo">Período a liquidar</Label>
          <Select
            id="liquidacion-periodo"
            value={periodo}
            disabled={mutation.isPending}
            onChange={(event) => cambiarPeriodo(event.target.value)}
          >
            {periodos.map((p) => {
              const tomado = vigentePorPeriodo.get(p);
              return (
                <option key={p} value={p}>
                  {formatearPeriodo(p)}
                  {tomado
                    ? ` — ya liquidado (${estadoDeLiquidacion(tomado.estado).label.toLowerCase()})`
                    : ''}
                </option>
              );
            })}
          </Select>
          <p className="text-xs text-muted-foreground">
            Se reparten los gastos imputados a ese período, incluidas las cuotas
            de los gastos en cuotas que caen ahí.
          </p>
        </div>

        {/* Decisión 2: el aviso reemplaza al 409 antes de que ocurra. */}
        {ocupado && !error && (
          <Alert variant="warning" title="Este período ya tiene liquidación">
            Está en estado {estadoDeLiquidacion(ocupado.estado).label.toLowerCase()}.
            Para volver a calcularlo hay que anularla primero.{' '}
            <Link
              to={`/edificios/${edificio.id}/liquidaciones/${ocupado.id}`}
              className="font-medium underline"
            >
              Ver la liquidación de {formatearPeriodo(ocupado.periodo)}
            </Link>
            .
          </Alert>
        )}

        {error && (
          <AyudaDelError
            error={error}
            edificioId={edificio.id}
            periodo={periodo}
          />
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={mutation.isPending || Boolean(ocupado)}>
            {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
            Generar liquidación
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
