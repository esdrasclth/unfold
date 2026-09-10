export interface NoticeProps {
  /** Aviso breve que tapa al estado mientras dura. */
  notice: string | null;
  dirty: boolean;
  /** Un documento sin ruta y sin cambios no dice nada: aún no es nada. */
  saved: boolean;
  [key: string]: unknown;
}

/**
 * El estado del documento en la barra de título, y los avisos breves.
 *
 * Comparten sitio a propósito: el aviso aparece donde ya se está mirando para
 * saber si hay cambios sin guardar, y se va solo dejando el estado debajo. Una
 * región aparte para tres palabras que duran tres segundos sería más ruido.
 *
 * `aria-live` educado y no urgente: esto acompaña a quien escribe, no le
 * interrumpe. Y la etiqueta se escribe entera —«Documento sin guardar»— porque
 * «sin guardar» a secas, leído en voz alta y sin contexto, no dice de qué.
 */
export function Notice({ notice, dirty, saved }: NoticeProps) {
  const texto = notice ?? (dirty ? "sin guardar" : saved ? "guardado" : "");

  return (
    <span
      id="doc-status"
      class={`titlebar-status${notice ? " is-notice" : ""}${!notice && dirty ? " is-dirty" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={notice ?? (dirty ? "Documento sin guardar" : "Documento guardado")}
    >
      {texto}
    </span>
  );
}
