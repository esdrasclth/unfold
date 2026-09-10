import { folderOf, whenLabel, type RecentFile } from "../../recent.ts";

export interface RecentMenuProps {
  files: readonly RecentFile[];
  onOpen: (path: string) => void;
  onForget: (path: string) => void;
  onBrowse: () => void;
  [key: string]: unknown;
}

/**
 * La lista de documentos recientes.
 *
 * Sólo pinta: abrir el menú, colocarlo bajo su botón, cerrarlo al pulsar fuera
 * y mover el foco con las flechas son cosa del controlador, que es quien posee
 * el hueco. Aquí entra una lista y salen sus filas.
 *
 * Cada fila dice la carpeta y cuándo se abrió, que es lo que distingue dos
 * `README.md` de proyectos distintos. La ruta entera va en el título.
 */
export function RecentMenu({ files, onOpen, onForget, onBrowse }: RecentMenuProps) {
  return (
    <>
      <div class="menu-head">Recientes</div>

      {files.length === 0 && (
        <p class="menu-empty">Todavía no has abierto ningún archivo.</p>
      )}

      {files.map((file) => (
        <button
          key={file.path}
          type="button"
          class="menu-item"
          role="menuitem"
          title={file.path}
          onClick={() => onOpen(file.path)}
        >
          <span class="menu-item-name">{file.name}</span>
          <span class="menu-item-meta">
            {folderOf(file.path)} · {whenLabel(file.opened)}
          </span>
          <span
            class="menu-item-forget"
            role="button"
            title="Quitar de la lista"
            aria-label={`Quitar ${file.name} de la lista`}
            onClick={(event) => {
              // Sin esto, quitar una entrada abriría antes el documento.
              event.stopPropagation();
              onForget(file.path);
            }}
          >
            ×
          </span>
        </button>
      ))}

      <button type="button" class="menu-item is-action" role="menuitem" onClick={() => onBrowse()}>
        Buscar en el disco…
      </button>
    </>
  );
}
