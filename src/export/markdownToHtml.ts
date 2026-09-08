import { GFM, parser as baseParser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";

/**
 * Convierte Markdown a HTML usando el mismo parser que el editor.
 *
 * Compartir el análisis con la vista previa no es un detalle: garantiza que lo
 * exportado sea exactamente lo que estabas viendo, sin un segundo intérprete
 * que discrepe en los casos raros.
 */
const parser = baseParser.configure(GFM);

/** Marcadores de sintaxis: no producen HTML, sólo delimitan. */
const SILENT = new Set([
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "CodeMark",
  "CodeInfo",
  "EmphasisMark",
  "StrikethroughMark",
  "LinkMark",
  "TableDelimiter",
  "URL",
  "LinkTitle",
  "TaskMarker",
  "CommentBlock",
  "Comment",
]);

/** Contenedores donde el texto entre hijos es sangrado, no contenido. */
const STRUCTURAL = new Set([
  "Document",
  "BulletList",
  "OrderedList",
  "ListItem",
  "Blockquote",
  "Table",
  "TableHeader",
  "TableRow",
  "FencedCode",
  "CodeBlock",
]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/'/g, "&#39;");
}

/** Identificador estable para enlazar desde el esquema. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

interface Context {
  src: string;
  /** Los identificadores repetidos se numeran, como hace GitHub. */
  usedIds: Map<string, number>;
}

/** Renderiza los hijos de un nodo dentro de un rango, con el texto intermedio. */
function renderRange(node: SyntaxNode, from: number, to: number, ctx: Context): string {
  const structural = STRUCTURAL.has(node.name);
  let out = "";
  let pos = from;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue;
    if (child.from > pos && !structural) {
      out += escapeHtml(ctx.src.slice(pos, child.from));
    }
    out += renderNode(child, ctx);
    pos = child.to;
  }

  if (pos < to && !structural) out += escapeHtml(ctx.src.slice(pos, to));
  return out;
}

function renderChildren(node: SyntaxNode, ctx: Context): string {
  return renderRange(node, node.from, node.to, ctx);
}

function uniqueId(text: string, ctx: Context): string {
  const base = slugify(text) || "seccion";
  const seen = ctx.usedIds.get(base) ?? 0;
  ctx.usedIds.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen}`;
}

function renderHeading(node: SyntaxNode, level: number, ctx: Context): string {
  // El `#` de cierre opcional no forma parte del texto.
  const inner = renderChildren(node, ctx).replace(/\s*#*\s*$/, "").trim();
  const id = uniqueId(inner.replace(/<[^>]*>/g, ""), ctx);
  return `<h${level} id="${escapeAttribute(id)}">${inner}</h${level}>`;
}

function renderListItem(node: SyntaxNode, ctx: Context): string {
  let inner = renderChildren(node, ctx).trim();
  // En listas compactas el párrafo envolvente sobra. Se quita sólo el primero,
  // para que un ítem con sublista siga funcionando; si el ítem tiene varios
  // párrafos de verdad, se respetan todos.
  const lead = /^<p>([\s\S]*?)<\/p>\s*/.exec(inner);
  if (lead) {
    const rest = inner.slice(lead[0].length);
    if (!rest.includes("<p>")) inner = (lead[1] + rest).trim();
  }
  return `<li>${inner}</li>`;
}

function renderTask(node: SyntaxNode, ctx: Context): string {
  const marker = node.firstChild;
  const checked = marker
    ? /[xX]/.test(ctx.src.slice(marker.from, marker.to))
    : false;
  const rest = renderRange(node, marker ? marker.to : node.from, node.to, ctx).trim();
  const box = `<input type="checkbox" disabled${checked ? " checked" : ""}> `;
  return box + rest;
}

function renderCode(node: SyntaxNode, ctx: Context): string {
  let language = "";
  let text = "";
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "CodeInfo") language = ctx.src.slice(child.from, child.to).trim();
    if (child.name === "CodeText") text = ctx.src.slice(child.from, child.to);
  }
  // Un bloque indentado no tiene CodeText: el cuerpo es el nodo entero.
  if (!text && node.name === "CodeBlock") {
    text = ctx.src.slice(node.from, node.to).replace(/^ {4}/gm, "");
  }
  const cls = language ? ` class="language-${escapeAttribute(language)}"` : "";
  if (language.toLowerCase() === "mermaid") {
    return `<div class="mermaid-diagram" data-mermaid="${escapeAttribute(text)}"><pre><code>${escapeHtml(text)}</code></pre></div>`;
  }
  return `<pre><code${cls}>${escapeHtml(text)}</code></pre>`;
}

function prepareMarkdown(source: string): { markdown: string; footnotes: string[] } {
  const footnotes: string[] = [];
  const definitions = new Map<string, string>();
  const lines = source.split(/\r?\n/).filter((line) => {
    const match = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(line);
    if (!match) return true;
    definitions.set(match[1], match[2]);
    return false;
  });
  let markdown = lines.join("\n");
  markdown = markdown.replace(/(^|\n)>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n((?:>.*(?:\n|$))*)/gi, (_all, prefix: string, kind: string, quoted: string) => {
    const text = quoted.split(/\r?\n/).map((line) => line.replace(/^>\s?/, "")).filter(Boolean).join(" ");
    const label = kind[0].toUpperCase() + kind.slice(1).toLowerCase();
    return `${prefix}<aside class="markdown-alert ${kind.toLowerCase()}"><strong>${label}</strong><p>${escapeHtml(text)}</p></aside>\n`;
  });
  // El parser GFM trata las URL desnudas como nodos silenciosos; convertirlas
  // a enlaces explícitos conserva su texto y evita párrafos vacíos.
  markdown = markdown.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (_all, prefix: string, url: string) => `${prefix}[${url}](${url})`);
  markdown = markdown.replace(/\[\^([^\]]+)\]/g, (_all, id: string) => {
    const number = footnotes.length + 1;
    if (!footnotes.some((entry) => entry.startsWith(`${id}::`))) {
      footnotes.push(`${id}::${definitions.get(id) ?? ""}`);
    }
    return `<sup class="footnote-ref"><a href="#fn-${escapeAttribute(id)}">${number}</a></sup>`;
  });
  return { markdown, footnotes };
}

function enhanceInline(html: string): string {
  return html.split(/(<[^>]+>)/g).map((part) => {
    if (part.startsWith("<")) return part;
    return part
      .replace(/\^(\S[^\^\n]*?)\^/g, "<sup>$1</sup>")
      .replace(/~(\S[^~\n]*?)~/g, "<sub>$1</sub>")
      .replace(/(?<![\w"'=])(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  }).join("");
}

function renderTable(node: SyntaxNode, ctx: Context): string {
  // La fila de guiones define la alineación de cada columna.
  const aligns: string[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name !== "TableDelimiter") continue;
    const raw = ctx.src.slice(child.from, child.to);
    if (!raw.includes("-")) continue;
    for (const spec of raw.split("|").map((s) => s.trim()).filter(Boolean)) {
      const left = spec.startsWith(":");
      const right = spec.endsWith(":");
      aligns.push(left && right ? "center" : right ? "right" : "left");
    }
    break;
  }

  const cells = (row: SyntaxNode, tag: "th" | "td"): string => {
    let out = "";
    let index = 0;
    for (let cell = row.firstChild; cell; cell = cell.nextSibling) {
      if (cell.name !== "TableCell") continue;
      const align = aligns[index++] ?? "left";
      out += `<${tag} style="text-align:${align}">${renderChildren(cell, ctx).trim()}</${tag}>`;
    }
    return `<tr>${out}</tr>`;
  };

  let head = "";
  let body = "";
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "TableHeader") head = cells(child, "th");
    else if (child.name === "TableRow") body += cells(child, "td");
  }
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/** Extrae destino y título de un enlace o imagen. */
function linkTarget(node: SyntaxNode, ctx: Context): { url: string; title: string } {
  let url = "";
  let title = "";
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "URL") url = ctx.src.slice(child.from, child.to);
    if (child.name === "LinkTitle") title = ctx.src.slice(child.from + 1, child.to - 1);
  }
  return { url, title };
}

/** Contenido visible de un enlace: lo que hay entre el primer `[` y el `]`. */
function linkLabelRange(node: SyntaxNode, ctx: Context): { from: number; to: number } {
  let from = node.from;
  let to = node.to;
  let seenOpen = false;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name !== "LinkMark") continue;
    const raw = ctx.src.slice(child.from, child.to);
    if (!seenOpen && (raw === "[" || raw === "![")) {
      from = child.to;
      seenOpen = true;
    } else if (seenOpen && raw === "]") {
      to = child.from;
      break;
    }
  }
  return { from, to };
}

function renderNode(node: SyntaxNode, ctx: Context): string {
  const name = node.name;
  if (SILENT.has(name)) return "";

  if (name.startsWith("ATXHeading") || name.startsWith("SetextHeading")) {
    return renderHeading(node, Number(name.slice(-1)), ctx);
  }

  switch (name) {
    case "Document": {
      // Los bloques de primer nivel se separan con un salto para que el HTML
      // exportado sea legible. Anidados no: ahí el salto acaba dentro de un
      // <li> o un <blockquote> y ensucia el resultado.
      const blocks: string[] = [];
      for (let child = node.firstChild; child; child = child.nextSibling) {
        const html = renderNode(child, ctx);
        if (html) blocks.push(html);
      }
      return blocks.join("\n");
    }

    case "Paragraph":
      return `<p>${renderChildren(node, ctx).trim()}</p>`;

    case "Blockquote":
      return `<blockquote>${renderChildren(node, ctx)}</blockquote>`;

    case "BulletList":
      return `<ul>${renderChildren(node, ctx)}</ul>`;

    case "OrderedList": {
      const first = /^\s*(\d+)/.exec(ctx.src.slice(node.from, node.to))?.[1] ?? "1";
      const start = first === "1" ? "" : ` start="${first}"`;
      return `<ol${start}>${renderChildren(node, ctx)}</ol>`;
    }

    case "ListItem":
      return renderListItem(node, ctx);

    case "Task":
      return renderTask(node, ctx);

    case "FencedCode":
    case "CodeBlock":
      return renderCode(node, ctx);

    case "HorizontalRule":
      return "<hr>";

    case "Table":
      return renderTable(node, ctx);

    case "Emphasis":
      return `<em>${renderChildren(node, ctx)}</em>`;

    case "StrongEmphasis":
      return `<strong>${renderChildren(node, ctx)}</strong>`;

    case "Strikethrough":
      return `<del>${renderChildren(node, ctx)}</del>`;

    case "InlineCode": {
      const text = ctx.src.slice(node.from, node.to).replace(/^`+|`+$/g, "");
      return `<code>${escapeHtml(text.trim())}</code>`;
    }

    case "Image": {
      const { url, title } = linkTarget(node, ctx);
      const label = linkLabelRange(node, ctx);
      const alt = ctx.src.slice(label.from, label.to);
      const titleAttr = title ? ` title="${escapeAttribute(title)}"` : "";
      return `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(alt)}"${titleAttr}>`;
    }

    case "Link": {
      const { url, title } = linkTarget(node, ctx);
      const label = linkLabelRange(node, ctx);
      const inner = renderRange(node, label.from, label.to, ctx);
      const titleAttr = title ? ` title="${escapeAttribute(title)}"` : "";
      return `<a href="${escapeAttribute(url)}"${titleAttr}>${inner}</a>`;
    }

    case "Autolink": {
      const url = ctx.src.slice(node.from, node.to).replace(/^<|>$/g, "");
      return `<a href="${escapeAttribute(url)}">${escapeHtml(url)}</a>`;
    }

    case "Escape":
      return escapeHtml(ctx.src.slice(node.from + 1, node.to));

    case "HardBreak":
      return "<br>";

    // El HTML del propio documento se respeta: es Markdown, no texto plano.
    case "HTMLBlock":
    case "HTMLTag":
      return ctx.src.slice(node.from, node.to);

    default:
      return renderChildren(node, ctx);
  }
}

export function markdownToHtml(markdown: string): string {
  const prepared = prepareMarkdown(markdown);
  const tree = parser.parse(prepared.markdown);
  const ctx: Context = { src: prepared.markdown, usedIds: new Map() };
  let body = enhanceInline(renderNode(tree.topNode, ctx).trim());
  if (prepared.footnotes.length) {
    body += `\n<section class="footnotes"><h2>Notas</h2><ol>${prepared.footnotes.map((entry) => {
      const [id, text] = entry.split("::");
      return `<li id="fn-${escapeAttribute(id)}">${enhanceInline(escapeHtml(text))} <a href="#fnref-${escapeAttribute(id)}">↩</a></li>`;
    }).join("")}</ol></section>`;
  }
  return body;
}
