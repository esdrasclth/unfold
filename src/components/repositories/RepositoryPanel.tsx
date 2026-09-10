import { useState } from "preact/hooks";
import type { GithubAuthStatus } from "../../github.ts";
import type { ConnectedRepository, RepositoryDocument } from "../../repositories.ts";
import type { RepositoryData } from "../../repositories/RepositoryController.ts";
import { RepositoryFooter } from "./RepositoryFooter.tsx";
import { RepositoryToolbar } from "./RepositoryToolbar.tsx";
import { RepositoryTree } from "./RepositoryTree.tsx";

export interface RepositoryPanelProps {
  data: RepositoryData;
  account: GithubAuthStatus | null;
  activePath: string | null;
  onRefresh: () => void;
  onAddFolder: () => void;
  onManage: () => void;
  onOpen: (repository: ConnectedRepository, document: RepositoryDocument) => void;
  onCreate: (repository: ConnectedRepository) => void;
  onPublish: (repository: ConnectedRepository) => void;
  onCloseFolder: (repository: ConnectedRepository) => void;
  [key: string]: unknown;
}

/**
 * Explorador de repositorios.
 *
 * Comparte el hueco de la izquierda con el esquema y sólo uno de los dos está
 * desplegado a la vez: en una ventana de 480 px, dos paneles abiertos no dejan
 * sitio para escribir.
 *
 * Lo que está plegado y lo que se busca vive aquí y no en el controlador. No es
 * un detalle: es lo que hace imposible que desplegar una carpeta o escribir en
 * el filtro vuelvan a consultar el backend, porque desde aquí no hay forma de
 * llamarlo. Los datos llegan ya leídos y esto sólo decide qué se enseña.
 */
export function RepositoryPanel({
  data,
  account,
  activePath,
  onRefresh,
  onAddFolder,
  onManage,
  onOpen,
  onCreate,
  onPublish,
  onCloseFolder,
}: RepositoryPanelProps) {
  const [query, setQuery] = useState("");
  const [collapsedRepos, setCollapsedRepos] = useState<ReadonlySet<number>>(new Set());
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(new Set());

  const alternar = <T,>(conjunto: ReadonlySet<T>, clave: T): ReadonlySet<T> => {
    const siguiente = new Set(conjunto);
    if (!siguiente.delete(clave)) siguiente.add(clave);
    return siguiente;
  };

  return (
    <>
      <div class="repos-inner">
        <RepositoryToolbar
          query={query}
          onQuery={setQuery}
          onRefresh={onRefresh}
          onAddFolder={onAddFolder}
        />

        <div class="repos-list" id="repos-list">
          <RepositoryTree
            repositories={data.repositories}
            documents={data.documents}
            loading={data.loading}
            problem={data.problem}
            query={query}
            activePath={activePath}
            collapsedRepos={collapsedRepos}
            collapsedFolders={collapsedFolders}
            onToggleRepo={(id) => setCollapsedRepos((previo) => alternar(previo, id))}
            onToggleFolder={(key) => setCollapsedFolders((previo) => alternar(previo, key))}
            onOpen={onOpen}
            onCreate={onCreate}
            onPublish={onPublish}
            onCloseFolder={onCloseFolder}
          />
        </div>

        <RepositoryFooter
          account={account}
          repositories={data.connectedCount}
          onManage={onManage}
        />
      </div>
      <div class="repos-resizer" id="repos-resizer" title="Arrastra para ajustar el ancho" />
    </>
  );
}
