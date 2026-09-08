import {
  CHROMES,
  DEFAULTS,
  LIMITS,
  applySettings,
  availableBodyFonts,
  availableCodeFonts,
  loadSettings,
  saveSettings,
  type ChromeName,
  type Settings,
} from "../settings.ts";
import { icon } from "./icons.ts";

export interface UpdateSettingsActions {
  check: () => void;
  resetDismissed: () => void;
}

/**
 * Panel de apariencia.
 *
 * Se abre por la derecha en lugar de como diálogo centrado a propósito: el
 * documento sigue visible detrás, así que cada control se ve aplicado sobre el
 * texto real mientras se arrastra, sin necesidad de una vista previa aparte.
 */
export class SettingsPanel {
  private settings: Settings;

  constructor(
    private readonly root: HTMLElement,
    private readonly onClose: () => void,
    private readonly updates?: UpdateSettingsActions,
  ) {
    this.settings = loadSettings();
    applySettings(this.settings);
    this.render();
    this.wire();
  }

  private render(): void {
    const fontOptions = (fonts: string[], selected: string, systemLabel: string): string =>
      [
        `<option value="">${systemLabel}</option>`,
        ...fonts.map(
          (font) =>
            `<option value="${font}"${font === selected ? " selected" : ""} style="font-family:'${font}'">${font}</option>`,
        ),
      ].join("");

    this.root.innerHTML = `
      <div class="settings-inner">
        <header class="settings-head">
          <span class="settings-title">Apariencia</span>
          <button class="icon-button" id="settings-close" title="Cerrar (Esc)">${icon("close")}</button>
        </header>

        <section class="settings-group">
          <label class="settings-label" for="set-body-font">Tipografía del texto</label>
          <select class="settings-select" id="set-body-font">
            ${fontOptions(availableBodyFonts(), this.settings.bodyFont, "La del sistema")}
          </select>
        </section>

        <section class="settings-group">
          <div class="settings-row">
            <label class="settings-label" for="set-size">Tamaño</label>
            <span class="settings-value" id="val-size"></span>
          </div>
          <input class="settings-range" type="range" id="set-size"
            min="${LIMITS.fontSize.min}" max="${LIMITS.fontSize.max}" step="${LIMITS.fontSize.step}" />
        </section>

        <section class="settings-group">
          <div class="settings-row">
            <label class="settings-label" for="set-line">Interlineado</label>
            <span class="settings-value" id="val-line"></span>
          </div>
          <input class="settings-range" type="range" id="set-line"
            min="${LIMITS.lineHeight.min}" max="${LIMITS.lineHeight.max}" step="${LIMITS.lineHeight.step}" />
        </section>

        <section class="settings-group">
          <div class="settings-row">
            <label class="settings-label" for="set-measure">Ancho de la columna</label>
            <span class="settings-value" id="val-measure"></span>
          </div>
          <input class="settings-range" type="range" id="set-measure"
            min="${LIMITS.measure.min}" max="${LIMITS.measure.max}" step="${LIMITS.measure.step}" />
          <p class="settings-hint">Entre 60 y 80 caracteres por línea es lo que mejor se lee.</p>
        </section>

        <section class="settings-group">
          <label class="settings-label" for="set-code-font">Tipografía del código</label>
          <select class="settings-select" id="set-code-font">
            ${fontOptions(availableCodeFonts(), this.settings.codeFont, "La del sistema")}
          </select>
        </section>

        <section class="settings-group">
          <label class="settings-label">Color de las barras</label>
          <div class="settings-swatches is-wrapped" id="set-chrome">
            ${CHROMES.map(
              (chrome) =>
                `<button class="settings-swatch${chrome.swatch ? "" : " is-neutral"}" data-chrome="${chrome.name}" title="${chrome.label}" style="--swatch:${chrome.swatch || "transparent"}"><span></span></button>`,
            ).join("")}
          </div>
          <p class="settings-hint">Cambia la barra superior, el esquema y la barra de estado. El papel del editor no se toca, y el color de acento lo elige la propia barra.</p>
        </section>

        ${this.updates ? `
        <section class="settings-group settings-updates">
          <span class="settings-label">Actualizaciones</span>
          <button class="settings-action" id="settings-check-updates" type="button">Buscar actualizaciones</button>
          <button class="settings-action is-quiet" id="settings-reset-updates" type="button">Volver a mostrar versiones omitidas</button>
          <p class="settings-hint">Se comprueba automáticamente al iniciar, como máximo una vez cada 15 minutos.</p>
        </section>` : ""}

        <button class="settings-reset" id="settings-reset">Restablecer todo</button>
      </div>
    `;
  }

  private wire(): void {
    const q = <T extends HTMLElement>(id: string): T => this.root.querySelector<T>(`#${id}`)!;

    const size = q<HTMLInputElement>("set-size");
    const line = q<HTMLInputElement>("set-line");
    const measure = q<HTMLInputElement>("set-measure");
    const bodyFont = q<HTMLSelectElement>("set-body-font");
    const codeFont = q<HTMLSelectElement>("set-code-font");

    // `input` y no `change`: el documento debe cambiar mientras se arrastra.
    size.addEventListener("input", () => this.commit({ fontSize: Number(size.value) }));
    line.addEventListener("input", () => this.commit({ lineHeight: Number(line.value) }));
    measure.addEventListener("input", () => this.commit({ measure: Number(measure.value) }));
    bodyFont.addEventListener("change", () => this.commit({ bodyFont: bodyFont.value }));
    codeFont.addEventListener("change", () => this.commit({ codeFont: codeFont.value }));

    q("set-chrome").addEventListener("click", (event) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-chrome]");
      if (!button) return;
      // El acento va incluido en la barra: se aplica solo al elegirla.
      this.commit({ chrome: button.dataset.chrome as ChromeName });
    });

    q("settings-reset").addEventListener("click", () => this.commit({ ...DEFAULTS }));
    q("settings-close").addEventListener("click", () => this.onClose());
    if (this.updates) {
      q("settings-check-updates").addEventListener("click", () => this.updates?.check());
      q("settings-reset-updates").addEventListener("click", () => this.updates?.resetDismissed());
    }

    this.paint();
  }

  private paint(): void {
    const q = <T extends HTMLElement>(id: string): T => this.root.querySelector<T>(`#${id}`)!;
    q<HTMLInputElement>("set-size").value = String(this.settings.fontSize);
    q<HTMLInputElement>("set-line").value = String(this.settings.lineHeight);
    q<HTMLInputElement>("set-measure").value = String(this.settings.measure);
    q<HTMLSelectElement>("set-body-font").value = this.settings.bodyFont;
    q<HTMLSelectElement>("set-code-font").value = this.settings.codeFont;
    q("val-size").textContent = `${this.settings.fontSize} px`;
    q("val-line").textContent = this.settings.lineHeight.toFixed(2);
    // Caracteres por línea = ancho / anchura media de letra. Tiene que
    // depender también del tamaño: con letra grande caben menos en el mismo
    // ancho, y calcularlo sólo con la medida daba una cifra falsa.
    const columnPx = this.settings.measure * 16;
    const averageGlyph = this.settings.fontSize * 0.5;
    q("val-measure").textContent = `≈ ${Math.round(columnPx / averageGlyph)} caracteres`;
    for (const swatch of this.root.querySelectorAll<HTMLElement>("[data-chrome]")) {
      swatch.classList.toggle("is-on", swatch.dataset.chrome === this.settings.chrome);
    }
  }

  private commit(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    applySettings(this.settings);
    saveSettings(this.settings);
    this.paint();
  }

  /** Ajusta el contenido un paso y mantiene sincronizado el panel de apariencia. */
  zoomContent(direction: 1 | -1): number {
    const { min, max, step } = LIMITS.fontSize;
    const next = Math.min(max, Math.max(min, this.settings.fontSize + direction * step));
    if (next !== this.settings.fontSize) this.commit({ fontSize: next });
    return next;
  }

  setOpen(open: boolean): void {
    this.root.classList.toggle("is-open", open);
    if (open) this.root.removeAttribute("inert");
    else this.root.setAttribute("inert", "");
  }
}
