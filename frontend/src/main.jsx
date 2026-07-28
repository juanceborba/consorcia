// frontend/src/main.jsx — ConsorcIA (scaffold inicial)
import React from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [health, setHealth] = React.useState(null);

  React.useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    fetch(`${apiUrl}/health`)
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setHealth({ status: 'error' }));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>ConsorcIA</h1>
      <p>Stack inicial levantado — scaffold de desarrollo.</p>
      <p>
        Backend:{' '}
        {health === null
          ? 'consultando…'
          : health.status === 'ok'
            ? '✅ /health OK'
            : '❌ sin respuesta'}
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
