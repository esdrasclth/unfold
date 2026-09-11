export type PanelName = "outline" | "repositories" | "settings";

export interface CommandHandlers {
  closeSettings(): void;
  zoom(direction: 1 | -1): void;
  toggleRepositories(): void;
  toggleOutline(): void;
  open(): void;
  create(): void;
  close(): void;
  cycle(direction: 1 | -1): void;
  save(saveAs: boolean): void;
  export(): void;
  print(): void;
  github(): void;
  focus(): void;
  typewriter(): void;
  source(): void;
  search(): void;
  publish(): void;
  palette(): void;
}

/** Registra los atajos globales sin conocer la vista ni el editor. */
export function registerCommands(handlers: CommandHandlers): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "p") {
      event.preventDefault(); handlers.palette(); return;
    }
    if (event.key === "Escape") { handlers.closeSettings(); return; }
    if (!event.ctrlKey && !event.metaKey) return;
    const key = event.key.toLowerCase();
    const zoomIn = !event.altKey &&
      (event.key === "+" || event.key === "=" || event.code === "NumpadAdd");
    const zoomOut = !event.altKey && (event.key === "-" || event.code === "NumpadSubtract");
    if (zoomIn || zoomOut) { event.preventDefault(); handlers.zoom(zoomIn ? 1 : -1); return; }
    if (event.key === ",") { event.preventDefault(); handlers.closeSettings(); return; }
    if (key === "b" && event.shiftKey) { event.preventDefault(); handlers.toggleRepositories(); }
    else if (key === "o" && event.shiftKey) { event.preventDefault(); handlers.toggleOutline(); }
    else if (key === "o") { event.preventDefault(); handlers.open(); }
    else if (key === "n") { event.preventDefault(); handlers.create(); }
    else if (key === "w") { event.preventDefault(); handlers.close(); }
    else if (event.key === "Tab") { event.preventDefault(); handlers.cycle(event.shiftKey ? -1 : 1); }
    else if (key === "s") { event.preventDefault(); handlers.save(event.shiftKey); }
    else if (key === "e" && event.shiftKey) { event.preventDefault(); handlers.export(); }
    else if (key === "p" && !event.shiftKey) { event.preventDefault(); handlers.print(); }
    else if (key === "h" && event.shiftKey) { event.preventDefault(); handlers.github(); }
    else if (key === "f" && event.shiftKey) { event.preventDefault(); handlers.focus(); }
    else if (key === "t" && event.shiftKey) { event.preventDefault(); handlers.typewriter(); }
    else if (key === "m" && event.shiftKey) { event.preventDefault(); handlers.source(); }
    else if (key === "l" && event.shiftKey) { event.preventDefault(); handlers.search(); }
    else if (key === "u" && event.shiftKey) { event.preventDefault(); handlers.publish(); }
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}

export interface AppActions {
  openFile(): Promise<void>;
  saveFile(saveAs?: boolean): Promise<boolean>;
  createDocument(): void;
  activateTab(id: number): Promise<void>;
  closeTab(id: number): Promise<void>;
  togglePanel(panel: PanelName): void;
  publish(): Promise<void>;
}
