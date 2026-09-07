import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/**
 * Detección de fórmulas en línea `$…$`.
 *
 * Va aparte del renderizado a propósito: aquí no se toca el DOM ni se importa
 * KaTeX, así que se puede probar con Node sin abrir la aplicación. Es la parte
 * que más falsos positivos puede dar, porque el delimitador es un solo carácter
 * que también sirve para poner precios.
 */

const DOLLAR = "$";

export interface MathRange {
  from: number;
  to: number;
  tex: string;
}

/** ¿Está esta posición dentro de código, donde un `$` es sólo un `$`? */
function insideCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, 1);
  while (node.parent) {
    if (
      node.name === "InlineCode" ||
      node.name === "FencedCode" ||
      node.name === "CodeBlock" ||
      node.name === "CodeText"
    ) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

/**
 * Fórmulas en línea dentro de un rango.
 *
 * Se buscan con una pasada de texto y no con una extensión del analizador de
 * Markdown: el delimitador es un único carácter, y una gramática nueva traería
 * más casos límite que los que resolvería. Del árbol sólo se necesita saber si
 * la posición cae dentro de código.
 */
export function inlineMath(state: EditorState, from: number, to: number): MathRange[] {
  const found: MathRange[] = [];
  const startLine = state.doc.lineAt(from).number;
  const endLine = state.doc.lineAt(to).number;

  for (let n = startLine; n <= endLine; n++) {
    const line = state.doc.line(n);
    const text = line.text;

    for (let i = 0; i < text.length; i++) {
      if (text[i] !== DOLLAR) continue;
      // Escapado: `\$` es un dólar literal.
      if (i > 0 && text[i - 1] === "\\") continue;
      // `$$` en línea es el delimitador de bloque, no de fórmula suelta.
      if (text[i + 1] === DOLLAR) {
        i++;
        continue;
      }
      // Sin espacio pegado a la apertura.
      if (!text[i + 1] || /\s/.test(text[i + 1])) continue;

      let close = -1;
      for (let j = i + 1; j < text.length; j++) {
        if (text[j] !== DOLLAR || text[j - 1] === "\\") continue;
        // Ni pegado al cierre: es lo que distingue «$e^x$» de «$20 y otro de
        // $35», donde el cierre candidato viene precedido de un espacio.
        if (/\s/.test(text[j - 1])) continue;
        close = j;
        break;
      }
      if (close === -1 || close === i + 1) continue;

      // Un dígito justo detrás del cierre delata otra cantidad, no el final de
      // una fórmula: «$20$35».
      if (/\d/.test(text[close + 1] ?? "")) continue;

      // Una fórmula no contiene otro `$` sin escapar. Sin esto, «$20 pero
      // $x=1$» emparejaba el primer dólar con el último y se tragaba el precio
      // y la fórmula de en medio. Al rechazar, el bucle vuelve a intentarlo
      // desde el siguiente dólar, que aquí sí es la apertura correcta.
      const body = text.slice(i + 1, close);
      let inner = false;
      for (let k = 0; k < body.length; k++) {
        if (body[k] === DOLLAR && body[k - 1] !== "\\") {
          inner = true;
          break;
        }
      }
      if (inner) continue;

      const start = line.from + i;
      if (!insideCode(state, start)) {
        found.push({ from: start, to: line.from + close + 1, tex: text.slice(i + 1, close) });
      }
      i = close;
    }
  }

  return found;
}
