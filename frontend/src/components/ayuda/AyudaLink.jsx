// frontend/src/components/ayuda/AyudaLink.jsx — ConsorcIA
// Trigger de ayuda contextual (patrón nuevo de PRD-07-02): abre el drawer
// global con el topic indicado. Dos variantes:
//   - link (default): botón link con ícono + texto ("Más información" o
//     children), para ir al pie de un bloque de contenido.
//   - icon: botón ghost solo ícono con aria-label="Ayuda", para ir junto al
//     título de una pantalla o card (convención §6.5: cada pantalla tiene su
//     acceso a ayuda).
// type="button" explícito: vive dentro de formularios y nunca debe submitear.
import { CircleHelp } from 'lucide-react';
import { useAyudaStore } from '@/stores/ayuda.store';
import { Button } from '@/components/ui/button';

export default function AyudaLink({
  topic,
  variant = 'link',
  children = 'Más información',
}) {
  const abrirAyuda = useAyudaStore((s) => s.abrirAyuda);

  if (variant === 'icon') {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Ayuda"
        className="text-muted-foreground"
        onClick={() => abrirAyuda(topic)}
      >
        <CircleHelp className="size-4" />
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      className="w-fit px-0"
      onClick={() => abrirAyuda(topic)}
    >
      <CircleHelp className="size-4" />
      {children}
    </Button>
  );
}
