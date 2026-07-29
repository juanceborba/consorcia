// frontend/src/components/ui/combobox.jsx — ConsorcIA
// Wrapper con los estilos del design system sobre `Combobox` de Base UI (S3-14).
// Es el primer combobox de la app: lo pide el selector de proveedor del form de
// gasto (PRD-04-02 §4.2 — el directorio suma el catálogo global de plataforma a
// los propios, así que un `<select>` con el catálogo completo no escala).
//
// Sigue la convención de los demás componentes de `ui/`: re-exporta las partes
// del primitivo con `data-slot` y las clases del tema, sin agregar lógica. Los
// tokens salen de dropdown-menu.jsx (mismo popup flotante) y de input.jsx (mismo
// campo de texto), así el combobox no se ve como un widget ajeno.
//
// Base UI, no Radix: la composición es Root › Input/Icon › Portal › Positioner ›
// Popup › List › Item, y el trigger se pasa con `render=` (no `asChild`).
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

function Combobox({ ...props }) {
  return <ComboboxPrimitive.Root data-slot="combobox" {...props} />;
}

// Contenedor del campo: envuelve el input y el ícono para que el chevron quede
// dentro del borde y el foco se pinte sobre el grupo entero.
function ComboboxInputGroup({ className, ...props }) {
  return (
    <ComboboxPrimitive.InputGroup
      data-slot="combobox-input-group"
      className={cn(
        'flex h-8 w-full min-w-0 items-center gap-1 rounded-lg border border-input bg-transparent pr-1 pl-2.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-disabled:pointer-events-none has-disabled:cursor-not-allowed has-disabled:bg-input/50 has-disabled:opacity-50 has-aria-invalid:border-destructive has-aria-invalid:ring-3 has-aria-invalid:ring-destructive/20 dark:bg-input/30',
        className,
      )}
      {...props}
    />
  );
}

function ComboboxInput({ className, ...props }) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        'h-full w-full min-w-0 flex-1 bg-transparent py-1 text-base outline-none placeholder:text-muted-foreground md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

function ComboboxIcon({ className, ...props }) {
  return (
    <ComboboxPrimitive.Icon
      data-slot="combobox-icon"
      className={cn('shrink-0 text-muted-foreground', className)}
      {...props}
    >
      <ChevronsUpDown className="size-4" />
    </ComboboxPrimitive.Icon>
  );
}

// Popup anclado al campo. `w-(--anchor-width)` lo hace exactamente del ancho del
// input y `max-h-(--available-height)` evita que se salga del viewport.
function ComboboxContent({ className, sideOffset = 4, children, ...props }) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        className="isolate z-50 outline-none"
        sideOffset={sideOffset}
        align="start"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            'max-h-(--available-height) w-(--anchor-width) min-w-48 origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxList({ className, ...props }) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn('flex flex-col', className)}
      {...props}
    />
  );
}

// `data-highlighted` es el foco de teclado; se pinta igual que el item del
// dropdown-menu para que navegar con flechas se sienta idéntico.
function ComboboxItem({ className, children, ...props }) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        'relative flex cursor-default items-center gap-2 rounded-md px-1.5 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </ComboboxPrimitive.Item>
  );
}

function ComboboxItemIndicator({ className, ...props }) {
  return (
    <ComboboxPrimitive.ItemIndicator
      data-slot="combobox-item-indicator"
      className={cn('ml-auto flex shrink-0 items-center', className)}
      {...props}
    >
      <Check className="size-4" />
    </ComboboxPrimitive.ItemIndicator>
  );
}

// Se renderiza solo cuando la lista queda sin ítems.
function ComboboxEmpty({ className, ...props }) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn('px-2 py-3 text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

function ComboboxSeparator({ className, ...props }) {
  return (
    <ComboboxPrimitive.Separator
      data-slot="combobox-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

export {
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
};
