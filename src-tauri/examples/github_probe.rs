//! Sonda manual contra un remoto de verdad.
//!
//! Las pruebas automáticas clonan de rutas locales, y libgit2 las copia sin
//! pasar por el transporte de red: el progreso de descarga, el helper de
//! credenciales y el push autenticado no llegan a ejercitarse ahí. Esta sonda
//! es la única forma de comprobarlos, y por eso sigue existiendo.
//!
//! ```text
//! cargo run --example github_probe -- https://github.com/usuario/repo.git
//! cargo run --example github_probe -- https://github.com/usuario/repo.git --publicar
//! ```
//!
//! Sin `--publicar` sólo lee. Con `--publicar` repite el orden exacto de la
//! fase 4 —confirmar, sincronizar, publicar— y deja un commit en el remoto.

use git2::Signature;
use std::fs;
use unfold_lib::git;

/// Identidad tal como la resuelve la aplicación cuando hay configuración de
/// Git: `user.name` y `user.email` mandan sobre cualquier otra cosa.
fn git_config_identity() -> Option<(String, String)> {
    let config = git2::Config::open_default().ok()?;
    let name = config.get_string("user.name").ok()?;
    let email = config.get_string("user.email").ok()?;
    Some((name, email))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let remote_url = std::env::args().nth(1).ok_or("Falta la URL HTTPS")?;
    let publicar = std::env::args().any(|argument| argument == "--publicar");
    let temp = tempfile::tempdir()?;
    let destination = temp.path().join("repository");

    println!("libgit2 {}", git::libgit2_version());

    let mut last = 0;
    let repository = git::clone(&remote_url, &destination, &mut |received, total| {
        // Sólo por decenas: si no, un repositorio mediano llena la consola.
        let percent = received * 100 / total.max(1);
        if percent >= last + 25 {
            last = percent;
            println!("descargando… {percent}%");
        }
    })?;

    let state = git::checkout_state(&repository)?;
    println!(
        "clonado: rama={:?} head={:?} cambios={} adelanto={} retraso={}",
        state.branch, state.head, state.changed, state.ahead, state.behind
    );

    for document in git::documents(&repository)? {
        println!(
            "  {} {}",
            if document.tracked { "seguido " } else { "sin añadir" },
            document.relative
        );
    }

    let branch = state.branch.clone().unwrap_or_else(|| "main".to_owned());
    println!("fetch: {:?}", git::fetch(&repository, &branch)?);

    // Un documento nuevo sin confirmar tiene que aparecer en el recuento y en
    // la vista de cambios, que es la promesa que hace la interfaz.
    let nombre = format!(
        "unfold-sonda-{}.md",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs()
    );
    fs::write(
        destination.join(&nombre),
        "# Sonda de la fase 4\n\nConfirmado y publicado por Unfold con libgit2.\n",
    )?;
    println!("cambios tras escribir: {}", git::changed_files(&repository)?);
    for change in git::changes(&repository)? {
        println!("  {:?} {}", change.state, change.relative);
    }

    if !publicar {
        println!("(sin --publicar: no se confirma ni se publica nada)");
        return Ok(());
    }

    // A partir de aquí, el mismo orden que sigue `sync_and_push`.
    let (name, email) = git_config_identity().ok_or("Sin user.name y user.email en Git")?;
    println!("firmando como {name} <{email}>");
    let author = Signature::now(&name, &email)?;
    let reviewed = git::changes(&repository)?
        .into_iter()
        .filter(|change| change.relative == nombre)
        .map(|change| git::ReviewedPath {
            relative: change.relative,
            fingerprint: change.fingerprint,
        })
        .collect::<Vec<_>>();

    let oid = git::commit(
        &repository,
        &reviewed,
        "test: valida commit y push de la fase 4 desde Unfold",
        &author,
    )?;
    println!("commit {oid}");

    let advance = git::fetch(&repository, &branch)?;
    println!("sincronización antes de publicar: {advance:?}");

    match git::push(&repository, &format!("refs/heads/{branch}:refs/heads/{branch}")) {
        Ok(()) => println!("publicado: {nombre}"),
        // Se imprime en vez de propagarse: el motivo del rechazo es
        // exactamente lo que esta sonda viene a comprobar.
        Err(error) => println!("RECHAZADO: {error}"),
    }

    let after = git::checkout_state(&repository)?;
    println!(
        "final: head={:?} cambios={} adelanto={} retraso={}",
        after.head, after.changed, after.ahead, after.behind
    );
    Ok(())
}
