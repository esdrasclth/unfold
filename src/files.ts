/**
 * Acceso a archivos. Bajo Tauri usa el sistema de archivos nativo; en un
 * navegador normal cae a la File System Access API, de modo que `npm run dev`
 * sigue siendo utilizable sin arrancar Rust.
 */

import { convertFileSrc } from "@tauri-apps/api/core";

export interface OpenedFile {
  path: string;
  name: string;
  content: string;
}

export const isTauri = "__TAURI_INTERNALS__" in window;

const MARKDOWN_FILTER = {
  name: "Markdown",
  extensions: ["md", "markdown", "mdx", "txt"],
};

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function dirname(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join("/");
}

// --- Navegador ---------------------------------------------------------------

const browserHandles = new Map<string, FileSystemFileHandle>();

async function openInBrowser(): Promise<OpenedFile | null> {
  const picker = window.showOpenFilePicker;
  if (!picker) return null;
  const [handle] = await picker({
    types: [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown"] } }],
  });
  if (!handle) return null;
  const file = await handle.getFile();
  let path: string | undefined;
  for (const [key, existing] of browserHandles) {
    if (await existing.isSameEntry(handle)) { path = key; break; }
  }
  path ??= `browser:${crypto.randomUUID()}/${handle.name}`;
  browserHandles.set(path, handle);
  return { path, name: handle.name, content: await file.text() };
}

async function writeInBrowser(path: string | null, content: string): Promise<boolean> {
  const browserHandle = path ? browserHandles.get(path) : undefined;
  if (!browserHandle) return false;
  const writable = await browserHandle.createWritable();
  await writable.write(content);
  await writable.close();
  return true;
}

// --- Tauri -------------------------------------------------------------------

async function openInTauri(): Promise<OpenedFile | null> {
  const [{ open }, { readTextFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const selected = await open({ multiple: false, filters: [MARKDOWN_FILTER] });
  if (typeof selected !== "string") return null;
  return {
    path: selected,
    name: basename(selected),
    content: await readTextFile(selected),
  };
}

// --- API pública -------------------------------------------------------------

export async function openFile(): Promise<OpenedFile | null> {
  try {
    return await (isTauri ? openInTauri() : openInBrowser());
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return null;
    throw error;
  }
}

export async function readFile(path: string): Promise<string> {
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  return readTextFile(path);
}

/** Guarda en `path`; si no hay ruta todavía, pregunta dónde. Devuelve la ruta usada. */
export async function saveFile(path: string | null, content: string): Promise<string | null> {
  if (!isTauri) {
    if (await writeInBrowser(path, content)) return path;
    return saveFileAs(content);
  }

  let target = path;
  if (!target) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    target = await save({ defaultPath: "documento.md", filters: [MARKDOWN_FILTER] });
    if (!target) return null;
  }

  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  await writeTextFile(target, content);
  return target;
}

export async function saveFileAs(content: string): Promise<string | null> {
  if (!isTauri) {
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: "documento.md" });
        const path = `browser:${crypto.randomUUID()}/${handle.name}`;
        browserHandles.set(path, handle);
        await writeInBrowser(path, content);
        return path;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return null;
        throw error;
      }
    }
    downloadFallback("documento.md", content);
    return null;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const target = await save({ defaultPath: "documento.md", filters: [MARKDOWN_FILTER] });
  if (!target) return null;
  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  await writeTextFile(target, content);
  return target;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

export function extensionForImage(mime: string): string {
  return IMAGE_EXTENSIONS[mime] ?? "png";
}

/**
 * Guarda una imagen pegada junto al documento, en `assets/`, y devuelve la ruta
 * relativa que hay que escribir en el Markdown. Relativa a propósito: así la
 * carpeta del documento se puede mover o sincronizar sin romper los enlaces.
 */
export async function saveImageBeside(
  documentPath: string,
  data: Uint8Array,
  extension: string,
): Promise<string> {
  const { mkdir, writeFile, exists } = await import("@tauri-apps/plugin-fs");

  const folder = `${dirname(documentPath)}/assets`;
  if (!(await exists(folder))) await mkdir(folder, { recursive: true });

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "")
    .replace("T", "-");

  let name = `imagen-${stamp}.${extension}`;
  let counter = 2;
  while (await exists(`${folder}/${name}`)) {
    name = `imagen-${stamp}-${counter++}.${extension}`;
  }

  await writeFile(`${folder}/${name}`, data);
  return `assets/${name}`;
}

function downloadFallback(name: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Convierte la ruta de una imagen del Markdown en algo que el WebView pueda
 * pedir. Las rutas relativas se resuelven contra la carpeta del documento.
 *
 * Recibe un getter y no una ruta: el documento abierto cambia durante la vida
 * del editor, y una ruta capturada al construirlo se queda obsoleta en cuanto
 * se abre el primer archivo.
 */
export function makeAssetResolver(documentPath: () => string | null): (src: string) => string {
  return (src: string): string => {
    if (/^(https?:|data:|blob:)/i.test(src)) return src;
    const current = documentPath();
    if (!isTauri || !current) return src;

    const base = dirname(current);
    const absolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(src) ? src : `${base}/${src}`;
    return convertFileSrc(absolute);
  };
}
