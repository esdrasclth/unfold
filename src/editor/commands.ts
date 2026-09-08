import type { ChangeSpec, StateCommand } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";

/**
 * Envuelve (o desenvuelve, si ya lo está) cada selección con un marcador de
 * Markdown. Con la selección vacía inserta el par y deja el cursor en medio,
 * que es lo que uno espera al pulsar Ctrl+B antes de escribir.
 */
function toggleWrap(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    const changes: ChangeSpec[] = [];
    const len = mark.length;

    const selection = state.changeByRange((range) => {
      const before = state.doc.sliceString(range.from - len, range.from);
      const after = state.doc.sliceString(range.to, range.to + len);

      // Ya envuelto por fuera de la selección: lo quitamos.
      if (before === mark && after === mark) {
        return {
          changes: [
            { from: range.from - len, to: range.from },
            { from: range.to, to: range.to + len },
          ],
          range: EditorSelection.range(range.from - len, range.to - len),
        };
      }

      const inner = state.doc.sliceString(range.from, range.to);
      // Ya envuelto por dentro de la selección: lo quitamos también.
      if (inner.length >= len * 2 && inner.startsWith(mark) && inner.endsWith(mark)) {
        return {
          changes: [
            { from: range.from, to: range.from + len },
            { from: range.to - len, to: range.to },
          ],
          range: EditorSelection.range(range.from, range.to - len * 2),
        };
      }

      return {
        changes: [
          { from: range.from, insert: mark },
          { from: range.to, insert: mark },
        ],
        range: range.empty
          ? EditorSelection.cursor(range.from + len)
          : EditorSelection.range(range.from + len, range.to + len),
      };
    });

    if (changes.length === 0 && selection.changes.empty) return false;
    dispatch(state.update(selection, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

export const toggleBold = toggleWrap("**");
export const toggleItalic = toggleWrap("*");
export const toggleInlineCode = toggleWrap("`");
export const toggleStrikethrough = toggleWrap("~~");

/** Añade o quita un prefijo Markdown en cada línea tocada por la selección. */
export function toggleLinePrefix(prefix: string): StateCommand {
  return ({ state, dispatch }) => {
    const lines = new Map<number, { from: number; to: number; text: string }>();
    for (const range of state.selection.ranges) {
      let pos = range.from;
      while (pos <= range.to) {
        const line = state.doc.lineAt(pos);
        lines.set(line.number, line);
        if (line.to >= range.to) break;
        pos = line.to + 1;
      }
    }

    const changes = [...lines.values()].map((line) => ({
      from: line.from,
      to: line.from + (line.text.startsWith(prefix) ? prefix.length : 0),
      insert: line.text.startsWith(prefix) ? "" : prefix,
    }));
    if (changes.length === 0) return false;
    dispatch(state.update({ changes, userEvent: "input.format" }));
    return true;
  };
}

/** Inserta un bloque listo para editar y coloca el cursor en su zona útil. */
export function insertMarkdownBlock(text: string, cursorOffset = text.length): StateCommand {
  return ({ state, dispatch }) => {
    const range = state.selection.main;
    const before = range.from > 0 && state.doc.sliceString(range.from - 1, range.from) !== "\n" ? "\n" : "";
    const after = range.to < state.doc.length && state.doc.sliceString(range.to, range.to + 1) !== "\n" ? "\n" : "";
    const insert = `${before}${text}${after}`;
    const start = range.from + before.length;
    dispatch(state.update({
      changes: { from: range.from, to: range.to, insert },
      selection: EditorSelection.cursor(start + cursorOffset),
      scrollIntoView: true,
      userEvent: "input.format",
    }));
    return true;
  };
}

/** Inserta una construcción en línea sin añadir saltos de párrafo. */
export function insertMarkdownSnippet(text: string, cursorOffset = text.length): StateCommand {
  return ({ state, dispatch }) => {
    const range = state.selection.main;
    dispatch(state.update({
      changes: { from: range.from, to: range.to, insert: text },
      selection: EditorSelection.cursor(range.from + cursorOffset),
      scrollIntoView: true,
      userEvent: "input.format",
    }));
    return true;
  };
}

/** Convierte las líneas seleccionadas en tareas o quita su casilla. */
export const toggleTask: StateCommand = ({ state, dispatch }) => {
  const lines = new Map<number, { from: number; text: string }>();
  for (const range of state.selection.ranges) {
    let pos = range.from;
    while (pos <= range.to) {
      const line = state.doc.lineAt(pos);
      lines.set(line.number, line);
      if (line.to >= range.to) break;
      pos = line.to + 1;
    }
  }
  const changes = [...lines.values()].map((line) => {
    const task = /^(-\s+)\[[ xX]\](\s*)/.exec(line.text);
    if (task) {
      return { from: line.from, to: line.from + task[0].length, insert: task[1] };
    }
    const bullet = /^(-\s+)/.exec(line.text);
    return {
      from: line.from,
      to: line.from + (bullet ? bullet[0].length : 0),
      insert: `${bullet?.[0] ?? "- "}[ ] `,
    };
  });
  if (changes.length === 0) return false;
  dispatch(state.update({ changes, userEvent: "input.format" }));
  return true;
};

/** Envuelve la selección en un bloque de código cercado. */
export const insertCodeFence: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  const selected = state.doc.sliceString(range.from, range.to);
  const text = `\`\`\`\n${selected}\n\`\`\``;
  dispatch(state.update({
    changes: { from: range.from, to: range.to, insert: text },
    selection: EditorSelection.range(range.from + 4, range.from + 4 + selected.length),
    scrollIntoView: true,
    userEvent: "input.format",
  }));
  return true;
};

/** Convierte las líneas tocadas por la selección al nivel de encabezado dado. */
export function setHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    const changes: ChangeSpec[] = [];
    const seen = new Set<number>();

    for (const range of state.selection.ranges) {
      let pos = range.from;
      while (pos <= range.to) {
        const line = state.doc.lineAt(pos);
        if (!seen.has(line.number)) {
          seen.add(line.number);
          const existing = /^(#{1,6})\s+/.exec(line.text);
          const prefix = level === 0 ? "" : `${"#".repeat(level)} `;
          changes.push({
            from: line.from,
            to: line.from + (existing ? existing[0].length : 0),
            insert: prefix,
          });
        }
        if (line.to >= range.to) break;
        pos = line.to + 1;
      }
    }

    if (changes.length === 0) return false;
    dispatch(state.update({ changes, userEvent: "input.format" }));
    return true;
  };
}

/** Inserta un enlace usando la selección como texto visible. */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const selection = state.changeByRange((range) => {
    const text = state.doc.sliceString(range.from, range.to);
    const insert = `[${text}]()`;
    return {
      changes: { from: range.from, to: range.to, insert },
      // El cursor cae dentro de los paréntesis, listo para pegar la URL.
      range: EditorSelection.cursor(range.from + insert.length - 1),
    };
  });
  dispatch(state.update(selection, { scrollIntoView: true, userEvent: "input.format" }));
  return true;
};
