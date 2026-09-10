import { icon } from "../../ui/icons.ts";
import { Notice } from "./Notice.tsx";

export interface DocumentTitleProps {
  name: string;
  notice: string | null;
  dirty: boolean;
  /** Un documento sin ruta y sin cambios no dice nada: aún no es nada. */
  saved: boolean;
  [key: string]: unknown;
}

/**
 * El nombre del documento y su estado, en la barra de título.
 *
 * Van juntos porque se leen juntos —«guia.md · sin guardar»— y porque el hueco
 * es el bloque entero: dejar sólo el estado a Preact obligaría a meter un nodo
 * de más dentro de una fila flexible con tres hijos contados.
 *
 * El icono se inserta con `dangerouslySetInnerHTML` por ser SVG ya escrito en
 * `icons.ts`, que es de donde salen todos los demás de la aplicación. Es una
 * cadena nuestra y constante, no algo que venga de fuera.
 */
export function DocumentTitle({ name, notice, dirty, saved }: DocumentTitleProps) {
  return (
    <>
      <span class="titlebar-icon" dangerouslySetInnerHTML={{ __html: icon("file") }} />
      <span class="titlebar-name" id="doc-name">
        {name}
      </span>
      <Notice notice={notice} dirty={dirty} saved={saved} />
    </>
  );
}
