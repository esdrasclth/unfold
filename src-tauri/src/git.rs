//! Motor Git.
//!
//! Empezó como la sonda de la fase 0, que sólo tenía que demostrar que
//! libgit2 podía clonar y publicar sin inflar el instalador. La fase 2 lo
//! convirtió en el motor real: aquí no hay comandos de Tauri, sólo las
//! operaciones sobre un repositorio. Quien las expone es `repositories`.

use git2::{
    build::{CheckoutBuilder, RepoBuilder},
    Cred, DiffFormat, DiffLineType, DiffOptions, FetchOptions, IndexEntry, ObjectType,
    PushOptions, RemoteCallbacks, Repository, Signature, StatusOptions,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Extensiones que Unfold considera documentos del repositorio.
///
/// Se queda en las dos de Markdown y deja fuera `.txt`, que sí acepta el
/// diálogo de abrir: en un repositorio cualquiera `.txt` son licencias,
/// requisitos y datos de prueba, y llenarían la lista de ruido.
const MARKDOWN_EXTENSIONS: [&str; 2] = ["md", "markdown"];
const DIFF_PREVIEW_MAX_BYTES: usize = 256 * 1024;
const DIFF_PREVIEW_MAX_LINES: usize = 2_000;
const DIFF_EXPANDED_MAX_BYTES: usize = 2 * 1024 * 1024;
const DIFF_EXPANDED_MAX_LINES: usize = 20_000;

/// Qué pasó al traer los cambios del remoto.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Advance {
    /// No había nada nuevo.
    UpToDate,
    /// El checkout se adelantó hasta el remoto.
    FastForwarded,
    /// Hay cambios locales sin confirmar; no se toca el árbol de trabajo.
    Dirty,
    /// Hay commits locales que el remoto no tiene: esto ya no es un avance.
    Diverged,
    /// El remoto no publica esa rama.
    NoUpstream,
}

/// Cómo está un documento respecto a lo que Git tiene guardado.
///
/// Es lo que pinta el indicador del explorador, así que se queda en los cuatro
/// casos que alguien que escribe necesita distinguir. Los estados finos de Git
/// —renombrado, cambio de tipo, borrado en el índice— caen todos en
/// `Modified`: dicen lo mismo desde el punto de vista del documento, que es
/// que hay algo que todavía no está confirmado.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DocumentState {
    /// Igual que en el último commit.
    Synced,
    /// Confirmado alguna vez, con cambios encima.
    Modified,
    /// Todavía no está en Git.
    New,
    /// Con marcas de conflicto de una fusión sin resolver.
    Conflicted,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    /// Ruta absoluta, que es lo que necesita el editor para abrirla.
    pub path: String,
    /// Ruta dentro del repositorio, con `/`, que es lo que se enseña.
    pub relative: String,
    /// Falso mientras el archivo no esté en el índice.
    pub tracked: bool,
    pub state: DocumentState,
}

impl DocumentState {
    fn of(status: git2::Status) -> Self {
        if status.is_conflicted() {
            return Self::Conflicted;
        }
        if status.is_wt_new() || status.is_index_new() {
            return Self::New;
        }
        // `is_empty` no vale: quedan banderas que no son ninguna de las
        // anteriores y que aun así significan «hay algo sin confirmar».
        if status.intersects(
            git2::Status::WT_MODIFIED
                | git2::Status::WT_DELETED
                | git2::Status::WT_RENAMED
                | git2::Status::WT_TYPECHANGE
                | git2::Status::INDEX_MODIFIED
                | git2::Status::INDEX_DELETED
                | git2::Status::INDEX_RENAMED
                | git2::Status::INDEX_TYPECHANGE,
        ) {
            return Self::Modified;
        }
        Self::Synced
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkout {
    pub branch: Option<String>,
    pub head: Option<String>,
    /// Archivos modificados o sin seguir, ignorados aparte.
    pub changed: usize,
    /// Commits locales que el remoto no tiene.
    pub ahead: usize,
    /// Commits del remoto que el checkout no tiene.
    pub behind: usize,
    /// Falso mientras no se sepa nada del remoto: sin él, «sincronizado» no
    /// significaría nada y el explorador no debe afirmarlo.
    pub has_upstream: bool,
}

/// Credenciales para hablar con el remoto.
///
/// El tiempo de vida queda libre a propósito: `clone` necesita añadirle un
/// callback de progreso que toma prestado un contador de la pila, y con
/// `'static` el préstamo no compilaría. La clausura de credenciales es dueña
/// de su `Config`, así que vale para cualquier tiempo de vida.
fn callbacks<'a>() -> Result<RemoteCallbacks<'a>, git2::Error> {
    let config = git2::Config::open_default()?;
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |url, username, _allowed| {
        // Respeta Git Credential Manager y otros helpers ya configurados. El
        // token nunca se inserta en la URL ni se persiste en .git/config.
        Cred::credential_helper(&config, url, username)
    });
    Ok(callbacks)
}

pub fn open(path: &Path) -> Result<Repository, git2::Error> {
    Repository::open(path)
}

/// URL del remoto `origin`, para reconocer una carpeta que ya estaba clonada.
pub fn origin_url(repository: &Repository) -> Option<String> {
    repository
        .find_remote("origin")
        .ok()
        .and_then(|remote| remote.url().ok().map(str::to_owned))
}

fn status_options(include_untracked: bool) -> StatusOptions {
    let mut options = StatusOptions::new();
    options.include_untracked(include_untracked);
    options.include_ignored(false);
    options.recurse_untracked_dirs(include_untracked);
    options
}

/// Cuenta lo que separa el árbol de trabajo del último commit.
///
/// Los archivos sin seguir cuentan: para quien escribe, un documento nuevo que
/// todavía no está en Git es exactamente lo que le falta por publicar.
pub fn changed_files(repository: &Repository) -> Result<usize, git2::Error> {
    let statuses = repository.statuses(Some(&mut status_options(true)))?;
    Ok(statuses.len())
}

/// Cambios que impiden mover el árbol de trabajo por debajo.
///
/// Aquí los archivos sin seguir no cuentan: no chocan con un avance rápido, y
/// bloquearlo por un borrador suelto haría que traer cambios fallara casi
/// siempre. Si alguno chocara de verdad, el checkout seguro lo dirá.
fn has_local_modifications(repository: &Repository) -> Result<bool, git2::Error> {
    let statuses = repository.statuses(Some(&mut status_options(false)))?;
    Ok(!statuses.is_empty())
}

pub fn checkout_state(repository: &Repository) -> Result<Checkout, git2::Error> {
    let head = repository.head().ok();
    let branch = head
        .as_ref()
        .and_then(|reference| reference.shorthand().ok())
        .map(str::to_owned);
    let local = head.as_ref().and_then(|reference| reference.target());

    // La comparación con el remoto es la que sostiene el indicador de
    // sincronizado. Si falta cualquiera de los dos lados no se inventa un
    // cero: se dice que no hay remoto conocido.
    let upstream = branch.as_deref().and_then(|branch| {
        repository
            .find_reference(&format!("refs/remotes/origin/{branch}"))
            .ok()
            .and_then(|reference| reference.target())
    });
    let (ahead, behind) = match (local, upstream) {
        (Some(local), Some(upstream)) => repository.graph_ahead_behind(local, upstream)?,
        _ => (0, 0),
    };

    Ok(Checkout {
        branch,
        head: local.map(|oid| oid.to_string()),
        changed: changed_files(repository)?,
        ahead,
        behind,
        has_upstream: upstream.is_some(),
    })
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            MARKDOWN_EXTENSIONS
                .iter()
                .any(|known| extension.eq_ignore_ascii_case(known))
        })
}

/// Enumera los documentos Markdown del árbol de trabajo.
///
/// Se recorre el disco y no el índice, como hacía la sonda de la fase 0: quien
/// acaba de escribir un documento espera verlo en la lista aunque todavía no
/// lo haya añadido a Git. Lo que el índice aporta es la marca `tracked`.
///
/// Se salta `.git` y todo lo que el repositorio ignore, que es lo que evita
/// recorrer `node_modules` y compañía.
pub fn documents(repository: &Repository) -> Result<Vec<Document>, git2::Error> {
    let Some(workdir) = repository.workdir() else {
        return Ok(Vec::new());
    };
    let index = repository.index()?;

    // El estado de todos los archivos se calcula una sola vez. Preguntarlo
    // archivo por archivo con `status_file` obliga a Git a recorrer el árbol
    // en cada llamada, y en un repositorio con cientos de documentos eso se
    // nota al abrir el panel.
    let mut states = std::collections::HashMap::new();
    for entry in repository
        .statuses(Some(&mut status_options(true)))?
        .iter()
    {
        if let Ok(path) = entry.path() {
            states.insert(path.to_owned(), entry.status());
        }
    }

    let mut documents = Vec::new();
    let mut pending = vec![workdir.to_path_buf()];

    while let Some(directory) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(relative) = path.strip_prefix(workdir) else {
                continue;
            };
            let relative = relative.to_string_lossy().replace('\\', "/");
            if relative == ".git" {
                continue;
            }
            // `symlink_metadata` y no `metadata`: un enlace a un directorio
            // padre convertiría el recorrido en un bucle infinito.
            let Ok(info) = entry.path().symlink_metadata() else {
                continue;
            };
            if info.is_symlink() {
                continue;
            }
            if repository.status_should_ignore(Path::new(&relative))? {
                continue;
            }

            if info.is_dir() {
                pending.push(path);
            } else if is_markdown(&path) {
                // Sin entrada en el estado, el archivo coincide con el último
                // commit: Git sólo informa de lo que se aparta.
                let state = states
                    .get(&relative)
                    .map_or(DocumentState::Synced, |status| DocumentState::of(*status));
                documents.push(Document {
                    path: path.to_string_lossy().into_owned(),
                    tracked: index.get_path(Path::new(&relative), 0).is_some(),
                    relative,
                    state,
                });
            }
        }
    }

    documents.sort_by(|left, right| left.relative.cmp(&right.relative));
    Ok(documents)
}

/// Un archivo que se aparta de lo que hay en el último commit.
///
/// A diferencia de `Document`, aquí entra cualquier extensión. Una vista de
/// cambios que escondiera parte de lo pendiente sería peligrosa: quien va a
/// confirmar tiene que ver todo lo que hay, aunque Unfold sólo edite Markdown.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub relative: String,
    pub state: DocumentState,
    /// El archivo ya no está en el árbol de trabajo.
    pub deleted: bool,
    /// Ya estaba en el índice antes de abrir la vista.
    pub staged: bool,
    /// Identifica el HEAD y el contenido exacto que se enseñó al abrir el diálogo.
    pub fingerprint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub relative: String,
    pub patch: String,
    pub binary: bool,
    pub truncated: bool,
    pub additions: usize,
    pub deletions: usize,
    pub shown_lines: usize,
    pub total_lines: usize,
    /// Se actualiza al cargar el diff para que publicar valide esta revisión.
    pub fingerprint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewedPath {
    pub relative: String,
    pub fingerprint: String,
}

fn safe_relative(relative: &str) -> Result<&Path, git2::Error> {
    let path = Path::new(relative);
    if relative.is_empty()
        || path.is_absolute()
        || path.components().any(|part| {
            matches!(
                part,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(git2::Error::from_str(
            "La ruta del cambio no pertenece al repositorio",
        ));
    }
    Ok(path)
}

fn fingerprint(repository: &Repository, relative: &str) -> Result<String, git2::Error> {
    let relative = safe_relative(relative)?;
    let head = repository
        .head()
        .ok()
        .and_then(|head| head.target())
        .map_or_else(|| "unborn".to_owned(), |oid| oid.to_string());
    let workdir = repository
        .workdir()
        .ok_or_else(|| git2::Error::from_str("El repositorio no tiene árbol de trabajo"))?;
    let path = workdir.join(relative);
    match std::fs::read(&path) {
        Ok(content) => Ok(format!(
            "{head}:blob:{}",
            git2::Oid::hash_object(ObjectType::Blob, &content)?
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(format!("{head}:deleted"))
        }
        Err(error) => Err(git2::Error::from_str(&format!(
            "No se pudo leer {}: {error}",
            relative.display()
        ))),
    }
}

/// Todo lo que separa el árbol de trabajo del último commit.
pub fn changes(repository: &Repository) -> Result<Vec<Change>, git2::Error> {
    let statuses = repository.statuses(Some(&mut status_options(true)))?;
    let mut changes = Vec::new();
    for entry in statuses.iter() {
        let Some(relative) = entry.path().ok() else {
            continue;
        };
        let status = entry.status();
        changes.push(Change {
            relative: relative.to_owned(),
            state: DocumentState::of(status),
            deleted: status.is_wt_deleted() || status.is_index_deleted(),
            staged: status.intersects(
                git2::Status::INDEX_NEW
                    | git2::Status::INDEX_MODIFIED
                    | git2::Status::INDEX_DELETED
                    | git2::Status::INDEX_RENAMED
                    | git2::Status::INDEX_TYPECHANGE,
            ),
            fingerprint: fingerprint(repository, relative)?,
        });
    }
    changes.sort_by(|left, right| left.relative.cmp(&right.relative));
    Ok(changes)
}

/// Diff combinado (índice + árbol de trabajo) de un único archivo.
///
/// Se calcula bajo demanda: abrir la vista de cambios sigue siendo barato y
/// sólo se paga por el archivo que alguien decide inspeccionar.
pub fn file_diff(
    repository: &Repository,
    relative: &str,
    expanded: bool,
) -> Result<FileDiff, git2::Error> {
    safe_relative(relative)?;
    let reviewed = fingerprint(repository, relative)?;
    let (max_bytes, max_lines) = if expanded {
        (DIFF_EXPANDED_MAX_BYTES, DIFF_EXPANDED_MAX_LINES)
    } else {
        (DIFF_PREVIEW_MAX_BYTES, DIFF_PREVIEW_MAX_LINES)
    };

    let head_tree = repository
        .head()
        .ok()
        .and_then(|head| head.peel_to_tree().ok());
    let mut options = DiffOptions::new();
    options
        .pathspec(relative)
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true);
    let diff = repository.diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut options))?;

    let mut bytes = Vec::new();
    let mut truncated = false;
    let mut additions = 0;
    let mut deletions = 0;
    let mut shown_lines = 0;
    let mut total_lines = 0;
    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        total_lines += 1;
        if line.origin_value() == DiffLineType::Addition {
            additions += 1;
        } else if line.origin_value() == DiffLineType::Deletion {
            deletions += 1;
        }
        let prefixed = matches!(
            line.origin_value(),
            DiffLineType::Context | DiffLineType::Addition | DiffLineType::Deletion
        );
        let next_bytes = line.content().len() + usize::from(prefixed);
        if shown_lines >= max_lines || bytes.len().saturating_add(next_bytes) > max_bytes {
            truncated = true;
            return true;
        }
        if matches!(
            line.origin_value(),
            DiffLineType::Context | DiffLineType::Addition | DiffLineType::Deletion
        ) {
            bytes.push(line.origin() as u8);
        }
        bytes.extend_from_slice(line.content());
        shown_lines += 1;
        true
    })?;
    let patch = String::from_utf8_lossy(&bytes).into_owned();
    let binary = diff.deltas().any(|delta| {
        delta.flags().is_binary()
            || delta.old_file().is_binary()
            || delta.new_file().is_binary()
    });
    if fingerprint(repository, relative)? != reviewed {
        return Err(git2::Error::from_str(
            "El archivo cambió mientras se preparaba el diff; vuelve a abrirlo",
        ));
    }
    Ok(FileDiff {
        relative: relative.to_owned(),
        patch,
        binary,
        truncated,
        additions,
        deletions,
        shown_lines,
        total_lines,
        fingerprint: reviewed,
    })
}

/// Confirma exactamente los archivos indicados.
///
/// El árbol del commit parte de `HEAD`, mientras que el índice final parte del
/// índice original. Así nada preparado desde otra herramienta se cuela en el
/// commit ni pierde su estado `staged`.
pub fn commit(
    repository: &Repository,
    paths: &[ReviewedPath],
    message: &str,
    author: &Signature<'_>,
) -> Result<git2::Oid, git2::Error> {
    let head = repository.head().ok().and_then(|head| head.peel_to_commit().ok());

    for path in paths {
        let actual = fingerprint(repository, &path.relative)?;
        if actual != path.fingerprint {
            return Err(git2::Error::from_str(&format!(
                "{} cambió después de abrir la revisión; vuelve a revisar el diff antes de publicar",
                path.relative
            )));
        }
    }

    let mut index = repository.index()?;
    let original_tree_id = index.write_tree()?;
    let original_tree = repository.find_tree(original_tree_id)?;

    type PreparedIndex = (git2::Oid, Vec<(PathBuf, Option<IndexEntry>)>);
    let prepared = (|| -> Result<PreparedIndex, git2::Error> {
        if let Some(parent) = &head {
            index.read_tree(&parent.tree()?)?;
        } else {
            index.clear()?;
        }

        for path in paths {
            let relative = safe_relative(&path.relative)?;
            // Un archivo borrado no se puede añadir desde el disco: lo que hay que
            // registrar es su ausencia.
            if repository.workdir().is_some_and(|dir| dir.join(relative).exists()) {
                index.add_path(relative)?;
            } else {
                index.remove_path(relative)?;
            }

            // `add_path` es el punto que leyó realmente el archivo. Comparar otra
            // vez cierra la ventana entre validar y preparar el contenido.
            let staged = index.get_path(relative, 0).map(|entry| entry.id);
            let expected = path
                .fingerprint
                .rsplit_once(":blob:")
                .and_then(|(_, oid)| git2::Oid::from_str(oid).ok());
            if staged != expected {
                return Err(git2::Error::from_str(&format!(
                    "{} cambió mientras se preparaba el commit; vuelve a revisarlo",
                    path.relative
                )));
            }
        }

        let commit_tree_id = index.write_tree()?;
        let selected_entries = paths
            .iter()
            .map(|path| {
                let relative = Path::new(&path.relative);
                (relative.to_path_buf(), index.get_path(relative, 0))
            })
            .collect::<Vec<_>>();
        Ok((commit_tree_id, selected_entries))
    })();

    // También se restaura si preparar falla a mitad: un error de disco no debe
    // desmarcar trabajo que otra herramienta dejó en el índice.
    let (commit_tree_id, selected_entries) = match prepared {
        Ok(prepared) => prepared,
        Err(error) => {
            index.read_tree(&original_tree)?;
            index.write()?;
            return Err(error);
        }
    };

    // Vuelve al índice previo y actualiza únicamente lo confirmado. Los demás
    // entries conservan exactamente su blob y su estado de preparación.
    index.read_tree(&original_tree)?;
    for (relative, entry) in &selected_entries {
        if let Some(entry) = entry {
            index.add(entry)?;
        } else {
            index.remove_path(relative)?;
        }
    }
    index.write()?;

    let current_head = repository
        .head()
        .ok()
        .and_then(|head| head.target());
    if current_head != head.as_ref().map(|commit| commit.id()) {
        index.read_tree(&original_tree)?;
        index.write()?;
        return Err(git2::Error::from_str(
            "La rama cambió mientras se preparaba el commit; vuelve a revisar los cambios",
        ));
    }

    let tree = repository.find_tree(commit_tree_id)?;
    let parents = head.iter().collect::<Vec<_>>();
    match repository.commit(Some("HEAD"), author, author, message, &tree, &parents) {
        Ok(oid) => Ok(oid),
        Err(error) => {
            index.read_tree(&original_tree)?;
            index.write()?;
            Err(error)
        }
    }
}

/// Clona informando del avance. `progress` recibe objetos recibidos y totales.
pub fn clone(
    remote_url: &str,
    destination: &Path,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<Repository, git2::Error> {
    let mut callbacks = callbacks()?;
    callbacks.transfer_progress(|stats| {
        progress(stats.received_objects(), stats.total_objects());
        true
    });

    let mut fetch = FetchOptions::new();
    fetch.remote_callbacks(callbacks);
    let mut builder = RepoBuilder::new();
    builder.fetch_options(fetch);
    builder.clone(remote_url, destination)
}

/// Trae `branch` desde `origin` y adelanta el checkout si puede hacerlo sin
/// inventarse nada. Fusionar de verdad no entra aquí: mientras Unfold no sepa
/// publicar, un árbol divergente se deja intacto y se cuenta lo que pasa.
pub fn fetch(repository: &Repository, branch: &str) -> Result<Advance, git2::Error> {
    let mut remote = repository.find_remote("origin")?;
    let mut options = FetchOptions::new();
    options.remote_callbacks(callbacks()?);
    let refspec = format!("+refs/heads/{branch}:refs/remotes/origin/{branch}");
    remote.fetch(&[refspec.as_str()], Some(&mut options), None)?;

    let remote_ref = format!("refs/remotes/origin/{branch}");
    let Ok(reference) = repository.find_reference(&remote_ref) else {
        return Ok(Advance::NoUpstream);
    };
    let fetched = repository.reference_to_annotated_commit(&reference)?;
    let (analysis, _) = repository.merge_analysis(&[&fetched])?;

    if analysis.is_up_to_date() {
        return Ok(Advance::UpToDate);
    }
    if !analysis.is_fast_forward() {
        return Ok(Advance::Diverged);
    }
    if has_local_modifications(repository)? {
        return Ok(Advance::Dirty);
    }

    // El orden importa. El checkout va primero, con HEAD todavía en el commit
    // viejo: así libgit2 compara el índice actual contra el árbol que llega,
    // actualiza los dos y detecta lo que chocaría. Moviendo la rama antes, el
    // índice queda como una base obsoleta, un checkout seguro se niega a
    // tocarlo y el repositorio se queda para siempre con archivos que parecen
    // borrados del índice.
    //
    // Y seguro, no forzado: el árbol ya se comprobó limpio, pero un archivo
    // sin seguir puede llamarse igual que uno que llega, y eso merece un error
    // y no que se lo lleve por delante.
    let target = repository.find_object(fetched.id(), None)?;
    repository.checkout_tree(&target, Some(CheckoutBuilder::default().safe()))?;

    let local_ref = format!("refs/heads/{branch}");
    repository
        .find_reference(&local_ref)?
        .set_target(fetched.id(), "unfold: avance rápido desde origin")?;
    repository.set_head(&local_ref)?;
    Ok(Advance::FastForwarded)
}

/// Publica por un refspec explícito. Todavía no la usa la interfaz; se mantiene
/// porque es la mitad que valida la fase 0 y la base de la fase 3.
/// Publica por un refspec explícito.
///
/// Devuelve `String` y no el error de libgit2 porque el motivo del rechazo casi
/// nunca está ahí: un push puede terminar «bien» a ojos del transporte y aun
/// así ser rechazado por el servidor, que manda su explicación en el estado de
/// cada referencia. Eso es lo que trae, por ejemplo, el `GH007` de GitHub
/// cuando el correo del autor es privado.
pub fn push(repository: &Repository, refspec: &str) -> Result<(), String> {
    let mut remote = repository
        .find_remote("origin")
        .map_err(|error| error.message().to_owned())?;

    let rejected = std::cell::RefCell::new(Vec::<String>::new());
    {
        // El bloque acota el préstamo: los callbacks retienen `rejected` y hay
        // que soltarlos antes de poder sacar lo que hayan escrito.
        let mut callbacks = callbacks().map_err(|error| error.message().to_owned())?;
        callbacks.push_update_reference(|reference, status| {
            if let Some(status) = status {
                rejected.borrow_mut().push(format!("{reference}: {status}"));
            }
            Ok(())
        });
        let mut options = PushOptions::new();
        options.remote_callbacks(callbacks);
        remote
            .push(&[refspec], Some(&mut options))
            .map_err(|error| error.message().to_owned())?;
    }

    let rejected = rejected.into_inner();
    if rejected.is_empty() {
        Ok(())
    } else {
        Err(rejected.join("; "))
    }
}

pub fn libgit2_version() -> String {
    let version = git2::Version::get().libgit2_version();
    format!("{}.{}.{}", version.0, version.1, version.2)
}

/// Carpeta de un repositorio conectado dentro del almacén de Unfold.
pub fn checkout_path(root: &Path, id: u64) -> PathBuf {
    root.join("repositories").join(id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{IndexAddOption, Signature};
    use std::fs;

    fn commit_all(repository: &Repository, message: &str) {
        let mut index = repository.index().unwrap();
        index.add_all(["*"], IndexAddOption::DEFAULT, None).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = repository.find_tree(tree_oid).unwrap();
        let signature = Signature::now("Unfold", "unfold@local").unwrap();
        let parents = repository
            .head()
            .ok()
            .and_then(|head| head.target())
            .and_then(|oid| repository.find_commit(oid).ok())
            .into_iter()
            .collect::<Vec<_>>();
        let parent_refs = parents.iter().collect::<Vec<_>>();
        repository
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                message,
                &tree,
                &parent_refs,
            )
            .unwrap();
    }

    /// Monta un remoto bare con un commit inicial y devuelve su ruta.
    fn remote_with_initial_commit(root: &Path) -> PathBuf {
        let source_path = root.join("source");
        let remote_path = root.join("remote.git");

        let source = Repository::init(&source_path).unwrap();
        fs::create_dir(source_path.join("docs")).unwrap();
        fs::write(source_path.join("README.md"), "# Uno\n").unwrap();
        fs::write(source_path.join("docs/guia.markdown"), "# Guía\n").unwrap();
        fs::write(source_path.join("notas.txt"), "no es markdown\n").unwrap();
        fs::write(source_path.join(".gitignore"), "borradores/\n").unwrap();
        commit_all(&source, "initial");

        let remote = Repository::init_bare(&remote_path).unwrap();
        source
            .remote("origin", remote_path.to_str().unwrap())
            .unwrap()
            .push(&["HEAD:refs/heads/main"], None)
            .unwrap();
        remote.set_head("refs/heads/main").unwrap();
        remote_path
    }

    /// Clona el remoto de prueba.
    ///
    /// El contador de progreso se queda a cero y no se comprueba: libgit2
    /// copia los repositorios locales sin pasar por el transporte de red, así
    /// que el callback de transferencia no llega a llamarse. Sólo se ejercita
    /// contra un remoto HTTPS de verdad.
    fn clone_to(remote: &Path, destination: &Path) -> Repository {
        clone(remote.to_str().unwrap(), destination, &mut |_, _| {}).unwrap()
    }

    #[test]
    fn documents_walk_the_working_tree_not_the_index() {
        let temp = tempfile::tempdir().unwrap();
        let remote = remote_with_initial_commit(temp.path());
        let clone_path = temp.path().join("clone");
        let repository = clone_to(&remote, &clone_path);

        // Un documento recién escrito y otro dentro de una carpeta ignorada.
        fs::write(clone_path.join("borrador.md"), "# Sin añadir\n").unwrap();
        fs::create_dir(clone_path.join("borradores")).unwrap();
        fs::write(clone_path.join("borradores/oculto.md"), "# Ignorado\n").unwrap();

        let found = documents(&repository).unwrap();
        let names = found
            .iter()
            .map(|document| document.relative.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["README.md", "borrador.md", "docs/guia.markdown"]);

        // `.txt` fuera, lo ignorado fuera, y la marca de seguimiento puesta.
        let borrador = found
            .iter()
            .find(|document| document.relative == "borrador.md")
            .unwrap();
        assert!(!borrador.tracked);
        assert!(found.iter().find(|d| d.relative == "README.md").unwrap().tracked);
    }

    #[test]
    fn file_diff_contains_only_the_requested_change() {
        let temp = tempfile::tempdir().unwrap();
        let remote = remote_with_initial_commit(temp.path());
        let clone_path = temp.path().join("clone");
        let repository = clone_to(&remote, &clone_path);

        fs::write(clone_path.join("README.md"), "# Dos\n").unwrap();
        fs::write(clone_path.join("nuevo.md"), "# Nuevo\n").unwrap();

        let changed = file_diff(&repository, "README.md", false).unwrap();
        assert!(changed.patch.contains("-# Uno"));
        assert!(changed.patch.contains("+# Dos"));
        assert!(!changed.patch.contains("nuevo.md"));

        let new = file_diff(&repository, "nuevo.md", false).unwrap();
        assert!(new.patch.contains("+# Nuevo"));
        assert!(!new.binary);
        assert!(file_diff(&repository, "../fuera.md", false).is_err());

        fs::write(clone_path.join("imagen.bin"), [0, 159, 146, 150, 255]).unwrap();
        let binary = file_diff(&repository, "imagen.bin", false).unwrap();
        assert!(binary.binary);

        let large = (0..2_500)
            .map(|line| format!("línea {line}\n"))
            .collect::<String>();
        fs::write(clone_path.join("grande.md"), large).unwrap();
        let limited = file_diff(&repository, "grande.md", false).unwrap();
        assert!(limited.truncated);
        assert!(limited.shown_lines <= DIFF_PREVIEW_MAX_LINES);
        assert!(limited.patch.len() <= DIFF_PREVIEW_MAX_BYTES);
        assert_eq!(limited.additions, 2_500);
        let expanded = file_diff(&repository, "grande.md", true).unwrap();
        assert!(!expanded.truncated);
        assert_eq!(expanded.shown_lines, expanded.total_lines);
    }

    #[test]
    fn fetch_fast_forwards_a_clean_checkout_and_stops_at_a_dirty_one() {
        let temp = tempfile::tempdir().unwrap();
        let remote = remote_with_initial_commit(temp.path());

        let reader_path = temp.path().join("reader");
        let reader = clone_to(&remote, &reader_path);
        assert_eq!(fetch(&reader, "main").unwrap(), Advance::UpToDate);

        // Otro clon publica un documento nuevo: es el push que valida el
        // transporte, igual que en la fase 0.
        let writer_path = temp.path().join("writer");
        let writer = clone_to(&remote, &writer_path);
        fs::write(writer_path.join("nuevo.md"), "# Publicado\n").unwrap();
        commit_all(&writer, "add nuevo.md");
        push(&writer, "refs/heads/main:refs/heads/main").unwrap();

        // Con el árbol limpio el checkout se adelanta y el archivo aparece.
        assert_eq!(fetch(&reader, "main").unwrap(), Advance::FastForwarded);
        assert!(reader_path.join("nuevo.md").exists());
        // El índice tiene que haberse movido con el árbol. Si se queda en el
        // commit viejo, el repositorio parece tener borrados que nadie hizo.
        assert_eq!(changed_files(&reader).unwrap(), 0);
        assert_eq!(fetch(&reader, "main").unwrap(), Advance::UpToDate);

        // Con un cambio sin confirmar no se toca nada.
        fs::write(writer_path.join("nuevo.md"), "# Segunda\n").unwrap();
        commit_all(&writer, "edit nuevo.md");
        push(&writer, "refs/heads/main:refs/heads/main").unwrap();
        fs::write(reader_path.join("README.md"), "# Editado a mano\n").unwrap();

        assert_eq!(fetch(&reader, "main").unwrap(), Advance::Dirty);
        let kept = fs::read_to_string(reader_path.join("README.md")).unwrap();
        assert_eq!(kept.replace("\r\n", "\n"), "# Editado a mano\n");
        assert_eq!(
            fs::read_to_string(reader_path.join("nuevo.md"))
                .unwrap()
                .replace("\r\n", "\n"),
            "# Publicado\n",
            "el avance bloqueado no debe traer el contenido nuevo"
        );
    }

    /// Un archivo sin seguir no debe bloquear el avance: casi todo el mundo
    /// tiene alguno suelto y traer cambios fallaría siempre.
    #[test]
    fn untracked_files_do_not_block_the_advance() {
        let temp = tempfile::tempdir().unwrap();
        let remote = remote_with_initial_commit(temp.path());
        let reader_path = temp.path().join("reader");
        let reader = clone_to(&remote, &reader_path);

        let writer_path = temp.path().join("writer");
        let writer = clone_to(&remote, &writer_path);
        fs::write(writer_path.join("nuevo.md"), "# Publicado\n").unwrap();
        commit_all(&writer, "add nuevo.md");
        push(&writer, "refs/heads/main:refs/heads/main").unwrap();

        fs::write(reader_path.join("suelto.md"), "# Mío\n").unwrap();
        assert_eq!(fetch(&reader, "main").unwrap(), Advance::FastForwarded);
        assert!(reader_path.join("suelto.md").exists());
        assert_eq!(changed_files(&reader).unwrap(), 1);
    }

    #[test]
    fn diverged_history_is_reported_and_not_merged() {
        let temp = tempfile::tempdir().unwrap();
        let remote = remote_with_initial_commit(temp.path());
        let reader_path = temp.path().join("reader");
        let reader = clone_to(&remote, &reader_path);

        let writer_path = temp.path().join("writer");
        let writer = clone_to(&remote, &writer_path);
        fs::write(writer_path.join("remoto.md"), "# Remoto\n").unwrap();
        commit_all(&writer, "remoto");
        push(&writer, "refs/heads/main:refs/heads/main").unwrap();

        // El lector también confirma algo propio: ya no es un avance.
        fs::write(reader_path.join("local.md"), "# Local\n").unwrap();
        commit_all(&reader, "local");

        assert_eq!(fetch(&reader, "main").unwrap(), Advance::Diverged);
        assert!(!reader_path.join("remoto.md").exists());
    }

    /// Los cuatro indicadores del explorador salen de aquí, así que se
    /// comprueban los cuatro sobre el mismo checkout.
    #[test]
    fn document_states_tell_synced_new_modified_and_conflicted_apart() {
        let temp = tempfile::tempdir().unwrap();
        let remote = remote_with_initial_commit(temp.path());
        let reader_path = temp.path().join("reader");
        let reader = clone_to(&remote, &reader_path);

        let state_of = |repository: &Repository, name: &str| {
            documents(repository)
                .unwrap()
                .into_iter()
                .find(|document| document.relative == name)
                .unwrap_or_else(|| panic!("falta {name}"))
                .state
        };

        // Recién clonado, todo coincide con el último commit.
        assert_eq!(state_of(&reader, "README.md"), DocumentState::Synced);

        fs::write(reader_path.join("suelto.md"), "# Nuevo
").unwrap();
        assert_eq!(state_of(&reader, "suelto.md"), DocumentState::New);

        fs::write(reader_path.join("README.md"), "# Tocado
").unwrap();
        assert_eq!(state_of(&reader, "README.md"), DocumentState::Modified);

        // Conflicto de verdad: los dos lados crean el mismo archivo con
        // contenido distinto y se intenta fusionar.
        let writer_path = temp.path().join("writer");
        let writer = clone_to(&remote, &writer_path);
        fs::write(writer_path.join("choque.md"), "# Desde el remoto
").unwrap();
        commit_all(&writer, "remoto");
        push(&writer, "refs/heads/main:refs/heads/main").unwrap();

        fs::write(reader_path.join("choque.md"), "# Desde el local
").unwrap();
        commit_all(&reader, "local");
        assert_eq!(fetch(&reader, "main").unwrap(), Advance::Diverged);

        let remote_ref = reader.find_reference("refs/remotes/origin/main").unwrap();
        let fetched = reader.reference_to_annotated_commit(&remote_ref).unwrap();
        reader.merge(&[&fetched], None, None).unwrap();
        assert!(
            reader.index().unwrap().has_conflicts(),
            "la fusión debía chocar"
        );
        assert_eq!(state_of(&reader, "choque.md"), DocumentState::Conflicted);
    }

    #[test]
    fn checkout_reports_the_distance_to_the_remote() {
        let temp = tempfile::tempdir().unwrap();
        let remote = remote_with_initial_commit(temp.path());
        let reader_path = temp.path().join("reader");
        let reader = clone_to(&remote, &reader_path);

        let fresh = checkout_state(&reader).unwrap();
        assert!(fresh.has_upstream);
        assert_eq!((fresh.ahead, fresh.behind), (0, 0));

        // Un commit propio sin publicar: por delante.
        fs::write(reader_path.join("local.md"), "# Local
").unwrap();
        commit_all(&reader, "local");
        let ahead = checkout_state(&reader).unwrap();
        assert_eq!((ahead.ahead, ahead.behind), (1, 0));

        // Y uno ajeno que llega al remoto: por delante y por detrás a la vez.
        let writer_path = temp.path().join("writer");
        let writer = clone_to(&remote, &writer_path);
        fs::write(writer_path.join("remoto.md"), "# Remoto
").unwrap();
        commit_all(&writer, "remoto");
        push(&writer, "refs/heads/main:refs/heads/main").unwrap();
        assert_eq!(fetch(&reader, "main").unwrap(), Advance::Diverged);

        let both = checkout_state(&reader).unwrap();
        assert_eq!((both.ahead, both.behind), (1, 1));
    }

    fn signature() -> Signature<'static> {
        Signature::now("Autora", "autora@ejemplo.test").unwrap()
    }

    fn reviewed(repository: &Repository, paths: &[&str]) -> Vec<ReviewedPath> {
        paths
            .iter()
            .map(|relative| ReviewedPath {
                relative: (*relative).to_owned(),
                fingerprint: fingerprint(repository, relative).unwrap(),
            })
            .collect()
    }

    /// La promesa de la vista de cambios es que se confirma exactamente lo
    /// marcado. Aquí se comprueba de las dos maneras: lo elegido entra y lo
    /// demás se queda tal cual estaba.
    #[test]
    fn commit_records_only_the_selected_paths() {
        let temp = tempfile::tempdir().unwrap();
        let remote = remote_with_initial_commit(temp.path());
        let clone_path = temp.path().join("clone");
        let repository = clone_to(&remote, &clone_path);

        fs::write(clone_path.join("elegido.md"), "# Va\n").unwrap();
        fs::write(clone_path.join("descartado.md"), "# No va\n").unwrap();
        fs::write(clone_path.join("README.md"), "# Tocado\n").unwrap();
        let selected = reviewed(&repository, &["elegido.md"]);

        commit(
            &repository,
            &selected,
            "sólo el elegido",
            &signature(),
        )
        .unwrap();

        // El commit tiene el archivo elegido...
        let head = repository.head().unwrap().peel_to_tree().unwrap();
        assert!(head.get_name("elegido.md").is_some());
        assert!(head.get_name("descartado.md").is_none());

        // ...y lo que no se marcó sigue pendiente, sin haberse perdido.
        let pending = changes(&repository)
            .unwrap()
            .into_iter()
            .map(|change| (change.relative, change.state))
            .collect::<Vec<_>>();
        assert_eq!(
            pending,
            vec![
                ("README.md".to_owned(), DocumentState::Modified),
                ("descartado.md".to_owned(), DocumentState::New),
            ]
        );
    }

    /// Lo que estuviera preparado desde la línea de órdenes no puede colarse en
    /// el commit ni quedar desmarcado. El árbol se construye desde HEAD y luego
    /// sólo se sustituyen en el índice los paths realmente confirmados.
    #[test]
    fn commit_ignores_what_was_staged_outside_unfold() {
        let temp = tempfile::tempdir().unwrap();
        let remote = remote_with_initial_commit(temp.path());
        let clone_path = temp.path().join("clone");
        let repository = clone_to(&remote, &clone_path);

        fs::write(clone_path.join("colado.md"), "# Preparado aparte\n").unwrap();
        fs::write(clone_path.join("elegido.md"), "# Va\n").unwrap();
        let mut index = repository.index().unwrap();
        index.add_path(Path::new("colado.md")).unwrap();
        index.write().unwrap();
        let selected = reviewed(&repository, &["elegido.md"]);

        commit(
            &repository,
            &selected,
            "sólo el elegido",
            &signature(),
        )
        .unwrap();

        let head = repository.head().unwrap().peel_to_tree().unwrap();
        assert!(head.get_name("elegido.md").is_some());
        assert!(
            head.get_name("colado.md").is_none(),
            "lo preparado fuera no debe entrar sin marcarse"
        );
        // No se pierde ni se desmarca: sigue preparado exactamente como estaba.
        assert!(clone_path.join("colado.md").exists());
        assert!(repository
            .status_file(Path::new("colado.md"))
            .unwrap()
            .is_index_new());
    }

    #[test]
    fn commit_records_a_deleted_file() {
        let temp = tempfile::tempdir().unwrap();
        let remote = remote_with_initial_commit(temp.path());
        let clone_path = temp.path().join("clone");
        let repository = clone_to(&remote, &clone_path);

        fs::remove_file(clone_path.join("README.md")).unwrap();
        let listed = changes(&repository).unwrap();
        let borrado = listed
            .iter()
            .find(|change| change.relative == "README.md")
            .unwrap();
        assert!(borrado.deleted);
        let selected = reviewed(&repository, &["README.md"]);

        commit(
            &repository,
            &selected,
            "quita el README",
            &signature(),
        )
        .unwrap();

        let head = repository.head().unwrap().peel_to_tree().unwrap();
        assert!(head.get_name("README.md").is_none());
        assert!(changes(&repository).unwrap().is_empty());
    }

    /// El autor del commit es el que se le pase, sin mirar la configuración de
    /// Git de la máquina donde se ejecute la prueba.
    #[test]
    fn commit_signs_with_the_given_identity() {
        let temp = tempfile::tempdir().unwrap();
        let remote = remote_with_initial_commit(temp.path());
        let clone_path = temp.path().join("clone");
        let repository = clone_to(&remote, &clone_path);

        fs::write(clone_path.join("nuevo.md"), "# Nuevo\n").unwrap();
        let author = Signature::now("Quien Firma", "1234+quien@users.noreply.github.com").unwrap();
        let selected = reviewed(&repository, &["nuevo.md"]);
        let oid = commit(&repository, &selected, "firma", &author).unwrap();

        let created = repository.find_commit(oid).unwrap();
        assert_eq!(created.author().name().ok(), Some("Quien Firma"));
        assert_eq!(
            created.author().email().ok(),
            Some("1234+quien@users.noreply.github.com")
        );
        assert_eq!(created.message().ok(), Some("firma"));
    }

    #[test]
    fn commit_rejects_a_file_changed_after_review() {
        let temp = tempfile::tempdir().unwrap();
        let remote = remote_with_initial_commit(temp.path());
        let clone_path = temp.path().join("clone");
        let repository = clone_to(&remote, &clone_path);

        fs::write(clone_path.join("README.md"), "# Revisado\n").unwrap();
        let selected = reviewed(&repository, &["README.md"]);
        fs::write(clone_path.join("README.md"), "# Cambió después\n").unwrap();

        let error = commit(&repository, &selected, "no debe entrar", &signature()).unwrap_err();
        assert!(error.message().contains("cambió después de abrir la revisión"));
        assert_eq!(
            repository.head().unwrap().peel_to_commit().unwrap().message(),
            Ok("initial")
        );
    }

    /// Un push rechazado por el servidor puede terminar sin error de
    /// transporte: el motivo llega en el estado de la referencia. Si esto se
    /// perdiera, publicar diría que fue bien sin haber publicado nada.
    #[test]
    fn push_reports_a_rejection_from_the_server() {
        let temp = tempfile::tempdir().unwrap();
        let remote = remote_with_initial_commit(temp.path());

        // El lector clona antes de que el otro publique: así se queda atrás.
        let reader_path = temp.path().join("reader");
        let reader = clone_to(&remote, &reader_path);

        let writer_path = temp.path().join("writer");
        let writer = clone_to(&remote, &writer_path);
        fs::write(writer_path.join("remoto.md"), "# Remoto\n").unwrap();
        commit_all(&writer, "remoto");
        push(&writer, "refs/heads/main:refs/heads/main").unwrap();

        // Y el lector confirma algo propio: su push ya no puede avanzar la rama.
        fs::write(reader_path.join("local.md"), "# Local\n").unwrap();
        commit_all(&reader, "local");
        assert_eq!(fetch(&reader, "main").unwrap(), Advance::Diverged);

        // El rechazo puede llegar por dos vías: el transporte se niega, o el
        // servidor acepta la conexión y devuelve el motivo en el estado de la
        // referencia. Las dos tienen que acabar en un error con explicación.
        let error = push(&reader, "refs/heads/main:refs/heads/main")
            .expect_err("el remoto no puede aceptar un push que no avanza");
        assert!(
            error.to_lowercase().contains("fastforward")
                || error.to_lowercase().contains("fast-forward"),
            "el rechazo debe decir que no se puede avanzar: {error}"
        );
    }

    #[test]
    fn origin_url_identifies_an_existing_checkout() {
        let temp = tempfile::tempdir().unwrap();
        let remote = remote_with_initial_commit(temp.path());
        let clone_path = temp.path().join("clone");
        let repository = clone_to(&remote, &clone_path);

        let url = origin_url(&repository).unwrap();
        assert_eq!(
            Path::new(&url).canonicalize().unwrap(),
            remote.canonicalize().unwrap()
        );

        let state = checkout_state(&repository).unwrap();
        assert_eq!(state.branch.as_deref(), Some("main"));
        assert!(state.head.is_some());
        assert_eq!(state.changed, 0);
    }
}
