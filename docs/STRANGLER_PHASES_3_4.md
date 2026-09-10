# Migración strangler — fases 3 y 4

Estas fases entregan a Preact las vistas que existían. Cada una se monta en un
hueco vacío del que Preact es dueño único: dentro no entra `innerHTML` ni
`appendChild` de nadie más, porque el reconciliador da por hecho que los nodos
que ve son los que él puso.

## Fase 3 — Componentes pequeños

| Vista | Componente | Hueco |
| --- | --- | --- |
| Barra de pestañas | `components/tabs/TabBar.tsx` · `TabItem.tsx` | `#tab-bar` |
| Barra de estado | `components/status/StatusBar.tsx` | `#statusbar` |
| Nombre y aviso | `components/status/DocumentTitle.tsx` · `Notice.tsx` | `#titlebar-file` |
| Aviso de actualización | `components/updates/UpdateBanner.tsx` | `#update` |
| Menú de recientes | `components/recent/RecentMenu.tsx` | el propio menú |
| Controles de ventana | `components/window/WindowControls.tsx` | `#window-controls` |

`mountComponent` da el mando imperativo que `main.ts` necesita mientras siga
siendo él quien sabe cuándo cambia algo: `update(props)` ocupa el sitio exacto
de lo que era `tabBar.render(...)`.

### Lo que se ha ganado

El teclado, sobre todo. No era un objetivo de la migración: es lo que aparece al
mirar de cerca vistas que se pintaban con cadenas.

- **Pestañas.** Eran `div`s con un manejador de clic delegado: no se llegaba a
  ellas tabulando ni había forma de recorrerlas. Ahora hay `tablist` con
  tabulación itinerante, flechas que dan la vuelta, Inicio, Fin y Supr.
- **Menú de recientes.** Se podía tabular hasta las filas pero no recorrerlas, y
  al cerrar con Escape el foco se quedaba dentro de un menú escondido.
- **Barra de estado.** El pie es un `contentinfo` y la posición del cursor lleva
  su etiqueta entera: «Ln 4, Col 9» leído en voz alta no dice nada.

### Un arreglo

«Más tarde» en el aviso de actualización descartaba la versión para siempre.
Ahora el aviso y el estado del documento son dos propiedades distintas, así que
guardar algo ya no borra a medias el aviso que estuviera puesto.

## Fase 4 — Paneles laterales

| Panel | Vista | Controlador |
| --- | --- | --- |
| Esquema | `components/outline/OutlineList.tsx` | `ui/outline.ts` |
| Apariencia | `components/settings/SettingsPanel.tsx` | `ui/settings.ts` |
| Explorador | `components/repositories/*` | `repositories/RepositoryController.ts` |

Los controladores conservan lo que no es pintar: el ancho y su arrastre, el
plegado del panel, el foco del filtro y —en el explorador— las llamadas al
backend y las vigilancias del disco.

```text
RepositoryPanel (vista)
      │ acción
      ▼
RepositoryController
      │
      ├── catálogo y documentos
      └── vigilancia recursiva por checkout
```

### Dos arreglos que aparecieron al mover

- **El esquema llevaba a donde el encabezado ya no estaba.** `refresh()`
  comparaba una firma de niveles y textos y, si coincidía, conservaba los
  encabezados de antes; pero escribir por encima mueve sus posiciones sin
  cambiar su texto. La firma existía para no reescribir el panel con
  `innerHTML` en cada pulsación, y con Preact deja de hacer falta.
- **El recuento del pie bailaba entre 2 y 3.** Venía de dos sitios: `refresh`
  pasaba los repositorios de GitHub y `setAccount` desde `main.ts` no pasaba
  nada, así que se usaba el total con las carpetas locales dentro.

## Criterios de salida

### Fase 3

- [x] Mismos estilos y comportamiento visual.
- [x] Navegación completa por teclado.
- [x] Estados accesibles mediante `aria-*`.
- [x] Se eliminan las implementaciones imperativas sustituidas.

### Fase 4

- [x] Expandir y filtrar no vuelve a consultar el backend. Lo plegado y lo
      buscado viven en el componente y no en el controlador, así que la vista no
      tiene forma de llamarlo. Comprobado contando invocaciones: cero.
- [x] Los watchers se liberan al cerrar. `dispose()` los detiene y las pruebas
      de interfaz siguen comprobándolo.
- [x] Una respuesta antigua no sobrescribe estado nuevo. Los dos contadores de
      generación —global y por repositorio— se mueven sin tocarlos.
- [x] El panel funciona con carpetas locales y repositorios.

## Probar componentes en Node

`--experimental-strip-types` quita los tipos pero no traduce JSX, así que ni los
componentes ni nada que los importe se puede cargar tal cual. `compile-tsx.mjs`
los compila con rolldown —el mismo que usa Vite— a archivos dentro del proyecto,
para que `preact` siga resolviéndose, y deja fuera del paquete a Preact para que
la prueba use el mismo módulo que el resto del proceso.
