use tauri::Manager;
use tauri_plugin_window_state::{StateFlags, WindowExt};

/// Qué se recuerda de la ventana entre sesiones.
const WINDOW_STATE: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED)
    .union(StateFlags::FULLSCREEN);

pub mod git;
mod github;
mod repositories;

/// Ruta pasada por linea de comandos, para poder asociar Unfold a los .md
/// y que abrir un archivo desde el explorador funcione.
#[tauri::command]
fn startup_file() -> Option<String> {
    std::env::args().nth(1).filter(|arg| !arg.starts_with('-'))
}

/// Pide a Windows 11 las esquinas redondeadas y la sombra del sistema.
///
/// La ventana se crea sin decoracion para que la barra de titulo gris del
/// sistema no rompa la paleta de la aplicacion. El efecto secundario es que
/// tambien se pierde el redondeo que Windows aplica a las ventanas normales, y
/// sin el la ventana se ve como un rectangulo pegado a la pantalla. Esta
/// llamada lo devuelve sin renunciar a la barra de titulo propia.
#[cfg(windows)]
fn apply_rounded_corners(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };

    let Ok(handle) = window.hwnd() else {
        return;
    };

    // En Windows 10 el atributo no existe: la llamada falla y no pasa nada.
    unsafe {
        let preference = DWMWCP_ROUND;
        let _ = DwmSetWindowAttribute(
            HWND(handle.0 as _),
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const _ as *const std::ffi::c_void,
            std::mem::size_of_val(&preference) as u32,
        );
    }
}

#[cfg(not(windows))]
fn apply_rounded_corners(_window: &tauri::WebviewWindow) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(github::GithubClient::new())
        .manage(repositories::Catalog::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // La ventana vuelve como se dejó: tamaño, sitio y si estaba
        // maximizada. Es lo que hace cualquier aplicación de escritorio, y
        // reabrir siempre en el centro obligaba a recolocarla cada vez.
        //
        // Se piden esas cuatro banderas y no todas a propósito. `VISIBLE`
        // devolvería la ventana visible antes de tiempo y con ella el
        // destello blanco que se evita mostrándola ya pintada; `DECORATIONS`
        // podría reponer la barra de título del sistema, que se quita para
        // poder usar la propia.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(WINDOW_STATE)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            startup_file,
            github::github_start_device_flow,
            github::github_poll_device_flow,
            github::github_auth_status,
            github::github_list_repositories,
            github::github_installation_state,
            github::github_logout,
            repositories::github_connected_repositories,
            repositories::github_connect_repository,
            repositories::github_disconnect_repository,
            repositories::github_fetch_repository,
            repositories::github_repository_documents,
            repositories::github_create_repository_document,
            repositories::github_touch_repository,
            repositories::github_repository_changes,
            repositories::github_repository_state,
            repositories::github_repository_diff,
            repositories::github_commit_identity,
            repositories::github_publish,
            repositories::github_push_pending,
        ])
        .setup(|app| {
            // La ventana se crea oculta y se muestra ya pintada: asi no se ve
            // el destello blanco del WebView al arrancar.
            if let Some(window) = app.get_webview_window("main") {
                // Antes de mostrarla: recolocarla ya visible se vería como un
                // salto. Si no hay nada guardado —primer arranque— no hace
                // nada y manda lo que diga la configuración.
                let _ = window.restore_state(WINDOW_STATE);
                apply_rounded_corners(&window);
                window.show()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al arrancar Unfold");
}
