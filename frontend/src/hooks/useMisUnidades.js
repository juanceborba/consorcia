// frontend/src/hooks/useMisUnidades.js — ConsorcIA
// Vínculos vigentes del usuario logueado (S4-12, #58): GET /api/me/unidades.
// Es el único listado que ve un residente puro, porque /api/edificios está
// scopeado por la organización activa del JWT y él no tiene (PRD-04-11 §5.5).
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useMisUnidades({ enabled = true } = {}) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.me.unidades(),
    queryFn: () => api.get('/api/me/unidades'),
    enabled,
  });

  const vinculos = data ?? [];

  // Edificios únicos derivados de los vínculos, para el selector del header.
  // Mismo shape que /api/edificios en lo que la UI usa (id + nombre).
  const edificios = [];
  for (const vinculo of vinculos) {
    if (!edificios.some((e) => e.id === vinculo.edificio.id)) {
      edificios.push(vinculo.edificio);
    }
  }

  return { vinculos, edificios, cargando: isLoading, error: error ?? null };
}
