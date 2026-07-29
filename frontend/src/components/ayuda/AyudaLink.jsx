// frontend/src/components/ayuda/AyudaLink.jsx — ConsorcIA
// Trigger de ayuda contextual (patrón nuevo de PRD-07-02): botón link con
// ícono de ayuda que abre el drawer global con el topic indicado. Se usa en
// cualquier pantalla: <AyudaLink topic="modulo/pantalla/tema" />. El texto por
// defecto es "Más información"; se puede personalizar con children.
// type="button" explícito: vive dentro de formularios y nunca debe submitear.
import { CircleHelp } from 'lucide-react';
import { useAyudaStore } from '@/stores/ayuda.store';
import { Button } from '@/components/ui/button';

export default function AyudaLink({ topic, children = 'Más información' }) {
  const abrirAyuda = useAyudaStore((s) => s.abrirAyuda);
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
