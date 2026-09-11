import type { EditorView } from "@codemirror/view";
import { setSourceMode, setTypewriter } from "../editor/index.ts";

export interface ViewModeState {
  theme: string;
  sourceMode: boolean;
  typewriter: boolean;
  focusMode: boolean;
}

export interface ViewModes {
  alternarTema: () => void;
  alternarEnfoque: () => void;
  alternarMaquinaDeEscribir: () => void;
  alternarCodigoFuente: () => void;
  /** Deja el editor y el cuerpo acordes al estado guardado. */
  aplicar: () => void;
  enCodigoFuente: () => boolean;
  estado: () => ViewModeState;
}

/**
 * Deja puesto el tema guardado antes de que se pinte nada.
 *
 * Va suelta porque tiene que correr antes de crear el editor: aplicarla después
 * daría un parpadeo en claro a quien usa el oscuro. Recién instalado se arranca
 * en claro y no en lo que diga el sistema, que es el aspecto con el que se
 * diseñó el editor.
 */
export function aplicarTemaGuardado(): string {
  const tema = localStorage.getItem("unfold:theme") ?? "light";
  document.documentElement.dataset.theme = tema;
  return tema;
}

/**
 * Los modos de la vista: tema, enfoque, máquina de escribir y código fuente.
 *
 * Cuatro interruptores que hacen lo mismo con distinto nombre: guardar la
 * preferencia, tocar una clase del cuerpo y devolver el foco al editor.
 *
 * Ya no tocan botones. Lo que se ve encendido sale del estado que esto publica
 * y lo pinta el armazón, así que nadie busca un botón por su identificador para
 * decir que ahora está activo.
 */
export function mountViewModes(view: EditorView, onChange: (estado: ViewModeState) => void): ViewModes {
  let sourceMode = localStorage.getItem("unfold:source-mode") === "on";
  let typewriterOn = localStorage.getItem("unfold:typewriter") === "on";
  let focusMode = false;
  let theme = document.documentElement.dataset.theme ?? "light";

  const estado = (): ViewModeState => ({ theme, sourceMode, typewriter: typewriterOn, focusMode });
  const avisar = (): void => onChange(estado());

  const aplicarMaquinaDeEscribir = (): void => {
    setTypewriter(view, typewriterOn);
    document.body.classList.toggle("typewriter-mode", typewriterOn);
  };

  const aplicarCodigoFuente = (): void => {
    setSourceMode(view, sourceMode);
    document.body.classList.toggle("source-mode", sourceMode);
  };

  return {
    alternarTema: () => {
      theme = theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = theme;
      localStorage.setItem("unfold:theme", theme);
      avisar();
    },

    // El enfoque no se guarda a propósito: se enciende para una sesión de
    // trabajo concreta, y encontrárselo puesto al arrancar desconcierta.
    alternarEnfoque: () => {
      focusMode = !focusMode;
      document.body.classList.toggle("focus-mode", focusMode);
      avisar();
    },

    alternarMaquinaDeEscribir: () => {
      typewriterOn = !typewriterOn;
      localStorage.setItem("unfold:typewriter", typewriterOn ? "on" : "off");
      aplicarMaquinaDeEscribir();
      avisar();
      view.focus();
    },

    alternarCodigoFuente: () => {
      sourceMode = !sourceMode;
      localStorage.setItem("unfold:source-mode", sourceMode ? "on" : "off");
      aplicarCodigoFuente();
      avisar();
      view.focus();
    },

    aplicar: () => {
      aplicarMaquinaDeEscribir();
      aplicarCodigoFuente();
      avisar();
    },

    enCodigoFuente: () => sourceMode,
    estado,
  };
}
