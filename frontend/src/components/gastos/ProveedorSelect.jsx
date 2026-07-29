// frontend/src/components/gastos/ProveedorSelect.jsx — ConsorcIA
// Selector de proveedor para el form de gasto (S3-14, PRD-04-02 §1.3/§4.2).
// "Ningún gasto se carga sin proveedor asociado" es la regla de oro del módulo,
// así que este control tiene que resolver el caso del proveedor que todavía no
// está en el directorio SIN sacar al usuario del form: de ahí el alta inline.
//
// Por qué un combobox y no un `<select>`: el directorio de una organización suma
// el catálogo global de plataforma a sus propios, crece con el producto y el
// backend lo pagina (tope 100). Un `<select>` mostraría solo la primera página y
// sin forma de buscar el resto.
//
// La búsqueda es del SERVIDOR (`?q=`, busca por razón social y por CUIT sobre el
// directorio completo, no sobre la página cargada), así que el filtrado interno
// del combobox se desactiva con `filter={null}`: filtrar de nuevo en el cliente
// escondería resultados que el backend ya consideró coincidentes por CUIT.
//
// Contrato para S3-08 (form de gasto): componente controlado por `value`
// (proveedorId o '') + `onChange(proveedorId)`, apto para un `Controller` de RHF.
// `onProveedorSeleccionado` entrega el objeto completo, que el form usa para
// pre-seleccionar el rubro habitual del proveedor.
import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useProveedores } from '@/hooks/useProveedores';
import ProveedorFormDialog from '@/pages/configuracion/ProveedorFormDialog';
import { Badge } from '@/components/ui/badge';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxIcon,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxSeparator,
} from '@/components/ui/combobox';

// Base UI resuelve la etiqueta sola cuando el ítem tiene forma `{ value, label }`;
// `proveedor` viaja al costado para poder pintar el badge y el CUIT en la fila.
const aOpcion = (proveedor) => ({
  value: proveedor.id,
  label: proveedor.razonSocial,
  proveedor,
});

export default function ProveedorSelect({
  value = '',
  onChange,
  onProveedorSeleccionado,
  disabled = false,
  invalido = false,
  id = 'gasto-proveedor',
  permitirAlta = true,
}) {
  const [query, setQuery] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [altaOpen, setAltaOpen] = useState(false);

  // El listado solo trae ACTIVOS (default del endpoint): un proveedor dado de
  // baja no se ofrece para gastos nuevos, aunque siga visible en los viejos.
  const { proveedores, cargando } = useProveedores({ q: query, limit: 50 });

  const opciones = useMemo(() => proveedores.map(aOpcion), [proveedores]);

  // El valor seleccionado puede no estar en la página actual (el usuario buscó
  // otra cosa después de elegir), así que se busca primero entre las opciones y
  // si no está se conserva el último objeto conocido para no perder la etiqueta.
  const [ultimoElegido, setUltimoElegido] = useState(null);
  const seleccionado =
    opciones.find((o) => o.value === value) ??
    (ultimoElegido?.value === value ? ultimoElegido : null);

  // Si el form resetea el campo (por ejemplo al guardar el gasto), la etiqueta
  // recordada tiene que irse con él.
  useEffect(() => {
    if (!value) setUltimoElegido(null);
  }, [value]);

  const elegir = (opcion) => {
    if (!opcion) {
      onChange?.('');
      setUltimoElegido(null);
      return;
    }
    setUltimoElegido(opcion);
    onChange?.(opcion.value);
    onProveedorSeleccionado?.(opcion.proveedor);
  };

  return (
    <>
      <Combobox
        items={opciones}
        // Sin filtrado en el cliente: el `?q=` del backend ya filtró (ver cabecera).
        filter={null}
        value={seleccionado}
        onValueChange={elegir}
        isItemEqualToValue={(a, b) => a?.value === b?.value}
        // El texto del input lo maneja Base UI (al elegir un ítem lo reemplaza
        // por su etiqueta); acá solo se espeja en `query` para la búsqueda.
        onInputValueChange={setQuery}
        open={abierto}
        onOpenChange={setAbierto}
        openOnInputClick
        disabled={disabled}
      >
        <ComboboxInputGroup>
          <ComboboxInput
            id={id}
            placeholder="Buscar por razón social o CUIT"
            aria-invalid={invalido ? true : undefined}
          />
          <ComboboxIcon />
        </ComboboxInputGroup>

        <ComboboxContent>
          <ComboboxEmpty>
            {cargando
              ? 'Buscando…'
              : query.trim()
                ? `Ningún proveedor coincide con "${query.trim()}".`
                : 'El directorio está vacío.'}
          </ComboboxEmpty>

          <ComboboxList>
            {opciones.map((opcion) => (
              <ComboboxItem key={opcion.value} value={opcion}>
                <span className="truncate">{opcion.label}</span>
                {opcion.proveedor.cuit && (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {opcion.proveedor.cuit}
                  </span>
                )}
                {opcion.proveedor.esGlobal && (
                  <Badge variant="info" className="shrink-0">
                    Global
                  </Badge>
                )}
                <ComboboxItemIndicator />
              </ComboboxItem>
            ))}
          </ComboboxList>

          {/* Alta inline: el proveedor que falta se crea sin abandonar el gasto
              a medio cargar. Va FUERA de la List para que no participe de la
              navegación por flechas ni cuente como resultado de la búsqueda. */}
          {permitirAlta && (
            <>
              <ComboboxSeparator />
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm font-medium text-primary transition-colors hover:bg-accent"
                onClick={() => {
                  setAbierto(false);
                  setAltaOpen(true);
                }}
              >
                <Plus className="size-4 shrink-0" />
                {query.trim() ? `Crear "${query.trim()}"` : 'Crear un proveedor'}
              </button>
            </>
          )}
        </ComboboxContent>
      </Combobox>

      {/* El diálogo queda montado en el árbol del form pero es un portal, así que
          no lo anida ni dispara su submit. Al crear, el proveedor nuevo queda
          seleccionado: es lo que el usuario venía a hacer. */}
      {permitirAlta && (
        <ProveedorFormDialog
          isOpen={altaOpen}
          onClose={() => setAltaOpen(false)}
          onGuardado={(proveedor) => elegir(aOpcion(proveedor))}
        />
      )}
    </>
  );
}
