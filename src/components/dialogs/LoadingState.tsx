/**
 * Que algo está en marcha.
 *
 * Una caja vacía mientras se espera parece una avería; esto dice que no lo es.
 * El texto sale sólo para quien no ve la animación.
 */
export function LoadingState({ label = "Cargando…" }: { label?: string }) {
  return (
    <div class="github-loading" role="status" aria-live="polite">
      <span aria-hidden="true" />
      <span class="visually-hidden">{label}</span>
    </div>
  );
}
