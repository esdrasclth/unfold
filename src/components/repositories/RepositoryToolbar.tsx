import { icon } from "../../ui/icons.ts";

export interface RepositoryToolbarProps {
  query: string;
  onQuery: (query: string) => void;
  onRefresh: () => void;
  onAddFolder: () => void;
}

export function RepositoryToolbar({
  query,
  onQuery,
  onRefresh,
  onAddFolder,
}: RepositoryToolbarProps) {
  return (
    <>
      <div class="repos-head">
        <span>Explorador</span>
        <button
          type="button"
          class="repos-icon"
          id="repos-add-folder"
          title="Abrir una carpeta del disco"
          aria-label="Abrir una carpeta del disco"
          onClick={onAddFolder}
          dangerouslySetInnerHTML={{ __html: icon("plus") }}
        />
        <button
          type="button"
          class="repos-icon"
          id="repos-refresh"
          title="Actualizar el explorador"
          aria-label="Actualizar el explorador"
          onClick={onRefresh}
          dangerouslySetInnerHTML={{ __html: icon("refresh") }}
        />
      </div>
      <input
        class="repos-filter"
        id="repos-filter"
        type="search"
        placeholder="Buscar por nombre…"
        autocomplete="off"
        spellcheck={false}
        aria-label="Buscar documentos por nombre"
        value={query}
        onInput={(event) => onQuery((event.currentTarget as HTMLInputElement).value.trim())}
        onKeyDown={(event) => {
          // Escape limpia la búsqueda antes que cerrar nada: es lo que se
          // espera dentro de un campo de filtro.
          const campo = event.currentTarget as HTMLInputElement;
          if (event.key !== "Escape" || campo.value === "") return;
          event.preventDefault();
          event.stopPropagation();
          onQuery("");
        }}
      />
    </>
  );
}
