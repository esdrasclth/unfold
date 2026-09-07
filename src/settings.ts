/**
 * Preferencias de apariencia.
 *
 * Todas se aplican escribiendo variables CSS en `<html>`, que es donde ya viven
 * la métrica y la tipografía del editor. Así cambiar una preferencia no toca
 * ninguna extensión de CodeMirror ni obliga a reconstruir el editor: el cambio
 * se ve mientras se arrastra el control.
 */

export interface Settings {
  /** Cadena vacía = la pila tipográfica del sistema. */
  bodyFont: string;
  codeFont: string;
  fontSize: number;
  lineHeight: number;
  /** Ancho de la columna de lectura, en rem. */
  measure: number;
  chrome: ChromeName;
}

export type AccentName = "terracota" | "oceano" | "bosque" | "ciruela";

export type ChromeName =
  | "neutro"
  | "petroleo"
  | "tinta"
  | "jade"
  | "bosque"
  | "ciruela"
  | "carmin"
  | "malva"
  | "pizarra"
  | "cielo"
  | "naranja"
  | "oro";

/**
 * Temas de barra: colorean la barra superior, el esquema, la apariencia y la
 * barra de estado, dejando intacto el papel del editor.
 *
 * Cada uno lleva el acento que mejor le contrasta, y no es configurable
 * aparte: la pareja barra/acento es una decisión de diseño, y dejarla suelta
 * sólo permitía romperla.
 */
export const CHROMES: { name: ChromeName; label: string; swatch: string; accent: AccentName }[] = [
  { name: "neutro", label: "Neutro", swatch: "", accent: "terracota" },
  { name: "petroleo", label: "Petróleo", swatch: "#0b3c49", accent: "terracota" },
  { name: "tinta", label: "Tinta", swatch: "#001011", accent: "oceano" },
  { name: "jade", label: "Jade", swatch: "#35605a", accent: "terracota" },
  { name: "bosque", label: "Bosque", swatch: "#498467", accent: "ciruela" },
  { name: "ciruela", label: "Ciruela", swatch: "#7b506f", accent: "bosque" },
  { name: "carmin", label: "Carmín", swatch: "#9c0d38", accent: "oceano" },
  { name: "malva", label: "Malva", swatch: "#584b53", accent: "oceano" },
  { name: "pizarra", label: "Pizarra", swatch: "#6b818c", accent: "terracota" },
  { name: "cielo", label: "Cielo", swatch: "#64a6bd", accent: "terracota" },
  { name: "naranja", label: "Naranja", swatch: "#f17300", accent: "oceano" },
  { name: "oro", label: "Oro", swatch: "#f1d302", accent: "ciruela" },
];

/** El acento que corresponde a una barra. */
export function accentFor(chrome: ChromeName): AccentName {
  return CHROMES.find((option) => option.name === chrome)?.accent ?? "terracota";
}

export const DEFAULTS: Settings = {
  bodyFont: "",
  codeFont: "",
  fontSize: 17,
  lineHeight: 1.78,
  measure: 47,
  chrome: "neutro",
};

export const LIMITS = {
  fontSize: { min: 13, max: 24, step: 1 },
  lineHeight: { min: 1.4, max: 2.2, step: 0.02 },
  measure: { min: 32, max: 72, step: 1 },
};

/** Candidatas para el cuerpo del texto, de más neutra a más marcada. */
const BODY_CANDIDATES = [
  "Segoe UI Variable Text",
  "Inter",
  "Aptos",
  "Calibri",
  "Verdana",
  "Georgia",
  "Cambria",
  "Constantia",
  "Palatino Linotype",
  "Times New Roman",
];

const CODE_CANDIDATES = [
  "Cascadia Code",
  "Cascadia Mono",
  "Consolas",
  "JetBrains Mono",
  "Fira Code",
  "Courier New",
  "Lucida Console",
];

/**
 * ¿Está instalada la fuente?
 *
 * Se mide el ancho de un texto con la fuente pedida y sin ella: si el navegador
 * hubiera caído al sustituto genérico, las dos medidas coincidirían. Es más
 * fiable que `document.fonts.check`, que da falsos positivos.
 */
function isInstalled(name: string): boolean {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return false;

  const sample = "MmmWWWiiil0Oo";
  const measure = (family: string): number => {
    context.font = `72px ${family}`;
    return context.measureText(sample).width;
  };

  return (
    measure(`"${name}", monospace`) !== measure("monospace") ||
    measure(`"${name}", serif`) !== measure("serif")
  );
}

let bodyFonts: string[] | null = null;
let codeFonts: string[] | null = null;

/** Fuentes de texto instaladas, calculadas una sola vez. */
export function availableBodyFonts(): string[] {
  bodyFonts ??= BODY_CANDIDATES.filter(isInstalled);
  return bodyFonts;
}

export function availableCodeFonts(): string[] {
  codeFonts ??= CODE_CANDIDATES.filter(isInstalled);
  return codeFonts;
}

const STORAGE_KEY = "unfold:settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };

    // Se mezcla sobre los valores por defecto: si en el futuro se añade una
    // preferencia, los ajustes ya guardados siguen siendo válidos.
    const merged = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } as Record<
      string,
      unknown
    >;
    // Y se descarta lo que ya no existe, para que una preferencia retirada
    // (como el acento, que ahora fija la barra) no se arrastre para siempre.
    return Object.fromEntries(
      Object.keys(DEFAULTS).map((key) => [key, merged[key]]),
    ) as unknown as Settings;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

const SYSTEM_BODY = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
const SYSTEM_CODE = '"Cascadia Code", "Consolas", ui-monospace, monospace';

export function applySettings(settings: Settings): void {
  const root = document.documentElement;
  root.style.setProperty(
    "--font-body",
    settings.bodyFont ? `"${settings.bodyFont}", ${SYSTEM_BODY}` : SYSTEM_BODY,
  );
  root.style.setProperty(
    "--font-mono",
    settings.codeFont ? `"${settings.codeFont}", ${SYSTEM_CODE}` : SYSTEM_CODE,
  );
  root.style.setProperty("--editor-font-size", `${settings.fontSize}px`);
  root.style.setProperty("--editor-line-height", String(settings.lineHeight));
  root.style.setProperty("--editor-measure", `${settings.measure}rem`);
  root.dataset.chrome = settings.chrome;
  root.dataset.accent = accentFor(settings.chrome);
}
