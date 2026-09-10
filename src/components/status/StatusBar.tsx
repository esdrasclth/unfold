export interface StatusBarProps {
  /** Texto completo del documento; el recuento se hace aquí. */
  doc: string;
  line: number;
  column: number;
  [key: string]: unknown;
}

/** Palabras por minuto de una lectura normal en pantalla. */
const RITMO_DE_LECTURA = 200;

export function contarPalabras(doc: string): number {
  const limpio = doc.trim();
  return limpio ? limpio.split(/\s+/).length : 0;
}

export function minutosDeLectura(palabras: number): number {
  // Nunca cero: «0 min de lectura» no dice nada y un documento con una línea
  // sigue costando un momento leerlo.
  return Math.max(1, Math.round(palabras / RITMO_DE_LECTURA));
}

/**
 * Barra de estado: recuento y posición del cursor.
 *
 * Contar es cosa suya y no de quien la llama: antes `main.ts` calculaba las
 * palabras y escribía en tres `span` por su cuenta, así que el recuento vivía
 * lejos de donde se enseña. Aquí entra el documento y sale lo que se lee.
 *
 * Va en un `contentinfo` con `aria-live` educado: cambia a cada pulsación, y
 * anunciarlo con urgencia interrumpiría a quien está escribiendo.
 */
export function StatusBar({ doc, line, column }: StatusBarProps) {
  const palabras = contarPalabras(doc);
  return (
    <>
      <span id="stat-words">
        {palabras.toLocaleString("es")} {palabras === 1 ? "palabra" : "palabras"}
      </span>
      <span id="stat-chars">{doc.length.toLocaleString("es")} caracteres</span>
      <span id="stat-read">{minutosDeLectura(palabras)} min de lectura</span>
      <span id="stat-caret" aria-label={`Línea ${line}, columna ${column}`}>
        Ln {line}, Col {column}
      </span>
    </>
  );
}
