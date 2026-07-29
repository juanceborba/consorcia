// frontend/src/components/gastos/RubroSelect.jsx — ConsorcIA
// Selector rubro → subrubro en cascada para el form de gasto (S3-14,
// PRD-04-02 §1.4). Dos `<select>` nativos, no un combobox: el árbol de una
// organización son decenas de ítems (el maestro son 10 rubros), no cientos, y
// está completo en una sola respuesta — buscar no aporta y la cascada enseña la
// jerarquía, que es justamente lo que el usuario tiene que entender para
// segmentar bien el gasto.
//
// El gasto SIEMPRE apunta a una HOJA (PRD-04-02 §1.1: subrubro, o rubro de nivel
// 1 sin hijos), y el backend lo valida en S3-02 con `rubroUsable(..., { soloHojas:
// true })`. De ahí las dos reglas del control:
//
//   1. elegir un rubro CON subrubros no fija todavía el `rubroId` — deja el
//      segundo select obligatorio (mostrarlo como válido llevaría a un 422),
//   2. elegir un rubro SIN subrubros fija el `rubroId` directo y el segundo
//      select no se muestra (no hay nada que elegir).
//
// El árbol que se pide es el USABLE (sin ocultos): tiene que coincidir exactamente
// con lo que el backend acepta, o el form ofrecería un rubro que el POST rechaza.
//
// Contrato para S3-08: controlado por `value` (rubroId hoja o '') +
// `onChange(rubroId)`, apto para un `Controller` de RHF.
import { useEffect, useState } from 'react';
import { useRubros } from '@/hooks/useRubros';
import { Select } from '@/components/ui/select';

export default function RubroSelect({
  value = '',
  onChange,
  disabled = false,
  invalido = false,
  id = 'gasto-rubro',
}) {
  const { arbol, cargando } = useRubros();
  const [rubroId, setRubroId] = useState('');

  // El `value` puede llegar de afuera (edición de un gasto, o la sugerencia del
  // rubro habitual del proveedor): hay que reconstruir en qué rama del árbol cae
  // para que el primer select muestre el padre correcto.
  useEffect(() => {
    if (!value) {
      setRubroId('');
      return;
    }
    const padre = arbol.find(
      (rubro) => rubro.id === value || rubro.subrubros.some((s) => s.id === value),
    );
    if (padre) setRubroId(padre.id);
  }, [value, arbol]);

  const rubro = arbol.find((r) => r.id === rubroId) ?? null;
  const subrubros = rubro?.subrubros ?? [];
  const necesitaSubrubro = subrubros.length > 0;

  const elegirRubro = (nuevoId) => {
    setRubroId(nuevoId);
    if (!nuevoId) {
      onChange?.('');
      return;
    }
    const elegido = arbol.find((r) => r.id === nuevoId);
    // Regla 2: rubro hoja → ya es un `rubroId` válido. Regla 1: con subrubros el
    // valor queda vacío hasta que se elija uno.
    onChange?.(elegido && elegido.subrubros.length === 0 ? nuevoId : '');
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Select
        id={id}
        value={rubroId}
        disabled={disabled || cargando}
        aria-label="Rubro"
        aria-invalid={invalido && !value ? true : undefined}
        onChange={(event) => elegirRubro(event.target.value)}
      >
        <option value="">{cargando ? 'Cargando rubros…' : 'Elegí un rubro'}</option>
        {arbol.map((item) => (
          <option key={item.id} value={item.id}>
            {item.nombre}
          </option>
        ))}
      </Select>

      {necesitaSubrubro && (
        <Select
          id={`${id}-subrubro`}
          value={value}
          disabled={disabled}
          aria-label="Subrubro"
          aria-invalid={invalido && !value ? true : undefined}
          onChange={(event) => onChange?.(event.target.value)}
        >
          <option value="">Elegí un subrubro</option>
          {subrubros.map((subrubro) => (
            <option key={subrubro.id} value={subrubro.id}>
              {subrubro.nombre}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
