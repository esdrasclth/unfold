import { isTauri } from "../files.ts";

export interface DesktopIntegrationOptions {
  initialize(): Promise<void>;
  startupFile(path: string | null): Promise<void>;
  openFile(path: string): void;
  beforeClose(): Promise<boolean>;
}

/** Integra el runtime con Tauri sin filtrar eventos de escritorio al editor. */
export async function registerDesktopIntegration(options: DesktopIntegrationOptions): Promise<void> {
  await options.initialize();
  if (!isTauri) {
    await options.startupFile(null);
    return;
  }

  const [{ invoke }, { getCurrentWebview }, { getCurrentWindow }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/webview"),
    import("@tauri-apps/api/window"),
  ]);
  const appWindow = getCurrentWindow();
  let closing = false;

  await appWindow.onCloseRequested(async (event) => {
    if (closing) return;
    event.preventDefault();
    if (!(await options.beforeClose())) return;
    closing = true;
    await appWindow.destroy();
  });

  const startup = await invoke<string | null>("startup_file");
  await options.startupFile(startup);

  const { listen } = await import("@tauri-apps/api/event");
  await listen<string>("unfold://open-file", (event) => {
    if (event.payload) options.openFile(event.payload);
  });

  await getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type !== "drop") return;
    const dropped = event.payload.paths.find((path) => /\.(md|markdown|mdx|txt)$/i.test(path));
    if (dropped) options.openFile(dropped);
  });
}
