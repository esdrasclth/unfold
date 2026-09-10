# Migración strangler — fase 0

Esta línea base fija el comportamiento que debe conservarse mientras Preact
reemplaza el DOM visible. CodeMirror, Tauri y la lógica de negocio siguen fuera
de los componentes declarativos.

## Punto de referencia

- Fecha: 9 de septiembre de 2026.
- Commit de partida: `41828f97ae5d715415b5dd51dabde1849b73816b`.
- Versión: `0.5.2`.
- Entorno: Windows, Node `22.14.0`, npm `10.5.0`, Rust `1.98.1` y Cargo `1.98.1`.
- El árbol estaba limpio antes de comenzar la fase.

### Resultados guardados

| Comando | Resultado en el commit de partida | Resultado al cerrar la fase 0 |
| --- | --- | --- |
| `npm run lint` | correcto, sin diagnósticos | correcto, sin diagnósticos |
| `npm test` | 216 comprobaciones correctas | 244 comprobaciones correctas |
| `npm run build` | correcto | correcto; 2.276 módulos transformados |
| `cargo test` | no medido antes del cambio | 48 correctas, 0 fallos |
| `cargo clippy --lib --tests -- -D warnings` | no medido antes del cambio | correcto, sin diagnósticos |

`cargo test` muestra en esta máquina el aviso informativo `linker stdout` al
crear las bibliotecas de importación de Windows. Clippy con avisos tratados como
errores queda limpio.

### Tamaño de referencia

Vite genera el nombre con hash en cada build. La referencia es el chunk
`index-*.js` que carga `dist/index.html`, no los parsers de Mermaid que se
descargan de forma diferida.

| Artefacto | Sin comprimir | gzip |
| --- | ---: | ---: |
| Chunk principal `index-*.js` | 419,59 kB | 143,82 kB |

La hoja principal `index-*.css` mide 53,71 kB (10,22 kB gzip). `dist` está
ignorado por Git y se regenera con `npm run build`. Vite mantiene su aviso de
tamaño para uno de los chunks generados; es parte de esta línea base, no un
fallo del build.

## Flujos críticos de aceptación

Las siguientes recetas son el contrato manual para cada corte del strangler.
Se ejecutan en la aplicación Tauri, con una carpeta temporal y un repositorio
de GitHub desechable. Los archivos se observan además desde otro editor para no
confundir el estado de la vista con el estado real del disco.

### Abrir y guardar

1. Crear fuera de Unfold un `.md` con contenido reconocible y abrirlo con
   `Ctrl+O`.
2. Comprobar nombre, contenido y pestaña activa; volver a abrir la misma ruta no
   debe crear otra pestaña.
3. Editar y pulsar `Ctrl+S`; el indicador de cambios desaparece y el archivo en
   disco contiene exactamente el texto visible.
4. En un documento nuevo, cancelar «Guardar como»: debe seguir abierto, sucio y
   sin ruta. Repetir provocando un fallo de escritura: no debe perder contenido.

Protección automática: `test-files.mjs`, `test-save.mjs` y `test-tabs.mjs`.

### Autosave

1. Editar un archivo existente y dejar de escribir durante más de un segundo.
   El archivo debe actualizarse y la pestaña quedar limpia.
2. Escribir de nuevo mientras una escritura lenta sigue pendiente. El guardado
   sólo limpia la pestaña si el texto guardado aún coincide con el visible; los
   cambios posteriores permanecen marcados y se guardan en el siguiente ciclo.
3. Cambiar de pestaña antes de que venza el segundo. El documento que se deja
   debe guardarse antes del cambio.
4. Confirmar que un documento nuevo y un documento en conflicto no se guardan
   silenciosamente.

Protección automática: `test-save.mjs` caracteriza el snapshot asíncrono y
`test-watcher.mjs` caracteriza la exclusión durante conflictos. El temporizador
de un segundo y su integración con Tauri siguen en esta receta de aceptación.

### Cambiar y cerrar pestañas

1. Abrir tres documentos, dejar selecciones y posiciones de scroll distintas y
   recorrerlos con clic y `Ctrl+Tab`; cada uno debe recuperar texto, selección,
   undo y scroll propios.
2. Cerrar una pestaña inactiva: la activa no cambia. Cerrar la activa: se elige
   la de la derecha o, si no existe, la de la izquierda.
3. Cerrar un borrador sucio y recorrer «Guardar», «Descartar» y «Cancelar».
4. Cerrar la última pestaña: la ventana conserva un editor nuevo vacío.
5. Cerrar la ventana con varias pestañas sucias: todas se revisan antes de
   destruirla y cancelar en cualquiera aborta el cierre.

Protección automática: `test-tabs.mjs`, `test-save.mjs`, `test-session.mjs` y
las pruebas de barra de pestañas de `test-ui.mjs`. El diálogo al cerrar la
ventana es una integración Tauri cubierta por la receta manual.

### Conflicto externo

1. Con el archivo limpio, modificarlo desde otro editor: Unfold lo recarga sin
   preguntar y avisa.
2. Con cambios locales sin guardar, modificarlo de nuevo fuera: aparece la
   barra de conflicto y se detiene el autosave.
3. Elegir «Cargar la versión del disco»: se adopta el contenido externo y queda
   limpio.
4. Repetir y elegir «Mantener la mía»: se oculta el conflicto y se programa el
   guardado local.
5. Cambiar de pestaña con un conflicto pendiente y volver: el conflicto debe
   pertenecer sólo a su pestaña.

Protección automática: `test-watcher.mjs` cubre autoescrituras, conflicto,
eventos obsoletos, cambio de ruta y cierre del watcher.

### Restaurar sesión

1. Dejar abiertos un archivo limpio, uno sucio y un borrador sin ruta; elegir
   como activa una pestaña que no sea la primera y cerrar la ventana.
2. Cambiar en disco el archivo limpio y volver a abrir Unfold.
3. El limpio debe releerse del disco; el sucio y el borrador deben conservar el
   snapshot local. También se restauran pestaña activa, selección y scroll.
4. Corromper la sesión guardada en un entorno de prueba: el arranque debe caer
   en un editor utilizable, no bloquearse.

Protección automática: `test-session.mjs` cubre persistencia, versiones,
corrupción y fallos; `test-tabs.mjs` cubre restauración y límites de selección y
scroll.

### Buscar documentos

1. Conectar una carpeta o repositorio que contenga coincidencias en nombre y
contenido, mayúsculas distintas, puntuación y una línea muy larga.
2. Buscar desde la paleta, verificar fragmentos y números de línea, y abrir un
resultado. Debe activarse el documento y la línea correspondiente.
3. Una consulta vacía no busca; una búsqueda sin resultados deja un estado
   vacío comprensible y una búsqueda anterior que termine tarde no reemplaza la
   más reciente.

Protección automática: cinco pruebas Rust de `search.rs` cubren coincidencia,
posición, mayúsculas, puntuación y límites. `test-ui.mjs` protege los estados DOM
de los paneles; la navegación completa se conserva como aceptación manual.

### Conectar, confirmar y publicar en GitHub

1. Sin sesión, iniciar el device flow, autorizar el código en GitHub y comprobar
   identidad y repositorios disponibles. Cancelar no debe dejar un diálogo
   bloqueado.
2. Conectar un repositorio desechable y abrir un documento desde su explorador.
3. Modificar, abrir «Publicar», revisar el diff, desmarcar un archivo y escribir
   el mensaje. El commit debe contener exactamente lo marcado.
4. Publicar y verificar desde GitHub que rama, autor, mensaje y contenido son
   correctos; el estado local queda sin commits pendientes.
5. Cambiar un archivo después de revisar el diff: la huella debe impedir el
   commit. Avanzar el remoto antes del push: el commit local queda a salvo y la
   divergencia se explica sin intentar fusionar.

Protección automática: 48 pruebas Rust cubren autenticación transformada,
catálogo, estado, diff, huellas, selección, identidad, commit, fetch y rechazo
de push. `test-ui.mjs` cubre diálogo, selección, diff y progreso. El device flow
y el push contra el servicio real siguen siendo aceptación manual porque
requieren credenciales y red.

## Riesgo corregido antes de migrar `onChange`

El historial lanzaba escrituras sin esperar. Si el almacenamiento terminaba una
escritura antigua después de una nueva, el archivo podía quedar con el snapshot
viejo. Ahora las escrituras pasan por una cola: conservan el orden en que se
registraron y un fallo consumido no impide las siguientes. Cuatro aserciones
nuevas reproducen el caso con un almacén deliberadamente lento.

## Criterio de salida

- [x] Línea base de lint, pruebas, build y tamaño registrada.
- [x] Flujos críticos convertidos en recetas de aceptación repetibles.
- [x] Pestañas y restauración caracterizadas con 24 aserciones nuevas.
- [x] Concurrencia del historial serializada y caracterizada con 4 aserciones.
- [x] Validaciones automáticas en verde.
- [ ] Crear el commit de fase 0 y comprobar entonces `git status` vacío.

No se debe empezar el montaje de Preact hasta cerrar el último punto. El commit
queda deliberadamente en manos de quien mantiene el repositorio para que pueda
elegir si la corrección de historial va en una PR independiente.
