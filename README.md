# Unfold

Editor Markdown de escritorio con vista previa en vivo al estilo Typora: el
documento se ve como quedará **mientras lo escribes**, sin panel dividido.

El archivo en disco sigue siendo Markdown literal en todo momento. Unfold no
mantiene un modelo de documento aparte ni reserializa nada al guardar, así que
tus archivos no cambian de formato por haberlos abierto.

## Cómo funciona

El buffer de CodeMirror contiene siempre el Markdown tal cual. Un plugin recorre
el árbol sintáctico de la parte visible y **oculta los marcadores** (`##`, `**`,
`` ` ``, `>`, `-`) con decoraciones, aplicando el estilo correspondiente al
texto. Cuando el cursor entra en un elemento, sus marcadores reaparecen para
poder editarlos; al salir, vuelven a ocultarse.

Sólo se decora el rango visible y sólo se recalcula cuando cambia el texto, el
viewport o la selección. Por eso sigue siendo fluido en archivos grandes.

Las tablas son la excepción: se sustituyen por una tabla HTML real. Como eso
altera la altura de las líneas, esa decoración vive en un `StateField` y no en
el `ViewPlugin` (CodeMirror no admite decoraciones de bloque desde un plugin de
vista).

## Requisitos

- Node.js 20 o superior
- Rust con toolchain MSVC, Microsoft C++ Build Tools y WebView2
  (WebView2 ya viene con Windows 10/11 actualizado)

## Desarrollo

```powershell
npm install
npm start          # tauri dev: app nativa con recarga en caliente
```

Para iterar sólo en la interfaz, sin recompilar Rust:

```powershell
npm run dev        # Vite en http://localhost:1420
```

En el navegador, abrir y guardar usan la File System Access API en lugar del
sistema de archivos nativo, de modo que el flujo completo se puede probar ahí.

## Compilar

```powershell
npm run release        # el .exe y el instalador NSIS
npm run release:setup  # ademas, el instalador con interfaz propia
```

La aplicación queda en `src-tauri/target/release/`, el instalador NSIS en
`src-tauri/target/release/bundle/nsis/`, y el instalador que se distribuye en
`setup/src-tauri/target/release/unfold-setup.exe`.

El orden importa: el instalador con interfaz **empotra** el NSIS con
`include_bytes!`, así que la aplicación tiene que estar compilada antes.

## Actualizaciones

La aplicación consulta un manifiesto firmado unos segundos después de arrancar
—no al abrir la ventana: la red no debe retrasar que el editor esté listo— y,
si hay versión nueva, muestra una franja con «Actualizar» y «Más tarde». Al
aceptar, descarga, instala y se reinicia sola.

La comprobación se hace **una vez al día** y «Más tarde» silencia esa versión
concreta: un aviso que reaparece en cada arranque deja de ser un aviso.

### Publicar una versión

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$HOME\.unfold\updater.key" -Raw
npm run release
```

Salen `Unfold_x.y.z_x64-setup.exe` y su `.sig`. Se publican los dos junto a un
`latest.json`:

```json
{
  "version": "0.2.0",
  "notes": "Qué ha cambiado",
  "pub_date": "2026-09-07T19:45:46Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contenido del .sig>",
      "url": "<url del .exe>"
    }
  }
}
```

Tres cosas que conviene tener claras:

- **La clave privada vive en `~/.unfold/updater.key` y no puede subirse al
  repositorio.** Si se pierde, ninguna instalación existente podrá volver a
  actualizarse: la firma dejaría de validar y no hay forma de recuperarla.
- **El endpoint tiene que ser HTTPS.** Con `http` la aplicación ni siquiera
  arranca: se aborta al inicio. Es deliberado, porque un canal en claro
  permitiría a cualquiera en la red servir una actualización falsa.
- `plugins.updater.endpoints` lleva un marcador `TU-USUARIO`. Hay que
  cambiarlo por el repositorio real antes de publicar.

## El instalador

`setup/` es una segunda aplicación Tauri: una ventana de 940×600 sin
decoración, con la paleta del editor, que por debajo ejecuta el instalador NSIS
en modo silencioso.

Se hizo así porque NSIS dibuja controles nativos de Win32 y Windows los pinta
con su propio tema: los campos y las casillas no se pueden redondear ni teñir.
Con un WebView el diseño es libre, y la maquinaria probada —registro,
desinstalador, WebView2, asociaciones— se conserva intacta en lugar de
reescribirla.

El NSIS viaja empotrado en el binario y se extrae a la carpeta temporal al
instalar, de modo que lo que se descarga es **un único `.exe` de 7 MB**.

La plantilla del NSIS se extrajo del binario del CLI de Tauri y se conserva sin
tocar salvo dos añadidos funcionales. Su interfaz sigue siendo la de serie: al
ejecutarse siempre con `/S` nadie la ve, y mantener una a medias habría sido
código muerto que además podía romperse sin que nos enterásemos.

Los dos añadidos:

- **`/DESKTOP`**: en modo silencioso no hay página final donde marcar el acceso
  directo, así que se acepta por línea de órdenes.
- **`OpenWithProgids`**: desde Windows 10 una aplicación no puede quedarse con
  una extensión por su cuenta —la elección vive en `UserChoice`, protegida—.
  Sin esta clave, Unfold ni siquiera aparecía en la lista de «Abrir con» para
  un `.md`. Ponerla como predeterminada sigue siendo cosa del usuario.

## Atajos

| Acción | Atajo |
| --- | --- |
| Nuevo documento | `Ctrl+N` |
| Cerrar pestaña | `Ctrl+W` |
| Pestaña siguiente / anterior | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Abrir / Guardar / Guardar como | `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` |
| Seguir un enlace | `Ctrl` + clic |
| Negrita / Cursiva | `Ctrl+B` / `Ctrl+I` |
| Código en línea / Tachado | `Ctrl+E` / `Ctrl+Shift+X` |
| Enlace | `Ctrl+K` |
| Encabezado 1..6 / quitar | `Ctrl+1` … `Ctrl+6` / `Ctrl+0` |
| Buscar y reemplazar | `Ctrl+F` |
| Esquema del documento | `Ctrl+Shift+O` |
| Apariencia | `Ctrl+,` |
| Exportar a HTML | `Ctrl+Shift+E` |
| Imprimir o guardar en PDF | `Ctrl+P` |
| Pegar sin formato | `Ctrl+Shift+V` |
| Modo enfoque | `Ctrl+Shift+F` |
| Modo máquina de escribir | `Ctrl+Shift+T` |
| Celda siguiente / anterior (en tablas) | `Tab` / `Shift+Tab` |
| Fila siguiente (en tablas) | `Enter` |

## Estructura

```
src/
  editor/
    livePreview.ts   El plugin que oculta y estiliza la sintaxis
    widgets.ts       Viñetas, casillas, reglas, imágenes y tablas
    tables.ts        Modelo de celdas: navegación con teclado y clic
    commands.ts      Negrita, cursiva, encabezados, enlaces
    paste.ts         Pegado de HTML e imágenes
    markdownFromHtml.ts  Conversor de HTML a Markdown (con pruebas)
    typewriter.ts    Modo máquina de escribir
    theme.ts         Estructura del editor y resaltado de código
    index.ts         Composición de extensiones
    headings.ts      Extracción de encabezados para el esquema
  export/
    markdownToHtml.ts  Markdown a HTML sobre el árbol del editor (con pruebas)
    document.ts        Documento autocontenido y estilos de impresión
    index.ts           Guardar .html e imprimir a PDF
  ui/icons.ts        Iconos SVG en línea
  ui/searchPanel.ts  Panel de buscar y reemplazar
  ui/outline.ts      Panel del esquema
  watcher.ts         Vigilancia del archivo abierto
  files.ts           Sistema de archivos (Tauri) y respaldo de navegador
  main.ts            Interfaz, estado del documento y autoguardado
  styles/            Variables de tema y tipografía del Markdown
src-tauri/           Capa nativa: ventana, permisos y empaquetado
scripts/make-icon.mjs  Genera el icono de la app sin dependencias
```

## Interfaz

La ventana se crea **sin decoración del sistema**: la barra de título gris de
Windows imponía su propio color y partía la composición en dos. En su lugar hay
una barra propia con los controles de minimizar, maximizar y cerrar en las
medidas de Windows 11 (46×32, rojo sólo al pasar por encima del de cerrar), de
modo que siguen donde el músculo los busca. Arrastrar y redimensionar siguen
funcionando igual.

Quitar la decoración también quita el redondeo que Windows aplica a las
ventanas normales, así que `src-tauri/src/lib.rs` lo pide de vuelta con
`DWMWA_WINDOW_CORNER_PREFERENCE`. En Windows 10 la llamada falla sin
consecuencias.

El conmutador del esquema vive en el **extremo izquierdo** de la barra, encima
de la columna que gobierna. Entre las acciones del documento, a la derecha, se
leía como una acción más sobre el texto.

## Apariencia

`Ctrl+,` abre un panel por la derecha, no un diálogo centrado: el documento
sigue visible detrás, así que cada control se ve aplicado sobre el texto real
mientras se arrastra.

| Preferencia | Rango |
| --- | --- |
| Tipografía del texto | Las instaladas en el sistema, detectadas al arrancar |
| Tamaño | 13 a 24 px |
| Interlineado | 1,4 a 2,2 |
| Ancho de la columna | 32 a 72 rem, con su equivalencia en caracteres |
| Tipografía del código | Las monoespaciadas instaladas |
| Color de las barras | Doce temas, cada uno con su acento |

### Temas de barra

Colorean la barra superior, el esquema, el panel de apariencia y la barra de
estado, **sin tocar el papel del editor**: el texto se sigue leyendo sobre el
mismo fondo de siempre.

Para que funcionaran hubo que separar en dos familias los colores que antes
eran una: los del cromo y los del documento. Sin esa separación, teñir la barra
de petróleo dejaba encima el texto oscuro pensado para el papel del editor.

Un tema son dos declaraciones: el color y `--on-chrome`, la tinta que va
encima. Todo lo demás (texto principal, secundario, estados de hover, reglas)
se deriva de esas dos. La tinta de cada tema se eligió midiendo el contraste
WCAG del blanco y del negro sobre el color y quedándose con el mayor; todos
superan el umbral AA de 4,5.

El acento sobre la barra no es el acento a secas: se acerca a la tinta lo justo
para leerse, aclarándose sobre barra oscura y oscureciéndose sobre barra clara.
Así el estado activo conserva su color en vez de volverse un gris neutro.

El acento no se configura aparte: **viene con la barra**. La pareja
barra/acento es una decisión de diseño, y dejarla suelta sólo permitía
romperla. Los cuatro acentos (terracota, océano, bosque y ciruela) están
afinados por separado para el tema claro y el oscuro.

Todo se aplica escribiendo variables CSS en `<html>`, donde ya vivían la métrica
y la tipografía del editor. Cambiar una preferencia no toca ninguna extensión de
CodeMirror ni reconstruye el editor.

La lista de tipografías se filtra midiendo el ancho de un texto con la fuente
pedida y sin ella: si el navegador hubiera caído al sustituto genérico, las dos
medidas coincidirían. `document.fonts.check` da falsos positivos.

El sistema visual sigue dos reglas:

- **Sin bordes.** La separación entre zonas es un cambio de plano, no una línea
  de 1px. El área de escritura es la capa que sobresale y el cromo (barra de
  título, esquema, barra de estado) se hunde por detrás.
- **Jerarquía por contraste.** Tres pesos de texto: títulos al color más fuerte,
  cuerpo un punto por debajo, y el andamiaje de sintaxis al más tenue. Esto
  último importa: al entrar el cursor en una línea, los `##` y `**` reaparecen
  **atenuados**, así la línea no da un tirón visual al revelarse.

## Al escribir

- **Corrector ortográfico** del sistema, el que ya trae WebView2.
- **Pegar desde el navegador** convierte el HTML a Markdown: encabezados,
  listas anidadas, tablas, citas y bloques de código con su lenguaje.
  `Ctrl+Shift+V` pega sin convertir nada.
- **Pegar una imagen** la guarda en `assets/` junto al documento y escribe el
  enlace relativo, para que mover la carpeta no rompa nada.
- **Tablas navegables**: `Tab` entre celdas seleccionando su contenido, y una
  fila nueva al tabular más allá de la última celda. Al pulsar una celda con el
  ratón el cursor cae en esa celda, no al principio de la tabla.
- **Modo máquina de escribir**: la línea del cursor se mantiene centrada.
- **Movimiento suavizado**: el cursor se desliza hasta su nueva posición en
  90 ms en lugar de teletransportarse, parpadea con un desvanecido en vez del
  encendido y apagado seco de CodeMirror, y la línea activa se tiñe muy
  levemente. Todo respeta `prefers-reduced-motion`.
- **Esquema lateral** con los encabezados del documento, sangrados por nivel y
  resaltando aquel en el que está el cursor. Se saca del árbol sintáctico, así
  que una almohadilla dentro de un bloque de código no aparece en la lista.
  Se pliega con `Ctrl+Shift+O` animando su ancho, y se ajusta arrastrando su
  borde derecho (entre 170 y 460 px; doble clic vuelve al ancho de fábrica).
  Tanto el estado como el ancho se recuerdan entre sesiones.

## Exportar

`Ctrl+Shift+E` guarda un `.html` autocontenido: los estilos van incrustados, de
modo que el archivo se puede enviar por correo o abrir dentro de años sin
depender de nada. `Ctrl+P` abre el diálogo de impresión con el documento ya
maquetado, desde donde «Microsoft Print to PDF» produce el PDF.

Se imprime un iframe oculto y no la ventana: lo que hay en pantalla es el
editor, con su sintaxis a medio ocultar y su barra de herramientas.

El HTML lo genera el **mismo parser que usa la vista previa**, así que lo
exportado coincide con lo que estabas viendo, sin un segundo intérprete que
discrepe en los casos raros.

Las cabeceras y pies de página del PDF (fecha y título) los pone el motor de
impresión, no Unfold. Se quitan en «Más opciones de configuración» del propio
diálogo.

## Cambios externos

Si editas el mismo archivo desde otro programa, Unfold se entera:

- **Sin cambios locales**, adopta la versión del disco sin preguntar.
- **Con cambios sin guardar**, muestra una barra de conflicto y **pausa el
  autoguardado**, que si no sobrescribiría en silencio lo que hiciste fuera. Tú
  eliges entre cargar el disco o quedarte con tu versión.

Esto exige la *feature* `watch` de `tauri-plugin-fs`, que no viene activada por
defecto: sin ella el comando existe en JavaScript pero no hay nada detrás.

## Pruebas

```powershell
npm test
```

Cubre los dos conversores, que son las piezas con más casos límite: HTML a
Markdown (al pegar) y Markdown a HTML (al exportar). Corren en dos segundos sin
abrir la aplicación, así que conviene ejecutarlos antes de tocar cualquiera de
los dos.

## Varios documentos

Cada pestaña guarda un `EditorState` entero, no sólo su texto, así que al
volver a ella se recuperan la selección, el scroll y el historial de deshacer.
Se comparte una única vista: cambiar de pestaña es un `setState`, mucho más
barato que mantener un editor por documento.

La barra vive dentro de la columna del editor, no en todo el ancho de la
ventana: la pestaña activa lleva el color del papel, y desde fuera de esa
columna caía sobre el esquema en vez de sobre la hoja a la que pertenece. Ahora
comparten borde izquierdo y la pestaña se apoya en la hoja, con las esquinas
redondeadas sólo por arriba.

Sólo aparece con dos o más abiertos; con uno repetiría el nombre que
ya está en la barra de título. Un documento sin guardar toma su nombre de la
primera línea, porque «Sin título» repetido no distingue ninguno.

Cerrar la ventana repasa **todas** las pestañas con cambios, no sólo la que se
ve, trayendo cada una al frente antes de preguntar: no se decide a ciegas sobre
un documento que no se está viendo.

El botón del reloj abre los recientes, con su carpeta y cuándo se usaron.

## Frontmatter y matemáticas

El bloque `---` del principio se dibuja como una ficha de metadatos. Hay que
reconocerlo aparte porque para Markdown no existe: la primera raya es una regla
horizontal y la de cierre convierte lo de en medio en un encabezado subrayado,
que además se colaba en el esquema.

`$…$` y `$$…$$` se renderizan con KaTeX, y se ocultan bajo el cursor como
cualquier otra sintaxis. La detección va aparte del renderizado para poder
probarla sin abrir la aplicación: el delimitador es un solo carácter que
también sirve para precios, y un falso positivo desfigura el texto. Las reglas
son que no haya espacio pegado a la apertura ni al cierre, que no haya un
dígito tras el cierre y que dentro no quede otro `$` sin escapar. Esta última
es la que evita que «$20 pero $x=1$» se trague el precio y la fórmula.

## Enlaces y cierre

`Ctrl` + clic sigue un enlace. El puntero sólo se vuelve mano mientras se
mantiene Ctrl, porque con clic normal hay que poder colocar el cursor: la
dirección está oculta por la vista previa.

Un ancla salta al encabezado del propio documento, otro Markdown se abre en el
editor, y el resto va al navegador del sistema. Sólo `http`, `https` y
`mailto`: abrir cualquier esquema desde un documento ajeno sería una vía de
entrada.

Cerrar la ventana con cambios sin guardar pregunta antes. Si el documento ya
tiene archivo y no hay conflicto no se pregunta: se guarda, que es lo que el
autoguardado ya promete.

El instalador asocia `.md`, `.markdown` y `.mdx`, y los limpia al desinstalar.
Ejecutando el `.exe` suelto no hay nada que registrar.

## Pendiente

- Pestañas para tener varios documentos abiertos
- Restaurar la última sesión y lista de archivos recientes
- Bloques matemáticos con `$…$` y `$$…$$`, y diagramas Mermaid
- Frontmatter YAML, notas al pie y enlaces automáticos
- Tablas dentro de citas o listas (ahora sólo se renderizan las de primer nivel)
- `tableField` recorre los bloques de primer nivel en cada pulsación; con
  documentos muy grandes convendrá mapear las decoraciones a través de los
  cambios en vez de reconstruirlas

## Nota sobre permisos

`src-tauri/capabilities/default.json` concede a la app lectura y escritura en
`**`, es decir, cualquier ruta. Es lo que hace que puedas abrir un `.md` esté
donde esté, y equivale a lo que hace cualquier editor de escritorio. Si prefieres
acotarlo, cambia el ámbito a rutas concretas como `$HOME/**` o `$DOCUMENT/**`.

## Licencia

MIT. Puedes usar, modificar y distribuir el código, incluso comercialmente,
conservando el aviso de copyright. Ver [LICENSE](LICENSE).
