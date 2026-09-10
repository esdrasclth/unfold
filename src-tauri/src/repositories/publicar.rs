//! Publicar: commit, sincronizar y empujar.
//!
//! Es la operación más larga de la aplicación y la única que puede quedarse a
//! medias dejando trabajo hecho: el commit existe aunque el servidor rechace el
//! empujón, y por eso `github_push_pending` puede retomarlo sin apilar encima un
//! commit vacío.
//!
//! Sale entera de `mod.rs` —los pasos, el aviso de progreso y la traducción de
//! los rechazos— porque es una tubería con su propio orden, y leerla
//! entremezclada con conectar y desconectar costaba el doble.

use super::catalogo::describe;
use super::{Identity, PublishReport, RepositoryEntry, PUBLISH_PROGRESS_EVENT};
use crate::git::{self, Advance};
use std::path::Path;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub(super) fn publish(
    app: Option<&AppHandle>,
    entry: RepositoryEntry,
    paths: Vec<git::ReviewedPath>,
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

    announce(app, entry.id, PublishPhase::Committing);
    let author = git2::Signature::now(&identity.name, &identity.email)
        .map_err(|error| format!("La identidad del autor no es válida: {}", error.message()))?;
    let commit = git::commit(&repository, &paths, message.trim(), &author)
        .map_err(|error| format!("No se pudo confirmar: {}", error.message()))?
        .to_string();

    Ok(sync_and_push(app, &repository, entry, Some(commit)))
}

/// En qué paso va la publicación. Los nombres viajan tal cual al frontend.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PublishPhase {
    Committing,
    Syncing,
    Pushing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishProgress {
    pub id: u64,
    pub phase: PublishPhase,
}

fn announce(app: Option<&AppHandle>, id: u64, phase: PublishPhase) {
    // Si nadie escucha, da igual: publicar no depende de que el aviso llegue.
    if let Some(app) = app {
        let _ = app.emit(PUBLISH_PROGRESS_EVENT, PublishProgress { id, phase });
    }
}

/// Sincroniza con el remoto y publica. `commit` es sólo el que se acabe de
/// crear, para poder contarlo en el informe; este paso no crea ninguno.
pub(super) fn sync_and_push(
    app: Option<&AppHandle>,
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
    announce(app, entry.id, PublishPhase::Syncing);
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

    announce(app, entry.id, PublishPhase::Pushing);
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

#[cfg(test)]
mod tests {
    use super::*;

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
