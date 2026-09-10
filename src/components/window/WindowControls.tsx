const GLYPHS = {
  minimize: '<path d="M1 6h10" />',
  maximize: '<rect x="1.5" y="1.5" width="9" height="9" rx="1" />',
  restore:
    '<path d="M3.5 3.5V2.2A.7.7 0 0 1 4.2 1.5h6.1a.7.7 0 0 1 .7.7v6.1a.7.7 0 0 1-.7.7H9.2" /><rect x="1.5" y="3.5" width="7.5" height="7.5" rx=".7" />',
  close: '<path d="m1.5 1.5 9 9M10.5 1.5l-9 9" />',
};

export type GlyphName = keyof typeof GLYPHS;

export function glyph(name: GlyphName): string {
  return `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name]}</svg>`;
}

export interface WindowControlsProps {
  maximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  [key: string]: unknown;
}

function Boton({ id, className, title, glyphName, onClick }: {
  id: string;
  className: string;
  title: string;
  glyphName: GlyphName;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      class={className}
      title={title}
      aria-label={title}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: glyph(glyphName) }}
    />
  );
}

/**
 * Controles de ventana propios.
 *
 * La ventana se crea sin decoración del sistema para que la barra de título no
 * rompa la paleta de la aplicación con su gris fijo. A cambio hay que reponer
 * minimizar, maximizar y cerrar respetando las medidas de Windows 11 —46×32 por
 * botón, rojo sólo al pasar por encima del de cerrar— para que sigan donde el
 * músculo los busca.
 *
 * Maximizar y restaurar son el mismo botón con dos caras, y cuál toca lo dice
 * quien lo monta: el estado cambia también al arrastrar contra el borde o con
 * Win+flecha, sin que nadie pulse aquí.
 */
export function WindowControls({
  maximized,
  onMinimize,
  onToggleMaximize,
  onClose,
}: WindowControlsProps) {
  return (
    <>
      <Boton
        id="win-min"
        className="window-button"
        title="Minimizar"
        glyphName="minimize"
        onClick={onMinimize}
      />
      <Boton
        id="win-max"
        className="window-button"
        title={maximized ? "Restaurar" : "Maximizar"}
        glyphName={maximized ? "restore" : "maximize"}
        onClick={onToggleMaximize}
      />
      <Boton
        id="win-close"
        className="window-button is-close"
        title="Cerrar"
        glyphName="close"
        onClick={onClose}
      />
    </>
  );
}
