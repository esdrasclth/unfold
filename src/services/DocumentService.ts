import { openFile, saveFile, saveFileAs } from "../files.ts";

export interface DocumentRecord {
  path: string;
  name: string;
  content: string;
}

export interface SaveDocumentRequest {
  path: string | null;
  content: string;
  saveAs: boolean;
}

export interface DocumentService {
  open(): Promise<DocumentRecord | null>;
  save(request: SaveDocumentRequest): Promise<string | null>;
}

/** Adaptador imperativo actual. Es el único lugar de esta frontera que toca archivos. */
export function createDocumentService(): DocumentService {
  return {
    open: openFile,
    save: ({ path, content, saveAs }) => saveAs ? saveFileAs(content) : saveFile(path, content),
  };
}
