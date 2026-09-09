# GitHub — fase 3

Explorador e integración. La fase 2 dejó los repositorios en el disco y los
documentos localizables, pero sólo desde dentro de un diálogo modal. Ésta los
saca a una barra lateral, con árbol, búsqueda e indicadores de estado.

Continúa desde [GITHUB_PHASE_2.md](GITHUB_PHASE_2.md).

## Qué entra en esta fase

- Barra lateral de repositorios.
- Árbol de carpetas.
- Búsqueda por nombre de archivo.
- Apertura en pestañas.
- Indicadores de modificado, sincronizado y conflicto.

## El hueco de la izquierda

El panel no se añade al lado del esquema: comparte su hueco, y sólo uno de los
dos está desplegado a la vez. La ventana puede bajar a 480 px de ancho y dos
paneles de 250 px dejarían menos sitio para escribir que para navegar, que en
un editor es exactamente al revés de lo que debe ser.

Abrir uno pliega el otro. Cada uno recuerda su ancho por separado y ambos
conservan su estado entre sesiones.

`Ctrl+Shift+B` lo abre y lo cierra. **No `Ctrl+Shift+R`**, que era el atajo
natural: wry deja activos los aceleradores de navegador de WebView2
(`browser_accelerator_keys` vale `true` por omisión y Tauri no lo cambia), así
que `Ctrl+R`, `F5` y `Ctrl+Shift+R` recargan la ventana entera. Un atajo que a
veces reinicia la aplicación no es un atajo.

## Árbol de carpetas

El backend sigue devolviendo la lista plana de rutas relativas que ya devolvía;
el árbol se arma en la interfaz. No hacía falta cambiar el escaneo, y así el
mismo dato sirve para el árbol y para la búsqueda.

Las carpetas empiezan desplegadas. Un repositorio de documentación suele ser
poco profundo, y llegar a un archivo abriendo cuatro niveles a mano es peor que
desplazarse.

## Búsqueda por nombre

Con el filtro vacío se ve el árbol; en cuanto se escribe algo, la lista pasa a
ser plana, con la carpeta de cada resultado a la derecha. Filtrar el árbol
conservando las ramas obliga a leer la jerarquía entera para encontrar dos
archivos: cuando ya se sabe el nombre, lo que se quiere es la lista.

La comparación ignora mayúsculas **y tildes**. Sin eso, teclear «guia» no
encontraría «guía», que es justo lo que uno escribe con prisa.

La búsqueda cruza todos los repositorios conectados, no sólo el desplegado. Por
eso el panel pide los documentos de todos al refrescar: filtrar sólo lo abierto
escondería resultados sin ninguna razón visible.

## Apertura en pestañas

Un documento del repositorio es un archivo del disco y entra por el mismo
camino que cualquier otro, así que hereda pestañas, sesión, recientes, copias
automáticas y vigilancia de cambios sin una línea de más. `Tabs.open` ya
reutilizaba la pestaña que tuviera esa ruta, de modo que abrir dos veces el
mismo documento cambia a su pestaña en vez de duplicarla.

El documento que está en pantalla se marca en el árbol, y la marca se actualiza
también cuando se cambia de pestaña desde la barra superior.

## Indicadores

Por documento, cuatro estados que salen de un único recorrido de `git status`:

| Estado | Marca | Significado |
| --- | --- | --- |
| Sincronizado | sin punto | Igual que en el último commit |
| Nuevo | punto hueco | Todavía no está en Git |
| Modificado | punto en color de acento | Confirmado antes, con cambios encima |
| Conflicto | punto rojo con halo | Fusión sin resolver |

Lo sincronizado no lleva marca a propósito: es el caso mayoritario, y darle un
punto igual que a los demás quita fuerza a los que sí piden atención.

Los estados finos de Git —renombrado, cambio de tipo, borrado en el índice—
caen todos en «modificado». Desde el punto de vista de quien escribe dicen lo
mismo: hay algo que no está confirmado.

El estado se calcula con un solo `statuses()` por repositorio y se busca en un
mapa. Preguntarlo archivo por archivo con `status_file` obliga a Git a recorrer
el árbol en cada llamada, y en un repositorio con cientos de documentos eso se
nota al abrir el panel.

### Sincronizado a nivel de repositorio

Bajo el nombre de cada repositorio va una línea con la rama y lo que esté
pendiente: cuántos archivos sin confirmar, cuántos commits sin publicar y
cuántos sin traer. Si no hay nada de eso, dice «sincronizado».

Los dos últimos números son nuevos en esta fase: `checkout_state` compara
`HEAD` con `refs/remotes/origin/<rama>` y devuelve el adelanto y el retraso.
Cuando no hay referencia remota conocida no se inventa un cero, se dice «sin
remoto»: afirmar que algo está sincronizado sin tener con qué compararlo sería
mentir en el sitio donde más caro sale.

### «Conflicto» aquí y en la barra de conflicto

Son dos cosas distintas y conviene no confundirlas. El punto rojo del
explorador es un conflicto **de Git**: una fusión sin resolver en el índice. La
barra que ya existía en la parte de arriba avisa de otra cosa —el archivo
cambió en el disco mientras había cambios sin guardar en el editor— y no tiene
que ver con Git. Esta fase no las junta.

## Cuándo se refresca

- Al abrir el panel.
- Con su botón de actualizar.
- Al guardar, si el archivo pertenece a un repositorio y el panel está abierto:
  guardar cambia el estado en Git, y sin releer el punto se queda mintiendo.
- Al conectar, desconectar o traer cambios desde el diálogo de GitHub.

No hay vigilancia continua del árbol del repositorio. Un cambio hecho fuera de
Unfold no mueve los indicadores hasta el siguiente refresco; el botón está ahí
para eso, y montar un vigilante recursivo sobre un repositorio entero cuesta
bastante más de lo que esta fase pide.

## Pruebas

`cargo test` — 20 correctas, 2 nuevas:

- los cuatro estados se distinguen sobre el mismo checkout: sincronizado recién
  clonado, nuevo sin añadir, modificado con cambios encima y conflicto de
  verdad, provocando una fusión que choca y comprobando que el índice queda con
  conflictos;
- el adelanto y el retraso se cuentan bien: cero recién clonado, uno por
  delante con un commit propio, y uno por delante y uno por detrás cuando el
  remoto también avanza.

`npm test` — 88 correctas, sin cambios. `npm run build` y
`cargo clippy --lib --tests` sin avisos.

### Lo que no está cubierto por pruebas

Todo el panel: el árbol, el filtro, la sangría, la exclusión mutua con el
esquema y la marca del documento activo. El proyecto no tiene banco de pruebas
de interfaz —sus 88 pruebas son de lógica pura, sin DOM— y montar uno para esta
fase habría sido más trabajo que la fase entera. Se comprueban por tipos, por
compilación y a mano.

## Criterios de salida

- [x] Barra lateral propia, plegable y ajustable, que comparte hueco con el
      esquema.
- [x] Árbol de carpetas armado desde las rutas del repositorio.
- [x] Búsqueda por nombre, insensible a mayúsculas y tildes, cruzando todos los
      repositorios conectados.
- [x] Los documentos se abren en pestañas y reutilizan la que ya estuviera
      abierta.
- [x] Indicadores de sincronizado, modificado, nuevo y conflicto por documento,
      y resumen de estado por repositorio.

## Siguiente

Publicar: confirmar y subir desde Unfold. Es lo que le da salida a los puntos
de «modificado» que esta fase acaba de poner en pantalla, lo que hace relajable
la regla de la fase 2 de no borrar lo irrecuperable, y lo que le da sentido al
permiso de escritura que la fase 1 ya sabe leer.
