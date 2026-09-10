import type { Heading } from "../../editor/headings.ts";

export interface OutlineListProps {
  headings: readonly Heading[];
  /** Índice del encabezado donde está el cursor, o -1 si ninguno. */
  activeIndex: number;
  onGo: (from: number) => void;
  [key: string]: unknown;
}

/** Sangrado máximo: más allá, la lista se va toda al margen derecho. */
const MAX_SANGRIA = 3;

/**
 * El esquema del documento.
 *
 * El nivel más alto presente marca el margen, para que un documento que empieza
 * en H2 no aparezca sangrado sin motivo, y a partir de ahí se sangra
 * relativamente. Un encabezado vacío se enseña como «(sin título)»: la fila
 * tiene que poder pulsarse igual, porque el sitio del documento existe.
 *
 * Sólo pinta. El ancho del panel, el plegado y de dónde salen los encabezados
 * son cosa del controlador.
 */
export function OutlineList({ headings, activeIndex, onGo }: OutlineListProps) {
  if (headings.length === 0) {
    return <p class="outline-empty">Los encabezados del documento aparecerán aquí.</p>;
  }

  const superior = Math.min(...headings.map((h) => h.level));

  return (
    <>
      {headings.map((heading, index) => {
        const rotulo = heading.text || "(sin título)";
        const activo = index === activeIndex;
        return (
          <button
            key={`${heading.from}:${rotulo}`}
            type="button"
            class={`outline-item level-${Math.min(heading.level - superior, MAX_SANGRIA)}${activo ? " is-active" : ""}`}
            title={rotulo}
            // Dice dónde estás dentro del documento, que es justo para lo que
            // se mira el esquema.
            aria-current={activo ? "true" : undefined}
            // Tabulación itinerante: recorrer treinta encabezados con el
            // tabulador para salir del panel sería peor que no llegar a ellos.
            tabindex={activo || (activeIndex < 0 && index === 0) ? 0 : -1}
            onClick={() => onGo(heading.from)}
          >
            {rotulo}
          </button>
        );
      })}
    </>
  );
}
