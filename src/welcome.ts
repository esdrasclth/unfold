import release from "./release.json" with { type: "json" };

const SEEN_VERSION_KEY = "unfold:bienvenida-vista";

interface WelcomeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Guía incluida en esta versión.
 *
 * Las novedades viven en release.json para que el proceso de compilación pueda
 * comprobar que fueron revisadas al subir la versión de la aplicación.
 */
export const WELCOME = `# Te damos la bienvenida a Unfold 👋

Escribe y lee en el mismo lugar: Unfold oculta la sintaxis de Markdown cuando
no la estás editando y la muestra de nuevo al colocar el cursor.

> Esta guía no es un archivo guardado. Aparecerá una vez por versión; puedes
> cerrarla, abrir un documento o crear uno nuevo para empezar.

## Empieza en tres pasos

1. Crea un documento con \`Ctrl+N\` o abre uno con \`Ctrl+O\`.
2. Escribe con normalidad. Usa \`#\` para títulos, \`**texto**\` para negrita y
   \`- [ ]\` para tareas.
3. Guarda con \`Ctrl+S\`. El archivo en disco seguirá siendo Markdown puro.

## Novedades de la versión ${release.version}

${release.highlights.map((highlight) => `- ${highlight}`).join("\n")}

## Trucos útiles

- Marca una tarea haciendo clic en su casilla.
- Sigue un enlace con \`Ctrl\` + clic.
- Recorre una tabla con \`Tab\` y \`Shift+Tab\`; pulsa \`Enter\` para añadir una fila.
- Abre el esquema con \`Ctrl+Shift+O\` y ajusta la apariencia con \`Ctrl+,\`.
- Usa \`Ctrl+F\` para buscar y reemplazar en el documento.

## Atajos esenciales

| Acción | Atajo |
| --- | --- |
| Nuevo · Abrir · Guardar | \`Ctrl+N\` · \`Ctrl+O\` · \`Ctrl+S\` |
| Negrita · Cursiva · Enlace | \`Ctrl+B\` · \`Ctrl+I\` · \`Ctrl+K\` |
| Cerrar · Cambiar pestaña | \`Ctrl+W\` · \`Ctrl+Tab\` |
| Enfoque · Máquina de escribir | \`Ctrl+Shift+F\` · \`Ctrl+Shift+T\` |
| Exportar HTML · Imprimir/PDF | \`Ctrl+Shift+E\` · \`Ctrl+P\` |
`;

/**
 * Consume la bienvenida de la versión actual.
 *
 * Se registra al mostrarla, no al guardar ni al cerrar: es una guía efímera,
 * no un documento del usuario que deba restaurarse en el siguiente arranque.
 */
export function takeWelcome(storage: WelcomeStorage = localStorage): string {
  if (storage.getItem(SEEN_VERSION_KEY) === release.version) return "";
  storage.setItem(SEEN_VERSION_KEY, release.version);
  return WELCOME;
}
