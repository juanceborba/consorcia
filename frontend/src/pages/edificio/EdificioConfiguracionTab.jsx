// frontend/src/pages/edificio/EdificioConfiguracionTab.jsx — ConsorcIA
// Tab "Configuración" del detalle de edificio (S2-07): placeholder mínimo;
// la edición de datos y configuración del edificio llega en S2-10.
import { Settings } from 'lucide-react';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function EdificioConfiguracionTab() {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="size-5 shrink-0" />
          Configuración
        </CardTitle>
        <CardDescription>
          La edición de datos y la configuración del edificio estará disponible
          a partir de la tarea S2-10 del sprint.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
