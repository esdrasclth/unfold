# GitHub — fase 4

Commit y push. Las fases anteriores dejaron los documentos en el disco y sus
cambios en pantalla; ésta les da salida. Es la primera vez que Unfold escribe
algo fuera del equipo.

Continúa desde [GITHUB_PHASE_3.md](GITHUB_PHASE_3.md).

## Qué entra en esta fase

- Vista de cambios.
- Selección de archivos.
- Mensaje de commit.
- Commit y push.
- Sincronización antes de publicar.
- Tratamiento de errores y conflictos.
- Identidad del autor y correo `noreply` cuando corresponde.

## Vista de cambios

Entra **cualquier extensión**, no sólo Markdown. El explorador de la fase 3
lista `.md` porque es lo que Unfold abre, pero una vista de cambios que
escondiera parte de lo pendiente sería peligrosa: quien va a confirmar tiene que
ver todo lo que hay, aunque no pueda editarlo aquí.

Todo empieza marcado. Lo normal es querer publicarlo entero, y desmarcar lo que
sobra es menos trabajo que marcar lo que falta.

## El índice se devuelve a HEAD antes de confirmar

Es la decisión menos obvia de la fase y conviene entenderla.

`commit` no añade la selección encima del índice tal como esté: primero lo
devuelve a `HEAD` y después añade sólo lo marcado. Sin ese paso, cualquier cosa
preparada antes desde la línea de órdenes entraría en el commit sin haber
aparecido marcada en pantalla, y la vista de cambios estaría prometiendo algo
que no cumple.

El precio es que se pierden las marcas de preparado previas. No se pierde
contenido: lo que no entra en el commit sigue en el árbol de trabajo, y la
propia vista lo vuelve a listar como pendiente. Hay una prueba que fija las dos
mitades.

## Sincronización antes de publicar

El orden es commit → sincronizar → push, y es el único que funciona sin saber
fusionar. Confirmar primero es lo que deja el árbol limpio para poder
adelantarlo hasta el remoto; sincronizar antes serviría de poco, porque los
archivos que se van a confirmar son justamente los que bloquean el avance.

Con el árbol ya limpio, `fetch` adelanta el checkout si sólo está por detrás. Si
el remoto avanzó **y** hay commits locales, la historia ha divergido y ahí se
para: el commit queda hecho y a salvo, y el aviso dice que hay que integrar los
cambios con Git.

**Ese es el límite conocido de esta fase.** Unfold no fusiona ni rebasa. Se da
cuando alguien publica en la misma rama entre tu última sincronización y tu
publicación. La alternativa —intentar una fusión automática— traería conflictos
que esta versión tampoco sabría resolver, así que se prefiere pararse y
decirlo.

## Reintentar no vuelve a confirmar

Si el push falla, el commit ya existe. Volver a llamar a `github_publish` con la
misma selección apilaría un commit vacío encima, así que el reintento va por
`github_push_pending`, que sincroniza y publica sin crear nada.

De paso, ese mismo comando le da salida al «N sin publicar» que la fase 3 puso
en el panel: un repositorio con commits hechos y sin subir ahora tiene un botón
que los sube.

## Tratamiento de errores

Un push puede terminar **bien** a ojos del transporte y aun así ser rechazado
por el servidor, que manda su explicación en el estado de cada referencia. Si
eso se perdiera, publicar diría que fue bien sin haber publicado nada. `push`
captura ese estado y por eso devuelve `String` en vez del error de libgit2.

Los códigos de GitHub son precisos pero mudos para quien no los conoce, así que
se traducen a algo accionable:

| Señal | Qué se dice |
| --- | --- |
| `GH007` | El correo de autor es privado; vuelve a publicar marcando el `noreply` |
| `GH006` o «protected branch» | La rama está protegida y no admite publicar directamente |
| «non-fast-forward», «fastforward», «fetch first» | Alguien publicó mientras tanto; el commit está guardado, reintenta |
| `401` o «authentication» | GitHub no aceptó las credenciales |
| cualquier otra | Se cuenta tal cual, sin inventar un motivo |

Las tres redacciones del rechazo por no poder avanzar están ahí porque son
tres: la del servidor de GitHub, la de Git y la de libgit2 cuando se niega él
mismo antes de salir a la red. La prueba las recorre las tres.

Además, antes de tocar nada:

- un índice con conflictos detiene la publicación, porque confirmar guardaría
  las marcas de conflicto dentro del commit;
- un repositorio sin permiso de escritura se rechaza aquí, sin llegar a la red.

Cuando algo se queda a medias, el informe lo dice paso por paso. `PublishReport`
no es un `Result` a propósito: el commit puede existir aunque el push falle, y
esconderlo detrás de un error haría creer que no se confirmó nada. El aviso
empieza por «El commit se creó, pero…», que cambia por completo cómo se lee.

## Identidad del autor

Manda `user.name` y `user.email` de la configuración de Git cuando existen. Es
lo que hace cualquier otra herramienta, y cambiarlo por detrás sería una
sorpresa desagradable en algo que queda escrito en el commit para siempre.

Si no hay ninguna —una máquina recién estrenada—, se compone con la cuenta de
GitHub y su dirección `noreply`, `<id>+<login>@users.noreply.github.com`, en vez
de fallar con un «dime quién eres». GitHub la acepta siempre como autor y la
enlaza con el perfil sin publicar ninguna dirección real.

El identificador numérico de la cuenta es la mitad de esa dirección, así que
`GithubUser` pasa a guardarlo. Una prueba comprueba que se compone bien y que,
sin nombre, el que se enseña es el `login`.

La vista lo enseña siempre —«se firmará como…»— y ofrece una casilla para forzar
el `noreply` aunque haya configuración de Git. Esa casilla es la salida
concreta del `GH007`: quien tenga activado en GitHub el bloqueo de correos
privados verá el rechazo con la instrucción de marcarla, y el segundo intento
funciona.

El nombre puede venir de Git aunque el correo sea el `noreply`: son dos
decisiones distintas y sólo una tiene que ver con privacidad.

## Interfaz

Cada repositorio del explorador enseña un botón que distingue los dos trabajos,
porque no son el mismo: «Publicar cambios (N)» cuando hay archivos tocados, y
«Publicar N commits pendientes» cuando sólo falta subirlos.

La vista pone los tres pasos —elegir, describir y publicar— en una sola
pantalla. Separarlos en un asistente obligaría a recordar lo que se marcó
mientras se escribe el mensaje, que es justo cuando hace falta tenerlo delante.

`Ctrl+Enter` en el mensaje publica. También hay entrada en la paleta,
«Publicar cambios en GitHub», que busca el repositorio del documento abierto.

## Pruebas

`cargo test` — 26 correctas, 6 nuevas:

- se confirma exactamente lo marcado: lo elegido entra en el árbol del commit y
  lo descartado sigue pendiente, sin perderse;
- lo preparado fuera de Unfold no se cuela en el commit, y tampoco se pierde;
- un archivo borrado se registra como borrado y deja el repositorio limpio;
- el commit se firma con la identidad que se le pase, sin mirar la
  configuración de la máquina donde corra la prueba;
- un push que no puede avanzar la rama falla con una explicación, venga por el
  transporte o por el estado de la referencia;
- los códigos de rechazo se traducen nombrando la salida, y lo que no se
  reconoce se repite tal cual.

`npm test` — 88 correctas, sin cambios. `npm run build` y
`cargo clippy --lib --tests` sin avisos.

### Lo que no está cubierto por pruebas

- **El `GH007` de verdad.** La traducción del mensaje sí se prueba, pero
  provocarlo requiere una cuenta con el bloqueo de correos privados activado.
  La validación de abajo confirma que esta cuenta no lo tiene puesto, así que
  esa rama sólo se ejercita a partir del texto.
- **Toda la vista de cambios.** El proyecto no tiene banco de pruebas de
  interfaz; se comprueba por tipos, por compilación y a mano.

### Validación manual del ciclo completo

`cargo run --example github_probe -- <url> --publicar` repite el orden exacto de
la fase contra un remoto HTTPS de verdad. Ejecutado sobre
`esdrasclth/unfold-github-spike`:

```text
libgit2 1.9.7
descargando… 33% … 100%
clonado: rama=Some("main") head=Some("56198107a38fc64b198b07bce1a2472311f7b424") cambios=0 adelanto=0 retraso=0
  seguido  README.md
  seguido  unfold-phase-0.md
fetch: UpToDate
cambios tras escribir: 1
  New unfold-sonda-1788926931.md
firmando como Esdras Clother <Esdras.Clother@outlook.com>
commit ae0e3da1ca31113fb82da4d5cda76929f0bc502b
sincronización antes de publicar: UpToDate
publicado: unfold-sonda-1788926931.md
final: head=Some("ae0e3da1ca31113fb82da4d5cda76929f0bc502b") cambios=0 adelanto=0 retraso=0
```

Queda comprobado lo que ninguna prueba local alcanza: el clone autenticado con
el helper de credenciales, el progreso de descarga, la identidad tomada de la
configuración de Git, el commit, la sincronización previa y el **push aceptado
por GitHub**.

La última línea es la que lo demuestra. El adelanto pasó de uno a cero después
de publicar, y ese número se calcula contra `refs/remotes/origin/main`: si el
remoto no hubiera aceptado el commit, seguiría en uno.

## Criterios de salida

- [x] Vista con todos los cambios pendientes y su estado.
- [x] Selección por archivo, con todo marcado de partida.
- [x] Mensaje de commit obligatorio.
- [x] Commit que contiene exactamente lo marcado, y push.
- [x] Sincronización antes de publicar, con el caso divergente detenido y
      explicado.
- [x] Errores del servidor traducidos a algo accionable, y reintento que no
      duplica commits.
- [x] Identidad tomada de Git cuando existe y compuesta con el `noreply` cuando
      no, visible antes de confirmar y forzable con una casilla.

## Siguiente

Lo que esta fase deja abierto es la fusión. Mientras no exista, publicar sobre
una rama que alguien más movió termina en «intégralo con Git». Un rebase de los
commits locales sobre el remoto, con resolución de conflictos documento a
documento, es el siguiente paso natural y el que cerraría el ciclo completo
dentro de Unfold.
