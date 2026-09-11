# Rendimiento y accesibilidad

## Línea base de la Fase 9

Medición local con `npm run build` en septiembre de 2026:

| Métrica | Antes de la carga diferida | Actual |
| --- | ---: | ---: |
| JavaScript inicial | ~435.700 bytes | 409.855 bytes |
| JavaScript inicial comprimido | ~152 KB gzip | 143 KB gzip |
| Tiempo de build local | ~1,1 s | 2,35 s* |

La primera cifra corresponde al último bundle generado antes de diferir los
diálogos de GitHub; la reducción es de aproximadamente 5,9 %. El tiempo de
build depende de la caché y del equipo, por eso no se usa como tiempo de inicio
de la aplicación. GitHub (`~16 KB`) y Mermaid (`~94 KB`) aparecen ahora en
chunks separados y se solicitan sólo al utilizarlos.

## Auditoría rápida

- Los overlays declaran `role`, `aria-modal`, nombre accesible y foco atrapado.
- Escape cierra el overlay superior y restaura el foco anterior.
- El conflicto se anuncia como `role="alert"`.
- Campos y controles iconográficos del panel de búsqueda tienen nombres
  accesibles.
- Paneles plegados usan `inert` para quedar fuera del teclado y del árbol de
  accesibilidad.

\* El tiempo incluye la generación completa del bundle y no es comparable
directamente con una medición de arranque en producción.
