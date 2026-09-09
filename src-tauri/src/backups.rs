//! Copias automáticas en la carpeta que elija quien escribe.
//!
//! El historial guarda versiones dentro de la aplicación; esto es lo otro: una
//! copia del documento en una carpeta tuya, para el día que la aplicación no
//! arranque o el disco se lleve por delante el archivo original.
//!
//! Vivía en el frontend y tenía dos agujeros. Escribía un archivo nuevo cada
//! treinta segundos de edición y **no borraba ninguno**, así que la carpeta
//! crecía sin final. Y llevaba aparte un índice en `localStorage` recortado a
//! cincuenta entradas: pasadas ésas, los archivos seguían en el disco pero ya
//! nada sabía que existían —ni para restaurarlos ni para borrarlos.
//!
//! Aquí no hay índice. El nombre del archivo lleva dentro de qué documento es y
//! de cuándo, así que **la carpeta es el índice**: no puede desincronizarse de
//! sí misma, y lo que sobra se puede podar mirando lo que hay.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// Cuántas copias se guardan de cada documento.
///
/// Es una red de seguridad, no un historial —para eso está el historial, con
/// sus treinta versiones—. Lo que se quiere de aquí es «lo de hace un rato», y
/// diez pasos hacia atrás cubren de sobra cualquier tarde de trabajo.
const MAX_POR_DOCUMENTO: usize = 10;

/// Hasta dónde se recorta el nombre del documento dentro del archivo.
///
/// Se conserva el final y no el principio: de `C:\proyectos\...\notas.md` lo
/// que distingue una copia de otra está al final, no en la letra de la unidad.
const MAX_NOMBRE: usize = 80;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupWrite {
    /// Ruta escrita, o nada si el contenido ya estaba copiado tal cual.
    pub path: Option<String>,
    /// Copias viejas borradas en esta pasada, para poder contarlo.
    pub pruned: usize,
}

/// Convierte la clave del documento en algo que Windows acepte como nombre.
fn nombre_seguro(key: &str) -> String {
    let limpio: String = key
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    // Por caracteres y no por bytes: cortar un UTF-8 por la mitad daría un
    // nombre inválido, y las rutas con acentos son de lo más normal.
    let total = limpio.chars().count();
    if total <= MAX_NOMBRE {
        limpio
    } else {
        limpio.chars().skip(total - MAX_NOMBRE).collect()
    }
}

/// Marca de tiempo de una copia de este documento, si el archivo lo es.
///
/// Se lee del nombre y no de la fecha del archivo: copiar la carpeta a otro
/// disco o restaurarla de un respaldo reescribe las fechas, y entonces el
/// orden —que es lo único que hace útil a la más reciente— se perdería.
fn marca_de(nombre: &str, seguro: &str) -> Option<u64> {
    let resto = nombre.strip_prefix(seguro)?.strip_prefix('-')?;
    let digitos = resto.strip_suffix(".md")?;
    if digitos.is_empty() || !digitos.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digitos.parse().ok()
}

/// Las copias de un documento, de la más reciente a la más vieja.
fn copias_de(folder: &Path, seguro: &str) -> Vec<(u64, PathBuf)> {
    let Ok(entradas) = std::fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut encontradas: Vec<(u64, PathBuf)> = entradas
        .flatten()
        .filter_map(|entrada| {
            let ruta = entrada.path();
            let marca = marca_de(ruta.file_name()?.to_str()?, seguro)?;
            Some((marca, ruta))
        })
        .collect();
    encontradas.sort_by(|a, b| b.0.cmp(&a.0));
    encontradas
}

/// Escribe la copia y poda lo que sobre.
///
/// Síncrona y aparte del comando: así se prueba tocando archivos de verdad,
/// sin montar el runtime de Tauri para cada caso.
fn escribir(folder: &str, key: &str, contents: &str) -> Result<BackupWrite, String> {
    let carpeta = PathBuf::from(folder);
    let seguro = nombre_seguro(key);
    std::fs::create_dir_all(&carpeta)
        .map_err(|error| format!("No se pudo crear la carpeta de copias: {error}"))?;

    let copias = copias_de(&carpeta, &seguro);

    // Escribir otra vez lo mismo sólo gasta disco: quien deshace hasta donde
    // estaba no ha cambiado nada, y la copia de antes ya dice eso.
    if let Some((_, ultima)) = copias.first() {
        if std::fs::read_to_string(ultima).is_ok_and(|previo| previo == contents) {
            return Ok(BackupWrite { path: None, pruned: 0 });
        }
    }

    let marca = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "El reloj del sistema va por detrás de 1970".to_owned())?
        .as_millis();
    let destino = carpeta.join(format!("{seguro}-{marca}.md"));
    std::fs::write(&destino, contents)
        .map_err(|error| format!("No se pudo escribir la copia: {error}"))?;

    // Se poda después de escribir y contando la recién hecha, para no dejar
    // nunca el documento con menos copias de las que se prometen.
    let mut pruned = 0;
    for (_, vieja) in copias_de(&carpeta, &seguro).into_iter().skip(MAX_POR_DOCUMENTO) {
        if std::fs::remove_file(&vieja).is_ok() {
            pruned += 1;
        }
    }

    Ok(BackupWrite {
        path: Some(destino.to_string_lossy().into_owned()),
        pruned,
    })
}

/// Devuelve el contenido de la copia más reciente, si la hay.
fn ultima(folder: &str, key: &str) -> Result<Option<String>, String> {
    let seguro = nombre_seguro(key);
    let Some((_, ruta)) = copias_de(Path::new(folder), &seguro).into_iter().next() else {
        return Ok(None);
    };
    std::fs::read_to_string(&ruta)
        .map(Some)
        .map_err(|error| format!("No se pudo leer la copia: {error}"))
}

#[tauri::command]
pub async fn backup_write(
    folder: String,
    key: String,
    contents: String,
) -> Result<BackupWrite, String> {
    tauri::async_runtime::spawn_blocking(move || escribir(&folder, &key, &contents))
        .await
        .map_err(|_| "La copia de seguridad se interrumpió".to_owned())?
}

#[tauri::command]
pub async fn backup_latest(folder: String, key: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || ultima(&folder, &key))
        .await
        .map_err(|_| "La lectura de la copia se interrumpió".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Carpeta temporal propia de cada prueba: aquí se tocan archivos de verdad.
    fn carpeta(nombre: &str) -> PathBuf {
        let ruta = std::env::temp_dir().join(format!("unfold-copias-{nombre}"));
        let _ = std::fs::remove_dir_all(&ruta);
        std::fs::create_dir_all(&ruta).expect("crear la carpeta de prueba");
        ruta
    }

    fn poner(folder: &Path, nombre: &str, contenido: &str) {
        std::fs::write(folder.join(nombre), contenido).expect("escribir");
    }

    /// La clave es una ruta de Windows entera; lo que queda tiene que ser un
    /// nombre de archivo válido y seguir distinguiendo un documento de otro.
    #[test]
    fn the_key_becomes_a_usable_file_name() {
        assert_eq!(nombre_seguro(r"C:\notas\diario.md"), "C__notas_diario.md");
        assert_eq!(nombre_seguro("untitled:Notas"), "untitled_Notas");
        assert_ne!(
            nombre_seguro(r"C:\a\notas.md"),
            nombre_seguro(r"C:\b\notas.md"),
            "dos documentos distintos no pueden compartir copias"
        );
    }

    /// Cortar por bytes partiría un carácter acentuado por la mitad y dejaría
    /// un nombre que el sistema de archivos rechaza.
    #[test]
    fn a_very_long_key_is_cut_without_breaking_characters() {
        let largo = format!("{}/año.md", "ñ".repeat(200));
        let seguro = nombre_seguro(&largo);
        assert_eq!(seguro.chars().count(), MAX_NOMBRE);
        assert!(seguro.ends_with("_año.md"), "se conserva el final: {seguro}");
    }

    /// Sólo son copias los archivos con la forma exacta. Lo demás que haya en
    /// la carpeta —incluidas las copias de otro documento— no se toca.
    #[test]
    fn only_this_documents_backups_are_recognised() {
        assert_eq!(marca_de("notas-17.md", "notas"), Some(17));
        assert_eq!(marca_de("notas-.md", "notas"), None);
        assert_eq!(marca_de("notas-ayer.md", "notas"), None);
        assert_eq!(marca_de("notas.md", "notas"), None);
        assert_eq!(marca_de("otras-17.md", "notas"), None);
        assert_eq!(
            marca_de("notas_viejas-17.md", "notas"),
            None,
            "un documento cuyo nombre empieza igual es otro documento"
        );
    }

    /// El orden sale del nombre y no de la fecha del archivo: copiar la carpeta
    /// a otro disco reescribe las fechas y dejaría «la última» en cualquiera.
    #[test]
    fn the_newest_comes_first_regardless_of_file_dates() {
        let folder = carpeta("orden");
        poner(&folder, "notas-100.md", "vieja");
        poner(&folder, "notas-300.md", "nueva");
        poner(&folder, "notas-200.md", "media");
        let marcas: Vec<u64> = copias_de(&folder, "notas").into_iter().map(|c| c.0).collect();
        assert_eq!(marcas, vec![300, 200, 100]);
    }

    /// Lo que rompía: se escribía una copia nueva cada treinta segundos y no se
    /// borraba ninguna, así que la carpeta crecía sin final.
    #[test]
    fn writing_prunes_the_oldest_and_the_folder_stops_growing() {
        let folder = carpeta("poda");
        for marca in 1..=30u64 {
            poner(&folder, &format!("notas-{marca}.md"), &format!("v{marca}"));
        }

        let informe =
            escribir(&folder.to_string_lossy(), "notas", "lo último").expect("escribir la copia");

        assert!(informe.path.is_some());
        assert_eq!(informe.pruned, 21, "sobraban veintiuna de las treinta y una");
        let quedan = copias_de(&folder, "notas");
        assert_eq!(quedan.len(), MAX_POR_DOCUMENTO);
        assert_eq!(
            std::fs::read_to_string(&quedan[0].1).unwrap(),
            "lo último",
            "la recién escrita nunca se poda"
        );
    }

    /// La poda mira el prefijo, así que tiene que dejar en paz lo que no es
    /// suyo: las copias de los demás documentos y cualquier otro archivo.
    #[test]
    fn pruning_never_touches_other_files() {
        let folder = carpeta("ajenos");
        for marca in 1..=20u64 {
            poner(&folder, &format!("notas-{marca}.md"), "x");
        }
        poner(&folder, "otras-1.md", "de otro documento");
        poner(&folder, "importante.md", "no es una copia");

        escribir(&folder.to_string_lossy(), "notas", "nueva").expect("escribir");

        assert!(folder.join("otras-1.md").exists());
        assert!(folder.join("importante.md").exists());
    }

    /// Guardar sin haber cambiado nada sólo gastaría disco.
    #[test]
    fn identical_content_is_not_copied_again() {
        let folder = carpeta("repetida");
        let ruta = folder.to_string_lossy().into_owned();

        assert!(escribir(&ruta, "notas", "igual").expect("primera").path.is_some());
        assert!(
            escribir(&ruta, "notas", "igual").expect("segunda").path.is_none(),
            "no se escribe una copia idéntica"
        );
        assert_eq!(copias_de(&folder, "notas").len(), 1);
    }

    #[test]
    fn the_latest_backup_is_the_one_restored() {
        let folder = carpeta("restaurar");
        let ruta = folder.to_string_lossy().into_owned();
        poner(&folder, "notas-1.md", "lo viejo");
        poner(&folder, "notas-9.md", "lo nuevo");

        assert_eq!(ultima(&ruta, "notas").expect("leer").as_deref(), Some("lo nuevo"));
        assert_eq!(
            ultima(&ruta, "sin-copias").expect("leer"),
            None,
            "un documento sin copias no es un error"
        );
    }

    /// Restaurar de una carpeta que ya no existe —un USB desconectado— tiene
    /// que decir que no hay copia, no tumbar la aplicación.
    #[test]
    fn a_missing_folder_is_not_a_crash() {
        let inexistente = std::env::temp_dir().join("unfold-copias-no-existe");
        assert_eq!(
            ultima(&inexistente.to_string_lossy(), "notas").expect("leer"),
            None
        );
    }
}
