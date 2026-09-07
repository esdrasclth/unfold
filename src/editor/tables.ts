import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type StateCommand } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export interface TableCell {
  /** Inicio del contenido de la celda, ya sin los espacios de relleno. */
  from: number;
  to: number;
}

export interface TableRow {
  cells: TableCell[];
  /** La fila de guiones (`| --- |`) sólo define alineación, no se navega. */
  delimiter: boolean;
}

export interface TableModel {
  from: number;
  to: number;
  rows: TableRow[];
}

const DELIMITER_ROW = /^[\s|:-]+$/;

/**
 * Localiza las celdas de una línea de tabla en coordenadas absolutas del
 * documento. Respeta las barras escapadas (`\|`), que forman parte del texto.
 */
function cellsOfLine(text: string, offset: number): TableCell[] {
  const bounds: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "|" && text[i - 1] !== "\\") bounds.push(i);
  }
  if (bounds.length === 0) return [];

  const cells: TableCell[] = [];
  const trimmed = text.trimEnd();
  const startsWithPipe = trimmed.trimStart().startsWith("|");

  for (let i = 0; i < bounds.length; i++) {
    const start = bounds[i] + 1;
    const end = i + 1 < bounds.length ? bounds[i + 1] : trimmed.length;
    // Sin barra final, el texto tras la última barra sigue siendo una celda.
    if (i + 1 >= bounds.length && trimmed.slice(start).trim() === "") break;

    const slice = text.slice(start, end);
    const lead = slice.length - slice.trimStart().length;
    const trail = slice.length - slice.trimEnd().length;
    cells.push({ from: offset + start + lead, to: offset + end - trail });
  }

  // Con barra inicial, lo anterior a ella es relleno, no una celda.
  if (!startsWithPipe && bounds[0] > 0) {
    const slice = text.slice(0, bounds[0]);
    const lead = slice.length - slice.trimStart().length;
    const trail = slice.length - slice.trimEnd().length;
    cells.unshift({ from: offset + lead, to: offset + bounds[0] - trail });
  }

  return cells;
}

/** Construye el modelo de una tabla a partir de su texto fuente. */
export function parseTableSource(source: string, from: number): TableModel {
  const rows: TableRow[] = [];
  let offset = from;

  for (const line of source.split("\n")) {
    if (line.trim().length > 0) {
      rows.push({
        cells: cellsOfLine(line, offset),
        delimiter: DELIMITER_ROW.test(line) && line.includes("-"),
      });
    }
    offset += line.length + 1;
  }

  return { from, to: offset - 1, rows };
}

/** Nodo `Table` que contiene la posición dada, si lo hay. */
function tableNodeAt(state: EditorState, pos: number): SyntaxNode | null {
  let node = syntaxTree(state).resolveInner(pos, -1);
  while (node.parent) {
    if (node.name === "Table") return node;
    node = node.parent;
  }
  return null;
}

export function tableAt(state: EditorState, pos: number): TableModel | null {
  const node = tableNodeAt(state, pos);
  if (!node) return null;
  const first = state.doc.lineAt(node.from);
  const last = state.doc.lineAt(node.to);
  return parseTableSource(state.doc.sliceString(first.from, last.to), first.from);
}

/** Aplana la tabla a la secuencia de celdas navegables, en orden de lectura. */
function navigableCells(table: TableModel): TableCell[] {
  return table.rows.filter((row) => !row.delimiter).flatMap((row) => row.cells);
}

function indexOfCellAt(cells: TableCell[], pos: number): number {
  for (let i = 0; i < cells.length; i++) {
    if (pos >= cells[i].from && pos <= cells[i].to) return i;
  }
  // Entre dos celdas (sobre una barra): nos quedamos con la anterior.
  for (let i = cells.length - 1; i >= 0; i--) {
    if (pos > cells[i].to) return i;
  }
  return 0;
}

/** Selecciona el contenido de una celda, listo para sobrescribirlo. */
function selectCell(cell: TableCell): EditorSelection {
  return EditorSelection.single(cell.from, cell.to);
}

function moveBy(step: number): StateCommand {
  return ({ state, dispatch }) => {
    const pos = state.selection.main.head;
    const table = tableAt(state, pos);
    if (!table) return false;

    const cells = navigableCells(table);
    if (cells.length === 0) return false;

    const index = indexOfCellAt(cells, pos) + step;

    // Tabulando más allá de la última celda, añadimos una fila nueva.
    if (index >= cells.length) {
      const columns = table.rows.find((row) => !row.delimiter)?.cells.length ?? 1;
      const blank = `\n| ${Array.from({ length: columns }, () => " ").join("| ")}|`;
      const insertAt = table.to;
      dispatch(
        state.update({
          changes: { from: insertAt, insert: blank },
          selection: EditorSelection.cursor(insertAt + 3),
          scrollIntoView: true,
          userEvent: "input.table",
        }),
      );
      return true;
    }

    if (index < 0) return false;
    dispatch(state.update({ selection: selectCell(cells[index]), scrollIntoView: true }));
    return true;
  };
}

export const nextCell = moveBy(1);
export const previousCell = moveBy(-1);

/** Enter dentro de una tabla salta a la primera celda de la fila siguiente. */
export const nextRow: StateCommand = ({ state, dispatch }) => {
  const pos = state.selection.main.head;
  const table = tableAt(state, pos);
  if (!table) return false;

  const body = table.rows.filter((row) => !row.delimiter);
  const current = body.findIndex((row) =>
    row.cells.some((cell) => pos >= cell.from && pos <= cell.to),
  );
  if (current === -1) return false;

  const following = body[current + 1];
  if (following && following.cells.length > 0) {
    dispatch(state.update({ selection: selectCell(following.cells[0]), scrollIntoView: true }));
    return true;
  }

  const columns = body[0]?.cells.length ?? 1;
  const blank = `\n| ${Array.from({ length: columns }, () => " ").join("| ")}|`;
  dispatch(
    state.update({
      changes: { from: table.to, insert: blank },
      selection: EditorSelection.cursor(table.to + 3),
      scrollIntoView: true,
      userEvent: "input.table",
    }),
  );
  return true;
};
