import { useLayoutEffect, useRef } from "preact/hooks";
import type { ComponentChildren, VNode } from "preact";
import { icon } from "../../ui/icons.ts";
import { Dialog } from "./Dialog.tsx";

export interface PickerDialogProps<T> {
  label: string;
  placeholder: string;
  inputLabel: string;
  query: string;
  onQuery: (query: string) => void;
  /** Sólo lo elegible; las cabeceras que haya entre medias no cuentan. */
  items: readonly T[];
  activeIndex: number;
  onActive: (index: number) => void;
  onRun: (item: T) => void;
  onClose: () => void;
  renderItem: (item: T, index: number, active: boolean) => VNode;
  /** Qué enseñar cuando no hay nada que elegir. */
  empty: ComponentChildren;
  footer: ComponentChildren;
  /** Clase extra del fondo y del panel, para el CSS propio de cada uno. */
  variant?: string;
}

/**
 * Un cuadro para elegir de una lista escribiendo.
 *
 * La paleta de comandos y la búsqueda en todos los documentos son la misma cosa
 * con distinto contenido: un campo arriba, una lista debajo, flechas para
 * recorrerla y Enter para ejecutar.
 *
 * La selección la lleva la lista y no el foco del navegador: el foco se queda
 * siempre en el campo, para poder seguir escribiendo mientras se recorre con
 * las flechas. Moverlo a cada fila obligaba a volver al campo para afinar.
 */
export function PickerDialog<T>({
  label,
  placeholder,
  inputLabel,
  query,
  onQuery,
  items,
  activeIndex,
  onActive,
  onRun,
  onClose,
  renderItem,
  empty,
  footer,
  variant,
}: PickerDialogProps<T>) {
  const lista = useRef<HTMLDivElement>(null);

  // La activa siempre a la vista al recorrer con las flechas, sin mover el foco.
  useLayoutEffect(() => {
    lista.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, items]);

  const mover = (paso: number): void => {
    if (items.length === 0) return;
    onActive((activeIndex + paso + items.length) % items.length);
  };

  return (
    <Dialog
      label={label}
      backdropClass={`command-palette-backdrop${variant ? ` ${variant}-backdrop` : ""}`}
      className={`command-palette${variant ? ` ${variant}` : ""}`}
      onClose={onClose}
      autoFocus=".command-palette-input"
    >
      <div class="command-palette-search">
        <span dangerouslySetInnerHTML={{ __html: icon("search") }} />
        <input
          class="command-palette-input"
          placeholder={placeholder}
          aria-label={inputLabel}
          autocomplete="off"
          role="combobox"
          aria-expanded="true"
          aria-controls="picker-lista"
          value={query}
          onInput={(event) => onQuery((event.currentTarget as HTMLInputElement).value)}
          onKeyDown={(event) => {
            switch (event.key) {
              case "ArrowDown":
                event.preventDefault();
                mover(1);
                break;
              case "ArrowUp":
                event.preventDefault();
                mover(-1);
                break;
              case "Enter": {
                event.preventDefault();
                const elegido = items[activeIndex];
                if (elegido !== undefined) onRun(elegido);
                break;
              }
              // Escape lo lleva el armazón, que sabe cuál está encima.
              default:
                break;
            }
          }}
        />
      </div>

      <div class="command-palette-list" id="picker-lista" role="listbox" ref={lista}>
        {items.length === 0 ? empty : items.map((item, index) => renderItem(item, index, index === activeIndex))}
      </div>

      <div class="command-palette-foot">{footer}</div>
    </Dialog>
  );
}
