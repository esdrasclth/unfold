import { initialAppState, type AppState, type Notice } from "./AppState.ts";
import { AppStore } from "./AppStore.ts";
import type { AppActions, PanelName } from "./commands.ts";
import type { DocumentService } from "../services/DocumentService.ts";
import type { GithubService } from "../services/GithubService.ts";
import type { PersistenceService, PersistedWorkspace } from "../services/PersistenceService.ts";
import type { RepositoryService } from "../services/RepositoryService.ts";

interface ControllerTab {
  id: number;
  path: string | null;
  name: string;
  content: string;
  dirty: boolean;
  conflict: boolean;
}

export type CloseDecision = "save" | "discard" | "cancel";

export interface AppControllerServices {
  documents: DocumentService;
  persistence: PersistenceService;
  repositories: RepositoryService;
  github: GithubService;
}

export interface AppControllerOptions {
  confirmClose?: (tab: Readonly<ControllerTab>) => Promise<CloseDecision>;
}

/**
 * Frontera de aplicación, deliberadamente independiente de Preact y del DOM.
 * Los adaptadores pueden seguir siendo imperativos mientras migra cada vista.
 */
export class AppController implements AppActions {
  readonly store: AppStore;
  private readonly services: AppControllerServices;
  private readonly confirmClose: (tab: Readonly<ControllerTab>) => Promise<CloseDecision>;
  private tabs: ControllerTab[] = [];
  private activeId = 0;
  private nextId = 1;
  private persistencePending: Promise<void> = Promise.resolve();

  constructor(
    services: AppControllerServices,
    store = new AppStore(initialAppState()),
    options: AppControllerOptions = {},
  ) {
    this.services = services;
    this.store = store;
    this.confirmClose = options.confirmClose ?? (async () => "cancel");
    this.addBlankDocument();
  }

  async restore(): Promise<void> {
    try {
      const workspace = await this.services.persistence.load();
      if (!workspace?.tabs.length) return;
      this.tabs = workspace.tabs.map((tab) => ({
        id: this.nextId++,
        path: tab.path,
        name: tab.name,
        content: tab.content,
        dirty: tab.dirty,
        conflict: false,
      }));
      const active = this.tabs[Math.min(Math.max(0, workspace.active), this.tabs.length - 1)];
      this.activeId = active.id;
      this.commitState();
    } catch (error) {
      this.reportError("No se pudo restaurar la sesión", error);
    }
  }

  async openFile(): Promise<void> {
    try {
      const opened = await this.services.documents.open();
      if (!opened) return;
      const existing = this.tabs.find((tab) => tab.path === opened.path);
      if (existing) {
        this.activeId = existing.id;
      } else {
        const untouchedBlank = this.tabs.length === 1 && !this.tabs[0].path &&
          !this.tabs[0].dirty && !this.tabs[0].content;
        const tab: ControllerTab = {
          id: untouchedBlank ? this.tabs[0].id : this.nextId++,
          path: opened.path,
          name: opened.name,
          content: opened.content,
          dirty: false,
          conflict: false,
        };
        if (untouchedBlank) this.tabs[0] = tab;
        else this.tabs.push(tab);
        this.activeId = tab.id;
      }
      this.commitState();
      await this.persist();
    } catch (error) {
      this.reportError("No se pudo abrir el archivo", error);
    }
  }

  async saveFile(saveAs = false): Promise<boolean> {
    const tab = this.activeTab();
    if (!tab) return false;
    const content = tab.content;
    try {
      const target = await this.services.documents.save({
        path: tab.path,
        content,
        saveAs: saveAs || tab.path === null,
      });
      if (!target) return false;
      tab.path = target;
      tab.name = target.split(/[\\/]/).pop() ?? target;
      tab.dirty = tab.content !== content;
      tab.conflict = false;
      this.commitState();
      await this.persist();
      return !tab.dirty;
    } catch (error) {
      this.reportError("No se pudo guardar el archivo", error);
      return false;
    }
  }

  createDocument(): void {
    this.addBlankDocument();
    void this.persist();
  }

  async activateTab(id: number): Promise<void> {
    if (!this.tabs.some((tab) => tab.id === id) || id === this.activeId) return;
    this.activeId = id;
    this.commitState();
    await this.persist();
  }

  async closeTab(id: number): Promise<void> {
    const tab = this.tabs.find((item) => item.id === id);
    if (!tab) return;
    if (tab.dirty) {
      this.activeId = tab.id;
      this.commitState();
      const decision = await this.confirmClose(tab);
      if (decision === "cancel") return;
      if (decision === "save" && !(await this.saveFile())) return;
    }

    const index = this.tabs.indexOf(tab);
    this.tabs.splice(index, 1);
    if (this.tabs.length === 0) this.addBlankDocument(false);
    else if (this.activeId === id) {
      this.activeId = this.tabs[Math.min(index, this.tabs.length - 1)].id;
      this.commitState();
    } else {
      this.commitState();
    }
    await this.persist();
  }

  togglePanel(panel: PanelName): void {
    this.store.update((state) => ({
      ...state,
      panels: { ...state.panels, [panel]: !state.panels[panel] },
    }));
  }

  async publish(): Promise<void> {
    const path = this.activeTab()?.path;
    if (!path) {
      this.setNotice({ kind: "info", message: "Guarda el documento antes de publicarlo" });
      return;
    }
    try {
      await this.services.repositories.publishDocument(path);
      this.setNotice({ kind: "success", message: "Cambios publicados en GitHub" });
    } catch (error) {
      this.reportError("No se pudieron publicar los cambios", error);
    }
  }

  async refreshGithub(): Promise<void> {
    this.store.update((state) => ({
      ...state,
      github: { ...state.github, busy: true },
    }));
    try {
      const session = await this.services.github.session();
      this.store.update((state) => ({ ...state, github: { ...session, busy: false } }));
    } catch (error) {
      this.store.update((state) => ({
        ...state,
        github: { ...state.github, busy: false },
      }));
      this.reportError("No se pudo consultar GitHub", error);
    }
  }

  /** Puente futuro desde las transacciones de CodeMirror. */
  documentChanged(content: string): void {
    const tab = this.activeTab();
    if (!tab || tab.content === content) return;
    tab.content = content;
    tab.dirty = true;
    this.commitState();
  }

  setConflict(conflict: boolean): void {
    const tab = this.activeTab();
    if (!tab || tab.conflict === conflict) return;
    tab.conflict = conflict;
    this.commitState();
  }

  clearNotice(): void {
    this.setNotice(null);
  }

  private activeTab(): ControllerTab | undefined {
    return this.tabs.find((tab) => tab.id === this.activeId);
  }

  private addBlankDocument(commit = true): void {
    const tab: ControllerTab = {
      id: this.nextId++,
      path: null,
      name: "Sin título",
      content: "",
      dirty: false,
      conflict: false,
    };
    this.tabs.push(tab);
    this.activeId = tab.id;
    if (commit) this.commitState();
  }

  private commitState(): void {
    const current = this.store.getState();
    const active = this.activeTab();
    this.store.setState({
      ...current,
      tabs: this.tabs.map(({ id, name, path, dirty }) => ({ id, name, path, dirty })),
      activeTabId: active?.id ?? 0,
      document: active
        ? { name: active.name, path: active.path, dirty: active.dirty, conflict: active.conflict }
        : { name: "Sin título", path: null, dirty: false, conflict: false },
    });
  }

  private workspace(): PersistedWorkspace {
    const active = this.activeTab();
    return {
      tabs: this.tabs.map((tab) => ({
        path: tab.path,
        name: tab.name,
        dirty: tab.dirty,
        content: tab.content,
        anchor: 0,
        head: 0,
        scrollTop: 0,
      })),
      active: Math.max(0, active ? this.tabs.indexOf(active) : 0),
    };
  }

  private async persist(): Promise<void> {
    const workspace = this.workspace();
    this.persistencePending = this.persistencePending
      .then(() => this.services.persistence.save(workspace))
      .catch((error) => this.reportError("No se pudo guardar la sesión", error));
    await this.persistencePending;
  }

  private setNotice(notice: Notice | null): void {
    this.store.update((state) => ({ ...state, notice }));
  }

  /** Única traducción de fallos técnicos a mensajes destinados a la interfaz. */
  private reportError(message: string, error: unknown): void {
    console.error(message, error);
    this.setNotice({ kind: "error", message });
  }
}

export type { AppState };
