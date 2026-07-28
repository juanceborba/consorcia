// frontend/src/pages/EdificioDetallePage.jsx — ConsorcIA
// Placeholder (S1-10): el detalle real del edificio se implementa en S1-13.
import { useParams } from 'react-router';

export default function EdificioDetallePage() {
  const { id } = useParams();

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <h1 className="text-2xl font-semibold">EdificioDetallePage — edificio {id}</h1>
    </main>
  );
}
