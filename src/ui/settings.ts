import {
  DEFAULTS,
  LIMITS,
  applySettings,
  loadSettings,
  saveSettings,
  type Settings,
} from "../settings.ts";
import { mountComponent, type MountedComponent } from "../components/mountComponent.ts";
import {
  SettingsPanel as SettingsPanelView,
  type SettingsPanelProps,
  type SettingsUpdateActions,
} from "../components/settings/SettingsPanel.tsx";

export type UpdateSettingsActions = SettingsUpdateActions;

/**
 * Panel de apariencia.
 *
 * La vista es un componente; aquí quedan el estado de los ajustes, aplicarlos
 * al documento, guardarlos y abrir o cerrar el panel.
 *
 * Se abre por la derecha en lugar de como diálogo centrado a propósito: el
 * documento sigue visible detrás, así que cada control se ve aplicado sobre el
 * texto real mientras se arrastra, sin necesidad de una vista previa aparte.
 */
export class SettingsPanel {
  private settings: Settings;
  private pendingVersion: string | null = null;
  private readonly root: HTMLElement;
  private readonly onClose: () => void;
  private readonly updates?: UpdateSettingsActions;
  private readonly vista: MountedComponent<SettingsPanelProps>;

  constructor(root: HTMLElement, onClose: () => void, updates?: UpdateSettingsActions) {
    this.root = root;
    this.onClose = onClose;
    this.updates = updates;

    this.settings = loadSettings();
    applySettings(this.settings);

    this.vista = mountComponent<SettingsPanelProps>(this.root, SettingsPanelView, this.props());
  }

  private props(): SettingsPanelProps {
    return {
      settings: this.settings,
      pendingVersion: this.pendingVersion,
      updates: this.updates,
      onChange: (patch) => this.commit(patch),
      onReset: () => this.commit({ ...DEFAULTS }),
      onClose: this.onClose,
    };
  }

  private render(): void {
    this.vista.update(this.props());
  }

  private commit(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    applySettings(this.settings);
    saveSettings(this.settings);
    this.render();
  }

  /** Ajusta el contenido un paso y mantiene sincronizado el panel de apariencia. */
  zoomContent(direction: 1 | -1): number {
    const { min, max, step } = LIMITS.fontSize;
    const next = Math.min(max, Math.max(min, this.settings.fontSize + direction * step));
    if (next !== this.settings.fontSize) this.commit({ fontSize: next });
    return next;
  }

  /** Enseña aquí la versión pendiente, si la hay. Sin nada, la fila no aparece. */
  setUpdatePending(version: string | null): void {
    if (version === this.pendingVersion) return;
    this.pendingVersion = version;
    this.render();
  }

  setOpen(open: boolean): void {
    this.root.classList.toggle("is-open", open);
    if (open) this.root.removeAttribute("inert");
    else this.root.setAttribute("inert", "");
  }
}
