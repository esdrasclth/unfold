//! Repositorios conectados.
//!
//! El catálogo es el puente entre GitHub y el disco: dice qué repositorios ha
//! conectado esta persona y dónde está su copia. Vive junto a los checkouts,
//! en el directorio local de la aplicación, con la forma que fijó la fase 0:
//!
//! ```text
//! %LOCALAPPDATA%\com.esdras.unfold\
//! ├── repositories\<id de GitHub>\   checkout completo
//! └── github-repositories.json       catálogo
//! ```
//!
//! El catálogo no guarda nada sensible y no depende de la sesión: al reiniciar
//! se lee del disco, así que los repositorios conectados siguen ahí aunque no
//! haya red ni token. Los tokens siguen donde los dejó la fase 1.

use crate::git::{self, Advance};
use crate::github::{granted_repositories, signed_in_user, GithubClient};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

const CATALOG_FILE: &str = "github-repositories.json";
const CATALOG_VERSION: u32 = 1;
const CLONE_PROGRESS_EVENT: &str = "github://clone-progress";

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
    id: u64,
    full_name: String,
    default_branch: String,
    clone_url: String,
    private: bool,
    can_push: bool,
    path: String,
    /// Segundos desde epoch. Sirve para ordenar la lista por uso reciente.
    last_used: u64,
}

/// Una entrada del catálogo más el estado real de su copia en disco.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedRepository {
    #[serde(flatten)]
    entry: RepositoryEntry,
    /// Rama del checkout, que puede no ser la predeterminada del repositorio.
    branch: Option<String>,
    head: Option<String>,
    changed: usize,
    /// Commits locales sin publicar y commits del remoto sin traer.
    ahead: usize,
    behind: usize,
    has_upstream: bool,
    /// La carpeta desapareció o dejó de ser un repositorio Git.
    missing: bool,
}

impl ConnectedRepository {
    /// Sin estado de checkout la copia local ya no está: se marca en vez de
    /// fallar, para que el explorador pueda decirlo en su sitio.
    fn new(entry: RepositoryEntry, state: Option<git::Checkout>) -> Self {
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchReport {
    advance: Advance,
    repository: ConnectedRepository,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloneProgress {
    id: u64,
    received: usize,
    total: usize,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogFile {
    version: u32,
    repositories: Vec<RepositoryEntry>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn local_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|error| format!("No se pudo localizar la carpeta de Unfold: {error}"))
}

fn catalog_path(root: &Path) -> PathBuf {
    root.join(CATALOG_FILE)
}

/// Lee el catálogo. Un archivo ausente es un catálogo vacío, no un error.
///
/// Si el JSON está roto se aparta en vez de borrarse: perder el catálogo sólo
/// obliga a volver a conectar, pero los checkouts siguen en disco y quien
/// quiera rescatar algo tiene el archivo original a mano.
fn read_catalog(root: &Path) -> Result<Vec<RepositoryEntry>, String> {
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
fn write_catalog(root: &Path, repositories: &[RepositoryEntry]) -> Result<(), String> {
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
fn describe(entry: RepositoryEntry) -> ConnectedRepository {
    let state = git::open(Path::new(&entry.path))
        .ok()
        .and_then(|repository| git::checkout_state(&repository).ok());
    ConnectedRepository::new(entry, state)
}

/// Inserta o actualiza una entrada conservando el orden por nombre.
fn upsert(repositories: &mut Vec<RepositoryEntry>, entry: RepositoryEntry) {
    repositories.retain(|existing| existing.id != entry.id);
    repositories.push(entry);
    repositories.sort_by(|left, right| left.full_name.cmp(&right.full_name));
}

/// Ejecuta trabajo de disco o de red fuera del hilo de la interfaz. Un clone
/// puede tardar minutos y la ventana no puede quedarse congelada mientras.
async fn blocking<T, F>(task: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|_| "La operación de Git se interrumpió".to_owned())?
}

/// Toma el candado del catálogo, ignorando el envenenamiento.
///
/// Si un hilo anterior entró en pánico con el candado tomado, el catálogo en
/// disco sigue íntegro —se escribe con renombrado atómico—, así que negarse a
/// continuar sólo dejaría la función de repositorios inservible el resto de la
/// sesión sin proteger nada.
fn guard(catalog: &Catalog) -> std::sync::MutexGuard<'_, ()> {
    catalog.lock.lock().unwrap_or_else(|error| error.into_inner())
}

/// Busca una entrada del catálogo. Es el primer paso de casi todo comando, y
/// tenerlo suelto evita repetir el candado y la lectura en cada uno.
fn entry_of(app: &AppHandle, catalog: &Catalog, id: u64) -> Result<RepositoryEntry, String> {
    let root = local_root(app)?;
    let _guard = guard(catalog);
    read_catalog(&root)?
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "Ese repositorio ya no está conectado".to_owned())
}

/// Apunta el repositorio como recién usado. Un identificador desconocido no es
/// un error: sólo significa que se desconectó mientras tanto.
fn touch(app: &AppHandle, catalog: &Catalog, id: u64) -> Result<(), String> {
    let root = local_root(app)?;
    let _guard = guard(catalog);
    let mut repositories = read_catalog(&root).unwrap_or_default();
    let Some(entry) = repositories.iter_mut().find(|entry| entry.id == id) else {
        return Ok(());
    };
    entry.last_used = now();
    write_catalog(&root, &repositories)
}

/// De dónde sale la identidad con la que se firma un commit.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IdentitySource {
    /// De `user.name` y `user.email` de la configuración de Git.
    GitConfig,
    /// Compuesta con la dirección `noreply` de GitHub.
    Noreply,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    name: String,
    email: String,
    source: IdentitySource,
}

/// Qué pasó al publicar, paso por paso.
///
/// No es un `Result` porque los pasos son tres y pueden quedarse a medias: el
/// commit puede existir aunque el push falle, y esconderlo detrás de un error
/// haría creer que no se confirmó nada.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishReport {
    /// Identificador del commit creado.
    commit: Option<String>,
    /// Resultado de sincronizar antes de publicar.
    advance: Option<Advance>,
    pushed: bool,
    /// Por qué se detuvo, si se detuvo.
    problem: Option<String>,
    repository: ConnectedRepository,
}

/// Lee `user.name` y `user.email` de la configuración de Git del sistema.
fn git_config_identity() -> Option<(String, String)> {
    let config = git2::Config::open_default().ok()?;
    let name = config.get_string("user.name").ok()?;
    let email = config.get_string("user.email").ok()?;
    if name.trim().is_empty() || email.trim().is_empty() {
        return None;
    }
    Some((name, email))
}

/// Resuelve con qué nombre y correo se va a firmar.
///
/// Manda la configuración de Git cuando existe: es lo que hace cualquier otra
/// herramienta y cambiarla por detrás sería una sorpresa desagradable. Si no
/// hay ninguna —una máquina recién estrenada—, se compone con la dirección
/// `noreply` de GitHub en vez de fallar con un «dime quién eres», y sin
/// arriesgarse a publicar un correo privado.
async fn resolve_identity(client: &GithubClient, force_noreply: bool) -> Result<Identity, String> {
    if !force_noreply {
        if let Some((name, email)) = git_config_identity() {
            return Ok(Identity {
                name,
                email,
                source: IdentitySource::GitConfig,
            });
        }
    }

    let user = signed_in_user(client)
        .await?
        .ok_or("Conecta GitHub o configura user.name y user.email en Git para poder firmar")?;
    Ok(Identity {
        // El nombre sí puede venir de Git aunque el correo sea el `noreply`:
        // son dos decisiones distintas y sólo una tiene que ver con privacidad.
        name: git_config_identity()
            .map(|(name, _)| name)
            .unwrap_or_else(|| user.display_name()),
        email: user.noreply_email(),
        source: IdentitySource::Noreply,
    })
}

#[tauri::command]
pub async fn github_commit_identity(
    client: State<'_, GithubClient>,
    force_noreply: bool,
) -> Result<Identity, String> {
    resolve_identity(&client, force_noreply).await
}

#[tauri::command]
pub async fn github_repository_changes(
    app: AppHandle,
    catalog: State<'_, Catalog>,
    id: u64,
) -> Result<Vec<git::Change>, String> {
    let entry = entry_of(&app, &catalog, id)?;
    blocking(move || {
        let repository = git::open(Path::new(&entry.path))
            .map_err(|_| format!("Ya no hay una copia local de «{}»", entry.full_name))?;
        git::changes(&repository).map_err(|error| error.message().to_owned())
    })
    .await
}

#[tauri::command]
pub async fn github_repository_state(
    app: AppHandle,
    catalog: State<'_, Catalog>,
    id: u64,
) -> Result<ConnectedRepository, String> {
    let entry = entry_of(&app, &catalog, id)?;
    blocking(move || Ok(describe(entry))).await
}

/// Confirma lo seleccionado, sincroniza y publica.
///
/// El orden importa y es el único que funciona sin saber fusionar: confirmar
/// primero es lo que deja el árbol limpio para poder adelantarlo hasta el
/// remoto. Sincronizar antes serviría de poco, porque los archivos que se van
/// a confirmar son justamente los que bloquean el avance.
#[tauri::command]
pub async fn github_publish(
    app: AppHandle,
    client: State<'_, GithubClient>,
    catalog: State<'_, Catalog>,
    id: u64,
    paths: Vec<String>,
    message: String,
    force_noreply: bool,
) -> Result<PublishReport, String> {
    if paths.is_empty() {
        return Err("Selecciona al menos un archivo para confirmar".to_owned());
    }
    if message.trim().is_empty() {
        return Err("Escribe un mensaje para el commit".to_owned());
    }

    let entry = entry_of(&app, &catalog, id)?;
    let identity = resolve_identity(&client, force_noreply).await?;

    let report = {
        let entry = entry.clone();
        blocking(move || publish(entry, paths, message, identity)).await?
    };

    touch(&app, &catalog, id)?;
    Ok(report)
}

fn publish(
    entry: RepositoryEntry,
    paths: Vec<String>,
    message: String,
    identity: Identity,
) -> Result<PublishReport, String> {
    let repository = git::open(Path::new(&entry.path))
        .map_err(|_| format!("Ya no hay una copia local de «{}»", entry.full_name))?;

    // Un índice con conflictos guardaría las marcas de conflicto dentro del
    // commit. Se para antes de tocar nada.
    if repository
        .index()
        .map_err(|error| error.message().to_owned())?
        .has_conflicts()
    {
        return Err(format!(
            "«{}» tiene una fusión sin resolver. Termínala con Git antes de publicar.",
            entry.full_name
        ));
    }
    if !entry.can_push {
        return Err(format!(
            "La GitHub App sólo tiene permiso de lectura sobre «{}»",
            entry.full_name
        ));
    }

    let author = git2::Signature::now(&identity.name, &identity.email)
        .map_err(|error| format!("La identidad del autor no es válida: {}", error.message()))?;
    let commit = git::commit(&repository, &paths, message.trim(), &author)
        .map_err(|error| format!("No se pudo confirmar: {}", error.message()))?
        .to_string();

    Ok(sync_and_push(&repository, entry, Some(commit)))
}

/// Publica los commits que ya estén hechos, sin crear ninguno.
///
/// Es lo que hay que llamar al reintentar después de un rechazo: el commit ya
/// existe, y volver a `github_publish` con la misma selección apilaría un
/// commit vacío encima. También le da salida al «N sin publicar» que la fase 3
/// enseña en el panel.
#[tauri::command]
pub async fn github_push_pending(
    app: AppHandle,
    catalog: State<'_, Catalog>,
    id: u64,
) -> Result<PublishReport, String> {
    let entry = entry_of(&app, &catalog, id)?;
    let report = {
        let entry = entry.clone();
        blocking(move || {
            let repository = git::open(Path::new(&entry.path))
                .map_err(|_| format!("Ya no hay una copia local de «{}»", entry.full_name))?;
            if !entry.can_push {
                return Err(format!(
                    "La GitHub App sólo tiene permiso de lectura sobre «{}»",
                    entry.full_name
                ));
            }
            Ok(sync_and_push(&repository, entry, None))
        })
        .await?
    };
    touch(&app, &catalog, id)?;
    Ok(report)
}

/// Sincroniza con el remoto y publica. `commit` es sólo el que se acabe de
/// crear, para poder contarlo en el informe; este paso no crea ninguno.
fn sync_and_push(
    repository: &git2::Repository,
    entry: RepositoryEntry,
    commit: Option<String>,
) -> PublishReport {
    let done = commit.is_some();
    let stop = |advance, problem: String| PublishReport {
        commit: commit.clone(),
        advance,
        pushed: false,
        problem: Some(problem),
        repository: describe(entry.clone()),
    };
    // El commit ya está hecho y a salvo, y decirlo cambia por completo cómo se
    // lee el aviso: no es «se perdió tu trabajo», es «falta el último paso».
    let hecho = if done { "El commit se creó, pero " } else { "" };

    // Sincronizar antes de publicar: si el remoto se adelantó, el push saldría
    // rechazado y el motivo sería mucho menos claro que éste.
    let branch = repository
        .head()
        .ok()
        .and_then(|head| head.shorthand().ok().map(str::to_owned))
        .unwrap_or_else(|| entry.default_branch.clone());
    let advance = match git::fetch(repository, &branch) {
        Ok(advance) => advance,
        Err(error) => {
            return stop(
                None,
                format!("{hecho}no se pudo comprobar el remoto: {}", error.message()),
            )
        }
    };

    match advance {
        Advance::Diverged => {
            return stop(
                Some(Advance::Diverged),
                format!(
                    "{hecho}el remoto tiene cambios que no están aquí. Unfold todavía no sabe \
                     fusionar: intégralos con Git y vuelve a publicar."
                ),
            )
        }
        Advance::Dirty => {
            return stop(
                Some(Advance::Dirty),
                format!(
                    "{hecho}quedan cambios sin confirmar que impiden traer lo del remoto. \
                     Confírmalos también o apártalos, y vuelve a publicar."
                ),
            )
        }
        _ => {}
    }

    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    if let Err(error) = git::push(repository, &refspec) {
        return stop(Some(advance), explain_push_error(&error));
    }

    PublishReport {
        commit,
        advance: Some(advance),
        pushed: true,
        problem: None,
        repository: describe(entry),
    }
}

/// Traduce el rechazo del servidor a algo accionable.
///
/// Los códigos de GitHub son precisos pero mudos para quien no los conoce, y el
/// más probable aquí —`GH007`— tiene una solución concreta que la interfaz
/// puede ofrecer con un clic.
fn explain_push_error(error: &str) -> String {
    let lower = error.to_lowercase();
    if error.contains("GH007") {
        return format!(
            "GitHub rechazó el commit porque su correo de autor es privado. Vuelve a \
             publicar marcando «usar mi correo noreply». ({error})"
        );
    }
    if error.contains("GH006") || lower.contains("protected branch") {
        return format!(
            "La rama está protegida en GitHub y no admite publicar directamente. ({error})"
        );
    }
    // Tres redacciones para lo mismo: la del servidor de GitHub, la de Git y
    // la que usa libgit2 cuando se niega él mismo antes de salir a la red.
    if lower.contains("non-fast-forward")
        || lower.contains("fastforward")
        || lower.contains("fetch first")
    {
        return format!(
            "Alguien publicó mientras tanto. El commit está guardado: vuelve a publicar. ({error})"
        );
    }
    if error.contains("401") || lower.contains("authentication") {
        return format!("GitHub no aceptó las credenciales al publicar. ({error})");
    }
    format!("GitHub no aceptó la publicación. ({error})")
}

#[tauri::command]
pub async fn github_connected_repositories(
    app: AppHandle,
    catalog: State<'_, Catalog>,
) -> Result<Vec<ConnectedRepository>, String> {
    let root = local_root(&app)?;
    let entries = {
        let _guard = guard(&catalog);
        read_catalog(&root)?
    };
    blocking(move || Ok(entries.into_iter().map(describe).collect())).await
}

/// Conecta un repositorio: lo clona en el almacén y lo apunta en el catálogo.
///
/// El descriptor no lo pone el frontend, sino la lista de concesiones vigentes
/// de GitHub. Así lo único que se puede clonar es algo que la GitHub App tenga
/// concedido en ese momento, y no lo que hubiera en pantalla hace un rato.
#[tauri::command]
pub async fn github_connect_repository(
    app: AppHandle,
    client: State<'_, GithubClient>,
    catalog: State<'_, Catalog>,
    id: u64,
) -> Result<ConnectedRepository, String> {
    let root = local_root(&app)?;
    let granted = granted_repositories(&client).await?;
    let repository = granted
        .into_iter()
        .find(|repository| repository.id == id)
        .ok_or("Ese repositorio ya no está entre los que la GitHub App tiene concedidos")?;

    let destination = git::checkout_path(&root, id);
    let entry = RepositoryEntry {
        id,
        full_name: repository.full_name,
        default_branch: repository.default_branch,
        clone_url: repository.clone_url,
        private: repository.private,
        can_push: repository.can_push,
        path: destination.to_string_lossy().into_owned(),
        last_used: now(),
    };

    let cloned = {
        let entry = entry.clone();
        let destination = destination.clone();
        let app = app.clone();
        blocking(move || clone_or_adopt(&app, &entry, &destination)).await?
    };

    let _guard = guard(&catalog);
    let mut repositories = read_catalog(&root).unwrap_or_default();
    upsert(&mut repositories, entry.clone());
    write_catalog(&root, &repositories)?;
    drop(_guard);

    Ok(cloned)
}

/// Clona, o adopta lo que ya hubiera en la carpeta si es el mismo repositorio.
///
/// La adopción no es un adorno: si Unfold se cierra entre el clone y la
/// escritura del catálogo, o si el catálogo se pierde, la carpeta se queda
/// ahí. Sin esto, volver a conectar fallaría para siempre y la única salida
/// sería borrarla a mano.
fn clone_or_adopt(
    app: &AppHandle,
    entry: &RepositoryEntry,
    destination: &Path,
) -> Result<ConnectedRepository, String> {
    if destination.exists() {
        let existing = git::open(destination)
            .map_err(|_| "La carpeta del repositorio ya existe y no es un repositorio Git".to_owned())?;
        let origin = git::origin_url(&existing).unwrap_or_default();
        if origin != entry.clone_url {
            return Err(format!(
                "La carpeta del repositorio ya existe y apunta a otro remoto ({origin})"
            ));
        }
        return Ok(describe(entry.clone()));
    }

    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("No se pudo crear la carpeta de repositorios: {error}"))?;
    }

    // El progreso se manda con cuentagotas: libgit2 llama a cada objeto y una
    // ventana no necesita diez mil avisos para dibujar una barra.
    let mut last = std::time::Instant::now();
    let mut announce = |received: usize, total: usize| {
        let done = total > 0 && received >= total;
        if !done && last.elapsed() < std::time::Duration::from_millis(120) {
            return;
        }
        last = std::time::Instant::now();
        let _ = app.emit(
            CLONE_PROGRESS_EVENT,
            CloneProgress {
                id: entry.id,
                received,
                total,
            },
        );
    };

    let cloned = git::clone(&entry.clone_url, destination, &mut announce).map_err(|error| {
        // Un clone a medias deja una carpeta que impediría el siguiente
        // intento; se limpia antes de contar el error.
        let _ = std::fs::remove_dir_all(destination);
        format!("No se pudo clonar {}: {}", entry.full_name, error.message())
    })?;

    let state = git::checkout_state(&cloned).map_err(|error| error.message().to_owned())?;
    Ok(ConnectedRepository::new(entry.clone(), Some(state)))
}

/// Desconecta un repositorio y, sólo si se pide, borra su copia.
///
/// Son dos decisiones distintas y se mantienen separadas, como fijó la fase 0.
/// Borrar se niega mientras haya cambios sin confirmar: Unfold todavía no sabe
/// publicar, así que cualquier cambio local es irrecuperable y no puede
/// desaparecer detrás de un botón de desconectar.
#[tauri::command]
pub async fn github_disconnect_repository(
    app: AppHandle,
    catalog: State<'_, Catalog>,
    id: u64,
    delete_checkout: bool,
) -> Result<(), String> {
    let root = local_root(&app)?;
    let _guard = guard(&catalog);
    let mut repositories = read_catalog(&root).unwrap_or_default();
    let Some(position) = repositories.iter().position(|entry| entry.id == id) else {
        return Ok(());
    };
    let entry = repositories.remove(position);

    if delete_checkout {
        let path = PathBuf::from(&entry.path);
        if let Ok(repository) = git::open(&path) {
            let changed = git::changed_files(&repository).map_err(|error| error.message().to_owned())?;
            if changed > 0 {
                return Err(format!(
                    "«{}» tiene {changed} cambio(s) sin confirmar. Se dejó todo como estaba.",
                    entry.full_name
                ));
            }
        }
        if path.exists() {
            std::fs::remove_dir_all(&path)
                .map_err(|error| format!("No se pudo borrar la copia local: {error}"))?;
        }
    }

    write_catalog(&root, &repositories)
}

#[tauri::command]
pub async fn github_fetch_repository(
    app: AppHandle,
    catalog: State<'_, Catalog>,
    id: u64,
) -> Result<FetchReport, String> {
    let entry = entry_of(&app, &catalog, id)?;

    let report = {
        let entry = entry.clone();
        blocking(move || {
            let repository = git::open(Path::new(&entry.path))
                .map_err(|_| format!("Ya no hay una copia local de «{}»", entry.full_name))?;
            let advance = git::fetch(&repository, &entry.default_branch)
                .map_err(|error| error.message().to_owned())?;
            Ok(FetchReport {
                advance,
                repository: describe(entry),
            })
        })
        .await?
    };

    // Traer cambios cuenta como uso: mantiene la lista ordenada por lo que de
    // verdad se está tocando.
    touch(&app, &catalog, id)?;
    Ok(report)
}

#[tauri::command]
pub async fn github_repository_documents(
    app: AppHandle,
    catalog: State<'_, Catalog>,
    id: u64,
) -> Result<Vec<git::Document>, String> {
    let entry = entry_of(&app, &catalog, id)?;
    blocking(move || {
        let repository = git::open(Path::new(&entry.path))
            .map_err(|_| format!("Ya no hay una copia local de «{}»", entry.full_name))?;
        git::documents(&repository).map_err(|error| error.message().to_owned())
    })
    .await
}

fn physical_document_target(repository: &Path, target: &Path) -> Result<PathBuf, String> {
    if !target.is_absolute() {
        return Err("La ruta del documento debe ser absoluta".to_owned());
    }
    let extension = target.extension().and_then(|value| value.to_str());
    if !extension.is_some_and(|value| {
        value.eq_ignore_ascii_case("md") || value.eq_ignore_ascii_case("markdown")
    }) {
        return Err("El documento debe tener extensión .md o .markdown".to_owned());
    }

    let root = repository
        .canonicalize()
        .map_err(|error| format!("No se pudo comprobar la carpeta del repositorio: {error}"))?;
    let parent = target
        .parent()
        .ok_or_else(|| "La ruta del documento no tiene una carpeta válida".to_owned())?
        .canonicalize()
        .map_err(|error| format!("No se pudo comprobar la carpeta elegida: {error}"))?;
    if !parent.starts_with(&root) {
        return Err("El documento debe guardarse físicamente dentro del repositorio".to_owned());
    }

    match std::fs::symlink_metadata(target) {
        Ok(metadata) => {
            if metadata.is_dir() {
                return Err("La ruta elegida es una carpeta".to_owned());
            }
            // También se resuelve el último componente: un enlace llamado
            // `nota.md` podría apuntar fuera aunque su carpeta esté dentro.
            let physical = target
                .canonicalize()
                .map_err(|error| format!("No se pudo comprobar el documento elegido: {error}"))?;
            if !physical.starts_with(&root) {
                return Err(
                    "El documento elegido apunta fuera del repositorio y no se modificó".to_owned(),
                );
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("No se pudo comprobar el documento elegido: {error}")),
    }
    Ok(target.to_path_buf())
}

fn create_repository_document(repository: &Path, target: &Path) -> Result<String, String> {
    let target = physical_document_target(repository, target)?;
    std::fs::write(&target, b"")
        .map_err(|error| format!("No se pudo crear el documento: {error}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn github_create_repository_document(
    app: AppHandle,
    catalog: State<'_, Catalog>,
    id: u64,
    target: String,
) -> Result<String, String> {
    let entry = entry_of(&app, &catalog, id)?;
    blocking(move || create_repository_document(Path::new(&entry.path), Path::new(&target))).await
}

/// Apunta que se abrió un documento del repositorio, para ordenar la lista.
#[tauri::command]
pub async fn github_touch_repository(
    app: AppHandle,
    catalog: State<'_, Catalog>,
    id: u64,
) -> Result<(), String> {
    touch(&app, &catalog, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: u64, full_name: &str) -> RepositoryEntry {
        RepositoryEntry {
            id,
            full_name: full_name.to_owned(),
            default_branch: "main".to_owned(),
            clone_url: format!("https://github.com/{full_name}.git"),
            private: true,
            can_push: true,
            path: format!("C:/unfold/repositories/{id}"),
            last_used: 1_700_000_000,
        }
    }

    #[test]
    fn missing_catalog_reads_as_empty() {
        let temp = tempfile::tempdir().unwrap();
        assert!(read_catalog(temp.path()).unwrap().is_empty());
    }

    #[test]
    fn catalog_survives_a_round_trip() {
        let temp = tempfile::tempdir().unwrap();
        let repositories = vec![entry(1, "esdrasclth/uno"), entry(2, "esdrasclth/dos")];
        write_catalog(temp.path(), &repositories).unwrap();

        let read = read_catalog(temp.path()).unwrap();
        assert_eq!(read.len(), 2);
        assert_eq!(read[0].full_name, "esdrasclth/uno");
        assert_eq!(read[1].id, 2);

        // El archivo se llama como fijó la fase 0 y no deja temporales atrás.
        assert!(temp.path().join(CATALOG_FILE).exists());
        assert!(!temp.path().join("github-repositories.json.tmp").exists());
    }

    /// Ningún campo del catálogo puede parecerse a una credencial: es un
    /// archivo en claro dentro del perfil del usuario.
    #[test]
    fn catalog_holds_nothing_secret() {
        let temp = tempfile::tempdir().unwrap();
        write_catalog(temp.path(), &[entry(1, "esdrasclth/uno")]).unwrap();
        let raw = std::fs::read_to_string(temp.path().join(CATALOG_FILE)).unwrap();

        for prohibido in ["token", "secret", "password", "authorization", "@github.com"] {
            assert!(
                !raw.to_lowercase().contains(prohibido),
                "el catálogo no debe contener «{prohibido}»: {raw}"
            );
        }
    }

    #[test]
    fn a_damaged_catalog_is_set_aside_instead_of_lost() {
        let temp = tempfile::tempdir().unwrap();
        let path = catalog_path(temp.path());
        std::fs::write(&path, "{ esto no es JSON").unwrap();

        let error = read_catalog(temp.path()).expect_err("un JSON roto se avisa");
        assert!(error.contains("dañado"), "{error}");
        assert!(!path.exists(), "el archivo roto se aparta");
        assert!(
            path.with_extension("json.dañado").exists(),
            "y se conserva bajo otro nombre"
        );
    }

    #[test]
    fn upsert_replaces_by_id_and_keeps_the_order() {
        let mut repositories = vec![entry(2, "esdrasclth/dos")];
        upsert(&mut repositories, entry(1, "esdrasclth/uno"));
        assert_eq!(
            repositories
                .iter()
                .map(|entry| entry.full_name.as_str())
                .collect::<Vec<_>>(),
            vec!["esdrasclth/dos", "esdrasclth/uno"]
        );

        // Reconectar el mismo repositorio lo actualiza; no lo duplica.
        let mut renamed = entry(1, "esdrasclth/aaa");
        renamed.last_used = 1_800_000_000;
        upsert(&mut repositories, renamed);
        assert_eq!(repositories.len(), 2);
        assert_eq!(repositories[0].full_name, "esdrasclth/aaa");
        assert_eq!(repositories[0].last_used, 1_800_000_000);
    }

    /// La ruta sale del ID numérico de GitHub, así que no hay nada que un
    /// nombre de repositorio pueda hacer para salirse de la carpeta.
    #[test]
    fn checkout_path_is_built_from_the_numeric_id() {
        let path = git::checkout_path(Path::new("C:/unfold"), 1_048_576);
        assert!(path.ends_with("repositories/1048576") || path.ends_with(r"repositories\1048576"));
    }

    #[test]
    fn describe_reports_a_checkout_that_is_no_longer_there() {
        let described = describe(entry(9, "esdrasclth/desaparecido"));
        assert!(described.missing);
        assert!(described.branch.is_none());
    }

    #[test]
    fn document_creation_stays_physically_inside_the_repository() {
        let temp = tempfile::tempdir().unwrap();
        let repository = temp.path().join("repository");
        let docs = repository.join("docs");
        let outside = temp.path().join("outside");
        std::fs::create_dir_all(&docs).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        let inside = docs.join("nueva.md");
        assert_eq!(
            create_repository_document(&repository, &inside).unwrap(),
            inside.to_string_lossy()
        );
        assert!(inside.exists());
        assert!(create_repository_document(&repository, &outside.join("fuera.md")).is_err());
        assert!(create_repository_document(&repository, &docs.join("datos.txt")).is_err());
    }

    /// Un código de GitHub no le dice nada a quien lo lee por primera vez. Lo
    /// que decide si el aviso sirve es que nombre la salida, y en el caso del
    /// correo privado esa salida es una casilla que está a un clic.
    #[test]
    fn push_errors_name_the_way_out() {
        let privado = explain_push_error("refs/heads/main: GH007: Your push would publish a private email address.");
        assert!(privado.contains("noreply"), "{privado}");

        let protegida = explain_push_error("refs/heads/main: GH006: Protected branch update failed.");
        assert!(protegida.contains("protegida"), "{protegida}");

        // Las tres redacciones del mismo rechazo tienen que caer en el mismo
        // consejo: el commit está a salvo y basta reintentar.
        for texto in [
            "cannot push non-fastforwardable reference",
            "refs/heads/main: non-fast-forward",
            "Updates were rejected because the remote contains work; fetch first",
        ] {
            let mensaje = explain_push_error(texto);
            assert!(mensaje.contains("vuelve a publicar"), "{texto} -> {mensaje}");
        }

        // Y lo que no se reconoce se cuenta tal cual, sin inventar un motivo.
        let raro = explain_push_error("algo muy raro");
        assert!(raro.contains("algo muy raro"), "{raro}");
    }
}
