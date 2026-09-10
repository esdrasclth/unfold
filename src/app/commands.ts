export type PanelName = "outline" | "repositories" | "settings";

export interface AppActions {
  openFile(): Promise<void>;
  saveFile(saveAs?: boolean): Promise<boolean>;
  createDocument(): void;
  activateTab(id: number): Promise<void>;
  closeTab(id: number): Promise<void>;
  togglePanel(panel: PanelName): void;
  publish(): Promise<void>;
}
