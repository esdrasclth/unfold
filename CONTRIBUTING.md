# Contribuir a Unfold

Gracias por querer echar una mano. Este documento cuenta cómo está montado el
proyecto y qué se espera de un cambio.

## Poner en marcha el entorno

Hace falta **Node.js 20 o superior** y **Rust con toolchain MSVC**. En Windows,
Rust necesita además las *Microsoft C++ Build Tools*; WebView2 ya viene con
Windows 10 y 11 actualizados.

```powershell
npm install
npm start     # tauri dev: ventana nativa con recarga en caliente
npm test      # las pruebas
```

`npm run dev` levanta sólo la interfaz en el navegador, en el puerto 1420. Es
mucho más rápido para iterar en estilos o en el editor, porque no recompila
Rust. Ahí, abrir y guardar usan la File System Access API en lugar del sistema
de archivos nativo, así que el flujo completo se puede probar igualmente.

## Estructura

```
src/
  editor/
    livePreview.ts       Oculta y estiliza la sintaxis; el corazón del editor
    widgets.ts           Viñetas, casillas, reglas, imágenes y tablas
    tables.ts            Modelo de celdas: navegación con teclado y con ratón
    inlineMath.ts        Detección de fórmulas $…$ (con pruebas)
    math.ts              Renderizado con KaTeX y bloques $$…$$
    frontmatter.ts       Reconoce el bloque YAML del principio
    headings.ts          Extrae los encabezados para el esquema
    commands.ts          Negrita, cursiva, encabezados, enlaces
    paste.ts             Pegado de HTML e imágenes
    markdownFromHtml.ts  Conversor de HTML a Markdown (con pruebas)
    links.ts             Seguir enlaces con Ctrl+clic
    typewriter.ts        Modo máquina de escribir
    theme.ts             Estructura del editor y resaltado de código
    index.ts             Composición de todas las extensiones
  export/
    markdownToHtml.ts    Markdown a HTML sobre el árbol del editor (con pruebas)
    document.ts          Documento autocontenido y estilos de impresión
    index.ts             Guardar .html e imprimir a PDF
  ui/                    Paneles, menús, diálogos e iconos
  styles/                Variables de tema y tipografía del Markdown
  tabs.ts                Documentos abiertos
  files.ts               Sistema de archivos, con respaldo de navegador
  watcher.ts             Vigilancia del archivo abierto
  updates.ts             Comprobación de versiones nuevas
  settings.ts            Preferencias de apariencia
  main.ts                Ensambla la interfaz y el estado de la sesión
src-tauri/               Capa nativa: ventana, permisos y empaquetado
setup/                   Instalador con interfaz propia (otra app Tauri)
scripts/                 Generador del icono y las pruebas
```

## Pruebas

```powershell
npm test
```

Cubren las tres piezas con más casos límite, que son los conversores:

- **HTML a Markdown**, lo que ocurre al pegar desde un navegador
- **Markdown a HTML**, lo que produce la exportación
- **Detección de fórmulas**, donde un falso positivo desfigura el texto: el
  delimitador `$` también se usa para precios

Corren con Node y un DOM de `linkedom`, sin abrir la aplicación, en un par de
segundos. Si tocas cualquiera de esos tres módulos, ejecútalas antes de abrir
el pull request; y si arreglas un caso que fallaba, añade la prueba.

## Convenciones

**El archivo manda sobre el modelo.** El buffer contiene Markdown literal y
guardar escribe lo que hay. Cualquier propuesta que implique serializar el
documento desde una estructura intermedia va contra la razón de ser del
proyecto: los archivos del usuario no deben cambiar por haberlos abierto.

**Las decoraciones de bloque van en un `StateField`.** CodeMirror no las admite
desde un `ViewPlugin` porque necesita conocerlas antes de calcular la altura de
línea. Si algo cambia el alto de una línea —tablas, fórmulas de bloque—, ese es
su sitio.

**Los comentarios explican el porqué, no el qué.** El código ya dice lo que
hace. Lo que se pierde con el tiempo es la razón por la que está hecho así,
sobre todo cuando la forma obvia no funcionaba.

**Los colores salen de las variables CSS**, nunca escritos a mano. Están todas
al principio de `src/styles/app.css` y se propagan a los temas de barra y a los
acentos.

## Compilar los instaladores

```powershell
npm run release        # la aplicación y su instalador NSIS
npm run release:setup  # además, el instalador con interfaz propia
```

El orden importa: el instalador con interfaz **empotra** el NSIS con
`include_bytes!`, así que la aplicación tiene que estar compilada antes.

`setup/` es una segunda aplicación Tauri: una ventana sin decoración, con la
paleta del editor, que por debajo ejecuta el NSIS en modo silencioso. Se hizo
así porque NSIS dibuja controles nativos de Win32 y Windows los pinta con su
propio tema: los campos y las casillas no se pueden redondear ni teñir. Con un
WebView el diseño es libre y la maquinaria probada —registro, desinstalador,
WebView2, asociaciones— se conserva intacta.

La plantilla NSIS de `src-tauri/installer.nsi` se extrajo del binario del CLI de
Tauri y se conserva sin tocar salvo dos añadidos, ambos comentados en el propio
archivo: `/DESKTOP`, porque en modo silencioso no hay página final donde marcar
el acceso directo, y `OpenWithProgids`, sin la cual Unfold ni siquiera aparecía
en la lista de «Abrir con» de un `.md`.

Publicar una versión es cosa de quien mantiene el proyecto: está en
[docs/RELEASING.md](docs/RELEASING.md).

## Pull requests

Un cambio por pull request, con un mensaje que explique **por qué**. Si
encontraste el problema de una forma concreta, cuéntalo: al siguiente que lo
lea le ahorra el mismo camino.

Antes de abrirlo:

```powershell
npx tsc --noEmit   # sin errores de tipos
npm test           # todas en verde
```
