// frontend/src/pages/configuracion/EdificiosCheckboxGroup.jsx — ConsorcIA
// Multi-select de edificios asignados a un gestor (S4-07, PRD-04-11 §4.2).
// Lista de checkboxes en vez de un combobox: la escala del MVP es de pocos
// edificios por organización y así se ve el set completo de un vistazo (que es
// lo que importa: el PATCH REEMPLAZA el set, no acumula).
//
// Se controla desde RHF con `value`/`onChange` (Controller): el registro nativo
// de N checkboxes con el mismo name devuelve strings sueltos o array según la
// cantidad, y acá el contrato siempre es un array de ids.
export default function EdificiosCheckboxGroup({
  edificios,
  value,
  onChange,
  onBlur,
  disabled = false,
  cargando = false,
  error,
}) {
  const alternar = (id, marcado) => {
    onChange(marcado ? [...value, id] : value.filter((v) => v !== id));
  };

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      {/* Mismo estilo que las legends de fieldset de S2-09 (UnidadAltaDialog) */}
      <legend className="text-sm leading-none font-medium">
        Edificios asignados
      </legend>
      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando edificios…</p>
      ) : edificios.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          La organización todavía no tiene edificios.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {edificios.map((edificio) => (
            <label
              key={edificio.id}
              className="flex items-center gap-2 text-sm data-disabled:opacity-50"
              data-disabled={disabled ? '' : undefined}
            >
              <input
                type="checkbox"
                className="size-4 accent-primary"
                value={edificio.id}
                checked={value.includes(edificio.id)}
                disabled={disabled}
                onBlur={onBlur}
                onChange={(event) =>
                  alternar(edificio.id, event.target.checked)
                }
              />
              {edificio.nombre}
            </label>
          ))}
        </div>
      )}
      {disabled && (
        <p className="text-sm text-muted-foreground">
          Un administrador de la organización opera todos los edificios: no hace
          falta asignárselos.
        </p>
      )}
      {!disabled && value.length === 0 && edificios.length > 0 && (
        <p className="text-sm text-warning">
          Sin edificios asignados, el gestor ve la organización en solo lectura.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
    </fieldset>
  );
}
