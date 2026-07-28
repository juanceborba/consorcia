// frontend/src/hooks/useEdificios.js — ConsorcIA
// Hook compartido: edificios visibles para el usuario (GET /api/edificios).
// Lo usan el selector del header (AppLayout) y el listado (EdificiosPage).
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export function useEdificios() {
  const [edificios, setEdificios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelado = false;
    api
      .get('/api/edificios')
      .then((data) => {
        if (!cancelado) setEdificios(data);
      })
      .catch((err) => {
        if (!cancelado) setError(err);
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  return { edificios, cargando, error };
}
