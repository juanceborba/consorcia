// frontend/src/components/gastos/GastoFormDialog.jsx — ConsorcIA
// Alta y edición de un gasto (S3-08, PRD-04-02 §1.1/§4.2). Un solo diálogo para
// los dos modos, como `ProveedorFormDialog` (S3-14): los campos son los mismos y
// lo único que cambia es el verbo (POST /api/edificios/:id/gastos vs
// PUT /api/gastos/:id).
//
// Es la pantalla que ESTRENA los dos selectores de S3-14: `ProveedorSelect`
// (combobox con búsqueda del servidor + alta inline) y `RubroSelect` (cascada
// rubro → subrubro). Los dos son controlados y entran por un `Controller` de
// RHF, que es el contrato para el que fueron escritos.
//
// DECISIONES de S3-08 (las del contrato de datos están en lib/gasto-schema.js):
//
// 1. EL PROVEEDOR SUGIERE EL RUBRO, NO LO IMPONE. Un proveedor puede tener
//    `rubroHabitualId` (S3-12) y elegirlo lo precarga, pero SOLO si el rubro
//    está vacío: sobreescribir un rubro ya elegido porque el usuario corrigió el
//    proveedor le borraría trabajo hecho. La sugerencia además puede caer en un
//    rubro que ya no es usable (se ocultó después), y en ese caso `RubroSelect`
//    simplemente no la encuentra en su árbol y queda vacío — lo correcto.
//
// 2. LA CATEGORÍA SE DESHABILITA CUANDO EL EDIFICIO NO LA SOPORTA. Si ninguna
//    unidad declara servicios, un gasto B no tiene entre quiénes repartirse y la
//    liquidación del mes entero falla con `DESBALANCE_LIQUIDACION` (S3-03). En
//    vez de dejar cargarlo, la opción va deshabilitada con el motivo y un link a
//    las unidades del edificio, que es donde se arregla. Ídem C con los sectores.
//
// 3. LOS ERRORES DEL SERVIDOR VUELVEN A SU CAMPO. `422 PROVEEDOR_INVALIDO` y
//    `422 RUBRO_INVALIDO` (el proveedor se dio de baja, el rubro se ocultó en
//    otra pestaña) se muestran inline en su selector; el `422 VALIDACION_FALLIDA`
//    trae el nombre del campo como prefijo del mensaje (`"monto: ..."`), así que
//    se rutea al campo cuando el prefijo es reconocible. El resto va a un toast.
//
// 4. `409 LIQUIDACION_APROBADA` CIERRA EL DIÁLOGO. No es un error del formulario
//    y no hay nada que corregir en él: el gasto quedó congelado por una
//    liquidación (posiblemente aprobada en otra pestaña mientras este diálogo
//    estaba abierto). Se avisa por toast, se cierra y se refresca la lista, que
//    vuelve con la acción de editar ya deshabilitada.
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatearMonto, formatearPeriodo, ultimosPeriodos } from '@/lib/formato';
import {
  aFormulario,
  aPayload,
  CATEGORIAS,
  etiquetaDeServicio,
  GASTO_VACIO,
  gastoSchema,
  MONEDAS,
  resumenDePlan,
  sectoresDeEdificio,
  serviciosDeEdificio,
} from '@/lib/gasto-schema';
import ProveedorSelect from '@/components/gastos/ProveedorSelect';
import RubroSelect from '@/components/gastos/RubroSelect';
import AyudaLink from '@/components/ayuda/AyudaLink';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

// Nombres de campo que el backend usa como prefijo de sus mensajes de
// `VALIDACION_FALLIDA` (decisión 3). Solo los que el form puede mostrar.
const CAMPOS_DEL_SERVIDOR = [
  'concepto',
  'descripcion',
  'monto',
  'moneda',
  'categoria',
  'servicioEspecifico',
  'sectorEspecifico',
  'fechaGasto',
  'periodo',
  'comprobanteUrl',
  'cuotasTotal',
];

// Campo con label, error inline y hint. Mismo componente local que
// ProveedorFormDialog: sigue sin haber un wrapper de formulario compartido.
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

export default function GastoFormDialog({
  edificio,
  gasto = null,
  isOpen,
  onClose,
}) {
  const queryClient = useQueryClient();
  const esEdicion = gasto !== null;

  // Decisión 2: el vocabulario de B y C es el que declaran las unidades.
  const servicios = useMemo(
    () => serviciosDeEdificio(edificio.unidades),
    [edificio.unidades],
  );
  const sectores = useMemo(
    () => sectoresDeEdificio(edificio.unidades),
    [edificio.unidades],
  );

  const {
    control,
    register,
    reset,
    watch,
    setValue,
    setError,
    getValues,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(gastoSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: GASTO_VACIO,
  });

  // Cada apertura reinicia el form: alta → vacío (con la fecha y el período de
  // hoy recalculados), edición → los datos del gasto.
  useEffect(() => {
    if (isOpen) reset(esEdicion ? aFormulario(gasto) : GASTO_VACIO);
  }, [isOpen, esEdicion, gasto, reset]);

  const categoria = watch('categoria');
  const periodo = watch('periodo');
  // S3-19: el plan de cuotas solo existe para un extraordinario, y su resumen se
  // recalcula en vivo con las mismas reglas que el motor (ver `resumenDePlan`).
  const tipo = watch('tipo');
  const enCuotas = watch('enCuotas');
  const cuotasTotal = watch('cuotasTotal');
  const monto = watch('monto');
  const moneda = watch('moneda');
  const esExtraordinario = tipo === 'extraordinario';
  const plan = useMemo(
    () => (esExtraordinario && enCuotas ? resumenDePlan({ monto, cuotasTotal, periodo }) : null),
    [esExtraordinario, enCuotas, monto, cuotasTotal, periodo],
  );

  // Pasar a ordinario apaga el plan: el backend lo rechaza (422) y dejar el
  // switch encendido mostraría un plan que no se va a guardar.
  useEffect(() => {
    if (!esExtraordinario && enCuotas) setValue('enCuotas', false);
  }, [esExtraordinario, enCuotas, setValue]);

  // Los últimos 12 períodos, más el del gasto que se está editando si cayera
  // fuera de la ventana (decisión 2 de gasto-schema.js).
  const periodos = useMemo(() => {
    const ultimos = ultimosPeriodos(12);
    return periodo && !ultimos.includes(periodo) ? [periodo, ...ultimos] : ultimos;
  }, [periodo]);

  const mutation = useMutation({
    mutationFn: (valores) =>
      esEdicion
        ? api.put(`/api/gastos/${gasto.id}`, aPayload(valores))
        : api.post(`/api/edificios/${edificio.id}/gastos`, aPayload(valores)),
    onSuccess: (guardado) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.gastos.all });
      toast.success(esEdicion ? 'Gasto actualizado' : 'Gasto cargado', {
        description: guardado.concepto,
      });
      onClose();
    },
    onError: (err) => {
      if (err.code === 'PROVEEDOR_INVALIDO') {
        setError('proveedorId', { type: 'server', message: err.message });
        return;
      }
      if (err.code === 'RUBRO_INVALIDO') {
        setError('rubroId', { type: 'server', message: err.message });
        return;
      }
      // Decisión 4: no es un error del formulario.
      if (err.code === 'LIQUIDACION_APROBADA') {
        queryClient.invalidateQueries({ queryKey: queryKeys.gastos.all });
        toast.error('El gasto quedó congelado por una liquidación', {
          description: err.message,
        });
        onClose();
        return;
      }
      // Decisión 3: `"campo: motivo"` → error inline en ese campo.
      if (err.code === 'VALIDACION_FALLIDA' && typeof err.message === 'string') {
        const campo = CAMPOS_DEL_SERVIDOR.find((c) =>
          err.message.startsWith(`${c}:`),
        );
        if (campo) {
          setError(campo, {
            type: 'server',
            message: err.message.slice(campo.length + 1).trim(),
          });
          return;
        }
      }
      toast.error(
        esEdicion ? 'No se pudo actualizar el gasto' : 'No se pudo cargar el gasto',
        { description: err.message ?? 'Error inesperado' },
      );
    },
  });

  // Deshabilitar una categoría que el edificio no soporta (decisión 2).
  const motivoCategoria = (valor) => {
    if (valor === 'B' && servicios.length === 0) {
      return 'Ninguna unidad de este edificio declara servicios de categoría B';
    }
    if (valor === 'C' && sectores.length === 0) {
      return 'Ninguna unidad de este edificio declara un sector';
    }
    return null;
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={esEdicion ? 'Editar gasto' : 'Nuevo gasto'}
      description={
        esEdicion
          ? gasto.concepto
          : `${edificio.nombre} · el gasto entra a la liquidación del período que elijas.`
      }
      size="xl"
    >
      <form
        onSubmit={handleSubmit((valores) => mutation.mutate(valores))}
        className="flex flex-col gap-4"
      >
        <Campo
          id="gasto-concepto"
          label="Concepto *"
          error={errors.concepto}
          hint="Cómo aparece en la liquidación (ej. Sueldo encargado)."
        >
          <Input
            id="gasto-concepto"
            autoComplete="off"
            placeholder="Sueldo encargado"
            aria-invalid={errors.concepto ? true : undefined}
            {...register('concepto')}
          />
        </Campo>

        <Campo id="gasto-descripcion" label="Descripción" error={errors.descripcion}>
          <textarea
            id="gasto-descripcion"
            rows={2}
            placeholder="Detalle opcional (ej. pago mensual según CCT 589/10 SUTERH)"
            className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"
            aria-invalid={errors.descripcion ? true : undefined}
            {...register('descripcion')}
          />
        </Campo>

        {/* Proveedor y rubro: los dos selectores de S3-14, por Controller. */}
        <Campo
          id="gasto-proveedor"
          label="Proveedor *"
          error={errors.proveedorId}
          hint="Buscá en el directorio de tu organización o creá uno nuevo sin salir de acá."
        >
          <Controller
            control={control}
            name="proveedorId"
            render={({ field }) => (
              <ProveedorSelect
                id="gasto-proveedor"
                value={field.value}
                invalido={errors.proveedorId ? true : undefined}
                onChange={field.onChange}
                // Decisión 1: la sugerencia no pisa un rubro ya elegido.
                onProveedorSeleccionado={(proveedor) => {
                  if (proveedor?.rubroHabitualId && !getValues('rubroId')) {
                    setValue('rubroId', proveedor.rubroHabitualId, {
                      shouldDirty: true,
                    });
                  }
                }}
              />
            )}
          />
        </Campo>

        <Campo
          id="gasto-rubro"
          label="Rubro *"
          error={errors.rubroId}
          hint="Segmenta el gasto para el análisis. Es independiente de la categoría A/B/C."
        >
          <Controller
            control={control}
            name="rubroId"
            render={({ field }) => (
              <RubroSelect
                id="gasto-rubro"
                value={field.value}
                invalido={errors.rubroId ? true : undefined}
                onChange={field.onChange}
              />
            )}
          />
        </Campo>

        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Campo
            id="gasto-monto"
            label="Monto *"
            error={errors.monto}
            hint="Se escribe como se lee: 1.500,50"
          >
            <Input
              id="gasto-monto"
              autoComplete="off"
              inputMode="decimal"
              placeholder="450.000,00"
              className="tabular-nums"
              aria-invalid={errors.monto ? true : undefined}
              {...register('monto')}
            />
          </Campo>

          <Campo id="gasto-moneda" label="Moneda" error={errors.moneda}>
            <Select id="gasto-moneda" {...register('moneda')}>
              {MONEDAS.map((moneda) => (
                <option key={moneda.value} value={moneda.value}>
                  {moneda.label}
                </option>
              ))}
            </Select>
          </Campo>
        </div>

        {/* Categoría: gobierna a QUIÉNES se les reparte el gasto al liquidar. */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <Label htmlFor="gasto-categoria">Categoría *</Label>
            <AyudaLink
              variant="icon"
              topic="edificios/unidades/categorias-gastos"
            />
          </div>
          <Select
            id="gasto-categoria"
            aria-invalid={errors.categoria ? true : undefined}
            {...register('categoria')}
          >
            {CATEGORIAS.map((opcion) => {
              const motivo = motivoCategoria(opcion.value);
              return (
                <option
                  key={opcion.value}
                  value={opcion.value}
                  disabled={motivo !== null}
                  title={motivo ?? undefined}
                >
                  {opcion.label}
                  {motivo ? ' (no disponible en este edificio)' : ''}
                </option>
              );
            })}
          </Select>
          <p className="text-xs text-muted-foreground">
            {CATEGORIAS.find((c) => c.value === categoria)?.ayuda}
          </p>
          {errors.categoria && (
            <p className="text-sm text-destructive">{errors.categoria.message}</p>
          )}
        </div>

        {/* Decisión 2: el servicio y el sector son cerrados. Sin valores
            declarados en las unidades, el gasto no tendría entre quiénes
            repartirse y la liquidación del período fallaría entera. */}
        {categoria === 'B' && (
          <Campo
            id="gasto-servicio"
            label="Servicio *"
            error={errors.servicioEspecifico}
            hint="Solo lo pagan las unidades que tienen este servicio tildado."
          >
            {servicios.length > 0 ? (
              <Select
                id="gasto-servicio"
                aria-invalid={errors.servicioEspecifico ? true : undefined}
                {...register('servicioEspecifico')}
              >
                <option value="">Elegí el servicio</option>
                {servicios.map((servicio) => (
                  <option key={servicio} value={servicio}>
                    {etiquetaDeServicio(servicio)}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ninguna unidad declara servicios.{' '}
                <Link
                  to={`/edificios/${edificio.id}/unidades`}
                  className="text-primary underline"
                >
                  Cargalos en las unidades
                </Link>{' '}
                antes de usar la categoría B.
              </p>
            )}
          </Campo>
        )}

        {categoria === 'C' && (
          <Campo
            id="gasto-sector"
            label="Sector *"
            error={errors.sectorEspecifico}
            hint="Solo lo pagan las unidades de este sector."
          >
            {sectores.length > 0 ? (
              <Select
                id="gasto-sector"
                aria-invalid={errors.sectorEspecifico ? true : undefined}
                {...register('sectorEspecifico')}
              >
                <option value="">Elegí el sector</option>
                {sectores.map((sector) => (
                  <option key={sector} value={sector}>
                    {sector}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ninguna unidad declara un sector.{' '}
                <Link
                  to={`/edificios/${edificio.id}/unidades`}
                  className="text-primary underline"
                >
                  Cargalos en las unidades
                </Link>{' '}
                antes de usar la categoría C.
              </p>
            )}
          </Campo>
        )}

        {/* Tipo: radios, no select — son dos opciones y el mockup de §4.2 las
            muestra a la vista, que es lo que conviene para un dato que cambia
            cómo se lee la liquidación (ordinarias vs extraordinarias). */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm leading-none font-medium">Tipo</legend>
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                value="ordinario"
                className="size-4 accent-primary"
                {...register('tipo')}
              />
              Ordinario
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                value="extraordinario"
                className="size-4 accent-primary"
                {...register('tipo')}
              />
              Extraordinario
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Los extraordinarios se muestran aparte en la liquidación (ej. una obra).
          </p>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            id="gasto-fecha"
            label="Fecha del gasto *"
            error={errors.fechaGasto}
            hint="Cuándo se hizo el gasto. No puede ser futura."
          >
            <Input
              id="gasto-fecha"
              type="date"
              aria-invalid={errors.fechaGasto ? true : undefined}
              {...register('fechaGasto')}
            />
          </Campo>

          <Campo
            id="gasto-periodo"
            label="Período *"
            error={errors.periodo}
            hint="La liquidación en la que entra, aunque el gasto sea de otro mes."
          >
            <Select
              id="gasto-periodo"
              aria-invalid={errors.periodo ? true : undefined}
              {...register('periodo')}
            >
              {periodos.map((p) => (
                <option key={p} value={p}>
                  {formatearPeriodo(p)}
                </option>
              ))}
            </Select>
          </Campo>
        </div>

        {/* S3-19 — plan de cuotas. Solo aparece en un extraordinario: una
            ordinaria es el gasto corriente del mes y prorratearla escondería el
            gasto real de cada período (el backend lo rechaza con 422). El resumen
            en vivo es lo que evita la sorpresa del último recibo: muestra la
            cuota, el rango de períodos y, si el ajuste de centavos la mueve, el
            monto de la última. */}
        {esExtraordinario && (
          <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
            <legend className="px-1 text-sm leading-none font-medium">
              Imputación
            </legend>

            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                {...register('enCuotas')}
              />
              <span>
                Cobrar en cuotas
                <span className="block text-xs text-muted-foreground">
                  El gasto se reparte en cuotas mensuales consecutivas desde el período
                  elegido. Sin esto, entra completo en un solo período.
                </span>
              </span>
            </label>
            {errors.enCuotas && (
              <p className="text-sm text-destructive">{errors.enCuotas.message}</p>
            )}

            {enCuotas && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo
                  id="gasto-cuotas"
                  label="Cantidad de cuotas *"
                  error={errors.cuotasTotal}
                  hint="Entre 2 y 120."
                >
                  <Input
                    id="gasto-cuotas"
                    type="number"
                    min="2"
                    max="120"
                    step="1"
                    inputMode="numeric"
                    aria-invalid={errors.cuotasTotal ? true : undefined}
                    {...register('cuotasTotal')}
                  />
                </Campo>

                <div
                  className="flex flex-col justify-center gap-1 rounded-md bg-muted/50 p-3 text-sm"
                  aria-live="polite"
                >
                  {plan ? (
                    <>
                      <p>
                        <strong>{plan.cantidad}</strong> cuotas de{' '}
                        <strong>{formatearMonto(plan.montoCuota, moneda)}</strong>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        De {formatearPeriodo(plan.desde)} a {formatearPeriodo(plan.hasta)}
                        {plan.ultimaDifiere && (
                          <>
                            {' · '}última: {formatearMonto(plan.montoUltima, moneda)}
                          </>
                        )}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Completá el monto y la cantidad de cuotas para ver el plan.
                    </p>
                  )}
                </div>
              </div>
            )}
          </fieldset>
        )}

        {/* Decisión 4 de gasto-schema.js: link, no upload (todavía no hay
            endpoint de subida). */}
        <Campo
          id="gasto-comprobante"
          label="Comprobante"
          error={errors.comprobanteUrl}
          hint="Link a la factura o el recibo ya digitalizado. La subida de archivos llega con el endpoint de storage."
        >
          <Input
            id="gasto-comprobante"
            type="url"
            autoComplete="off"
            placeholder="https://…"
            aria-invalid={errors.comprobanteUrl ? true : undefined}
            {...register('comprobanteUrl')}
          />
        </Campo>

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
                : 'Cargar gasto'}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
