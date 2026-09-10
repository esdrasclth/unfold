//! El catálogo de repositorios conectados.
//!
//! Dice qué repositorios ha conectado esta persona y dónde está su copia:
//!
//! ```text
//! %LOCALAPPDATA%\com.esdras.unfold//! ├── repositories\<id de GitHub>\   checkout completo
//! └── github-repositories.json       catálogo
//! ```
//!
//! No guarda nada sensible y no depende de la sesión: al reiniciar se lee del
//! disco, así que los repositorios conectados siguen ahí aunque no haya red ni
//! token.
//!
//! Sale a su propio archivo porque es lo único de `repositories` que no habla
//! ni con GitHub ni con Git: sólo lee y escribe un JSON. Todo lo demás de allí
//! entra por aquí para saber dónde está cada copia.

use crate::git;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

pub const CATALOG_FILE: &str = "github-repositories.json";
const CATALOG_VERSION: u32 = 1;

/// Serializa las lecturas y escrituras del catálogo.
///
/// No cachea nada a propósito: el archivo tiene unas pocas entradas y volver a
/// leerlo en cada operación sale más barato que razonar sobre una copia en
/// memoria que puede quedarse vieja.
#[derive(Default)]
pub struct Catalog {
    lock: Mutex<()>,
}

/// Lo que se guarda de cada repositorio. Todo público en GitHub o derivable de
/// la ruta local: aquí no entra ni un token.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryEntry {
    pub(super) id: u64,
    pub(super) full_name: String,
    pub(super) default_branch: String,
    pub(super) clone_url: String,
    pub(super) private: bool,
    pub(super) can_push: bool,
    pub(super) path: String,
    /// Segundos desde epoch. Sirve para ordenar la lista por uso reciente.
    pub(super) last_used: u64,
}

/// Una entrada del catálogo más el estado real de su copia en disco.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedRepository {
    #[serde(flatten)]
    pub(super) entry: RepositoryEntry,
    /// Rama del checkout, que puede no ser la predeterminada del repositorio.
    pub(super) branch: Option<String>,
    pub(super) head: Option<String>,
    pub(super) changed: usize,
    /// Commits locales sin publicar y commits del remoto sin traer.
    pub(super) ahead: usize,
    pub(super) behind: usize,
    pub(super) has_upstream: bool,
    /// La carpeta desapareció o dejó de ser un repositorio Git.
    pub(super) missing: bool,
}

impl ConnectedRepository {
    /// Sin estado de checkout la copia local ya no está: se marca en vez de
    /// fallar, para que el explorador pueda decirlo en su sitio.
    pub(super) fn new(entry: RepositoryEntry, state: Option<git::Checkout>) -> Self {
        match state {
            Some(state) => Self {
                entry,
                branch: state.branch,
                head: state.head,
                changed: state.changed,
                ahead: state.ahead,
                behind: state.behind,
                has_upstream: state.has_upstream,
                missing: false,
            },
            None => Self {
                entry,
                branch: None,
                head: None,
                changed: 0,
                ahead: 0,
                behind: 0,
                has_upstream: false,
                missing: true,
            },
        }
    }
}


#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogFile {
    version: u32,
    repositories: Vec<RepositoryEntry>,
}

pub(super) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub(super) fn local_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|error| format!("No se pudo localizar la carpeta de Unfold: {error}"))
}

pub(super) fn catalog_path(root: &Path) -> PathBuf {
    root.join(CATALOG_FILE)
}

/// Lee el catálogo. Un archivo ausente es un catálogo vacío, no un error.
///
/// Si el JSON está roto se aparta en vez de borrarse: perder el catálogo sólo
/// obliga a volver a conectar, pero los checkouts siguen en disco y quien
/// quiera rescatar algo tiene el archivo original a mano.
pub(super) fn read_catalog(root: &Path) -> Result<Vec<RepositoryEntry>, String> {
    let path = catalog_path(root);
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("No se pudo leer el catálogo: {error}")),
    };

    match serde_json::from_str::<CatalogFile>(&raw) {
        Ok(catalog) => Ok(catalog.repositories),
        Err(_) => {
            let apartado = path.with_extension("json.dañado");
            let _ = std::fs::rename(&path, &apartado);
            Err(format!(
                "El catálogo de repositorios estaba dañado. Se guardó una copia en {} y se empezó de cero.",
                apartado.display()
            ))
        }
    }
}

/// Escribe el catálogo entero de una vez.
///
/// Primero a un temporal y luego un renombrado, que en Windows es atómico y
/// sobrescribe: si la aplicación se cierra a medias, en disco queda el catálogo
/// viejo entero y nunca uno cortado por la mitad.
pub(super) fn write_catalog(root: &Path, repositories: &[RepositoryEntry]) -> Result<(), String> {
    std::fs::create_dir_all(root)
        .map_err(|error| format!("No se pudo crear la carpeta de Unfold: {error}"))?;

    let catalog = CatalogFile {
        version: CATALOG_VERSION,
        repositories: repositories.to_vec(),
    };
    let json = serde_json::to_string_pretty(&catalog)
        .map_err(|_| "No se pudo preparar el catálogo".to_owned())?;

    let path = catalog_path(root);
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, json)
        .map_err(|error| format!("No se pudo escribir el catálogo: {error}"))?;
    std::fs::rename(&temporary, &path)
        .map_err(|error| format!("No se pudo guardar el catálogo: {error}"))
}

/// Mira el checkout de una entrada sin fallar si ya no está.
pub(super) fn describe(entry: RepositoryEntry) -> ConnectedRepository {
    let state = git::open(Path::new(&entry.path))
        .ok()
        .and_then(|repository| git::checkout_state(&repository).ok());
    ConnectedRepository::new(entry, state)
}

/// Inserta o actualiza una entrada conservando el orden por nombre.
pub(super) fn upsert(repositories: &mut Vec<RepositoryEntry>, entry: RepositoryEntry) {
    repositories.retain(|existing| existing.id != entry.id);
    repositories.push(entry);
    repositories.sort_by(|left, right| left.full_name.cmp(&right.full_name));
}

/// Toma el candado del catálogo, ignorando el envenenamiento.
///
/// Si un hilo anterior entró en pánico con el candado tomado, el catálogo en
/// disco sigue íntegro —se escribe con renombrado atómico—, así que negarse a
/// continuar sólo dejaría la función de repositorios inservible el resto de la
/// sesión sin proteger nada.
pub(super) fn guard(catalog: &Catalog) -> std::sync::MutexGuard<'_, ()> {
    catalog.lock.lock().unwrap_or_else(|error| error.into_inner())
}

/// Busca una entrada del catálogo. Es el primer paso de casi todo comando, y
/// tenerlo suelto evita repetir el candado y la lectura en cada uno.
pub(super) fn entry_of(app: &AppHandle, catalog: &Catalog, id: u64) -> Result<RepositoryEntry, String> {
    let root = local_root(app)?;
    let _guard = guard(catalog);
    read_catalog(&root)?
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "Ese repositorio ya no está conectado".to_owned())
}

/// Apunta el repositorio como recién usado. Un identificador desconocido no es
/// un error: sólo significa que se desconectó mientras tanto.
pub(super) fn touch(app: &AppHandle, catalog: &Catalog, id: u64) -> Result<(), String> {
    let root = local_root(app)?;
    let _guard = guard(catalog);
    let mut repositories = read_catalog(&root).unwrap_or_default();
    let Some(entry) = repositories.iter_mut().find(|entry| entry.id == id) else {
        return Ok(());
    };
    entry.last_used = now();
    write_catalog(&root, &repositories)
}
