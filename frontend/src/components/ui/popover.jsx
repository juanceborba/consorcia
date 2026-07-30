// frontend/src/components/ui/popover.jsx — ConsorcIA
// Wrapper con los estilos del design system sobre `Popover` de Base UI (S3-08b).
// Lo pide el panel "Filtros" del listado de gastos (PRD-04-02 §4.1): un grupo de
// controles anclado a un botón, que es exactamente lo que un `DropdownMenu` NO
// es (sus ítems son `menuitem` y navegan con flechas; un select o un input
// adentro rompen ese contrato de accesibilidad).
//
// Sigue la convención de los demás componentes de `ui/`: re-exporta las partes
// del primitivo con `data-slot` y las clases del tema, sin agregar lógica. Los
// tokens del popup salen de dropdown-menu.jsx, así el panel no se ve como un
// widget ajeno.
//
// Base UI, no Radix: la composición es Root › Trigger › Portal › Positioner ›
// Popup, y el trigger se pasa con `render=` (no `asChild`).
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from '@/lib/utils';

function Popover({ ...props }) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = 'start',
  sideOffset = 4,
  children,
  ...props
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        className="isolate z-50 outline-none"
        sideOffset={sideOffset}
        align={align}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            'max-h-(--available-height) w-80 origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-4 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverTitle({ className, ...props }) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn('text-sm font-semibold', className)}
      {...props}
    />
  );
}

function PopoverClose({ ...props }) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

export { Popover, PopoverClose, PopoverContent, PopoverTitle, PopoverTrigger };
