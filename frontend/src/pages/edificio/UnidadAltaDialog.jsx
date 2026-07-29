// frontend/src/pages/edificio/UnidadAltaDialog.jsx — ConsorcIA
// Alta de unidades (S2-09) desde el tab Unidades: modal (PRD-07-02 §3.6) con
// dos modos — individual (form completo con categorías A/B/C, §1.4 de
// PRD-04-01) y bulk "carga rápida" (grilla de N filas editables). Ambos
// envían un array al endpoint bulk POST /api/edificios/:id/unidades.
//
// Invariante de coeficientes (PRD-04-01 §1.3) — INFORMATIVA desde #57: el
// backend guarda aunque la suma resultante del edificio no cierre en 1.000000,
// así la carga puede ser incremental. El feedback inline replica la cuenta en
// cliente con decimal.js (misma semántica que services/coeficientes.js) en los
// dos modos: los coeficientes del form solo entran en la suma cuando ya
// matchean el regex del contrato, así el texto no oscila mientras se tipea.
// **Guardar NUNCA se deshabilita por la suma** — solo por la validación de
// campos o mientras el submit está en vuelo.
//
// Coeficiente sugerido (#57): al tipear los m² de una fila se autocompleta
// `coeficiente = m² / totalM2 del edificio` (6 decimales, PRD-04-01 §1.3).
// Heurística deliberadamente simple: cada cambio de m² sobrescribe el
// coeficiente. O sea, una edición manual del coeficiente se respeta hasta que
// el usuario vuelva a tocar los m² de esa misma fila — no hace falta rastrear
// "campo tocado", el gesto de cambiar la superficie ES el pedido de resugerir.
//
// Patrones de formularios según PRD-07-02 §6.1: validación onBlur, errores
// inline, submit deshabilitado solo si el form es inválido, loading en el
// botón, toast de éxito/error, confirmación al cerrar con cambios.
import { useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Decimal from 'decimal.js';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import {
  COEFICIENTE_REGEX,
  crearBulkFormSchema,
  crearUnidadFormSchema,
  SERVICIOS_B,
  TIPOS_UNIDAD,
} from '@/lib/unidad-schema';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs';

// Mismos objetivo y tolerancia que backend/src/services/coeficientes.js.
const OBJETIVO = new Decimal(1);
const TOLERANCIA = new Decimal('0.000001');

function sumarDecimales(valores) {
  return valores.reduce((acc, v) => acc.plus(v), new Decimal(0));
}

// Cuenta de la invariante en cliente. Solo suma los coeficientes del form
// que ya son válidos según el regex del contrato (los que se están tipeando
// no cuentan). Devuelve la suma resultante del edificio, el delta y si
// cierra dentro de la tolerancia.
function calcularInvariante(sumaExistente, coeficientesForm) {
  const validos = coeficientesForm.filter(
    (v) => typeof v === 'string' && COEFICIENTE_REGEX.test(v.trim()),
  );
  const resultante = sumaExistente.plus(sumarDecimales(validos));
  const delta = OBJETIVO.minus(resultante);
  return { resultante, delta, cuadra: delta.abs().lte(TOLERANCIA) };
}

// Texto de la invariante: se actualiza al editar cualquier coeficiente del
// form. Verde cuando cierra en 1.000000, warning cuando no (no es un error —
// guardar sigue habilitado, #57).
function FeedbackInvariante({ invariante }) {
  const { resultante, delta, cuadra } = invariante;
  if (cuadra) {
    return (
      <p className="text-sm font-medium text-success tabular-nums">
        Suma actual: {resultante.toFixed(6)} ✓ — cierra la invariante
      </p>
    );
  }
  return (
    <p className="text-sm font-medium text-warning tabular-nums">
      Suma actual: {resultante.toFixed(6)} — {delta.gte(0) ? 'falta' : 'sobra'}{' '}
      {delta.abs().toFixed(6)}
    </p>
  );
}

// Coeficiente sugerido a partir de los m² de la UF (PRD-04-01 §1.3):
// coeficiente = m² / m² totales del edificio, con 6 decimales. Devuelve null
// si no se puede calcular (m² vacío o no numérico, totalM2 ausente) o si el
// resultado no matchea el regex del contrato (m² > totalM2 → > 1, o un m²
// tan chico que redondea a 0.000000): en esos casos no se toca el campo y la
// validación inline del coeficiente hace su trabajo.
function coeficienteSugerido(m2, totalM2) {
  const superficie = new Decimal(Number(m2) || 0);
  const total = new Decimal(Number(totalM2) || 0);
  if (superficie.lte(0) || total.lte(0)) return null;
  const sugerido = superficie.div(total).toFixed(6);
  return COEFICIENTE_REGEX.test(sugerido) ? sugerido : null;
}

// Campo con label + error inline (patrón §6.1, igual que EdificioNuevoPage).
function Campo({ id, label, obligatorio = true, error, children }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>
        {label}
        {obligatorio && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
    </div>
  );
}

const FILA_VACIA = { numero: '', tipo: 'departamento', m2: '', coeficiente: '' };

export default function UnidadAltaDialog({
  edificioId,
  edificioTotalM2,
  unidadesExistentes,
  isOpen,
  onClose,
}) {
  const queryClient = useQueryClient();
  const [modo, setModo] = useState('individual'); // 'individual' | 'bulk'

  const numerosExistentes = useMemo(
    () => unidadesExistentes.map((u) => u.numero),
    [unidadesExistentes],
  );
  // Coeficientes existentes vienen como strings (Decimal de Prisma
  // serializado); decimal.js los suma sin error de float.
  const sumaExistente = useMemo(
    () => sumarDecimales(unidadesExistentes.map((u) => u.coeficiente)),
    [unidadesExistentes],
  );

  // Registro del campo m² que además sugiere el coeficiente de la fila. Cada
  // cambio de m² sobrescribe el coeficiente (heurística del header).
  const registrarM2 = (form, campoM2, campoCoeficiente) => {
    const { onChange, ...resto } = form.register(campoM2);
    return {
      ...resto,
      onChange: (event) => {
        onChange(event);
        const sugerido = coeficienteSugerido(event.target.value, edificioTotalM2);
        if (sugerido !== null) {
          form.setValue(campoCoeficiente, sugerido, {
            shouldValidate: true,
            shouldDirty: true,
          });
        }
      },
    };
  };

  // ── Modo individual ────────────────────────────────────────────────────
  const formIndividual = useForm({
    resolver: zodResolver(crearUnidadFormSchema(numerosExistentes)),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      numero: '',
      tipo: 'departamento',
      m2: '',
      coeficiente: '',
      categoriaA: true,
      categoriaB: [],
      categoriaC: '',
    },
  });
  const coeficienteIndividual = formIndividual.watch('coeficiente');
  const invarianteIndividual = calcularInvariante(sumaExistente, [
    coeficienteIndividual,
  ]);

  // ── Modo bulk ──────────────────────────────────────────────────────────
  const formBulk = useForm({
    resolver: zodResolver(crearBulkFormSchema(numerosExistentes)),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { unidades: [{ ...FILA_VACIA }, { ...FILA_VACIA }, { ...FILA_VACIA }] },
  });
  const { fields, append, remove } = useFieldArray({
    control: formBulk.control,
    name: 'unidades',
  });
  const filasBulk = formBulk.watch('unidades');
  const invarianteBulk = calcularInvariante(
    sumaExistente,
    (filasBulk ?? []).map((f) => f?.coeficiente),
  );

  const invariante = modo === 'individual' ? invarianteIndividual : invarianteBulk;
  const formActivo = modo === 'individual' ? formIndividual : formBulk;
  const hayCambios = formIndividual.formState.isDirty || formBulk.formState.isDirty;

  // ── Submit (ambos modos mandan array al endpoint bulk) ─────────────────
  const mutation = useMutation({
    mutationFn: (unidades) =>
      api.post(`/api/edificios/${edificioId}/unidades`, unidades),
    onSuccess: ({ unidades: creadas, coeficientes }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.edificios.unidades(edificioId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.edificios.detail(edificioId),
      });
      // La suma la reporta el backend (#57): si no cierra en 1 no es un error,
      // pero el toast lo dice y el listado deja la alerta a la vista.
      const delta = new Decimal(coeficientes.delta);
      toast.success(
        creadas.length === 1
          ? 'Unidad creada'
          : `${creadas.length} unidades creadas`,
        {
          description: coeficientes.cuadra
            ? 'La suma de coeficientes del edificio quedó en 1.000000.'
            : `La suma de coeficientes quedó en ${coeficientes.suma}: ${
                delta.gte(0) ? 'faltan' : 'sobran'
              } ${delta.abs().toFixed(6)}.`,
        },
      );
      formIndividual.reset();
      formBulk.reset();
      onClose();
    },
    onError: (err) => {
      // Duplicados / validación de campos (la suma nunca rechaza, #57).
      toast.error('No se pudieron guardar las unidades', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  const submitIndividual = formIndividual.handleSubmit((values) => {
    mutation.mutate([
      {
        numero: values.numero,
        tipo: values.tipo,
        m2: values.m2,
        coeficiente: values.coeficiente,
        categoriaA: values.categoriaA,
        categoriaB: values.categoriaB,
        categoriaC: values.categoriaC || null,
      },
    ]);
  });

  const submitBulk = formBulk.handleSubmit((values) => {
    mutation.mutate(
      values.unidades.map((u) => ({
        numero: u.numero,
        tipo: u.tipo,
        m2: u.m2,
        coeficiente: u.coeficiente,
      })),
    );
  });

  // Confirmación antes de cerrar con cambios sin guardar (§6.1.8).
  const cerrar = () => {
    if (
      hayCambios &&
      !mutation.isSuccess &&
      !window.confirm('Tenés cambios sin guardar. ¿Cerrar de todas formas?')
    ) {
      return;
    }
    onClose();
  };

  // La suma de coeficientes NO condiciona el guardado (#57): solo la validación
  // de campos y el submit en vuelo.
  const guardarDeshabilitado =
    !formActivo.formState.isValid || mutation.isPending;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={cerrar}
      title="Agregar unidades"
      description={
        sumaExistente.gt(0)
          ? `El edificio ya tiene ${sumaExistente.toFixed(6)} de coeficiente asignado. Podés cargar de a poco: la suma total tiene que llegar a 1.000000.`
          : 'Cargá las unidades funcionales del edificio. Podés cargarlas de a poco: la suma total tiene que llegar a 1.000000.'
      }
      size="xl"
    >
      <Tabs value={modo} onValueChange={setModo}>
        <TabsList>
          <TabsTab value="individual">Una unidad</TabsTab>
          <TabsTab value="bulk">Carga rápida (varias)</TabsTab>
        </TabsList>
      </Tabs>

      {modo === 'individual' ? (
        <form
          onSubmit={submitIndividual}
          className="grid gap-4 sm:grid-cols-2"
        >
          <Campo
            id="unidad-numero"
            label="Número"
            error={formIndividual.formState.errors.numero}
          >
            <Input
              id="unidad-numero"
              placeholder="3A"
              aria-invalid={!!formIndividual.formState.errors.numero}
              {...formIndividual.register('numero')}
            />
          </Campo>

          <Campo
            id="unidad-tipo"
            label="Tipo"
            error={formIndividual.formState.errors.tipo}
          >
            <Select
              id="unidad-tipo"
              aria-invalid={!!formIndividual.formState.errors.tipo}
              {...formIndividual.register('tipo')}
            >
              {TIPOS_UNIDAD.map((tipo) => (
                <option key={tipo.value} value={tipo.value}>
                  {tipo.label}
                </option>
              ))}
            </Select>
          </Campo>

          <Campo
            id="unidad-m2"
            label="Superficie (m²)"
            error={formIndividual.formState.errors.m2}
          >
            <Input
              id="unidad-m2"
              type="number"
              min="0"
              step="any"
              placeholder="85"
              aria-invalid={!!formIndividual.formState.errors.m2}
              {...registrarM2(formIndividual, 'm2', 'coeficiente')}
            />
          </Campo>

          <Campo
            id="unidad-coeficiente"
            label="Coeficiente"
            error={formIndividual.formState.errors.coeficiente}
          >
            <Input
              id="unidad-coeficiente"
              placeholder="0.027742"
              inputMode="decimal"
              aria-invalid={!!formIndividual.formState.errors.coeficiente}
              {...formIndividual.register('coeficiente')}
            />
            <p className="text-xs text-muted-foreground">
              Se sugiere al cargar los m² (m² / {Number(edificioTotalM2)} m²
              totales del edificio). Podés editarlo.
            </p>
          </Campo>

          {/* Categorías A/B/C (Ley 941, PRD-04-01 §1.4) */}
          <fieldset className="flex flex-col gap-2 sm:col-span-2">
            <legend className="text-sm leading-none font-medium">
              Categorías de gastos
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                {...formIndividual.register('categoriaA')}
              />
              A — gastos generales (sueldos, seguros, ABL)
            </label>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="text-muted-foreground">B — servicios:</span>
              {SERVICIOS_B.map((servicio) => (
                <label
                  key={servicio.value}
                  className="flex items-center gap-2"
                >
                  <input
                    type="checkbox"
                    value={servicio.value}
                    className="size-4 accent-primary"
                    {...formIndividual.register('categoriaB')}
                  />
                  {servicio.label}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="unidad-categoriaC" className="text-muted-foreground">
                C — sector:
              </Label>
              <Input
                id="unidad-categoriaC"
                placeholder="Opcional (ej. pileta, torre-a)"
                className="max-w-xs"
                {...formIndividual.register('categoriaC')}
              />
            </div>
          </fieldset>

          <div className="flex flex-col gap-3 sm:col-span-2">
            <FeedbackInvariante invariante={invariante} />
            <div className="flex gap-2">
              <Button type="submit" disabled={guardarDeshabilitado}>
                {mutation.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {mutation.isPending ? 'Guardando…' : 'Guardar unidad'}
              </Button>
              <Button type="button" variant="outline" onClick={cerrar}>
                Cancelar
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <form onSubmit={submitBulk} className="flex flex-col gap-3">
          {/* Grilla de carga rápida: una fila por UF */}
          <div className="grid grid-cols-[1fr_1.2fr_0.7fr_1fr_auto] items-center gap-2 text-sm font-medium text-muted-foreground">
            <span>Número</span>
            <span>Tipo</span>
            <span>m²</span>
            <span>Coeficiente</span>
            <span className="sr-only">Quitar</span>
          </div>
          {fields.map((field, index) => {
            const errorsFila =
              formBulk.formState.errors.unidades?.[index] ?? {};
            return (
              <div
                key={field.id}
                className="grid grid-cols-[1fr_1.2fr_0.7fr_1fr_auto] items-start gap-2"
              >
                <div className="flex flex-col gap-1">
                  <Input
                    placeholder="3A"
                    aria-label={`Número de la fila ${index + 1}`}
                    aria-invalid={!!errorsFila.numero}
                    {...formBulk.register(`unidades.${index}.numero`)}
                  />
                  {errorsFila.numero && (
                    <p className="text-xs text-destructive">
                      {errorsFila.numero.message}
                    </p>
                  )}
                </div>
                <Select
                  aria-label={`Tipo de la fila ${index + 1}`}
                  {...formBulk.register(`unidades.${index}.tipo`)}
                >
                  {TIPOS_UNIDAD.map((tipo) => (
                    <option key={tipo.value} value={tipo.value}>
                      {tipo.label}
                    </option>
                  ))}
                </Select>
                <div className="flex flex-col gap-1">
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="85"
                    aria-label={`m² de la fila ${index + 1}`}
                    aria-invalid={!!errorsFila.m2}
                    {...registrarM2(
                      formBulk,
                      `unidades.${index}.m2`,
                      `unidades.${index}.coeficiente`,
                    )}
                  />
                  {errorsFila.m2 && (
                    <p className="text-xs text-destructive">
                      {errorsFila.m2.message}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <Input
                    placeholder="0.027742"
                    inputMode="decimal"
                    aria-label={`Coeficiente de la fila ${index + 1}`}
                    aria-invalid={!!errorsFila.coeficiente}
                    {...formBulk.register(`unidades.${index}.coeficiente`)}
                  />
                  {errorsFila.coeficiente && (
                    <p className="text-xs text-destructive">
                      {errorsFila.coeficiente.message}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Quitar fila ${index + 1}`}
                  disabled={fields.length === 1}
                  onClick={() => remove(index)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            );
          })}

          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => append({ ...FILA_VACIA })}
          >
            <Plus className="size-4" />
            Agregar fila
          </Button>

          <div className="flex flex-col gap-3 pt-1">
            <FeedbackInvariante invariante={invariante} />
            <div className="flex gap-2">
              <Button type="submit" disabled={guardarDeshabilitado}>
                {mutation.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {mutation.isPending
                  ? 'Guardando…'
                  : `Guardar ${fields.length === 1 ? '1 unidad' : `${fields.length} unidades`}`}
              </Button>
              <Button type="button" variant="outline" onClick={cerrar}>
                Cancelar
              </Button>
            </div>
          </div>
        </form>
      )}
    </Dialog>
  );
}
