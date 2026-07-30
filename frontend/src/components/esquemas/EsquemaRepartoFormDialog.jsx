// frontend/src/components/esquemas/EsquemaRepartoFormDialog.jsx — ConsorcIA
// Alta y edición de un esquema de reparto (S3-20, PRD-02-05 · CCyC art. 2049).
// Un solo diálogo para los dos modos, como `GastoFormDialog` (S3-08): los campos
// son los mismos y lo único que cambia es el verbo (POST sobre el edificio vs
// PUT /api/esquemas-reparto/:id).
//
// DECISIONES (las del contrato de datos están en lib/esquema-reparto-schema.js):
//
// 1. LA TABLA DE PESOS MUESTRA TODAS LAS UF Y MANDA SOLO LAS CARGADAS. Dibujar
//    únicamente las filas existentes obligaría a un "agregar unidad" que en un
//    esquema de 20 UF no le ahorra nada a nadie; dejar la fila vacía es lo que
//    expresa "esta UF va con el default de la base". El default se dice en la
//    cabecera de la columna y cambia con la base elegida — es la única parte del
//    modelo que no se puede deducir mirando la pantalla.
//
// 2. EL SERVICIO Y EL SECTOR SALEN DE LAS UNIDADES, IGUAL QUE EN EL GASTO. Un
//    alcance por servicio que ninguna UF declara no alcanza a nadie: el reparto
//    daría 0 para todas y la liquidación del período fallaría con
//    `DESBALANCE_LIQUIDACION`. Mismo desplegable cerrado que `GastoFormDialog`.
//
// 3. `409 ALCANCE_OCUPADO` Y `409 ESQUEMA_DUPLICADO` VUELVEN A SU CAMPO. Los dos
//    son corregibles sin salir del formulario (cambiar el nombre, o desactivar el
//    otro esquema del mismo servicio), así que se muestran inline y no en un toast.
//
// 4. EDITAR UN ESQUEMA EN USO NO REESCRIBE NADA YA EMITIDO, y el diálogo lo dice.
//    El reparto aplicado vive en el snapshot de `LiquidacionDetalle`, así que lo
//    que cambia es lo que se va a liquidar de acá en adelante. Es la pregunta que
//    se hace cualquiera antes de tocar un esquema con liquidaciones encima.
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import {
  ALCANCES,
  aFormulario,
  aPayload,
  alcanceNecesitaValor,
  BASES,
  baseDe,
  ESQUEMA_VACIO,
  esquemaRepartoSchema,
} from '@/lib/esquema-reparto-schema';
import {
  etiquetaDeServicio,
  sectoresDeEdificio,
  serviciosDeEdificio,
} from '@/lib/gasto-schema';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

function Campo({ id, label, error, hint, children }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
    </div>
  );
}

export default function EsquemaRepartoFormDialog({
  edificio,
  esquemaId = null,
  isOpen,
  onClose,
}) {
  const queryClient = useQueryClient();
  const esEdicion = esquemaId !== null;

  // Decisión 2: el vocabulario del alcance es el que declaran las unidades.
  const unidades = useMemo(
    () =>
      [...(edificio.unidades ?? [])].sort((a, b) =>
        String(a.numero).localeCompare(String(b.numero), 'es-AR', {
          numeric: true,
        }),
      ),
    [edificio.unidades],
  );
  const servicios = useMemo(
    () => serviciosDeEdificio(edificio.unidades),
    [edificio.unidades],
  );
  const sectores = useMemo(
    () => sectoresDeEdificio(edificio.unidades),
    [edificio.unidades],
  );

  // El detalle trae lo que la lista no: quién referencia al esquema (decisión 4).
  const { data: detalle, isPending: cargandoDetalle } = useQuery({
    queryKey: queryKeys.esquemasReparto.detail(esquemaId),
    queryFn: () => api.get(`/api/esquemas-reparto/${esquemaId}`),
    enabled: isOpen && esEdicion,
  });

  const {
    register,
    reset,
    watch,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(esquemaRepartoSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: ESQUEMA_VACIO,
  });

  // Cada apertura reinicia el form: alta → vacío, edición → el esquema traído.
  useEffect(() => {
    if (!isOpen) return;
    if (!esEdicion) reset(ESQUEMA_VACIO);
    else if (detalle) reset(aFormulario(detalle));
  }, [isOpen, esEdicion, detalle, reset]);

  const base = watch('base');
  const alcance = watch('alcance');
  const infoBase = baseDe(base);
  const infoAlcance = ALCANCES.find((a) => a.value === alcance) ?? ALCANCES[0];

  const mutation = useMutation({
    mutationFn: (valores) =>
      esEdicion
        ? api.put(`/api/esquemas-reparto/${esquemaId}`, aPayload(valores))
        : api.post(
            `/api/edificios/${edificio.id}/esquemas-reparto`,
            aPayload(valores),
          ),
    onSuccess: (guardado) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.esquemasReparto.all });
      // El esquema cambia con qué se reparte cada gasto que lo usa: la lista de
      // gastos muestra el nombre del esquema y tiene que reflejar la edición.
      queryClient.invalidateQueries({ queryKey: queryKeys.gastos.all });
      toast.success(esEdicion ? 'Esquema actualizado' : 'Esquema creado', {
        description: guardado.nombre,
      });
      onClose();
    },
    onError: (err) => {
      // Decisión 3.
      if (err.code === 'ESQUEMA_DUPLICADO') {
        setError('nombre', { type: 'server', message: err.message });
        return;
      }
      if (err.code === 'ALCANCE_OCUPADO') {
        setError('alcanceValor', { type: 'server', message: err.message });
        return;
      }
      toast.error(
        esEdicion ? 'No se pudo guardar el esquema' : 'No se pudo crear el esquema',
        { description: err.message ?? 'Error inesperado' },
      );
    },
  });

  const cargando = esEdicion && cargandoDetalle;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={esEdicion ? 'Editar esquema de reparto' : 'Nuevo esquema de reparto'}
      description={
        esEdicion
          ? detalle?.nombre
          : `${edificio.nombre} · el esquema define qué proporción de un gasto paga cada unidad.`
      }
      size="xl"
    >
      {cargando ? (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Cargando el esquema…
        </p>
      ) : (
        <form
          onSubmit={handleSubmit((valores) => mutation.mutate(valores))}
          className="flex flex-col gap-4"
        >
          {/* Decisión 4: qué cambia y qué no al editar un esquema ya usado. */}
          {detalle?.enUso && (
            <Alert variant="info" title="Este esquema ya está en uso">
              Lo usan {detalle.referencias.gastos} gasto(s)
              {detalle.referencias.liquidaciones > 0 &&
                ` y ${detalle.referencias.liquidaciones} unidad(es) de liquidaciones ya emitidas`}
              {detalle.referencias.esGeneral && ', y es el esquema general del edificio'}
              . Editarlo <strong>no reescribe</strong> las liquidaciones ya
              emitidas —cada recibo guarda el reparto con el que se calculó—: cambia
              lo que se va a liquidar de acá en adelante.
            </Alert>
          )}

          <Campo
            id="esquema-nombre"
            label="Nombre *"
            error={errors.nombre}
            hint="Cómo se identifica en el gasto y en el recibo (ej. Ascensor (PB al 50%))."
          >
            <Input
              id="esquema-nombre"
              autoComplete="off"
              placeholder="Ascensor (PB al 50%)"
              aria-invalid={errors.nombre ? true : undefined}
              {...register('nombre')}
            />
          </Campo>

          <Campo
            id="esquema-base"
            label="Base del reparto *"
            error={errors.base}
            hint={infoBase.ayuda}
          >
            <Select
              id="esquema-base"
              aria-invalid={errors.base ? true : undefined}
              {...register('base')}
            >
              {BASES.map((opcion) => (
                <option key={opcion.value} value={opcion.value}>
                  {opcion.label}
                </option>
              ))}
            </Select>
          </Campo>

          <Campo
            id="esquema-alcance"
            label="Alcance *"
            error={errors.alcance}
            hint={infoAlcance.ayuda}
          >
            <Select
              id="esquema-alcance"
              aria-invalid={errors.alcance ? true : undefined}
              {...register('alcance')}
            >
              {ALCANCES.map((opcion) => (
                <option
                  key={opcion.value}
                  value={opcion.value}
                  disabled={
                    (opcion.value === 'SERVICIO' && servicios.length === 0) ||
                    (opcion.value === 'SECTOR' && sectores.length === 0)
                  }
                >
                  {opcion.label}
                  {(opcion.value === 'SERVICIO' && servicios.length === 0) ||
                  (opcion.value === 'SECTOR' && sectores.length === 0)
                    ? ' (ninguna unidad lo declara)'
                    : ''}
                </option>
              ))}
            </Select>
          </Campo>

          {alcanceNecesitaValor(alcance) && (
            <Campo
              id="esquema-alcance-valor"
              label={alcance === 'SERVICIO' ? 'Servicio *' : 'Sector *'}
              error={errors.alcanceValor}
              hint={
                alcance === 'SERVICIO'
                  ? 'Los gastos de categoría B de este servicio van a usar este esquema automáticamente.'
                  : 'Los gastos de categoría C de este sector van a usar este esquema automáticamente.'
              }
            >
              <Select
                id="esquema-alcance-valor"
                aria-invalid={errors.alcanceValor ? true : undefined}
                {...register('alcanceValor')}
              >
                <option value="">
                  {alcance === 'SERVICIO' ? 'Elegí el servicio' : 'Elegí el sector'}
                </option>
                {(alcance === 'SERVICIO' ? servicios : sectores).map((valor) => (
                  <option key={valor} value={valor}>
                    {alcance === 'SERVICIO' ? etiquetaDeServicio(valor) : valor}
                  </option>
                ))}
              </Select>
            </Campo>
          )}

          {/* Trazabilidad legal: el CCyC art. 2049 pone la exención en manos del
              reglamento, no del administrador. Es lo primero que se pide cuando
              un propietario impugna el reparto. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              id="esquema-clausula"
              label="Cláusula del reglamento"
              error={errors.clausulaReglamento}
              hint="Qué habilita este reparto (ej. art. 12 del reglamento de copropiedad)."
            >
              <Input
                id="esquema-clausula"
                autoComplete="off"
                placeholder="art. 12 del reglamento de copropiedad"
                aria-invalid={errors.clausulaReglamento ? true : undefined}
                {...register('clausulaReglamento')}
              />
            </Campo>

            <Campo
              id="esquema-documento"
              label="Link al documento"
              error={errors.documentoUrl}
              hint="El reglamento escaneado, si lo tenés publicado."
            >
              <Input
                id="esquema-documento"
                type="url"
                autoComplete="off"
                placeholder="https://…"
                aria-invalid={errors.documentoUrl ? true : undefined}
                {...register('documentoUrl')}
              />
            </Campo>
          </div>

          {esEdicion && (
            <label className="flex items-start gap-3 text-sm">
              <input
                id="esquema-activo"
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                {...register('activo')}
              />
              <span>
                Activo
                <span className="block text-xs text-muted-foreground">
                  Un esquema inactivo deja de ofrecerse y deja de aplicarse solo,
                  pero los gastos que ya lo eligieron a mano lo siguen usando.
                </span>
              </span>
            </label>
          )}

          {/* Decisión 1: todas las UF, y lo que significa dejar una vacía. */}
          <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
            <legend className="px-1 text-sm leading-none font-medium">
              Pesos por unidad
            </legend>
            <p className="text-xs text-muted-foreground">
              Cargá solo las unidades que se apartan del reparto normal. Una unidad
              sin peso <strong>{infoBase.ausente}</strong>.
              {alcance !== 'TODAS' && ' Las unidades fuera del alcance no pagan nada.'}
            </p>

            {unidades.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Este edificio todavía no tiene unidades cargadas.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {unidades.map((unidad) => (
                  <div key={unidad.id} className="flex flex-col gap-1">
                    <Label
                      htmlFor={`esquema-peso-${unidad.numero}`}
                      className="text-xs font-normal text-muted-foreground"
                    >
                      UF {unidad.numero}
                      {unidad.coeficiente != null && (
                        <span className="tabular-nums"> · coef. {unidad.coeficiente}</span>
                      )}
                    </Label>
                    <Input
                      id={`esquema-peso-${unidad.numero}`}
                      autoComplete="off"
                      inputMode="decimal"
                      placeholder={infoBase.value === 'PESOS_PROPIOS' ? '0' : '1'}
                      className="tabular-nums"
                      aria-invalid={errors.pesos?.[unidad.id] ? true : undefined}
                      {...register(`pesos.${unidad.id}`)}
                    />
                    {errors.pesos?.[unidad.id] && (
                      <p className="text-xs text-destructive">
                        {errors.pesos[unidad.id].message}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </fieldset>

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={mutation.isPending || (esEdicion && !isDirty)}
            >
              {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
              {mutation.isPending
                ? 'Guardando…'
                : esEdicion
                  ? 'Guardar cambios'
                  : 'Crear esquema'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
