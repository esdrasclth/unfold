/**
 * Convierte el HTML del portapapeles en Markdown.
 *
 * Cubre lo que realmente se pega desde un navegador: artículos, documentación,
 * tablas y fragmentos de código. Lo que no reconoce se degrada a su texto, que
 * es siempre mejor que volcar etiquetas crudas en el documento.
 */

const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DIV", "DL", "FIGURE",
  "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI",
  "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE", "UL",
]);

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "HEAD", "TEMPLATE", "SVG"]);

/** Escapa lo que el lector de Markdown interpretaría como sintaxis. */
function escapeInline(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, "\\$1");
}

/** Al principio de línea también son sintaxis `#`, `-`, `>` y `1.`. */
function escapeLineStart(text: string): string {
  return text
    .replace(/^(\s*)([#>])/gm, "$1\\$2")
    .replace(/^(\s*)([-+*])(\s)/gm, "$1\\$2$3")
    .replace(/^(\s*)(\d+)\.(\s)/gm, "$1$2\\.$3");
}

// Constantes de DOM por valor: `Node.ELEMENT_NODE` obliga a tener el global
// `Node`, que no existe en todos los entornos donde queremos probar esto.
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === ELEMENT_NODE;
}

/** El HTML colapsa los espacios; el Markdown resultante debe reflejarlo. */
function collapse(text: string): string {
  return text.replace(/[\t\n\r ]+/g, " ");
}

function inlineChildren(node: Node): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) out += inline(child);
  return out;
}

function inline(node: Node): string {
  if (node.nodeType === TEXT_NODE) {
    return escapeInline(collapse(node.textContent ?? ""));
  }
  if (!isElement(node)) return "";
  if (SKIP_TAGS.has(node.tagName)) return "";

  switch (node.tagName) {
    case "BR":
      return "  \n";

    case "STRONG":
    case "B": {
      const content = inlineChildren(node).trim();
      return content ? `**${content}**` : "";
    }

    case "EM":
    case "I": {
      const content = inlineChildren(node).trim();
      return content ? `*${content}*` : "";
    }

    case "DEL":
    case "S":
    case "STRIKE": {
      const content = inlineChildren(node).trim();
      return content ? `~~${content}~~` : "";
    }

    case "CODE":
    case "KBD":
    case "SAMP": {
      // Dentro de <pre> el código lo maneja el bloque, no aquí.
      const text = collapse(node.textContent ?? "");
      if (!text) return "";
      // Si el propio código lleva acentos graves, alargamos la valla.
      const longest = /`+/.exec(text)?.[0].length ?? 0;
      const fence = "`".repeat(longest + 1);
      const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
      return `${fence}${pad}${text}${pad}${fence}`;
    }

    case "A": {
      const href = node.getAttribute("href") ?? "";
      const text = inlineChildren(node).trim();
      if (!text) return "";
      if (!href || href.startsWith("javascript:")) return text;
      return `[${text}](${encodeURI(href)})`;
    }

    case "IMG": {
      const src = node.getAttribute("src") ?? "";
      const alt = (node.getAttribute("alt") ?? "").replace(/[[\]]/g, "");
      return src ? `![${alt}](${encodeURI(src)})` : "";
    }

    default:
      return inlineChildren(node);
  }
}

/** Texto en línea de un elemento, ya recortado y sin saltos sobrantes. */
function inlineOf(node: Node): string {
  return inlineChildren(node).replace(/[ \t]+/g, " ").trim();
}

function listToMarkdown(list: HTMLElement, depth: number): string {
  const ordered = list.tagName === "OL";
  const start = Number(list.getAttribute("start") ?? "1");
  const indent = "  ".repeat(depth);
  const items: string[] = [];
  let index = start;

  for (const child of Array.from(list.children)) {
    if (child.tagName !== "LI") continue;

    // Separamos el contenido propio del ítem de sus sublistas.
    const nested: HTMLElement[] = [];
    const own = list.ownerDocument.createElement("div");
    for (const part of Array.from(child.childNodes)) {
      if (isElement(part) && (part.tagName === "UL" || part.tagName === "OL")) {
        nested.push(part);
      } else {
        own.appendChild(part.cloneNode(true));
      }
    }

    const marker = ordered ? `${index++}.` : "-";
    const checkbox = child.querySelector<HTMLInputElement>(":scope > input[type=checkbox]");
    const task = checkbox ? (checkbox.checked ? "[x] " : "[ ] ") : "";
    const body = blocksOf(own, depth).trim() || inlineOf(own);

    // Las líneas siguientes de un ítem se alinean bajo su texto.
    const hang = " ".repeat(marker.length + 1);
    const text = body.split("\n").join(`\n${indent}${hang}`);
    let entry = `${indent}${marker} ${task}${text}`;

    for (const sub of nested) entry += `\n${listToMarkdown(sub, depth + 1)}`;
    items.push(entry);
  }

  return items.join("\n");
}

function tableToMarkdown(table: HTMLElement): string {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (rows.length === 0) return "";

  const grid = rows.map((row) =>
    Array.from(row.querySelectorAll("th, td")).map((cell) =>
      inlineOf(cell).replace(/\|/g, "\\|").replace(/\n/g, " "),
    ),
  );

  const width = Math.max(...grid.map((row) => row.length));
  const pad = (row: string[]): string[] =>
    Array.from({ length: width }, (_, i) => row[i] ?? "");

  const hasHeader = rows[0].querySelector("th") !== null;
  const header = hasHeader ? pad(grid[0]) : Array.from({ length: width }, () => "");
  const body = hasHeader ? grid.slice(1) : grid;

  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.map((row) => `| ${pad(row).join(" | ")} |`),
  ];
  return lines.join("\n");
}

function preToMarkdown(pre: HTMLElement): string {
  const code = pre.querySelector("code") ?? pre;
  const classes = `${code.className} ${pre.className}`;
  const language = /(?:language|lang|highlight)-([\w+#-]+)/.exec(classes)?.[1] ?? "";
  const text = (code.textContent ?? "").replace(/\n+$/, "");
  // Si el propio código contiene una valla, alargamos la nuestra.
  const longest = /^`{3,}/m.exec(text)?.[0].length ?? 2;
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

/** Recorre los hijos de un contenedor produciendo bloques separados. */
function blocksOf(container: Node, depth: number): string {
  const blocks: string[] = [];
  let pending = "";

  const flush = (): void => {
    const text = pending.replace(/[ \t]+/g, " ").trim();
    if (text) blocks.push(escapeLineStart(text));
    pending = "";
  };

  for (const child of Array.from(container.childNodes)) {
    if (isElement(child) && SKIP_TAGS.has(child.tagName)) continue;

    if (isElement(child) && BLOCK_TAGS.has(child.tagName)) {
      flush();
      blocks.push(blockOf(child, depth));
      continue;
    }
    pending += inline(child);
  }
  flush();

  return blocks.filter((block) => block.trim().length > 0).join("\n\n");
}

function blockOf(el: HTMLElement, depth: number): string {
  switch (el.tagName) {
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6": {
      const level = Number(el.tagName[1]);
      const text = inlineOf(el);
      return text ? `${"#".repeat(level)} ${text}` : "";
    }

    case "HR":
      return "---";

    case "PRE":
      return preToMarkdown(el);

    case "UL":
    case "OL":
      return listToMarkdown(el, depth);

    case "TABLE":
      return tableToMarkdown(el);

    case "BLOCKQUOTE": {
      const inner = blocksOf(el, depth);
      return inner
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
    }

    case "P": {
      const text = inlineOf(el);
      return text ? escapeLineStart(text) : "";
    }

    default:
      return blocksOf(el, depth);
  }
}

export function markdownFromHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const markdown = blocksOf(doc.body, 0);
  // Como mucho una línea en blanco entre bloques.
  return markdown.replace(/\n{3,}/g, "\n\n").trim();
}
