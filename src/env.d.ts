/// <reference types="vite/client" />

declare global {
  interface Window {
    /** File System Access API: sólo existe en navegadores, no bajo Tauri. */
    showOpenFilePicker?: (options?: {
      types?: { description?: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle[]>;
  }
}

export {};
