import type { ConnectedRepository, RepositoryDocument } from "../../repositories.ts";
import { STATE_LABEL, folderOf, nameOf, samePath, type Folder } from "./tree.ts";

export interface DocumentRowProps {
  repository: ConnectedRepository;
  document: RepositoryDocument;
  label: string;
  depth: number;
  /** Sólo en los resultados de la búsqueda, donde no hay árbol que sitúe. */
  folder?: string;
  activePath: string | null;
  onOpen: (repository: ConnectedRepository, document: RepositoryDocument) => void;
}

export function DocumentRow({
  repository,
  document,
  label,
  depth,
  folder,
  activePath,
  onOpen,
}: DocumentRowProps) {
  const estado = STATE_LABEL[document.state];
  const clases = [
    "repos-document",
    depth > 0 ? "is-nested" : "",
    document.state !== "synced" ? `is-${document.state}` : "",
    samePath(activePath, document.path) ? "is-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      class={clases}
      style={`--depth:${depth}`}
      title={estado ? `${document.relative} — ${estado}` : document.relative}
      aria-current={samePath(activePath, document.path) ? "true" : undefined}
      onClick={() => onOpen(repository, document)}
    >
      <span class="repos-dot" aria-hidden="true" />
      <span class="repos-document-name">{label}</span>
      <span class="repos-document-folder">{folder ?? ""}</span>
    </button>
  );
}

export interface FolderNodeProps {
  repository: ConnectedRepository;
  folder: Folder;
  depth: number;
  collapsedFolders: ReadonlySet<string>;
  activePath: string | null;
  onToggleFolder: (key: string) => void;
  onOpen: (repository: ConnectedRepository, document: RepositoryDocument) => void;
}

/** Dibuja un nivel: primero las carpetas, después los documentos. */
export function FolderNode({
  repository,
  folder,
  depth,
  collapsedFolders,
  activePath,
  onToggleFolder,
  onOpen,
}: FolderNodeProps) {
  const carpetas = [...folder.folders.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  return (
    <>
      {carpetas.map((child) => {
        const key = `${repository.id}:${child.path}`;
        const open = !collapsedFolders.has(key);
        return (
          <>
            <button
              key={key}
              type="button"
              // La guía de sangría la dibuja el CSS, pero sólo tiene a qué
              // referirse cuando hay un nivel por encima.
              class={`repos-folder${depth > 0 ? " is-nested" : ""}${open ? " is-open" : ""}`}
              style={`--depth:${depth}`}
              aria-expanded={open}
              onClick={() => onToggleFolder(key)}
            >
              <span class="repos-caret" aria-hidden="true">
                ▸
              </span>
              <span>{child.name}</span>
            </button>
            {open && (
              <FolderNode
                key={`${key}:hijos`}
                repository={repository}
                folder={child}
                depth={depth + 1}
                collapsedFolders={collapsedFolders}
                activePath={activePath}
                onToggleFolder={onToggleFolder}
                onOpen={onOpen}
              />
            )}
          </>
        );
      })}

      {folder.documents.map((document) => (
        <DocumentRow
          key={document.path}
          repository={repository}
          document={document}
          label={nameOf(document.relative)}
          depth={depth}
          activePath={activePath}
          onOpen={onOpen}
        />
      ))}
    </>
  );
}

export { folderOf };
