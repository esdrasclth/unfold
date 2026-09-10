import { isFolder } from "../../folders.ts";
import type { ConnectedRepository, RepositoryDocument } from "../../repositories.ts";
import { icon } from "../../ui/icons.ts";
import { DocumentRow, FolderNode } from "./RepositoryNode.tsx";
import { buildTree, fold, folderOf, nameOf, summaryOf } from "./tree.ts";

export function Notice({ children }: { children: string }) {
  return <p class="repos-empty">{children}</p>;
}

export interface RepositoryTreeProps {
  repositories: readonly ConnectedRepository[];
  documents: ReadonlyMap<number, RepositoryDocument[]>;
  loading: boolean;
  problem: string | null;
  query: string;
  activePath: string | null;
  collapsedRepos: ReadonlySet<number>;
  collapsedFolders: ReadonlySet<string>;
  onToggleRepo: (id: number) => void;
  onToggleFolder: (key: string) => void;
  onOpen: (repository: ConnectedRepository, document: RepositoryDocument) => void;
  onCreate: (repository: ConnectedRepository) => void;
  onPublish: (repository: ConnectedRepository) => void;
  onCloseFolder: (repository: ConnectedRepository) => void;
}

/**
 * Botón de publicar, sólo cuando hay algo que publicar.
 *
 * Distingue los dos casos porque no son el mismo trabajo: con archivos tocados
 * hay que elegir y describir; con commits ya hechos sólo falta subirlos.
 */
function textoPublicar(repository: ConnectedRepository): string | null {
  if (repository.missing || !repository.canPush) return null;
  if (repository.changed === 0 && repository.ahead === 0) return null;
  if (repository.changed > 0) return `Publicar cambios (${repository.changed})`;
  return repository.ahead === 1
    ? "Publicar 1 commit pendiente"
    : `Publicar ${repository.ahead} commits pendientes`;
}

/**
 * Resultados de la búsqueda: una lista plana con la carpeta al lado.
 *
 * Plana a propósito. Filtrar el árbol conservando las ramas obliga a leer la
 * jerarquía entera para encontrar dos archivos; cuando ya se sabe el nombre, lo
 * que se quiere es la lista.
 */
function Resultados({ repositories, documents, query, activePath, onOpen }: RepositoryTreeProps) {
  const aguja = fold(query);
  const bloques = repositories
    .map((repository) => ({
      repository,
      matches: (documents.get(repository.id) ?? []).filter((document) =>
        fold(document.relative).includes(aguja),
      ),
    }))
    .filter((bloque) => bloque.matches.length > 0);

  if (bloques.length === 0) {
    return <Notice>{`Ningún documento coincide con «${query}».`}</Notice>;
  }

  return (
    <>
      {bloques.map(({ repository, matches }) => (
        <>
          <div key={`cabecera-${repository.id}`} class="repos-result-head">
            {repository.fullName}
          </div>
          {matches.map((document) => (
            <DocumentRow
              key={document.path}
              repository={repository}
              document={document}
              label={nameOf(document.relative)}
              depth={0}
              folder={folderOf(document.relative)}
              activePath={activePath}
              onOpen={onOpen}
            />
          ))}
        </>
      ))}
    </>
  );
}

export function RepositoryTree(props: RepositoryTreeProps) {
  const {
    repositories,
    documents,
    loading,
    problem,
    query,
    activePath,
    collapsedRepos,
    collapsedFolders,
    onToggleRepo,
    onToggleFolder,
    onOpen,
    onCreate,
    onPublish,
    onCloseFolder,
  } = props;

  if (problem) return <Notice>{problem}</Notice>;
  if (loading && repositories.length === 0) return <Notice>Leyendo repositorios…</Notice>;
  if (repositories.length === 0) {
    return (
      <Notice>
        No hay repositorios conectados. Conecta uno desde GitHub para verlo aquí.
      </Notice>
    );
  }
  if (query) return <Resultados {...props} />;

  return (
    <>
      {repositories.map((repository) => {
        const open = !collapsedRepos.has(repository.id);
        const resumen = summaryOf(repository);
        const suyos = documents.get(repository.id) ?? [];
        const publicar = textoPublicar(repository);

        return (
          <div key={repository.id} class={`repo${open ? " is-open" : ""}`}>
            {/*
              La cabecera es una fila con dos botones y no un botón con cosas
              dentro: crear un documento vivía en una fila entera debajo, y una
              fila por repositorio es mucho sitio para una acción que cabe en el
              hueco que ya sobra aquí al lado del nombre.
            */}
            <div class="repo-head">
              <button
                type="button"
                class="repo-toggle"
                aria-expanded={open}
                // El resumen se recorta en paneles estrechos; el título lo da entero.
                title={`${repository.fullName} — ${resumen}`}
                onClick={() => onToggleRepo(repository.id)}
              >
                <span class="repos-caret" aria-hidden="true">
                  ▸
                </span>
                <span class="repo-name">{repository.fullName}</span>
                <span class="repo-summary">{resumen}</span>
              </button>

              {!repository.missing && (
                <button
                  type="button"
                  class="repos-create"
                  title={`Nuevo documento en ${repository.fullName}`}
                  aria-label={`Nuevo documento en ${repository.fullName}`}
                  onClick={() => onCreate(repository)}
                  dangerouslySetInnerHTML={{ __html: icon("plus") }}
                />
              )}

              {/*
                Quita la carpeta del explorador. No borra nada del disco, y por
                eso no pregunta: volver a abrirla es un clic.
              */}
              {isFolder(repository) && (
                <button
                  type="button"
                  class="repos-create repos-close-folder"
                  title={`Quitar «${repository.fullName}» del explorador`}
                  aria-label={`Quitar «${repository.fullName}» del explorador`}
                  onClick={() => onCloseFolder(repository)}
                  dangerouslySetInnerHTML={{ __html: icon("close") }}
                />
              )}
            </div>

            {open && publicar && (
              <button type="button" class="repos-publish" onClick={() => onPublish(repository)}>
                {publicar}
              </button>
            )}

            {open && repository.missing && (
              <Notice>La carpeta de este repositorio ya no está en el disco.</Notice>
            )}
            {open && !repository.missing && suyos.length === 0 && (
              <Notice>Sin documentos Markdown.</Notice>
            )}
            {open && !repository.missing && suyos.length > 0 && (
              <FolderNode
                repository={repository}
                folder={buildTree(suyos)}
                depth={0}
                collapsedFolders={collapsedFolders}
                activePath={activePath}
                onToggleFolder={onToggleFolder}
                onOpen={onOpen}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
