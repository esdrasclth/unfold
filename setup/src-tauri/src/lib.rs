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
#[cfg(not(sin_instalador))]
const NSIS: &[u8] = include_bytes!(concat!(
    "../../../src-tauri/target/release/bundle/nsis/Unfold_",
    env!("CARGO_PKG_VERSION"),
    "_x64-setup.exe"
));

/// Hueco vacio para compilar sin el artefacto: ver `build.rs`. Instalar con
/// esto puesto no escribe nada, asi que se rechaza antes de intentarlo.
#[cfg(sin_instalador)]
const NSIS: &[u8] = &[];

/// Carpeta propuesta: la misma que usaria el instalador por su cuenta.
fn destino_en(base: Option<String>) -> String {
    // Sin `LOCALAPPDATA` no se puede adivinar el perfil, y proponer la raiz
    // es mejor que proponer nada: quien la vea la cambiara.
    let base = base.unwrap_or_else(|| "C:\\".into());
    format!("{}\\Unfold", base.trim_end_matches('\\'))
}

#[tauri::command]
fn destino_por_defecto() -> String {
    destino_en(std::env::var("LOCALAPPDATA").ok())
}

fn megas(bytes: u64) -> u64 {
    // Redondeado hacia arriba: prometer menos de lo que ocupa seria mentir.
    bytes.div_ceil(1024 * 1024)
}

#[tauri::command]
fn tamano_instalador() -> u64 {
    megas(NSIS.len() as u64)
}

fn escribir_temporal() -> Result<PathBuf, String> {
    if NSIS.is_empty() {
        return Err("Este binario se compilo sin el instalador empotrado.".into());
    }
    let destino = std::env::temp_dir().join("unfold-instalador.exe");
    let mut archivo = std::fs::File::create(&destino)
        .map_err(|e| format!("No se pudo preparar el instalador: {e}"))?;
    archivo
        .write_all(NSIS)
        .map_err(|e| format!("No se pudo preparar el instalador: {e}"))?;
    Ok(destino)
}

/// NSIS exige que `/D` sea el ultimo parametro, sin comillas y sin barra
/// final: con ella crea una carpeta de nombre vacio dentro del destino.
fn argumento_destino(destino: &str) -> String {
    format!("/D={}", destino.trim().trim_end_matches(['\\', '/']))
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
    orden.raw_arg(argumento_destino(&destino));

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

#[cfg(test)]
mod tests {
    use super::*;

    /// NSIS crea una carpeta de nombre vacio dentro del destino si `/D` acaba
    /// en barra, asi que Unfold quedaria instalado en `...\Unfold\`.
    #[test]
    fn the_destination_argument_never_ends_in_a_slash() {
        assert_eq!(argumento_destino(r"C:\Apps\Unfold"), r"/D=C:\Apps\Unfold");
        assert_eq!(argumento_destino(r"C:\Apps\Unfold\"), r"/D=C:\Apps\Unfold");
        assert_eq!(argumento_destino(r"C:\Apps\Unfold\\\"), r"/D=C:\Apps\Unfold");
        assert_eq!(argumento_destino("C:/Apps/Unfold/"), "/D=C:/Apps/Unfold");
    }

    /// La ruta llega de una caja de texto, y un espacio pegado al final es lo
    /// mas facil de dejarse al pegarla.
    #[test]
    fn surrounding_whitespace_is_dropped() {
        assert_eq!(argumento_destino(r"  C:\Apps\Unfold  "), r"/D=C:\Apps\Unfold");
    }

    /// Va sin comillas a proposito: es la peculiaridad de NSIS que obliga a
    /// usar `raw_arg`, y entrecomillarlo romperia la instalacion.
    #[test]
    fn the_destination_argument_is_not_quoted() {
        let con_espacios = argumento_destino(r"C:\Program Files\Unfold");
        assert_eq!(con_espacios, r"/D=C:\Program Files\Unfold");
        assert!(!con_espacios.contains('"'));
    }

    #[test]
    fn the_proposed_folder_hangs_from_the_user_profile() {
        assert_eq!(
            destino_en(Some(r"C:\Users\ana\AppData\Local".into())),
            r"C:\Users\ana\AppData\Local\Unfold"
        );
        assert_eq!(
            destino_en(Some(r"C:\Users\ana\AppData\Local\".into())),
            r"C:\Users\ana\AppData\Local\Unfold",
            "no se duplica la barra"
        );
    }

    /// Sin `LOCALAPPDATA` hay que proponer algo: una caja vacia deja a quien
    /// instala sin saber que se espera de el.
    #[test]
    fn without_the_environment_variable_there_is_still_a_proposal() {
        assert_eq!(destino_en(None), r"C:\Unfold");
    }

    /// Se redondea hacia arriba porque la cifra se le ensena a quien descarga:
    /// decir 5 MB de algo que ocupa 5,3 seria prometer de menos.
    #[test]
    fn the_size_is_rounded_up() {
        assert_eq!(megas(0), 0);
        assert_eq!(megas(1), 1);
        assert_eq!(megas(1024 * 1024), 1);
        assert_eq!(megas(1024 * 1024 + 1), 2);
        assert_eq!(megas(5 * 1024 * 1024 + 300), 6);
    }

    /// Compilado con el hueco vacio, instalar tiene que negarse: ejecutar un
    /// archivo de cero bytes diria «instalado» sin haber instalado nada.
    #[cfg(sin_instalador)]
    #[test]
    fn without_the_embedded_installer_it_refuses_instead_of_pretending() {
        assert!(escribir_temporal().is_err());
    }
}
