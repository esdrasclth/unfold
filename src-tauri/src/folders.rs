//! Carpetas locales abiertas en el explorador.
//!
//! El explorador nació atado a GitHub, y quien no lo usa se quedaba sin árbol:
//! abría documento a documento con `Ctrl+O`. Una carpeta es la misma idea sin
//! Git —una raíz con documentos Markdown dentro— y por eso comparte forma con
//! los repositorios, para pintarse en el mismo panel sin duplicar el árbol.
//!
//! Los identificadores son **negativos** a propósito. Los de GitHub son
//! positivos, así que con mirar el signo se sabe a qué comando va cada raíz sin
//! arrastrar una tabla de correspondencias por media aplicación.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const FOLDERS_FILE: &str = "folders.json";

/// Hasta dónde baja el recorrido y cuántos documentos se traen.
///
/// Una carpeta la elige una persona, no un catálogo, y puede apuntar sin querer
/// a la raíz del disco. Los topes existen para que ese despiste no deje la
/// ventana congelada leyendo medio sistema de archivos.
const MAX_DEPTH: usize = 8;
const MAX_DOCUMENTS: usize = 4_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: i64,
    pub path: String,
    /// El último tramo de la ruta, que es como se nombra en el panel.
    pub name: String,
    /// La carpeta ya no está donde se abrió.
    pub missing: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderDocument {
    pub path: String,
    pub relative: String,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FoldersFile {
    folders: Vec<String>,
}

fn catalog_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("No se pudo localizar la carpeta de Unfold: {error}"))?
        .join(FOLDERS_FILE))
}

fn read_paths(app: &AppHandle) -> Result<Vec<String>, String> {
    let path = catalog_path(app)?;
    match std::fs::read_to_string(&path) {
        Ok(raw) => Ok(serde_json::from_str::<FoldersFile>(&raw)
            .map(|file| file.folders)
            // Un catálogo ilegible no puede impedir abrir la aplicación: son
            // rutas, se vuelven a añadir en dos clics.
            .unwrap_or_default()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("No se pudieron leer las carpetas: {error}")),
    }
}

fn write_paths(app: &AppHandle, folders: &[String]) -> Result<(), String> {
    let path = catalog_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("No se pudo crear la carpeta de Unfold: {error}"))?;
    }
    let json = serde_json::to_string_pretty(&FoldersFile {
        folders: folders.to_vec(),
    })
    .map_err(|_| "No se pudo preparar la lista de carpetas".to_owned())?;

    // Igual que el catálogo de repositorios: temporal y renombrado, que en
    // Windows es atómico, para no dejar nunca un archivo a medias.
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, json)
        .map_err(|error| format!("No se pudieron guardar las carpetas: {error}"))?;
    std::fs::rename(&temporary, &path)
        .map_err(|error| format!("No se pudieron guardar las carpetas: {error}"))
}

/// Identificador estable y negativo a partir de la ruta.
///
/// Estable porque el panel recuerda qué raíces están plegadas de una sesión a
/// otra; si el número cambiara al reiniciar, todas se abrirían de nuevo.
fn id_of(path: &str) -> i64 {
    // FNV-1a de 64 bits: cabe en cuatro líneas y reparte bien para lo que hace
    // falta aquí, que es no chocar entre un puñado de rutas.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.to_lowercase().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    // El signo es la marca: negativo es carpeta, positivo es repositorio.
    -((hash & 0x7fff_ffff_ffff_ffff) as i64).max(1)
}

fn name_of(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_owned())
}

fn describe(path: String) -> Folder {
    let missing = !Path::new(&path).is_dir();
    Folder {
        id: id_of(&path),
        name: name_of(&path),
        path,
        missing,
    }
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("md") || value.eq_ignore_ascii_case("markdown"))
}

/// Recorre la carpeta buscando Markdown, sin seguir enlaces ni entrar en las
/// carpetas ocultas —`.git`, `.obsidian` y compañía— que sólo traen ruido.
fn walk(root: &Path) -> Vec<FolderDocument> {
    let mut documents = Vec::new();
    let mut pending = vec![(root.to_path_buf(), 0usize)];

    while let Some((directory, depth)) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            if documents.len() >= MAX_DOCUMENTS {
                return documents;
            }
            let path = entry.path();
            // `symlink_metadata` y no `metadata`: un enlace que apunte a un
            // ancestro convertiría el recorrido en un bucle infinito.
            let Ok(info) = path.symlink_metadata() else {
                continue;
            };
            if info.is_symlink() {
                continue;
            }
            let nombre = entry.file_name();
            let nombre = nombre.to_string_lossy();
            if nombre.starts_with('.') || nombre == "node_modules" {
                continue;
            }

            if info.is_dir() {
                if depth < MAX_DEPTH {
                    pending.push((path, depth + 1));
                }
            } else if is_markdown(&path) {
                let Ok(relative) = path.strip_prefix(root) else {
                    continue;
                };
                documents.push(FolderDocument {
                    path: path.to_string_lossy().into_owned(),
                    relative: relative.to_string_lossy().replace('\\', "/"),
                });
            }
        }
    }

    documents.sort_by(|left, right| left.relative.cmp(&right.relative));
    documents
}

#[tauri::command]
pub async fn open_folder(app: AppHandle, path: String) -> Result<Folder, String> {
    let raiz = Path::new(&path);
    if !raiz.is_dir() {
        return Err("Eso no es una carpeta".to_owned());
    }
    // Se guarda la ruta canónica para que la misma carpeta abierta por dos
    // caminos distintos no aparezca dos veces en el panel.
    let canonica = raiz
        .canonicalize()
        .map_err(|error| format!("No se pudo comprobar la carpeta: {error}"))?
        .to_string_lossy()
        .into_owned();

    let mut folders = read_paths(&app)?;
    if !folders.iter().any(|existente| existente == &canonica) {
        folders.push(canonica.clone());
        folders.sort_by_key(|value| name_of(value).to_lowercase());
        write_paths(&app, &folders)?;
    }
    Ok(describe(canonica))
}

#[tauri::command]
pub async fn close_folder(app: AppHandle, id: i64) -> Result<(), String> {
    let mut folders = read_paths(&app)?;
    folders.retain(|path| id_of(path) != id);
    write_paths(&app, &folders)
}

#[tauri::command]
pub async fn open_folders(app: AppHandle) -> Result<Vec<Folder>, String> {
    Ok(read_paths(&app)?.into_iter().map(describe).collect())
}

#[tauri::command]
pub async fn folder_documents(app: AppHandle, id: i64) -> Result<Vec<FolderDocument>, String> {
    let Some(path) = read_paths(&app)?.into_iter().find(|path| id_of(path) == id) else {
        return Err("Esa carpeta ya no está en la lista".to_owned());
    };
    let raiz = PathBuf::from(&path);
    if !raiz.is_dir() {
        return Err(format!("La carpeta «{}» ya no está en el disco", name_of(&path)));
    }
    tauri::async_runtime::spawn_blocking(move || walk(&raiz))
        .await
        .map_err(|_| "El recorrido de la carpeta se interrumpió".to_owned())
}

/// Crea un documento dentro de la carpeta.
///
/// Reutiliza la validación de los repositorios, que no es de GitHub: comprueba
/// que el destino cae físicamente dentro de la raíz, resolviendo enlaces, y no
/// puede vaciar un archivo que ya exista.
#[tauri::command]
pub async fn folder_create_document(
    app: AppHandle,
    id: i64,
    target: String,
) -> Result<crate::repositories::CreatedDocument, String> {
    let Some(path) = read_paths(&app)?.into_iter().find(|path| id_of(path) == id) else {
        return Err("Esa carpeta ya no está en la lista".to_owned());
    };
    tauri::async_runtime::spawn_blocking(move || {
        crate::repositories::create_repository_document(Path::new(&path), Path::new(&target))
    })
    .await
    .map_err(|_| "La creación del documento se interrumpió".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_ids_are_negative_and_stable() {
        let uno = id_of(r"C:\notas");
        assert!(uno < 0, "el signo distingue carpeta de repositorio");
        assert_eq!(uno, id_of(r"C:\notas"), "el mismo camino da el mismo número");
        // En Windows la caja no distingue rutas, y el panel recuerda por id qué
        // raíces están plegadas: dos números para la misma carpeta las abriría
        // todas al reiniciar.
        assert_eq!(uno, id_of(r"c:\NOTAS"));
        assert_ne!(uno, id_of(r"C:\notas-viejas"));
    }

    #[test]
    fn the_walk_finds_markdown_and_skips_what_only_adds_noise() {
        let temp = tempfile::tempdir().unwrap();
        let raiz = temp.path();
        std::fs::create_dir_all(raiz.join("docs")).unwrap();
        std::fs::create_dir_all(raiz.join(".git")).unwrap();
        std::fs::create_dir_all(raiz.join("node_modules")).unwrap();

        std::fs::write(raiz.join("guia.md"), "# Guía").unwrap();
        std::fs::write(raiz.join("docs/nota.markdown"), "# Nota").unwrap();
        std::fs::write(raiz.join("datos.txt"), "no es markdown").unwrap();
        std::fs::write(raiz.join(".git/config.md"), "oculto").unwrap();
        std::fs::write(raiz.join("node_modules/leeme.md"), "dependencia").unwrap();

        let encontrados = walk(raiz);
        let rutas: Vec<_> = encontrados.iter().map(|d| d.relative.as_str()).collect();
        assert_eq!(rutas, vec!["docs/nota.markdown", "guia.md"]);
    }

    /// Una carpeta la elige una persona y puede apuntar a cualquier sitio. El
    /// tope de profundidad es lo que impide que un despiste deje la ventana
    /// congelada leyendo medio disco.
    #[test]
    fn the_walk_stops_at_the_depth_limit() {
        let temp = tempfile::tempdir().unwrap();
        let mut hondo = temp.path().to_path_buf();
        for nivel in 0..(MAX_DEPTH + 3) {
            hondo = hondo.join(format!("n{nivel}"));
        }
        std::fs::create_dir_all(&hondo).unwrap();
        std::fs::write(hondo.join("perdida.md"), "# Muy abajo").unwrap();
        std::fs::write(temp.path().join("cerca.md"), "# Arriba").unwrap();

        let encontrados = walk(temp.path());
        let rutas: Vec<_> = encontrados.iter().map(|d| d.relative.as_str()).collect();
        assert_eq!(rutas, vec!["cerca.md"]);
    }
}
