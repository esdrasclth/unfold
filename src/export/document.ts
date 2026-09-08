import { markdownToHtml } from "./markdownToHtml.ts";

/**
 * Hoja de estilos del documento exportado.
 *
 * Va incrustada a propósito: un `.html` exportado tiene que poder enviarse por
 * correo o abrirse dentro de cinco años sin depender de nada externo. Repite la
 * tipografía del editor para que lo exportado se reconozca como lo que se veía.
 */
const STYLES = `
:root {
  --texto: #24211d;
  --suave: #5c574f;
  --tenue: #97918a;
  --borde: #e0ddd6;
  --acento: #b4572a;
  --codigo-fondo: #f4f2ee;
  color-scheme: light;
}
* { box-sizing: border-box; }
body {
  margin: 0 auto;
  padding: 3.5rem 1.5rem 6rem;
  max-width: 46rem;
  background: #fff;
  color: var(--texto);
  font-family: "Inter", "Segoe UI", system-ui, sans-serif;
  font-size: 17px;
  line-height: 1.75;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 2em 0 .6em; font-weight: 650; letter-spacing: -.011em; }
h1 { font-size: 1.9em; margin-top: 0; }
h2 { font-size: 1.5em; }
h3 { font-size: 1.22em; }
h4 { font-size: 1.06em; }
h5, h6 { font-size: .95em; color: var(--suave); text-transform: uppercase; letter-spacing: .06em; }
p, ul, ol, blockquote, table, pre { margin: 0 0 1.1em; }
ul, ol { padding-left: 1.4em; }
li { margin: .25em 0; }
li::marker { color: var(--acento); }
a { color: var(--acento); text-underline-offset: 2px; }
strong { font-weight: 680; }
del { color: var(--suave); }
blockquote {
  margin-left: 0;
  padding: .1em 0 .1em 1.15em;
  border-left: 3px solid var(--borde);
  color: var(--suave);
  font-style: italic;
}
code {
  font-family: "Cascadia Code", "Consolas", ui-monospace, monospace;
  font-size: .875em;
  background: var(--codigo-fondo);
  border: 1px solid var(--borde);
  border-radius: 4px;
  padding: .1em .32em;
}
pre {
  background: var(--codigo-fondo);
  border: 1px solid var(--borde);
  border-radius: 7px;
  padding: .9em 1.1em;
  overflow-x: auto;
}
pre code { background: none; border: none; padding: 0; font-size: .86em; }
hr { border: none; border-top: 1px solid var(--borde); margin: 2em 0; }
img { max-width: 100%; height: auto; border-radius: 8px; }
table { border-collapse: collapse; width: 100%; font-size: .94em; }
th, td { border: 1px solid var(--borde); padding: .45em .7em; }
th { background: #f7f5f1; font-weight: 620; }
tbody tr:nth-child(even) td { background: #faf9f7; }
input[type=checkbox] { margin-right: .35em; accent-color: var(--acento); }
.markdown-alert { margin: 1.1em 0; padding: .8em 1em; border-left: 4px solid var(--acento); background: #fff8f2; border-radius: 6px; }
.markdown-alert strong { display: block; margin-bottom: .2em; }
.markdown-alert.warning, .markdown-alert.caution { border-color: #c47b16; background: #fff9e8; }
.markdown-alert.tip { border-color: #2f8f68; background: #effaf5; }
.markdown-alert.important { border-color: #6957b5; background: #f5f2ff; }
.footnotes { margin-top: 3rem; border-top: 1px solid var(--borde); color: var(--suave); font-size: .9em; }
.mermaid-diagram { overflow: auto; margin: 1.2em 0; text-align: center; }
.mermaid-diagram pre { text-align: left; }

@media print {
  /* Al imprimir manda el papel: sin márgenes propios y sin cortar bloques. */
  body { padding: 0; max-width: none; font-size: 11pt; }
  a { color: var(--texto); text-decoration: underline; }
  pre, blockquote, table, img { break-inside: avoid; }
  h1, h2, h3, h4, h5, h6 { break-after: avoid; }
  @page { margin: 18mm 16mm; }
}
.theme-midnight { --texto: #e8edf5; --suave: #a7b2c4; --tenue: #718096; --borde: #334155; --acento: #7dd3fc; --codigo-fondo: #162033; background: #0f172a; color-scheme: dark; }
.theme-midnight body { background: #0f172a; }
.theme-warm { --texto: #3b2f25; --suave: #756454; --borde: #e8d8c5; --acento: #b4572a; --codigo-fondo: #fbf3e8; background: #fffaf3; }
.theme-warm body { background: #fffaf3; }
`;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export interface DocumentOptions {
  title: string;
  theme?: "paper" | "midnight" | "warm";
  author?: string;
  description?: string;
  /** Convierte rutas de imagen para que se vean también fuera del editor. */
  resolveAsset?: (src: string) => string;
}

/** Documento HTML completo y autocontenido, listo para guardar o imprimir. */
export function buildHtmlDocument(markdown: string, options: DocumentOptions): string {
  let body = markdownToHtml(markdown);

  if (options.resolveAsset) {
    const resolve = options.resolveAsset;
    body = body.replace(/(<img[^>]+src=")([^"]+)(")/g, (_all, before, src, after) =>
      `${before}${resolve(src)}${after}`,
    );
  }

  const theme = options.theme ?? "paper";
  const themeClass = ` theme-${theme}`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
${options.author ? `<meta name="author" content="${escapeAttribute(options.author)}">` : ""}
${options.description ? `<meta name="description" content="${escapeAttribute(options.description)}">` : ""}
<style>${STYLES}</style>
</head>
<body class="${themeClass.trim()}">
${body}
</body>
</html>
`;
}
