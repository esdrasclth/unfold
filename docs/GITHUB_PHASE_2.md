# GitHub — fase 2

Repositorios locales. La fase 1 dejó la sesión y la lista de lo que GitHub
concede; ésta baja esa lista al disco: clona, la anota, encuentra los
documentos y los vuelve a encontrar después de reiniciar.

Continúa desde [GITHUB_PHASE_1.md](GITHUB_PHASE_1.md).

## Qué entra en esta fase

- Conectar y desconectar repositorios.
- Clone y fetch.
- Persistir el catálogo.
- Escanear archivos `.md`.
- Restaurar los repositorios al reiniciar.

Publicar sigue fuera: se puede leer y editar, pero lo que se escriba todavía no
sale del equipo. Eso condiciona varias decisiones de aquí, y se dice en cada
una.

## En disco

Exactamente la forma que fijó la fase 0, con las rutas pedidas a la API de
directorios de Tauri y no compuestas a mano:

```text
%LOCALAPPDATA%\com.esdras.unfold\
├── repositories\<id numérico de GitHub>\   checkout completo
└── github-repositories.json                catálogo
```

La carpeta se nombra con el ID numérico de GitHub. Además de sobrevivir a
renombrados y forks, como decía la fase 0, tiene una consecuencia de seguridad
que conviene dejar escrita: la ruta se construye a partir de un `u64`, así que
no hay ningún nombre de repositorio capaz de salirse de la carpeta.

El catálogo guarda ID, `owner/nombre`, rama predeterminada, URL de clonado, si
es privado, si hay permiso de escritura, la ruta local y el último uso. Nada
más. Hay una prueba que lee el archivo escrito y falla si aparece cualquier
cosa que suene a credencial, incluida una URL con usuario incrustado.

## Por qué el catálogo no depende de la sesión

Es un archivo local y se lee sin token y sin red. De ahí salen tres cosas que
no son casualidad:

- al reiniciar, los repositorios siguen ahí sin hablar con GitHub;
- sin conexión se pueden abrir igual los documentos ya clonados;
- si la sesión caduca o se cierra, no se pierde el acceso a lo que ya está en
  el disco.

Por eso el diálogo pide primero el catálogo y después el estado de la sesión, y
sigue enseñando los repositorios conectados aunque lo segundo falle.

Se escribe entero, a un temporal, y se renombra encima. En Windows ese
renombrado es atómico: si Unfold se cierra a media escritura, en disco queda el
catálogo anterior completo y nunca uno cortado.

Si el JSON llega dañado no se borra: se aparta como
`github-repositories.json.dañado` y se empieza de cero. Perder el catálogo sólo
obliga a volver a conectar, pero los checkouts siguen ahí y quien quiera
rescatar algo tiene el original a mano.

## Conectar

`github_connect_repository` recibe sólo un ID. El descriptor —URL, rama,
permisos— no lo pone el frontend, sino la lista de concesiones vigentes que
devuelve GitHub en ese mismo momento. Así lo único clonable es algo que la
GitHub App tenga concedido ahora, y no lo que hubiera en pantalla hace un rato.

Si la carpeta de destino ya existe y es un clon del mismo remoto, se adopta en
vez de fallar. No es un adorno: si la aplicación se cierra entre el clone y la
escritura del catálogo, o si el catálogo se pierde, la carpeta se queda ahí, y
sin adopción reconectar fallaría para siempre. Si la carpeta existe pero apunta
a otro remoto, se dice y no se toca.

Un clone que falla a medias deja una carpeta que impediría el siguiente
intento, así que se limpia antes de contar el error.

El avance se manda a la ventana por eventos, con un tope de uno cada 120 ms:
libgit2 avisa por cada objeto y una barra de progreso no necesita diez mil
avisos.

## Traer cambios

`fetch` trae la rama y adelanta el checkout sólo cuando puede hacerlo sin
inventarse nada. Devuelve cuál de los cinco casos ocurrió: al día, adelantado,
con cambios sin confirmar, divergente, o el remoto ya no publica esa rama.

Fusionar de verdad no entra aquí. Mientras Unfold no sepa publicar, un árbol
divergente se deja intacto y se cuenta lo que pasa; resolverlo es trabajo para
Git, y decirlo es más honesto que intentar una fusión que nadie pidió.

Dos detalles que costó encontrar:

**El orden del avance rápido.** El checkout va primero, con `HEAD` todavía en
el commit viejo, y sólo después se mueve la rama. Al revés —que es como suele
escribirse— el índice queda como una base obsoleta, un checkout seguro se niega
a tocarlo, y el repositorio se queda para siempre enseñando archivos que
parecen borrados del índice sin que nadie los borrara. Hay una prueba que
comprueba que después de avanzar no queda ningún cambio pendiente.

**Seguro y no forzado.** El árbol se comprueba limpio antes de moverlo, pero un
archivo sin seguir puede llamarse igual que uno que llega. Con checkout forzado
se lo lleva por delante; con checkout seguro sale un error. Se prefiere el
error.

Lo que sí se deja pasar son los archivos sin seguir que no chocan: casi todo el
mundo tiene alguno suelto, y bloquear por eso haría que traer cambios fallara
siempre.

## Desconectar

Son dos decisiones separadas, como fijó la fase 0: quitar del catálogo y borrar
la copia. El diálogo ofrece las dos por separado y ninguna es la predeterminada
silenciosa.

Borrar se niega mientras haya cambios sin confirmar, y dice cuántos. Unfold
todavía no sabe publicar, así que cualquier cambio local es irrecuperable y no
puede desaparecer detrás de un botón de desconectar. Cuando la fase 3 sepa
publicar, esta regla se podrá relajar.

## Escanear documentos

Se recorre el árbol de trabajo, no el índice como hacía la sonda de la fase 0.
Quien acaba de escribir un documento espera verlo en la lista aunque no lo haya
añadido a Git todavía; lo que aporta el índice es la marca «sin añadir» que
lleva cada uno.

- Sólo `.md` y `.markdown`. `.txt` se queda fuera aunque el diálogo de abrir lo
  acepte: en un repositorio cualquiera los `.txt` son licencias, requisitos y
  datos de prueba, y llenarían la lista de ruido.
- Se salta `.git` y todo lo que el repositorio ignore, que es lo que evita
  recorrer `node_modules` y compañía.
- Se salta cualquier enlace simbólico: uno que apunte a un directorio padre
  convertiría el recorrido en un bucle infinito.

Abrir un documento no tiene nada de especial: es un archivo del disco y entra
por el mismo camino que cualquier otro, así que hereda pestañas, sesión,
recientes, copias automáticas y vigilancia de cambios sin una línea de más.

## Interfaz

El diálogo de GitHub pasa a tener tres bloques: la cuenta, los repositorios
conectados y los que se pueden conectar. Cada repositorio conectado se despliega
para enseñar sus documentos y trae sus tres acciones —traer cambios, ver en
GitHub, desconectar— junto a su rama y sus cambios pendientes.

El botón de la barra se enciende también cuando hay repositorios conectados sin
sesión abierta, porque en ese estado Unfold sigue siendo útil.

## Reorganización del código

`git_probe.rs` era la sonda de la fase 0 y pasa a ser `git.rs`, el motor real:
sin comandos de Tauri, sólo operaciones sobre un repositorio. Los tres comandos
`git_probe_*` dejan de estar expuestos a la ventana; los sustituyen los seis de
`repositories.rs`, que es quien tiene el catálogo.

`examples/github_probe.rs` sigue existiendo y se reescribió contra la API
nueva, porque hace algo que las pruebas no pueden: hablar con un remoto HTTPS
de verdad. Ver más abajo.

## Pruebas

`cargo test` — 18 correctas, 11 nuevas en esta fase.

Del motor Git, contra remotos locales creados en el momento:

- el escaneo recorre el árbol de trabajo, encuentra un documento nuevo sin
  añadir, respeta `.gitignore` y deja fuera los `.txt`;
- un checkout limpio avanza, el archivo aparece, el índice queda al día y el
  segundo intento dice que ya estaba al día;
- un checkout con cambios sin confirmar no se toca, y se comprueba que el
  contenido nuevo no llegó;
- un archivo sin seguir no bloquea el avance;
- una historia divergente se informa y no se fusiona;
- `origin` identifica un checkout ya clonado.

Del catálogo:

- ida y vuelta a disco sin dejar temporales;
- un catálogo ausente se lee como vacío;
- uno dañado se aparta bajo otro nombre en vez de perderse;
- reconectar actualiza la entrada en vez de duplicarla;
- la ruta se construye desde el ID numérico;
- el archivo escrito no contiene nada que suene a credencial.

`npm test` — 88 correctas, sin cambios. `npm run build` correcto y
`cargo clippy --all-targets` sin avisos.

### Lo que las pruebas no pueden cubrir

libgit2 clona las rutas locales copiando los objetos, sin pasar por el
transporte de red. El progreso de descarga y el helper de credenciales no
llegan a ejercitarse en ninguna prueba automática. Para eso está
`cargo run --example github_probe -- <url https>`, que clona un remoto de
verdad e imprime el avance, los documentos encontrados y el resultado de un
fetch. Es verificación manual, no automática.

Tampoco se prueban solos `github_connect_repository` ni la adopción de una
carpeta existente, porque ambos empiezan pidiéndole a GitHub la lista de
concesiones.

### Validación manual del motor

La sonda se ejecutó contra `esdrasclth/unfold-github-spike`, el repositorio
privado de la fase 0:

```text
libgit2 1.9.7
descargando… 16% … 100%
clonado: rama=Some("main") head=Some("56198107a38fc64b198b07bce1a2472311f7b424") cambios=0
  seguido  README.md
  seguido  unfold-phase-0.md
fetch: UpToDate
con un borrador: cambios=1
```

Queda comprobado lo que las pruebas no alcanzan: el clone autenticado por HTTPS
con el helper de credenciales, el progreso de descarga, y que el `HEAD` clonado
es el mismo commit que registró la fase 0. El escaneo encuentra los dos
documentos y los marca como seguidos, el fetch dice que no hay nada nuevo, y un
borrador sin añadir aparece en el recuento de cambios, que es lo que después
bloquea el borrado al desconectar.

## Criterios de salida

- [x] Conectar clona en el almacén y anota el repositorio.
- [x] Desconectar separa quitar del catálogo de borrar la copia, y protege los
      cambios sin confirmar.
- [x] Traer cambios adelanta lo que puede y explica lo que no.
- [x] El catálogo sobrevive a reiniciar y no depende de la sesión ni de la red.
- [x] Los documentos `.md` del repositorio se listan y se abren en pestañas.

## Siguiente

Fase 3: el explorador. Sacar los repositorios del diálogo y ponerlos en una
barra lateral con árbol de carpetas, búsqueda por nombre e indicadores de
estado. Ver [GITHUB_PHASE_3.md](GITHUB_PHASE_3.md).

Publicar queda para después. Hasta entonces siguen valiendo las dos reglas que
esta fase dejó puestas: no se borra una copia con cambios sin confirmar, y un
árbol divergente no se toca.
