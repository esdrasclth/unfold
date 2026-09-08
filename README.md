<div align="center">

# Unfold

**Un editor Markdown donde el documento se ve como quedará mientras lo escribes.**

Sin panel dividido, sin previsualización aparte. Escribes en un sitio y lees en ese mismo sitio.

[Descargar para Windows](https://github.com/esdrasclth/unfold/releases/latest) ·
[unfold.brandsofts.com](https://unfold.brandsofts.com/) ·
[Cómo funciona](#cómo-funciona) ·
[Contribuir](CONTRIBUTING.md)

![Unfold en tema claro](docs/captura-claro.png)

</div>

---

## Qué lo diferencia

**Tus archivos no cambian.** El editor no mantiene un modelo de documento aparte
del texto: el buffer contiene siempre Markdown literal. Guardar escribe lo que
ya había, así que abrir un `.md` con Unfold nunca reordena tus listas ni
normaliza tus comillas.

**Arranca en 250 ms y ocupa 5 MB.** Está hecho con Tauri, que usa el WebView2
que Windows ya trae, en vez de empaquetar un navegador entero.

**Se edita donde se lee.** Al poner el cursor en una línea, sus marcadores
reaparecen —atenuados, para no dar un tirón visual— y puedes editarlos. Al
salir, vuelven a ocultarse.

<details>
<summary>Ver en tema oscuro</summary>

![Unfold en tema oscuro](docs/captura-oscuro.png)

</details>

## Instalar

Descarga **`Unfold-Setup.exe`** de la [última versión](https://github.com/esdrasclth/unfold/releases/latest)
y ábrelo. Necesitas Windows 10 o 11.

Se instala para tu usuario, sin pedir permisos de administrador, y a partir de
ahí la propia aplicación te avisa cuando hay una versión nueva.

> **Windows mostrará un aviso de SmartScreen** la primera vez. El instalador no
> está firmado con un certificado comercial, que cuesta unos cientos de euros al
> año. Pulsa «Más información» → «Ejecutar de todas formas». Puedes comprobar
> que el archivo es el mismo que publicamos comparando su hash con el de la
> release.

## Qué sabe hacer

Además, Unfold restaura la sesión (pestañas, borradores, cursor y posición) al
volver a abrirlo. El menú contextual del editor reúne las construcciones
Markdown disponibles y `Ctrl+Shift+M` alterna el modo Código fuente.

- **Vista previa en vivo** de encabezados, negrita, cursiva, tachado, código,
  citas, listas, tareas, reglas e imágenes
- **Tablas renderizadas** y navegables con `Tab`, sin salir del Markdown
- **Fórmulas** `$…$` y `$$…$$` con KaTeX, y **frontmatter YAML** como ficha de
  metadatos
- **Pestañas** con su propio historial de deshacer, y archivos recientes
- **Esquema lateral** plegable y ajustable, sacado del árbol sintáctico
- **Pegar desde el navegador** convierte el HTML a Markdown; pegar una imagen la
  guarda junto al documento
- **Exportar** a HTML autocontenido y a PDF
- **Vigila el archivo**: si lo editas desde otro programa, avisa en vez de
  pisarlo
- **Apariencia configurable**: tipografía, tamaño, interlineado, ancho de
  columna y doce colores de barra
- Corrector ortográfico, modo enfoque y modo máquina de escribir

## Atajos

| Acción | Atajo |
| --- | --- |
| Nuevo · Abrir · Guardar | `Ctrl+N` · `Ctrl+O` · `Ctrl+S` |
| Cerrar pestaña · Cambiar de pestaña | `Ctrl+W` · `Ctrl+Tab` |
| Negrita · Cursiva · Código · Tachado | `Ctrl+B` · `Ctrl+I` · `Ctrl+E` · `Ctrl+Shift+X` |
| Enlace · Seguir un enlace | `Ctrl+K` · `Ctrl` + clic |
| Encabezado 1–6 · Quitar | `Ctrl+1` … `Ctrl+6` · `Ctrl+0` |
| Buscar y reemplazar | `Ctrl+F` |
| Esquema · Apariencia | `Ctrl+Shift+O` · `Ctrl+,` |
| Exportar HTML · Imprimir o PDF | `Ctrl+Shift+E` · `Ctrl+P` |
| Modo enfoque · Máquina de escribir | `Ctrl+Shift+F` · `Ctrl+Shift+T` |
| Código fuente · Menú Markdown | `Ctrl+Shift+M` · clic derecho |
| Pegar sin formato | `Ctrl+Shift+V` |
| En tablas: celda · fila | `Tab` / `Shift+Tab` · `Enter` |

## Cómo funciona

El buffer de CodeMirror contiene el Markdown tal cual. Un plugin recorre el
árbol sintáctico **de la parte visible** y oculta los marcadores (`##`, `**`,
`` ` ``, `>`, `-`) con decoraciones, aplicando al texto el estilo que
corresponde. Cuando la selección toca un elemento, sus marcadores vuelven a
mostrarse para poder editarlos.

Sólo se decora el rango visible, y sólo se recalcula cuando cambia el texto, el
viewport o la selección. Por eso sigue siendo fluido en archivos grandes.

Hay dos excepciones que no caben en ese esquema. Las **tablas** y las
**fórmulas de bloque** se sustituyen por HTML real, y eso altera la altura de
las líneas; CodeMirror no admite decoraciones de bloque desde un plugin de
vista, así que viven en un `StateField`.

El **frontmatter** también se trata aparte, porque para Markdown no existe: la
primera raya `---` es una regla horizontal y la de cierre convierte lo de en
medio en un encabezado subrayado.

## Desarrollo

Necesitas Node.js 22.18 o superior y Rust con toolchain MSVC.

```powershell
npm install
npm start     # aplicación nativa con recarga en caliente
npm test      # pruebas de regresión, sin abrir la app
```

Para iterar sólo en la interfaz, `npm run dev` levanta Vite en el navegador; ahí
abrir y guardar usan la File System Access API en lugar del sistema de archivos.

En [CONTRIBUTING.md](CONTRIBUTING.md) están la estructura del proyecto, cómo
compilar los instaladores y las convenciones del código.

## Contribuir

Se aceptan issues y pull requests. Si vas a meterte con algo grande, abre antes
un issue para comentarlo.

Lo que está pendiente y sería bienvenido:

- Notas al pie y enlaces automáticos
- Tablas dentro de citas o listas
- Compilaciones para macOS y Linux

## Licencia

MIT. Puedes usar, modificar y distribuir el código, incluso comercialmente,
conservando el aviso de copyright. Ver [LICENSE](LICENSE).
