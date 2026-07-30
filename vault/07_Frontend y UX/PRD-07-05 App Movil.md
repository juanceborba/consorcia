---
title: "PRD-07-05: App Móvil"
description: "Estrategia mobile-first, PWA, React Native y experiencia de usuario en dispositivos móviles para ConsorcIA."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P1"
tags: [frontend, ux, mobile, pwa, react-native, responsive, app, consorcIA]
outcomes:
  - "Definir la estrategia mobile-first de ConsorcIA"
  - "Implementar PWA con offline support"
  - "Diseñar la experiencia de usuario en móvil"
  - "Planificar React Native para Fase 2"
  - "Optimizar performance en dispositivos móviles"
---

# PRD-07-05: App Móvil

> **ConsorcIA adopta una estrategia mobile-first: PWA en Fase 1, React Native en Fase 2.** El 60% de los residentes accederán desde móvil. La experiencia debe ser nativa, rápida y funcional sin conexión.

---

## 1. Estrategia Mobile

### 1.1 Fases

| Fase | Tecnología | Alcance | Timeline |
|------|------------|---------|----------|
| **Fase 1 (MVP)** | PWA (Progressive Web App) | Residentes: pagos, tickets, chat | Mes 1-3 |
| **Fase 2** | React Native | Apps nativas iOS/Android | Mes 6-9 |
| **Fase 3** | React Native + features | Push notifications, biometría | Mes 9-12 |

### 1.2 Por qué PWA primero

| Ventaja | Descripción |
|---------|-------------|
| **Un solo codebase** | Mismo React que el web. Sin duplicar esfuerzo. |
| **Deploy instantáneo** | Sin app stores. Actualizaciones inmediatas. |
| **SEO** | Indexable por Google. Landing page + app en uno. |
| **Costo** | Menor inversión inicial. Validar demanda antes de nativo. |
| **Offline** | Service workers permiten funcionalidad sin conexión. |

---

## 2. PWA: Configuración

### 2.1 Vite PWA Plugin

```typescript
// vite.config.ts
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: new RegExp('^https://api.consorcia.app/.*'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 86400 },
            },
          },
          {
            urlPattern: new RegExp('^https://storage.consorcia.app/.*'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'assets-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 604800 },
            },
          },
        ],
      },
      manifest: {
        name: 'ConsorcIA',
        short_name: 'ConsorcIA',
        description: 'Inteligencia para tu consorcio',
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/residente',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
```

### 2.2 Instalación

```
+---------------------------------------------+
|  Agregar ConsorcIA a tu pantalla            |
+---------------------------------------------+
|  1. Abre consorcia.app en Chrome/Safari     |
|  2. Toca "Compartir" (iOS) o menu (Android) |
|  3. Selecciona "Agregar a pantalla de inicio"|
|  4. Listo! ConsorcIA funciona como app      |
+---------------------------------------------+
```

---

## 3. UX Móvil: Residente

### 3.1 Bottom Navigation

```
+---------------------------------------------+
|  ConsorcIA - Edificio Rivadavia 1234        |
+---------------------------------------------+
|                                             |
|  [Dashboard content]                        |
|                                             |
|                                             |
|                                             |
+---------------------------------------------+
|  Inicio  Expensas  Nuevo  Tickets  Chat     |
+---------------------------------------------+
```

### 3.2 Pantallas principales

#### Dashboard del Residente

```
+---------------------------------------------+
|  Ana Lopez          (2)                     |
+---------------------------------------------+
|  EXPENSA JULIO 2026                         |
|  +-------------------------------------+    |
|  |  Vence: 10/08/2026                  |    |
|  |  Monto: $59.168                     |    |
|  |  Estado: PENDIENTE                  |    |
|  |  [PAGAR AHORA]                      |    |
|  +-------------------------------------+    |
|                                             |
|  RESUMEN                                    |
|  - Ultimo pago: $59.168 (10/07)           |
|  - Saldo a favor: $0                      |
|  - Deuda total: $0                        |
|                                             |
|  NOTIFICACIONES                             |
|  - Asamblea: 15/08 - 19:00               |
|  - Ascensor en reparacion                 |
+---------------------------------------------+
```

#### Pago de Expensas

```
+---------------------------------------------+
|  Pagar Expensa                              |
+---------------------------------------------+
|  Expensa Julio 2026                         |
|  $59.168                                    |
|                                             |
|  METODO DE PAGO                             |
|  * MercadoPago                              |
|  o Transferencia bancaria                   |
|  o Efectivo (acercarse a admin)            |
|                                             |
|  [CONFIRMAR PAGO]                           |
|                                             |
|  Ver detalle del recibo                     |
+---------------------------------------------+
```

#### Nuevo Ticket

```
+---------------------------------------------+
|  Nuevo Ticket                               |
+---------------------------------------------+
|  Titulo *                                   |
|  [Fuga en bano principal...               ] |
|                                             |
|  Descripcion                                |
|  [El bano de mi departamento tiene...     ] |
|                                             |
|  Adjuntar foto                              |
|  [cam] [cam] [+]                            |
|                                             |
|  Prioridad                                  |
|  * Normal  o Urgente  o Emergencia         |
|                                             |
|  [ENVIAR TICKET]                            |
+---------------------------------------------+
```

---

## 4. UX Móvil: Administrador

### 4.1 Dashboard Admin (vista móvil)

```
+---------------------------------------------+
|  ConsorcIA              (3)                  |
+---------------------------------------------+
|  RESUMEN DEL MES                            |
|  +-------------+ +-------------+            |
|  |  $1.2M      | |  15         |            |
|  |  Gastos     | |  Tickets    |            |
|  +-------------+ +-------------+            |
|  +-------------+ +-------------+            |
|  |  3          | |  2          |            |
|  |  Deudores   | |  Vencen hoy |            |
|  +-------------+ +-------------+            |
|                                             |
|  ACCIONES URGENTES                          |
|  - 2 recibos vencen hoy                    |
|  - Ticket #45: "Fuga agua"                |
|  - Asamblea: falta quorum (5/20)          |
|                                             |
|  GRAFICO RAPIDO                             |
|  [Sparkline de gastos ultimos 6 meses]    |
+---------------------------------------------+
```

### 4.2 Acciones rápidas (FAB)

```
+---------------------------------------------+
|                                             |
|                                             |
|                    [+]                      |
|                   (FAB)                     |
|                                             |
+---------------------------------------------+

Al tocar FAB:
+---------------------------------------------+
|                                             |
|              [Nuevo Gasto]                  |
|              [Nueva Liquidacion]            |
|              [Nuevo Ticket]                 |
|              [Nueva Notificacion]           |
|                    [X]                      |
|                                             |
+---------------------------------------------+
```

---

## 5. Offline Support

### 5.1 Qué funciona sin conexión

| Funcionalidad | Offline | Sync |
|---------------|---------|------|
| Ver expensas | Si Cache | Auto |
| Ver tickets | Si Cache | Auto |
| Crear ticket | Si Draft | Al reconectar |
| Ver documentos | Si Cache | Auto |
| Chat | No | - |
| Pagar expensas | No | - |
| Dashboard admin | Si Cache | Auto |

### 5.2 Indicador de conexión

```tsx
function ConnectionStatus() {
  const isOnline = useOnlineStatus();

  if (!isOnline) {
    return (
      <div className="fixed top-0 left-0 right-0 bg-amber-500 text-white text-center text-sm py-1 z-50">
        Sin conexion. Los cambios se sincronizaran al reconectar.
      </div>
    );
  }

  return null;
}
```

### 5.3 Queue de acciones offline

```typescript
interface QueuedAction {
  id: string;
  type: 'CREATE_TICKET' | 'UPDATE_TICKET' | 'SEND_MESSAGE';
  payload: unknown;
  timestamp: Date;
}

class OfflineQueue {
  private queue: QueuedAction[] = [];

  add(action: Omit<QueuedAction, 'id' | 'timestamp'>) {
    this.queue.push({
      ...action,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    });
    this.persist();
  }

  async sync() {
    while (this.queue.length > 0) {
      const action = this.queue[0];
      try {
        await this.execute(action);
        this.queue.shift();
      } catch (error) {
        break;
      }
    }
    this.persist();
  }

  private persist() {
    localStorage.setItem('offline-queue', JSON.stringify(this.queue));
  }
}
```

---

## 6. React Native: Plan Fase 2

### 6.1 Arquitectura

```
consorcia-mobile/
├── src/
│   ├── components/          # Shared con web (logica)
│   ├── screens/             # Pantallas nativas
│   ├── navigation/          # React Navigation
│   ├── hooks/               # Hooks nativos (camara, biometria)
│   ├── stores/              # Mismos stores Zustand
│   ├── api/                 # Mismo cliente API
│   └── utils/               # Utilidades nativas
├── android/
├── ios/
└── package.json
```

### 6.2 Features nativas

| Feature | Libreria | Uso |
|---------|----------|-----|
| Push notifications | Firebase Cloud Messaging | Alertas de vencimiento, tickets |
| Biometria | react-native-biometrics | Login con huella/face ID |
| Camara | react-native-camera | Adjuntar fotos a tickets |
| Geolocalizacion | react-native-geolocation | Verificar ubicacion (encargado) |
| Deep links | react-navigation | Links de pago, tickets |

---

## 7. Performance en Movil

### 7.1 Optimizaciones

| Tecnica | Implementacion |
|---------|----------------|
| Lazy loading | React.lazy() para cada pantalla |
| Image optimization | WebP, lazy loading, placeholder blur |
| Virtual lists | react-window para listas largas |
| Code splitting | Chunks por ruta |
| Preload critical | link rel="preload" para fonts |
| Reduce motion | Respetar prefers-reduced-motion |

### 7.2 Métricas móviles

| Métrica | Target |
|---------|--------|
| First Contentful Paint | < 2s en 4G |
| Time to Interactive | < 4s en 4G |
| Bundle size | < 150KB inicial |
| Lighthouse PWA score | > 90 |

---

## 8. Decisiones de Diseño

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| PWA primero | Sobre app nativa | Menor costo, validacion rapida, un solo codebase |
| React Native Fase 2 | Sobre Flutter | Shared logic con web React. Equipo ya sabe React. |
| Bottom nav | En residente | Patron nativo de apps moviles. Familiaridad. |
| FAB | En admin movil | Acceso rapido a acciones frecuentes. |
| Offline queue | Draft + sync | Residentes pueden crear tickets sin conexion. |
| Service workers | NetworkFirst para API | Datos frescos, pero funcional sin conexion. |

---

*Documento relacionado:* [[PRD-07-01 Stack Frontend]]  
*Documento relacionado:* [[PRD-07-02 Diseño de Componentes]]  
*Documento relacionado:* [[PRD-07-03 Rutas y Navegacion]]
