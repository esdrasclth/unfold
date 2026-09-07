import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { markdownFromHtml } from "./markdownFromHtml.ts";

export interface PasteOptions {
  /** Guarda una imagen y devuelve la ruta relativa, o null si no se puede. */
  saveImage: (data: Uint8Array, mime: string) => Promise<string | null>;
  /** Mensaje breve para el usuario (por ejemplo, si aún no hay archivo). */
  notify: (message: string) => void;
}

/**
 * Etiquetas que indican que el HTML del portapapeles lleva formato real.
 * Copiar desde un editor de código también produce `text/html`, pero solo con
 * `<span>` de color: ahí convertir haría más daño que bien.
 */
const MEANINGFUL = "a,b,strong,i,em,del,s,code,pre,img,h1,h2,h3,h4,h5,h6,ul,ol,table,blockquote,hr";

function hasRealFormatting(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.querySelector(MEANINGFUL) !== null;
}

function imageFromClipboard(data: DataTransfer): File | null {
  for (const item of Array.from(data.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

function insert(view: EditorView, text: string): void {
  view.dispatch(
    view.state.changeByRange((range) => ({
      changes: { from: range.from, to: range.to, insert: text },
      range: EditorSelection.cursor(range.from + text.length),
    })),
    { scrollIntoView: true, userEvent: "input.paste" },
  );
}

/** Pega el portapapeles como texto plano, sin convertir nada. */
function pastePlain(view: EditorView): boolean {
  void navigator.clipboard.readText().then((text) => {
    if (text) insert(view, text);
  });
  return true;
}

export function smartPaste(options: PasteOptions): Extension {
  return [
    EditorView.domEventHandlers({
      paste(event, view) {
        const data = event.clipboardData;
        if (!data) return false;

        // 1. Una imagen del portapapeles se guarda en disco y se enlaza.
        const image = imageFromClipboard(data);
        if (image) {
          event.preventDefault();
          void (async () => {
            const buffer = new Uint8Array(await image.arrayBuffer());
            const relative = await options.saveImage(buffer, image.type);
            if (relative) insert(view, `![](${relative})`);
          })();
          return true;
        }

        // 2. HTML con formato real se convierte a Markdown.
        const html = data.getData("text/html");
        if (html && hasRealFormatting(html)) {
          const markdown = markdownFromHtml(html);
          if (markdown) {
            event.preventDefault();
            insert(view, markdown);
            return true;
          }
        }

        // 3. Cualquier otra cosa: comportamiento normal de CodeMirror.
        return false;
      },
    }),
    keymap.of([{ key: "Mod-Shift-v", run: pastePlain }]),
  ];
}
