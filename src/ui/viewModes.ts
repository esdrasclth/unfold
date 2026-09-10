import type { EditorView } from "@codemirror/view";
import { setSourceMode, setTypewriter } from "../editor/index.ts";
import { icon } from "./icons.ts";

/** Los botones que reflejan cada modo. */
export interface ViewModeRefs {
  theme: HTMLElement;
  typewriter: HTMLElement;
  source: HTMLElement;
}

export interface ViewModes {
  alternarTema: () => void;
  alternarEnfoque: () => void;
  alternarMaquinaDeEscribir: () => void;
  alternarCodigoFuente: () => void;
  /** Deja los botones y el editor acordes al estado guardado. */
  aplicar: () => void;
  enCodigoFuente: () => boolean;
}

/**
 * Los modos de la vista: tema, enfoque, máquina de escribir y código fuente.
 *
 * Cuatro interruptores que hacen lo mismo con distinto nombre —guardar la
 * preferencia, tocar una clase del cuerpo y devolver el foco al editor— y que
 * estaban repartidos por `main.ts` con su estado suelto entre medias. Lo que
 * eligió quien escribe se conserva entre arranques, así que el estado tiene que
 * leerse antes de pintar nada; por eso se lee aquí al montar y no fuera.
 */
/**
 * Deja puesto el tema guardado antes de que se pinte nada.
 *
 * Va suelta y no dentro de los modos porque tiene que correr antes de crear el
 * editor: aplicarla después daría un parpadeo en claro a quien usa el oscuro.
 * Recién instalado se arranca en claro y no en lo que diga el sistema, que es
 * el aspecto con el que se diseñó el editor.
 */
export function aplicarTemaGuardado(boton: HTMLElement): void {
  const tema = localStorage.getItem("unfold:theme") ?? "light";
  document.documentElement.dataset.theme = tema;
  boton.innerHTML = icon(tema === "dark" ? "sun" : "moon");
}

export function mountViewModes(view: EditorView, el: ViewModeRefs): ViewModes {
  let sourceMode = localStorage.getItem("unfold:source-mode") === "on";
  let typewriterOn = localStorage.getItem("unfold:typewriter") === "on";

  const aplicarTema = (tema: string): void => {
    document.documentElement.dataset.theme = tema;
    el.theme.innerHTML = icon(tema === "dark" ? "sun" : "moon");
  };

  const aplicarMaquinaDeEscribir = (): void => {
    setTypewriter(view, typewriterOn);
    el.typewriter.classList.toggle("is-on", typewriterOn);
    document.body.classList.toggle("typewriter-mode", typewriterOn);
  };

  const aplicarCodigoFuente = (): void => {
    setSourceMode(view, sourceMode);
    el.source.classList.toggle("is-on", sourceMode);
    el.source.title = sourceMode ? "Vista renderizada" : "Código fuente";
    el.source.setAttribute("aria-pressed", String(sourceMode));
    el.source.setAttribute(
      "aria-label",
      sourceMode ? "Cambiar a vista renderizada" : "Cambiar a código fuente",
    );
    document.body.classList.toggle("source-mode", sourceMode);
  };

  return {
    alternarTema: () => {
      const siguiente = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      localStorage.setItem("unfold:theme", siguiente);
      aplicarTema(siguiente);
    },

    // El enfoque no se guarda a propósito: se enciende para una sesión de
    // trabajo concreta, y encontrárselo puesto al arrancar desconcierta.
    alternarEnfoque: () => {
      const puesto = document.body.classList.toggle("focus-mode");
      const boton = document.querySelector<HTMLButtonElement>("#btn-focus");
      boton?.classList.toggle("is-on", puesto);
      boton?.setAttribute("aria-pressed", String(puesto));
    },

    alternarMaquinaDeEscribir: () => {
      typewriterOn = !typewriterOn;
      localStorage.setItem("unfold:typewriter", typewriterOn ? "on" : "off");
      aplicarMaquinaDeEscribir();
      view.focus();
    },

    alternarCodigoFuente: () => {
      sourceMode = !sourceMode;
      localStorage.setItem("unfold:source-mode", sourceMode ? "on" : "off");
      aplicarCodigoFuente();
      view.focus();
    },

    // El tema no entra aquí: ya lo dejó puesto `aplicarTemaGuardado` antes de
    // que existiera el editor, y volver a tocarlo sólo repetiría trabajo.
    aplicar: () => {
      aplicarMaquinaDeEscribir();
      aplicarCodigoFuente();
    },

    enCodigoFuente: () => sourceMode,
  };
}
