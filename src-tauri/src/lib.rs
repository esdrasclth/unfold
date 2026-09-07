use tauri::Manager;

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
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![startup_file])
        .setup(|app| {
            // La ventana se crea oculta y se muestra ya pintada: asi no se ve
            // el destello blanco del WebView al arrancar.
            if let Some(window) = app.get_webview_window("main") {
                apply_rounded_corners(&window);
                window.show()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al arrancar Unfold");
}
