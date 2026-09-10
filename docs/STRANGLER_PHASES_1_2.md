# Migración strangler — fases 1 y 2

Estas fases instalan Preact sin entregarle todavía ninguna vista existente y
crean la frontera de aplicación que usarán los componentes en los siguientes
cortes. `src/main.ts` permanece sin cambios.

## Fase 1 — Preact aislado

- `preact@10.29.8` está en dependencias de producción.
- `@preact/preset-vite@2.10.6` está en dependencias de desarrollo y registrado
  en `vite.config.ts`.
- TypeScript usa `react-jsx` con `preact` como `jsxImportSource`.
- `index.html` contiene un nodo vacío y oculto, `#preact-experiment`, y carga
  `src/app/mount.tsx` como una entrada separada del `main.ts` existente.
- El componente experimental sólo confirma el montaje. No posee UI de Unfold,
  no escucha eventos y no modifica el DOM administrado por `main.ts`.

### Comprobaciones

- `npm run dev` arrancó en `http://localhost:1420/`.
- La respuesta transformada de `mount.tsx` incluye el runtime Prefresh y
  `import.meta.hot.accept`, por lo que Fast Refresh/HMR está activo.
- `npm start` compiló y ejecutó `target/debug/unfold.exe`; se detuvo después de
  confirmar el arranque.
- El build de producción no contiene `__PREFRESH__`, `prefresh`, `jsxDEV`,
  `preact/debug`, `react-refresh`, `Preact DevTools` ni `@vite/client`.

El chunk de entrada pasa de la referencia de fase 0 (419,59 kB; 143,82 kB
gzip) a 430,70 kB; 148,36 kB gzip. La diferencia es el runtime de Preact que
usa el montaje experimental, no herramientas de desarrollo.

## Fase 2 — Frontera de aplicación

```text
Componentes Preact
       │ estado + AppActions
       ▼
 AppController ── AppStore
       │
       ├── DocumentService
       ├── PersistenceService
       ├── RepositoryService
       └── GithubService
```

### Responsabilidades

- `AppState` define pestañas resumidas, documento activo, paneles, GitHub y
  avisos; no contiene objetos del DOM ni de CodeMirror.
- `AppStore` implementa únicamente lectura, actualización y suscripción. No se
  incorpora Redux, Zustand ni otro estado global.
- `AppController` implementa `AppActions`, mantiene el contenido interno de las
  pestañas y coordina servicios inyectados.
- `documentChanged` y `setConflict` son los futuros puentes imperativos desde
  CodeMirror y el watcher.
- Los servicios son puertos sin dependencia de Preact. Sus adaptadores actuales
  encapsulan archivos, sesión y GitHub; publicación conserva un adaptador de
  alto nivel para que el diálogo imperativo siga siendo dueño de la revisión.
- Sólo el controlador convierte excepciones técnicas en `Notice` para la UI.
  Los detalles permanecen en consola para diagnóstico.
- La persistencia se serializa y el guardado compara el snapshot escrito con el
  contenido actual; una edición que llega durante una escritura sigue marcada
  como pendiente.

### Prueba sin DOM

`test-app-controller.mjs` importa y usa el controlador con `document` ausente e
inyecta dobles en memoria. Sus 26 aserciones cubren:

- estado inicial y notificaciones;
- apertura, deduplicación y sustitución del borrador vacío;
- edición y guardado como;
- cambios que llegan durante un guardado lento;
- creación, activación y cierre con decisión inyectada;
- publicación con y sin ruta;
- paneles, estado de GitHub y persistencia;
- restauración con índice activo fuera de rango.

## Criterios de salida

- [x] HMR de Preact activo en desarrollo.
- [x] Aplicación Tauri compilada y abierta mediante `npm start`.
- [x] Build, lint y pruebas en verde.
- [x] Build de producción sin herramientas de desarrollo.
- [x] `src/main.ts` sin cambios.
- [x] Controlador comprobable sin DOM y servicios inyectables sin Preact.
