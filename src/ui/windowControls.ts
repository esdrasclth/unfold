import { isTauri } from "../files.ts";
import { mountComponent } from "../components/mountComponent.ts";
import { WindowControls, type WindowControlsProps } from "../components/window/WindowControls.tsx";

/**
 * Monta los controles de ventana y los mantiene al día.
 *
 * El componente sólo pinta. Quién habla con la ventana —minimizar, alternar
 * maximizado, cerrar— y quién se entera de que cambió de tamaño es cosa de
 * aquí: el estado maximizado cambia también al arrastrar contra el borde o con
 * Win+flecha, sin que nadie pulse un botón.
 */
export function mountWindowControls(host: HTMLElement): void {
  if (!isTauri) {
    // En el navegador la ventana la gobierna el navegador.
    host.remove();
    return;
  }

  let vista: WindowControlsProps = {
    maximized: false,
    onMinimize: () => {},
    onToggleMaximize: () => {},
    onClose: () => {},
  };
  const controles = mountComponent<WindowControlsProps>(host, WindowControls, vista);

  void (async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();

    const pintar = (maximized: boolean): void => {
      vista = {
        maximized,
        onMinimize: () => void appWindow.minimize(),
        onToggleMaximize: () => void appWindow.toggleMaximize(),
        onClose: () => void appWindow.close(),
      };
      controles.update(vista);
    };

    const sincronizar = async (): Promise<void> => pintar(await appWindow.isMaximized());

    await appWindow.onResized(() => void sincronizar());
    await sincronizar();
  })();
}
