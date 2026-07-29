// frontend/src/pages/edificio/unidad-form-utils.jsx — ConsorcIA
// Helpers compartidos por los dos flujos de alta de unidades (S2-09, separados
// en #57): UnidadAltaDialog (individual) y UnidadBulkDialog (carga rápida).
// Acá viven la cuenta de la invariante en cliente, el feedback inline, el
// coeficiente sugerido por m², el wrapper Campo y el toast de alta exitosa.
//
// Invariante de coeficientes (PRD-04-01 §1.3) — INFORMATIVA desde #57: el
// backend guarda aunque la suma resultante del edificio no cierre en 1.000000,
// así la carga puede ser incremental. El feedback inline replica la cuenta en
// cliente con decimal.js (misma semántica que services/coeficientes.js): los
// coeficientes del form solo entran en la suma cuando ya matchean el regex del
// contrato, así el texto no oscila mientras se tipea. **Guardar NUNCA se
// deshabilita por la suma** — solo por la validación de campos o mientras el
// submit está en vuelo.
import { toast } from 'sonner';
import Decimal from 'decimal.js';
import { COEFICIENTE_REGEX } from '@/lib/unidad-schema';
import { Label } from '@/components/ui/label';

// Mismos objetivo y tolerancia que backend/src/services/coeficientes.js.
const OBJETIVO = new Decimal(1);
const TOLERANCIA = new Decimal('0.000001');

export function sumarDecimales(valores) {
  return valores.reduce((acc, v) => acc.plus(v), new Decimal(0));
}

// Cuenta de la invariante en cliente. Solo suma los coeficientes del form
// que ya son válidos según el regex del contrato (los que se están tipeando
// no cuentan). Devuelve la suma resultante del edificio, el delta y si
// cierra dentro de la tolerancia.
export function calcularInvariante(sumaExistente, coeficientesForm) {
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
export function FeedbackInvariante({ invariante }) {
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
export function coeficienteSugerido(m2, totalM2) {
  const superficie = new Decimal(Number(m2) || 0);
  const total = new Decimal(Number(totalM2) || 0);
  if (superficie.lte(0) || total.lte(0)) return null;
  const sugerido = superficie.div(total).toFixed(6);
  return COEFICIENTE_REGEX.test(sugerido) ? sugerido : null;
}

// Registro del campo m² que además sugiere el coeficiente de la fila. Cada
// cambio de m² sobrescribe el coeficiente (heurística deliberada: una edición
// manual del coeficiente se respeta hasta que el usuario vuelva a tocar los
// m² de esa misma fila — no hace falta rastrear "campo tocado", el gesto de
// cambiar la superficie ES el pedido de resugerir).
export function registrarM2(form, campoM2, campoCoeficiente, totalM2) {
  const { onChange, ...resto } = form.register(campoM2);
  return {
    ...resto,
    onChange: (event) => {
      onChange(event);
      const sugerido = coeficienteSugerido(event.target.value, totalM2);
      if (sugerido !== null) {
        form.setValue(campoCoeficiente, sugerido, {
          shouldValidate: true,
          shouldDirty: true,
        });
      }
    },
  };
}

// Campo con label + error inline (patrón §6.1, igual que EdificioNuevoPage).
export function Campo({ id, label, obligatorio = true, error, children }) {
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

export const FILA_VACIA = { numero: '', tipo: 'departamento', m2: '', coeficiente: '' };

// Toast de alta exitosa (ambos flujos mandan array al endpoint bulk). La suma
// la reporta el backend (#57): si no cierra en 1 no es un error, pero el toast
// lo dice y el listado deja la alerta a la vista.
export function avisarUnidadesCreadas({ unidades: creadas, coeficientes }) {
  const delta = new Decimal(coeficientes.delta);
  toast.success(
    creadas.length === 1 ? 'Unidad creada' : `${creadas.length} unidades creadas`,
    {
      description: coeficientes.cuadra
        ? 'La suma de coeficientes del edificio quedó en 1.000000.'
        : `La suma de coeficientes quedó en ${coeficientes.suma}: ${
            delta.gte(0) ? 'faltan' : 'sobran'
          } ${delta.abs().toFixed(6)}.`,
    },
  );
}
