import { PickerDialog } from "./PickerDialog.tsx";

export interface CommandAction {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void;
}

export interface CommandPaletteProps {
  actions: readonly CommandAction[];
  query: string;
  activeIndex: number;
  onQuery: (query: string) => void;
  onActive: (index: number) => void;
  onRun: (action: CommandAction) => void;
  onClose: () => void;
}

export function filtrar(
  actions: readonly CommandAction[],
  query: string,
): readonly CommandAction[] {
  const aguja = query.trim().toLowerCase();
  if (!aguja) return actions;
  return actions.filter((action) => action.label.toLowerCase().includes(aguja));
}

/** Resalta el trozo que coincide, que es lo que explica por qué está ahí. */
export function Rotulo({ label, query }: { label: string; query: string }) {
  const aguja = query.trim().toLowerCase();
  const desde = aguja ? label.toLowerCase().indexOf(aguja) : -1;
  if (desde < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, desde)}
      <mark>{label.slice(desde, desde + aguja.length)}</mark>
      {label.slice(desde + aguja.length)}
    </>
  );
}

/**
 * Paleta de comandos.
 *
 * Enseña el atajo de cada acción que lo tenga: la paleta es donde se descubren,
 * y quien la usa dos veces para lo mismo ya sabe cómo no volver a abrirla.
 */
export function CommandPalette({
  actions,
  query,
  activeIndex,
  onQuery,
  onActive,
  onRun,
  onClose,
}: CommandPaletteProps) {
  const coincidencias = filtrar(actions, query);

  return (
    <PickerDialog<CommandAction>
      label="Paleta de comandos"
      placeholder="Buscar una acción…"
      inputLabel="Buscar comandos"
      query={query}
      onQuery={onQuery}
      items={coincidencias}
      activeIndex={activeIndex}
      onActive={onActive}
      onRun={onRun}
      onClose={onClose}
      empty={
        <p class="command-palette-empty">{`Ninguna acción coincide con «${query.trim()}».`}</p>
      }
      footer={
        <>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> moverse
          </span>
          <span>
            <kbd>↵</kbd> ejecutar
          </span>
          <span>
            <kbd>Esc</kbd> cerrar
          </span>
        </>
      }
      renderItem={(action, index, active) => (
        <button
          key={action.id}
          type="button"
          class={`command-palette-item${active ? " is-active" : ""}`}
          role="option"
          aria-selected={active}
          onClick={() => onRun(action)}
          // Apuntar con el ratón mueve la selección: si no, habría dos a la vez.
          onMouseMove={() => {
            if (index !== activeIndex) onActive(index);
          }}
        >
          <span class="command-palette-label">
            <Rotulo label={action.label} query={query} />
          </span>
          {action.shortcut && (
            <span class="command-palette-keys">
              {action.shortcut.split("+").map((tecla) => (
                <kbd key={tecla}>{tecla}</kbd>
              ))}
            </span>
          )}
        </button>
      )}
    />
  );
}
