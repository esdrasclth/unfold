import type { CommandAction } from "./commandPalette.ts";

/**
 * Todo lo que la paleta sabe hacer, con quién lo hace de verdad.
 *
 * La lista vivía incrustada en el manejador del atajo, entre corchetes y con
 * dos acciones escritas del tirón dentro de la propia lista. Aquí es una tabla:
 * se lee de arriba abajo qué ofrece la aplicación, que es justo lo que uno
 * quiere ver cuando se pregunta si algo tiene comando o no.
 */
export interface PaletteActions {
  nuevo: () => void;
  abrir: () => void;
  guardar: () => void;
  exportar: () => void;
  imprimir: () => void;
  alternarCodigoFuente: () => void;
  alternarEnfoque: () => void;
  alternarTema: () => void;
  abrirAjustes: () => void;
  abrirExplorador: () => void;
  buscarPorNombre: () => void;
  buscarEnDocumentos: () => void;
  publicar: () => void;
  abrirGithub: () => void;
  verHistorial: () => void;
  configurarCarpetaCopias: () => void;
  recuperarCopia: () => void;
  /** El rótulo cambia según el modo, así que se pregunta al abrir la paleta. */
  enCodigoFuente: () => boolean;
  /** Se enseña entre paréntesis cuando ya hay carpeta elegida. */
  carpetaCopias: () => string | null;
}

export function paletteCommands(acciones: PaletteActions): CommandAction[] {
  const carpeta = acciones.carpetaCopias();
  return [
    { id: "new", label: "Nuevo documento", shortcut: "Ctrl+N", run: acciones.nuevo },
    { id: "open", label: "Abrir documento", shortcut: "Ctrl+O", run: acciones.abrir },
    { id: "save", label: "Guardar documento", shortcut: "Ctrl+S", run: acciones.guardar },
    { id: "export", label: "Exportar a HTML", shortcut: "Ctrl+Shift+E", run: acciones.exportar },
    { id: "print", label: "Imprimir / exportar PDF", shortcut: "Ctrl+P", run: acciones.imprimir },
    {
      id: "source",
      label: acciones.enCodigoFuente() ? "Usar vista renderizada" : "Usar código fuente",
      run: acciones.alternarCodigoFuente,
    },
    { id: "focus", label: "Alternar modo enfoque", run: acciones.alternarEnfoque },
    { id: "theme", label: "Cambiar tema", run: acciones.alternarTema },
    { id: "settings", label: "Abrir Apariencia y ajustes", run: acciones.abrirAjustes },
    {
      id: "repositories",
      label: "Explorador de repositorios",
      shortcut: "Ctrl+Shift+B",
      run: acciones.abrirExplorador,
    },
    { id: "repositories-search", label: "Buscar un documento por nombre", run: acciones.buscarPorNombre },
    {
      id: "search-documents",
      label: "Buscar en todos los documentos",
      shortcut: "Ctrl+Shift+L",
      run: acciones.buscarEnDocumentos,
    },
    { id: "publish", label: "Publicar cambios en GitHub", shortcut: "Ctrl+Shift+U", run: acciones.publicar },
    { id: "github", label: "Conectar o revisar GitHub", shortcut: "Ctrl+Shift+H", run: acciones.abrirGithub },
    { id: "history", label: "Ver historial y recuperar versión", run: acciones.verHistorial },
    {
      id: "backup-folder",
      label: `Configurar carpeta de copias${carpeta ? ` (${carpeta})` : ""}`,
      run: acciones.configurarCarpetaCopias,
    },
    { id: "restore-backup", label: "Recuperar última copia automática", run: acciones.recuperarCopia },
  ];
}
