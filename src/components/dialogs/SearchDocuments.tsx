import { PickerDialog } from "./PickerDialog.tsx";

export interface Hit {
  rootId: number;
  rootName: string;
  path: string;
  relative: string;
  line: number;
  text: string;
  from: number;
  to: number;
}

export interface SearchDocumentsProps {
  query: string;
  hits: readonly Hit[];
  truncated: boolean;
  /** Lo que se dice cuando no hay resultados que enseñar. */
  notice: string | null;
  activeIndex: number;
  onQuery: (query: string) => void;
  onActive: (index: number) => void;
  onOpen: (hit: Hit) => void;
  onClose: () => void;
}

export function recuento(total: number, truncated: boolean): string {
  if (truncated) return `${total}+ resultados`;
  return total === 1 ? "1 resultado" : `${total} resultados`;
}

/**
 * Buscar en todos los documentos.
 *
 * `Ctrl+F` busca dentro del documento abierto; esto es lo otro, que es lo que
 * hace falta con un árbol de cuarenta archivos delante: en cuál de todos está
 * esa frase.
 *
 * Los resultados se agrupan por archivo porque lo que se decide primero es a
 * qué documento ir, no a qué línea. La cabecera se pinta antes de la primera
 * coincidencia de cada archivo, pero no cuenta como fila elegible: las flechas
 * recorren coincidencias, no encabezados.
 */
export function SearchDocuments({
  query,
  hits,
  truncated,
  notice,
  activeIndex,
  onQuery,
  onActive,
  onOpen,
  onClose,
}: SearchDocumentsProps) {
  return (
    <PickerDialog<Hit>
      label="Buscar en los documentos"
      variant="buscador"
      placeholder="Buscar en todos los documentos…"
      inputLabel="Buscar en todos los documentos"
      query={query}
      onQuery={onQuery}
      items={hits}
      activeIndex={activeIndex}
      onActive={onActive}
      onRun={onOpen}
      onClose={onClose}
      empty={<p class="command-palette-empty">{notice ?? ""}</p>}
      footer={
        <>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> moverse
          </span>
          <span>
            <kbd>↵</kbd> abrir
          </span>
          <span>
            <kbd>Esc</kbd> cerrar
          </span>
          <span class="buscador-cuenta">{hits.length > 0 ? recuento(hits.length, truncated) : ""}</span>
        </>
      }
      renderItem={(hit, index, active) => {
        const anterior = hits[index - 1];
        const abreArchivo =
          !anterior || anterior.rootId !== hit.rootId || anterior.relative !== hit.relative;
        return (
          <>
            {abreArchivo && (
              <p class="buscador-archivo" key={`cabecera-${hit.rootId}-${hit.relative}`}>
                <strong>{hit.relative}</strong>
                <span>{hit.rootName}</span>
              </p>
            )}
            <button
              key={`${hit.path}:${hit.line}:${hit.from}`}
              type="button"
              class={`buscador-hit${active ? " is-active" : ""}`}
              role="option"
              aria-selected={active}
              onClick={() => onOpen(hit)}
              onMouseMove={() => {
                if (index !== activeIndex) onActive(index);
              }}
            >
              <span class="buscador-linea">{hit.line}</span>
              {/*
                Se resalta el trozo que coincide: es lo que explica por qué esa
                línea está en la lista. Va troceado como texto, no interpolado:
                la línea viene de un archivo del disco.
              */}
              <span class="buscador-texto">
                {hit.text.slice(0, hit.from)}
                <mark>{hit.text.slice(hit.from, hit.to)}</mark>
                {hit.text.slice(hit.to)}
              </span>
            </button>
          </>
        );
      }}
    />
  );
}
