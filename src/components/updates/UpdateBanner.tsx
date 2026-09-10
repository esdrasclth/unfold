import { icon } from "../../ui/icons.ts";

export type UpdateStatus = "idle" | "checking" | "available" | "installing" | "error";

export type UpdateAction = "cerrar" | "tarde" | "omitir" | "reintentar" | "instalar";

export interface UpdateBannerProps {
  status: UpdateStatus;
  version: string;
  /** Cuerpo del manifiesto, tal como llega; aquí se recorta a viñetas. */
  notes: string;
  /** Motivo del fallo, sólo en `error`. */
  reason: string;
  downloaded: number;
  total: number | null;
  onAction: (action: UpdateAction) => void;
  [key: string]: unknown;
}

/** Las novedades, en viñetas y sin pasar de tres: es un aviso, no el diario. */
export function novedades(texto: string): string[] {
  return texto
    .split("\n")
    .map((linea) => linea.replace(/^[-*•]\s+/, "").trim())
    .filter((linea) => linea.length > 0 && !linea.startsWith("#"))
    .slice(0, 3);
}

export function megasDescargados(descargado: number, total: number | null): string {
  const megas = (descargado / 1024 / 1024).toFixed(1);
  return total ? `${megas} de ${(total / 1024 / 1024).toFixed(1)} MB` : `${megas} MB descargados`;
}

function Icono({ name }: { name: string }) {
  return <span class="update-card-icon" dangerouslySetInnerHTML={{ __html: icon(name) }} />;
}

function Cerrar({ action, label, onAction }: {
  action: UpdateAction;
  label: string;
  onAction: (action: UpdateAction) => void;
}) {
  return (
    <button
      type="button"
      class="update-card-close"
      aria-label={label}
      onClick={() => onAction(action)}
      dangerouslySetInnerHTML={{ __html: icon("close") }}
    />
  );
}

/**
 * El aviso de versión nueva.
 *
 * Sólo pinta. Quién comprueba, cuándo y con qué resultado es cosa del
 * controlador que lo monta: aquí no hay temporizadores, ni llamadas a la red,
 * ni `useEffect` que dispare nada. Entra un estado y sale una tarjeta.
 *
 * «Más tarde» y «Omitir esta versión» son acciones distintas a propósito: la
 * primera aparta la tarjeta y la segunda descarta la versión. Estuvieron
 * confundidas en un mismo botón, y quien lo pulsaba esperando que se lo
 * recordaran no volvía a saber de esa versión nunca.
 */
export function UpdateBanner(props: UpdateBannerProps) {
  const { status, version, notes, reason, downloaded, total, onAction } = props;
  if (status === "idle") return null;

  if (status === "checking") {
    return (
      <div class="update-card-head">
        <Icono name="refresh" />
        <div class="update-card-title">
          <strong>Buscando actualizaciones…</strong>
        </div>
        <Cerrar action="cerrar" label="Cerrar" onAction={onAction} />
      </div>
    );
  }

  if (status === "installing") {
    return (
      <>
        <div class="update-card-head">
          <Icono name="download" />
          <div class="update-card-title">
            <strong>Instalando Unfold {version}</strong>
            <span class="update-card-progress-text">
              {downloaded > 0 ? megasDescargados(downloaded, total) : "Preparando la descarga…"}
            </span>
          </div>
        </div>
        <div
          class="update-card-bar"
          role="progressbar"
          aria-label="Descarga de la actualización"
          aria-valuemin={0}
          aria-valuemax={100}
          // Sin tamaño total no hay proporción honesta que dar, y una barra sin
          // valor es justo cómo se dice «esto avanza pero no sé cuánto falta».
          aria-valuenow={total ? Math.round((downloaded / total) * 100) : undefined}
        >
          <span style={total ? `width:${Math.min(100, (downloaded / total) * 100)}%` : "width:0"} />
        </div>
        <p class="update-card-note">
          Unfold se reiniciará solo al terminar, y tus pestañas vuelven como están.
        </p>
      </>
    );
  }

  if (status === "error") {
    return (
      <>
        <div class="update-card-head">
          <Icono name="alert" />
          <div class="update-card-title">
            <strong>No se pudo actualizar</strong>
            <span class="update-card-reason">{reason}</span>
          </div>
          <Cerrar action="cerrar" label="Cerrar" onAction={onAction} />
        </div>
        <div class="update-card-actions">
          <button type="button" class="update-card-btn is-primary" onClick={() => onAction("reintentar")}>
            Reintentar
          </button>
        </div>
      </>
    );
  }

  const puntos = novedades(notes);
  return (
    <>
      <div class="update-card-head">
        <Icono name="download" />
        <div class="update-card-title">
          <strong>Unfold {version}</strong>
          <span>Hay una versión nueva disponible</span>
        </div>
        <Cerrar action="tarde" label="Más tarde" onAction={onAction} />
      </div>
      {puntos.length > 0 && (
        <ul class="update-card-notes">
          {puntos.map((punto) => (
            <li key={punto}>{punto}</li>
          ))}
        </ul>
      )}
      <div class="update-card-actions">
        <button type="button" class="update-card-btn is-primary" onClick={() => onAction("instalar")}>
          Reiniciar e instalar
        </button>
        <button type="button" class="update-card-btn" onClick={() => onAction("tarde")}>
          Más tarde
        </button>
      </div>
      <button type="button" class="update-card-skip" onClick={() => onAction("omitir")}>
        Omitir esta versión
      </button>
    </>
  );
}
