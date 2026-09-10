import { Fragment } from "preact";
import { TabItem } from "./TabItem.tsx";

export interface TabBarTab {
  id: number;
  name: string;
  path: string | null;
  dirty: boolean;
}

export interface TabBarProps {
  tabs: readonly TabBarTab[];
  activeId: number;
  onActivate: (id: number) => void;
  onClose: (id: number) => void;
  [key: string]: unknown;
}

/**
 * Barra de pestañas.
 *
 * Se ve siempre, también con un solo documento: esconderla dejaba esa única
 * pestaña sin su aspa y no había forma de cerrarla con el ratón. Cerrar la
 * última no vacía la aplicación, deja un documento en blanco.
 *
 * Devuelve un fragmento y no un envoltorio propio porque el hueco —`#tab-bar`—
 * es ya el contenedor flexible que coloca las pestañas; meter un `div` en medio
 * las sacaría de esa disposición. El `role="tablist"` lo lleva el hueco.
 *
 * Lo que gana al pasar a Preact es el teclado. Antes eran `div`s sueltos: no se
 * llegaba a ellos tabulando ni había forma de recorrerlos. Ahora hay tabulación
 * itinerante, flechas para moverse, Inicio y Fin para los extremos, y Supr para
 * cerrar sin soltar el teclado.
 */
export function TabBar({ tabs, activeId, onActivate, onClose }: TabBarProps) {
  const alTeclado = (event: KeyboardEvent, id: number): void => {
    const indice = tabs.findIndex((tab) => tab.id === id);
    if (indice < 0 || tabs.length === 0) return;

    if (event.key === "Delete") {
      event.preventDefault();
      onClose(id);
      return;
    }

    let destino: number;
    switch (event.key) {
      case "ArrowRight":
        destino = (indice + 1) % tabs.length;
        break;
      case "ArrowLeft":
        destino = (indice - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        destino = 0;
        break;
      case "End":
        destino = tabs.length - 1;
        break;
      default:
        return;
    }

    const siguiente = tabs[destino];
    if (!siguiente || siguiente.id === id) return;
    event.preventDefault();
    onActivate(siguiente.id);
    // El foco viaja con la selección: quien recorre con las flechas espera
    // seguir dentro de la barra, no que el foco se quede en la de antes.
    document.getElementById(`tab-${siguiente.id}`)?.focus();
  };

  return (
    <Fragment>
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          id={tab.id}
          name={tab.name}
          path={tab.path}
          dirty={tab.dirty}
          active={tab.id === activeId}
          onActivate={onActivate}
          onClose={onClose}
          onKeyDown={alTeclado}
        />
      ))}
    </Fragment>
  );
}
