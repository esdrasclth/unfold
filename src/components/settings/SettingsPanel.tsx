import {
  CHROMES,
  LIMITS,
  availableBodyFonts,
  availableCodeFonts,
  type ChromeName,
  type Settings,
} from "../../settings.ts";
import { icon } from "../../ui/icons.ts";

export interface SettingsUpdateActions {
  check: () => void;
  resetDismissed: () => void;
  /** Vuelve a enseñar la tarjeta de la versión pendiente. */
  install: () => void;
}

export interface SettingsPanelProps {
  settings: Settings;
  /** Versión pendiente de instalar, o nada si no la hay. */
  pendingVersion: string | null;
  updates?: SettingsUpdateActions;
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onClose: () => void;
  [key: string]: unknown;
}

/**
 * Cuántos caracteres caben por línea con estos ajustes.
 *
 * Depende también del tamaño de letra y no sólo del ancho: con letra grande
 * caben menos en la misma columna, y calcularlo sólo con la medida daba una
 * cifra que no se correspondía con lo que se veía.
 */
export function caracteresPorLinea(measure: number, fontSize: number): number {
  const anchoColumna = measure * 16;
  const letraMedia = fontSize * 0.5;
  return Math.round(anchoColumna / letraMedia);
}

function Fuentes({ id, label, fonts, value, onChange }: {
  id: string;
  label: string;
  fonts: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <section class="settings-group">
      <label class="settings-label" for={id}>
        {label}
      </label>
      <select
        class="settings-select"
        id={id}
        value={value}
        onChange={(event) => onChange((event.currentTarget as HTMLSelectElement).value)}
      >
        <option value="">La del sistema</option>
        {fonts.map((font) => (
          <option key={font} value={font} style={`font-family:'${font}'`}>
            {font}
          </option>
        ))}
      </select>
    </section>
  );
}

function Rango({ id, label, valor, limites, value, onInput, hint }: {
  id: string;
  label: string;
  valor: string;
  limites: { min: number; max: number; step: number };
  value: number;
  onInput: (value: number) => void;
  hint?: string;
}) {
  return (
    <section class="settings-group">
      <div class="settings-row">
        <label class="settings-label" for={id}>
          {label}
        </label>
        <span class="settings-value">{valor}</span>
      </div>
      <input
        class="settings-range"
        type="range"
        id={id}
        min={limites.min}
        max={limites.max}
        step={limites.step}
        value={value}
        // `input` y no `change`: el documento tiene que cambiar mientras se
        // arrastra, que es lo que hace que el panel se abra sobre el texto y
        // no como un diálogo con vista previa aparte.
        onInput={(event) => onInput(Number((event.currentTarget as HTMLInputElement).value))}
      />
      {hint && <p class="settings-hint">{hint}</p>}
    </section>
  );
}

/**
 * Panel de apariencia.
 *
 * Se abre por la derecha en lugar de como diálogo centrado a propósito: el
 * documento sigue visible detrás, así que cada control se ve aplicado sobre el
 * texto real mientras se arrastra.
 */
export function SettingsPanel({
  settings,
  pendingVersion,
  updates,
  onChange,
  onReset,
  onClose,
}: SettingsPanelProps) {
  return (
    <div class="settings-inner">
      <header class="settings-head">
        <span class="settings-title">Apariencia</span>
        <button
          type="button"
          class="icon-button"
          id="settings-close"
          title="Cerrar (Esc)"
          aria-label="Cerrar los ajustes"
          onClick={onClose}
          dangerouslySetInnerHTML={{ __html: icon("close") }}
        />
      </header>

      <Fuentes
        id="set-body-font"
        label="Tipografía del texto"
        fonts={availableBodyFonts()}
        value={settings.bodyFont}
        onChange={(bodyFont) => onChange({ bodyFont })}
      />

      <Rango
        id="set-size"
        label="Tamaño"
        valor={`${settings.fontSize} px`}
        limites={LIMITS.fontSize}
        value={settings.fontSize}
        onInput={(fontSize) => onChange({ fontSize })}
      />

      <Rango
        id="set-line"
        label="Interlineado"
        valor={settings.lineHeight.toFixed(2)}
        limites={LIMITS.lineHeight}
        value={settings.lineHeight}
        onInput={(lineHeight) => onChange({ lineHeight })}
      />

      <Rango
        id="set-measure"
        label="Ancho de la columna"
        valor={`≈ ${caracteresPorLinea(settings.measure, settings.fontSize)} caracteres`}
        limites={LIMITS.measure}
        value={settings.measure}
        onInput={(measure) => onChange({ measure })}
        hint="Entre 60 y 80 caracteres por línea es lo que mejor se lee."
      />

      <Fuentes
        id="set-code-font"
        label="Tipografía del código"
        fonts={availableCodeFonts()}
        value={settings.codeFont}
        onChange={(codeFont) => onChange({ codeFont })}
      />

      <section class="settings-group">
        <span class="settings-label">Color de las barras</span>
        <div class="settings-swatches is-wrapped" id="set-chrome" role="radiogroup" aria-label="Color de las barras">
          {CHROMES.map((chrome) => (
            <button
              key={chrome.name}
              type="button"
              class={`settings-swatch${chrome.swatch ? "" : " is-neutral"}${chrome.name === settings.chrome ? " is-on" : ""}`}
              title={chrome.label}
              role="radio"
              aria-label={chrome.label}
              aria-checked={chrome.name === settings.chrome}
              style={`--swatch:${chrome.swatch || "transparent"}`}
              // El acento va incluido en la barra: se aplica solo al elegirla.
              onClick={() => onChange({ chrome: chrome.name as ChromeName })}
            >
              <span />
            </button>
          ))}
        </div>
        <p class="settings-hint">
          Cambia la barra superior, el esquema y la barra de estado. El papel del editor no se
          toca, y el color de acento lo elige la propia barra.
        </p>
      </section>

      {updates && (
        <section class="settings-group settings-updates">
          <span class="settings-label">Actualizaciones</span>
          {/*
            Apartar la tarjeta del aviso no puede ser lo mismo que perderla:
            quien la cierra tiene que poder volver a encontrarla, y éste es el
            sitio donde la buscaría.
          */}
          {pendingVersion && (
            <button type="button" class="settings-pending" onClick={() => updates.install()}>
              Instalar Unfold {pendingVersion}
            </button>
          )}
          <button type="button" class="settings-action" id="settings-check-updates" onClick={() => updates.check()}>
            Buscar actualizaciones
          </button>
          <button type="button" class="settings-action is-quiet" onClick={() => updates.resetDismissed()}>
            Volver a mostrar versiones omitidas
          </button>
          <p class="settings-hint">
            Se comprueba automáticamente al iniciar, como máximo una vez cada 15 minutos.
          </p>
        </section>
      )}

      <button type="button" class="settings-reset" id="settings-reset" onClick={onReset}>
        Restablecer todo
      </button>
    </div>
  );
}
