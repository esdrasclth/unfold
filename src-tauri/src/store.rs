//! Documentos de estado guardados en disco.
//!
//! El historial de versiones y la sesión vivían en `localStorage`, y ahí no
//! caben: treinta copias completas de un documento de diez mil líneas son
//! catorce megas contra una cuota de cinco. Al llenarse, escribir falla —y
//! `history.ts` se lo tragaba en silencio, de modo que la aplicación seguía
//! ofreciendo «recuperar versión» sin tener ninguna guardada.
//!
//! Peor todavía: la sesión compartía esa misma cuota con el historial, así que
//! un documento grande podía impedir guardar los borradores sin guardar.
//!
//! En disco no hay cuota, y cada cosa va en su archivo. Se escribe igual que
//! los catálogos: a un temporal y luego renombrar, que en Windows es atómico y
//! sobrescribe, para no dejar nunca un archivo a medias.

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Qué se puede guardar. Es una lista cerrada a propósito: el nombre llega
/// desde el frontend y sin ella sería una ruta que alguien podría torcer.
const CONOCIDOS: [&str; 2] = ["history", "session"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreWrite {
    /// Bytes que ocupa ya en disco, para poder decirlo cuando importe.
    pub bytes: u64,
}

fn ruta(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if !CONOCIDOS.contains(&name) {
        return Err(format!("«{name}» no es un documento de estado conocido"));
    }
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("No se pudo localizar la carpeta de Unfold: {error}"))?
        .join(format!("{name}.json")))
}

#[tauri::command]
pub async fn store_read(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let path = ruta(&app, &name)?;
    match std::fs::read_to_string(&path) {
        Ok(contenido) => Ok(Some(contenido)),
        // Que no exista es el primer arranque, no un error.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("No se pudo leer {name}: {error}")),
    }
}

#[tauri::command]
pub async fn store_write(
    app: AppHandle,
    name: String,
    contents: String,
) -> Result<StoreWrite, String> {
    let path = ruta(&app, &name)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("No se pudo crear la carpeta de Unfold: {error}"))?;
    }

    let temporal = path.with_extension("json.tmp");
    std::fs::write(&temporal, &contents)
        .map_err(|error| format!("No se pudo escribir {name}: {error}"))?;
    std::fs::rename(&temporal, &path)
        .map_err(|error| format!("No se pudo guardar {name}: {error}"))?;

    Ok(StoreWrite {
        bytes: contents.len() as u64,
    })
}

#[tauri::command]
pub async fn store_clear(app: AppHandle, name: String) -> Result<(), String> {
    let path = ruta(&app, &name)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("No se pudo borrar {name}: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El nombre viene del frontend. Sin lista cerrada sería una ruta, y
    /// `../../algo` escribiría fuera de la carpeta de la aplicación.
    #[test]
    fn only_known_documents_are_addressable() {
        for malo in ["../secreto", "..", "history/../..", "cualquiera"] {
            assert!(
                !CONOCIDOS.contains(&malo),
                "«{malo}» no debería estar en la lista"
            );
        }
        assert!(CONOCIDOS.contains(&"history"));
        assert!(CONOCIDOS.contains(&"session"));
    }
}
