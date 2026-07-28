// src/server.js — ConsorcIA Backend
// Entry point del proceso: importa la app Express (src/app.js) y la pone a
// escuchar. Separado de app.js para que los tests de integración (S1-09)
// puedan levantar la app en un puerto efímero sin colisionar con este listen.

import app from './app.js';
import { config } from './config/index.js';

app.listen(config.port, () => {
  console.log(`ConsorcIA backend escuchando en puerto ${config.port}`);
});
