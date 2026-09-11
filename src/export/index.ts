import { buildHtmlDocument } from "./document.ts";
import { isTauri } from "../files.ts";

export interface ExportContext {
  markdown: string;
  title: string;
  /** Ruta del documento, para proponer un nombre de archivo coherente. */
  documentPath: string | null;
  resolveAsset?: (src: string) => string;
  notify: (message: string) => void;
}

async function renderMermaidInHtml(html: string): Promise<string> {
  if (!html.includes("mermaid-diagram")) return html;
  try {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict" });
    const pattern = /<div class="mermaid-diagram" data-mermaid="([^"]*)">[\s\S]*?<\/div>/g;
    const matches = [...html.matchAll(pattern)];
    for (const match of matches) {
      const source = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      try {
        const { svg } = await mermaid.render(`unfold-export-${Math.random().toString(36).slice(2)}`, source);
        html = html.replace(match[0], `<div class="mermaid-diagram">${svg}</div>`);
      } catch { /* conserva el bloque fuente como fallback */ }
    }
  } catch { /* Mermaid es opcional para exportar documentos sin diagramas */ }
  return html;
}

function suggestedName(context: ExportContext, extension: string): string {
  const base = context.documentPath
    ? (context.documentPath.split(/[\\/]/).pop() ?? context.title).replace(/\.[^.]+$/, "")
    : context.title;
  return `${base || "documento"}.${extension}`;
}

/** Guarda un `.html` autocontenido en la ruta que elija el usuario. */
export async function exportHtml(context: ExportContext): Promise<void> {
  const html = await renderMermaidInHtml(buildHtmlDocument(context.markdown, {
    title: context.title,
    resolveAsset: context.resolveAsset,
  }));

  if (!isTauri) {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = suggestedName(context, "html");
    anchor.click();
    URL.revokeObjectURL(url);
    return;
  }

  const { save } = await import("@tauri-apps/plugin-dialog");
  const target = await save({
    defaultPath: suggestedName(context, "html"),
    filters: [{ name: "Página web", extensions: ["html"] }],
  });
  if (!target) return;

  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  await writeTextFile(target, html);
  context.notify(`Exportado a ${target.split(/[\\/]/).pop()}`);
}

/**
 * Abre el diálogo de impresión con el documento ya maquetado.
 *
 * Se imprime un iframe oculto y no la ventana: lo que hay en pantalla es el
 * editor, con su sintaxis a medio ocultar y su barra de herramientas. Desde el
 * diálogo, «Microsoft Print to PDF» produce el PDF.
 */
export async function printDocument(context: ExportContext): Promise<void> {
  const html = await renderMermaidInHtml(buildHtmlDocument(context.markdown, {
    title: context.title,
    resolveAsset: context.resolveAsset,
  }));

  const previous = document.querySelector<HTMLIFrameElement>("iframe[data-unfold-print]");
  if (previous) previous.remove();

  const frame = document.createElement("iframe");
  frame.dataset.unfoldPrint = "true";
  frame.setAttribute("aria-hidden", "true");
  // Fuera de la vista pero con tamaño real: un iframe de 0px no pagina bien.
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;visibility:hidden;";

  frame.addEventListener("load", () => {
    const target = frame.contentWindow;
    if (!target) return;
    // Damos un respiro para que carguen las imágenes antes de paginar.
    window.setTimeout(() => {
      target.focus();
      target.print();
    }, 300);
  });

  document.body.appendChild(frame);
  frame.srcdoc = html;
  context.notify("Elige «Microsoft Print to PDF» para guardar en PDF");
}
