use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
// `raw_arg` evita que Rust entrecomille el argumento: NSIS exige `/D` sin
// comillas aunque la ruta lleve espacios.
#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// El instalador NSIS viaja dentro de este binario.
///
/// Se empotra en vez de acompanarlo como archivo suelto para que lo que se
/// descarga sea un unico .exe. La ruta apunta al artefacto de la aplicacion
/// principal, asi que hay que compilarla antes que esto.
const NSIS: &[u8] = include_bytes!("../../../src-tauri/target/release/bundle/nsis/Unfold_0.2.0_x64-setup.exe");

/// Carpeta propuesta: la misma que usaria el instalador por su cuenta.
#[tauri::command]
fn destino_por_defecto() -> String {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\".into());
    format!("{base}\\Unfold")
}

#[tauri::command]
fn tamano_instalador() -> u64 {
    // Redondeado hacia arriba: prometer menos de lo que ocupa seria mentir.
    (NSIS.len() as u64).div_ceil(1024 * 1024)
}

fn escribir_temporal() -> Result<PathBuf, String> {
    let destino = std::env::temp_dir().join("unfold-instalador.exe");
    let mut archivo = std::fs::File::create(&destino)
        .map_err(|e| format!("No se pudo preparar el instalador: {e}"))?;
    archivo
        .write_all(NSIS)
        .map_err(|e| format!("No se pudo preparar el instalador: {e}"))?;
    Ok(destino)
}

/// Ejecuta el instalador NSIS en silencio.
///
/// `/S` lo hace silencioso y `/D` fija la carpeta. NSIS exige que `/D` sea el
/// ultimo parametro y que vaya sin comillas aunque la ruta tenga espacios: es
/// una peculiaridad suya, no un descuido.
#[tauri::command]
fn instalar(destino: String, acceso_directo: bool) -> Result<(), String> {
    let ruta = escribir_temporal()?;

    let mut orden = Command::new(&ruta);
    orden.arg("/S");
    if acceso_directo {
        orden.arg("/DESKTOP");
    }
    orden.raw_arg(format!("/D={}", destino.trim_end_matches('\\')));

    let salida = orden
        .status()
        .map_err(|e| format!("No se pudo ejecutar el instalador: {e}"))?;

    // Se borra el temporal haya ido bien o mal; su fallo no es del usuario.
    let _ = std::fs::remove_file(&ruta);

    if salida.success() {
        Ok(())
    } else {
        Err(format!(
            "El instalador termino con el codigo {}.",
            salida.code().unwrap_or(-1)
        ))
    }
}

#[tauri::command]
fn abrir_unfold(destino: String) -> Result<(), String> {
    let exe = PathBuf::from(&destino).join("unfold.exe");
    Command::new(&exe)
        .spawn()
        .map_err(|e| format!("No se pudo abrir Unfold: {e}"))?;
    Ok(())
}

#[tauri::command]
fn desinstalar(destino: String, borrar_datos: bool) -> Result<(), String> {
    let exe = PathBuf::from(&destino).join("uninstall.exe");
    if !exe.exists() { return Err("No se encontró el desinstalador de Unfold.".into()); }
    if borrar_datos {
        for base in ["APPDATA", "LOCALAPPDATA"] {
            if let Ok(root) = std::env::var(base) {
                let data = PathBuf::from(root).join("com.esdras.unfold");
                if data.exists() { let _ = std::fs::remove_dir_all(data); }
            }
        }
    }
    let mut command = Command::new(&exe);
    command.arg("/S");
    command.spawn().map_err(|e| format!("No se pudo iniciar el desinstalador: {e}"))?;
    Ok(())
}

/// Esquinas redondeadas de Windows 11, igual que en la aplicacion: la ventana
/// no lleva decoracion del sistema y sin esto seria un rectangulo pegado.
#[cfg(windows)]
fn redondear(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };

    let Ok(handle) = window.hwnd() else { return };
    unsafe {
        let preferencia = DWMWCP_ROUND;
        let _ = DwmSetWindowAttribute(
            HWND(handle.0 as _),
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preferencia as *const _ as *const std::ffi::c_void,
            std::mem::size_of_val(&preferencia) as u32,
        );
    }
}

#[cfg(not(windows))]
fn redondear(_window: &tauri::WebviewWindow) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            destino_por_defecto,
            tamano_instalador,
            instalar,
            abrir_unfold,
            desinstalar
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                redondear(&window);
                window.show()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al arrancar el instalador de Unfold");
}
