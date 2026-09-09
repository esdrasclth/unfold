use keyring::{Entry, Error as KeyringError};
use reqwest::{Client, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use tokio::sync::Mutex;

pub const APP_ID: u64 = 4_879_959;
pub const CLIENT_ID: &str = "Iv23liir06ihq68sjXCi";
/// Nombre corto de la App en las URL de GitHub. Con él se compone la pantalla
/// donde se elige a qué repositorios da acceso, que es de GitHub y no se puede
/// replicar dentro de Unfold.
pub const APP_SLUG: &str = "unfold-development-esdrasclth";

const CREDENTIAL_SERVICE: &str = "com.esdras.unfold.github";
const CREDENTIAL_USER: &str = "oauth";
const API_VERSION: &str = "2026-03-10";
const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const API_URL: &str = "https://api.github.com";

pub struct GithubClient {
    http: Option<Client>,
    token_lock: Mutex<()>,
}

impl GithubClient {
    /// No devuelve `Result` a propósito: que no se pueda preparar la conexión
    /// con GitHub no puede impedir que se abra un editor de Markdown. El fallo
    /// se recuerda y sale a la luz cuando alguien usa GitHub, que es el único
    /// momento en que estorba.
    pub fn new() -> Self {
        // `reqwest` está enlazado con rustls sin proveedor criptográfico, y
        // construir un cliente sin haber instalado uno provoca un pánico. El
        // plugin del actualizador instala este mismo proveedor cuando le toca;
        // la llamada devuelve error si ya estaba puesto, y no hay nada que
        // hacer con ese error.
        let _ = rustls::crypto::ring::default_provider().install_default();
        Self {
            http: Client::builder()
                .user_agent("Unfold Markdown Editor")
                .build()
                .ok(),
            token_lock: Mutex::new(()),
        }
    }

    fn http(&self) -> Result<&Client, String> {
        self.http
            .as_ref()
            .ok_or_else(|| "No se pudo preparar la conexión con GitHub".to_owned())
    }

    async fn access_token(&self) -> Result<Option<String>, String> {
        let _guard = self.token_lock.lock().await;
        let Some(mut credential) = load_credential()? else {
            return Ok(None);
        };

        if credential.needs_refresh(now()) {
            let Some(refresh_token) = credential.refresh_token.as_deref() else {
                delete_credential()?;
                return Ok(None);
            };
            if credential
                .refresh_expires_at
                .is_some_and(|expires| expires <= now())
            {
                delete_credential()?;
                return Ok(None);
            }

            credential = self.refresh(refresh_token).await?;
            save_credential(&credential)?;
        }

        Ok(Some(credential.access_token))
    }

    async fn refresh(&self, refresh_token: &str) -> Result<StoredCredential, String> {
        let response = self
            .http()?
            .post(ACCESS_TOKEN_URL)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", CLIENT_ID),
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
            ])
            .send()
            .await
            .map_err(network_error)?;
        let exchange = response
            .json::<TokenExchange>()
            .await
            .map_err(network_error)?;
        // Si GitHub rechaza la renovación, la credencial guardada ya no puede
        // volver a servir: se descarta aquí para no reintentarla en cada uso.
        exchange.into_credential().inspect_err(|_| {
            let _ = delete_credential();
        })
    }

    async fn get<T: DeserializeOwned>(&self, path: &str, token: &str) -> Result<T, ApiError> {
        let response = self
            .http()
            .map_err(ApiError::Other)?
            .get(format!("{API_URL}{path}"))
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", API_VERSION)
            .send()
            .await
            .map_err(|error| ApiError::Other(network_error(error)))?;
        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(ApiError::Unauthorized);
        }
        if !response.status().is_success() {
            return Err(ApiError::Other(format!(
                "GitHub respondió con el estado {}",
                response.status()
            )));
        }
        response
            .json::<T>()
            .await
            .map_err(|error| ApiError::Other(network_error(error)))
    }
}

#[derive(Debug)]
enum ApiError {
    Unauthorized,
    Other(String),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAuthorization {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct DeviceAuthorizationResponse {
    device_code: Option<String>,
    user_code: Option<String>,
    verification_uri: Option<String>,
    expires_in: Option<u64>,
    interval: Option<u64>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Deserialize)]
struct TokenExchange {
    access_token: Option<String>,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
    refresh_token_expires_in: Option<u64>,
    error: Option<String>,
    error_description: Option<String>,
    interval: Option<u64>,
}

impl TokenExchange {
    fn into_credential(self) -> Result<StoredCredential, String> {
        let access_token = self.access_token.ok_or_else(|| {
            self.error_description
                .unwrap_or_else(|| "GitHub no devolvió un token de acceso".to_owned())
        })?;
        let issued = now();
        Ok(StoredCredential {
            access_token,
            refresh_token: self.refresh_token,
            access_expires_at: self.expires_in.map(|seconds| issued + seconds),
            refresh_expires_at: self
                .refresh_token_expires_in
                .map(|seconds| issued + seconds),
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PollState {
    Pending,
    SlowDown,
    Authorized,
    Expired,
    Denied,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PollResult {
    state: PollState,
    retry_after: u64,
}

/// Sirve a dos formatos distintos y por eso el renombrado va sólo en un
/// sentido: GitHub envía `avatar_url` y el frontend espera `avatarUrl`. Un
/// `rename_all` sin dirección se aplicaría también al leer y ningún usuario
/// se podría decodificar.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct GithubUser {
    /// El identificador numérico es la mitad del correo `noreply`, así que se
    /// guarda aunque la interfaz no lo enseñe.
    pub id: u64,
    pub login: String,
    pub name: Option<String>,
    avatar_url: String,
    html_url: String,
}

impl GithubUser {
    /// Dirección `noreply` de GitHub para esta cuenta.
    ///
    /// GitHub la acepta siempre como autor y la enlaza con el perfil, sin
    /// publicar ninguna dirección real. Es el valor correcto cuando no hay una
    /// identidad configurada, y el único que no puede filtrar un correo
    /// privado.
    pub fn noreply_email(&self) -> String {
        format!("{}+{}@users.noreply.github.com", self.id, self.login)
    }

    pub fn display_name(&self) -> String {
        self.name.clone().unwrap_or_else(|| self.login.clone())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubAuthStatus {
    connected: bool,
    user: Option<GithubUser>,
    /// Caducidad del token de acceso. Se renueva solo, así que no es un aviso
    /// que darle a nadie: cambia cada pocas horas sin que pase nada.
    expires_at: Option<u64>,
    /// Caducidad del token de refresco, que es la que sí acaba la sesión: el
    /// día que vence hay que volver a autorizar a mano.
    refresh_expires_at: Option<u64>,
}

#[derive(Deserialize)]
struct InstallationList {
    installations: Vec<Installation>,
}

#[derive(Deserialize)]
struct Installation {
    id: u64,
    app_id: u64,
    suspended_at: Option<String>,
    /// `all` o `selected`. Es lo que decide si el usuario ve todos sus
    /// repositorios en Unfold o sólo los que marcó al instalar.
    repository_selection: Option<String>,
}

/// Estado de la instalación de la App para esta cuenta.
///
/// Una App sólo ve lo que su instalación le concede y no puede ampliarse a sí
/// misma: ésa es la protección del modelo. Lo único que puede hacer Unfold es
/// darse cuenta de que el acceso está limitado y llevar a la pantalla correcta.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallationState {
    installed: bool,
    installation_id: Option<u64>,
    /// Verdadero cuando la instalación da acceso a todos los repositorios.
    all_repositories: bool,
    /// A dónde mandar a la persona para cambiar qué repositorios ve Unfold.
    configure_url: String,
}

#[derive(Deserialize)]
struct RepositoryList {
    repositories: Vec<ApiRepository>,
}

#[derive(Deserialize)]
struct ApiRepository {
    id: u64,
    name: String,
    full_name: String,
    private: bool,
    html_url: String,
    clone_url: String,
    default_branch: String,
    permissions: Option<RepositoryPermissions>,
}

#[derive(Deserialize)]
struct RepositoryPermissions {
    push: bool,
    admin: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepository {
    pub id: u64,
    pub installation_id: u64,
    pub name: String,
    pub full_name: String,
    pub private: bool,
    pub html_url: String,
    pub clone_url: String,
    pub default_branch: String,
    pub can_push: bool,
}

impl GithubRepository {
    fn from_api(repository: ApiRepository, installation_id: u64) -> Self {
        let can_push = repository
            .permissions
            .as_ref()
            .is_some_and(|permissions| permissions.push || permissions.admin);
        Self {
            id: repository.id,
            installation_id,
            name: repository.name,
            full_name: repository.full_name,
            private: repository.private,
            html_url: repository.html_url,
            clone_url: repository.clone_url,
            default_branch: repository.default_branch,
            can_push,
        }
    }
}

#[derive(Deserialize, Serialize)]
struct StoredCredential {
    access_token: String,
    refresh_token: Option<String>,
    access_expires_at: Option<u64>,
    refresh_expires_at: Option<u64>,
}

impl StoredCredential {
    fn needs_refresh(&self, current_time: u64) -> bool {
        self.access_expires_at
            .is_some_and(|expires| expires <= current_time + 60)
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn credential_entry() -> Result<Entry, String> {
    Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER)
        .map_err(|error| format!("No se pudo abrir el almacén seguro: {error}"))
}

fn load_credential() -> Result<Option<StoredCredential>, String> {
    let secret = match credential_entry()?.get_password() {
        Ok(secret) => secret,
        Err(KeyringError::NoEntry) => return Ok(None),
        Err(error) => return Err(format!("No se pudo leer la sesión segura: {error}")),
    };
    serde_json::from_str(&secret)
        .map(Some)
        .map_err(|_| "La sesión segura de GitHub está dañada".to_owned())
}

fn save_credential(credential: &StoredCredential) -> Result<(), String> {
    let secret = serde_json::to_string(credential)
        .map_err(|_| "No se pudo preparar la sesión de GitHub".to_owned())?;
    credential_entry()?
        .set_password(&secret)
        .map_err(|error| format!("No se pudo guardar la sesión segura: {error}"))
}

fn delete_credential() -> Result<(), String> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("No se pudo cerrar la sesión segura: {error}")),
    }
}

fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "GitHub tardó demasiado en responder".to_owned()
    } else if error.is_connect() {
        "No se pudo conectar con GitHub".to_owned()
    } else {
        format!("No se pudo completar la solicitud a GitHub: {error}")
    }
}

async fn current_user(client: &GithubClient, token: &str) -> Result<GithubUser, ApiError> {
    client.get("/user", token).await
}

/// La cuenta conectada, o `None` si no hay sesión. La usa `repositories` para
/// componer la identidad del autor.
pub async fn signed_in_user(client: &GithubClient) -> Result<Option<GithubUser>, String> {
    let Some(token) = client.access_token().await? else {
        return Ok(None);
    };
    match current_user(client, &token).await {
        Ok(user) => Ok(Some(user)),
        Err(ApiError::Unauthorized) => {
            delete_credential()?;
            Ok(None)
        }
        Err(ApiError::Other(error)) => Err(error),
    }
}

#[tauri::command]
pub async fn github_start_device_flow(
    client: State<'_, GithubClient>,
) -> Result<DeviceAuthorization, String> {
    let response = client
        .http()?
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .form(&[("client_id", CLIENT_ID)])
        .send()
        .await
        .map_err(network_error)?;
    let authorization = response
        .json::<DeviceAuthorizationResponse>()
        .await
        .map_err(network_error)?;

    if let Some(error) = authorization.error {
        return Err(authorization
            .error_description
            .unwrap_or_else(|| format!("GitHub rechazó Device Flow: {error}")));
    }

    Ok(DeviceAuthorization {
        device_code: authorization
            .device_code
            .ok_or("GitHub no devolvió el código del dispositivo")?,
        user_code: authorization
            .user_code
            .ok_or("GitHub no devolvió el código de usuario")?,
        verification_uri: authorization
            .verification_uri
            .ok_or("GitHub no devolvió la dirección de autorización")?,
        expires_in: authorization.expires_in.unwrap_or(900),
        interval: authorization.interval.unwrap_or(5),
    })
}

#[tauri::command]
pub async fn github_poll_device_flow(
    client: State<'_, GithubClient>,
    device_code: String,
) -> Result<PollResult, String> {
    let response = client
        .http()?
        .post(ACCESS_TOKEN_URL)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", CLIENT_ID),
            ("device_code", device_code.as_str()),
            (
                "grant_type",
                "urn:ietf:params:oauth:grant-type:device_code",
            ),
        ])
        .send()
        .await
        .map_err(network_error)?;
    let exchange = response
        .json::<TokenExchange>()
        .await
        .map_err(network_error)?;

    if exchange.access_token.is_some() {
        let credential = exchange.into_credential()?;
        let _guard = client.token_lock.lock().await;
        save_credential(&credential)?;
        return Ok(PollResult {
            state: PollState::Authorized,
            retry_after: 0,
        });
    }

    let retry_after = exchange.interval.unwrap_or(5);
    let state = match exchange.error.as_deref() {
        Some("authorization_pending") => PollState::Pending,
        Some("slow_down") => PollState::SlowDown,
        Some("expired_token" | "bad_verification_code") => PollState::Expired,
        Some("access_denied") => PollState::Denied,
        Some(error) => {
            return Err(exchange
                .error_description
                .unwrap_or_else(|| format!("GitHub rechazó la autorización: {error}")))
        }
        None => return Err("GitHub devolvió una respuesta de autorización incompleta".to_owned()),
    };
    Ok(PollResult { state, retry_after })
}

#[tauri::command]
pub async fn github_auth_status(
    client: State<'_, GithubClient>,
) -> Result<GithubAuthStatus, String> {
    let Some(token) = client.access_token().await? else {
        return Ok(GithubAuthStatus {
            connected: false,
            user: None,
            expires_at: None,
            refresh_expires_at: None,
        });
    };

    match current_user(&client, &token).await {
        Ok(user) => {
            let stored = load_credential()?;
            Ok(GithubAuthStatus {
                connected: true,
                user: Some(user),
                expires_at: stored.as_ref().and_then(|value| value.access_expires_at),
                refresh_expires_at: stored.and_then(|value| value.refresh_expires_at),
            })
        }
        Err(ApiError::Unauthorized) => {
            delete_credential()?;
            Ok(GithubAuthStatus {
                connected: false,
                user: None,
                expires_at: None,
                refresh_expires_at: None,
            })
        }
        Err(ApiError::Other(error)) => Err(error),
    }
}

/// Repositorios que la GitHub App tiene concedidos ahora mismo.
///
/// Es la única fuente de verdad sobre qué puede tocar Unfold, y por eso la
/// comparte con `repositories`: conectar un repositorio parte de esta lista y
/// no de lo que diga el frontend, de modo que sólo se pueda clonar algo que
/// GitHub esté concediendo en ese momento.
pub async fn granted_repositories(
    client: &GithubClient,
) -> Result<Vec<GithubRepository>, String> {
    let token = client
        .access_token()
        .await?
        .ok_or("Conecta GitHub antes de listar repositorios")?;

    // Cualquier `401` aquí significa que la sesión dejó de valer: se descarta
    // en vez de dejar al usuario reintentando con una credencial muerta.
    let expired = |error: ApiError| -> String {
        match error {
            ApiError::Unauthorized => {
                let _ = delete_credential();
                "La sesión de GitHub expiró; vuelve a conectarla".to_owned()
            }
            ApiError::Other(error) => error,
        }
    };

    let installations: InstallationList = client
        .get("/user/installations", &token)
        .await
        .map_err(expired)?;

    let mut seen = HashSet::new();
    let mut repositories = Vec::new();
    for installation in installations
        .installations
        .into_iter()
        .filter(|installation| installation.app_id == APP_ID && installation.suspended_at.is_none())
    {
        let mut page = 1;
        loop {
            let path = format!(
                "/user/installations/{}/repositories?per_page=100&page={page}",
                installation.id
            );
            let list: RepositoryList = client.get(&path, &token).await.map_err(expired)?;
            let count = list.repositories.len();
            for repository in list.repositories {
                if seen.insert(repository.id) {
                    repositories.push(GithubRepository::from_api(repository, installation.id));
                }
            }
            if count < 100 {
                break;
            }
            page += 1;
        }
    }

    repositories.sort_by(|left, right| left.full_name.cmp(&right.full_name));
    Ok(repositories)
}

/// Dónde se cambia qué repositorios ve Unfold.
///
/// Con la App ya instalada, la página de esa instalación; sin instalar, la
/// pantalla de instalación, que es la misma donde se eligen repositorios.
fn configure_url(installation_id: Option<u64>) -> String {
    match installation_id {
        Some(id) => format!("https://github.com/settings/installations/{id}"),
        None => format!("https://github.com/apps/{APP_SLUG}/installations/new"),
    }
}

#[tauri::command]
pub async fn github_installation_state(
    client: State<'_, GithubClient>,
) -> Result<InstallationState, String> {
    let Some(token) = client.access_token().await? else {
        return Ok(InstallationState {
            installed: false,
            installation_id: None,
            all_repositories: false,
            configure_url: configure_url(None),
        });
    };

    let installations: InstallationList = match client.get("/user/installations", &token).await {
        Ok(value) => value,
        Err(ApiError::Unauthorized) => {
            delete_credential()?;
            return Err("La sesión de GitHub expiró; vuelve a conectarla".to_owned());
        }
        Err(ApiError::Other(error)) => return Err(error),
    };

    let installation = installations
        .installations
        .into_iter()
        .find(|installation| installation.app_id == APP_ID && installation.suspended_at.is_none());

    Ok(match installation {
        Some(installation) => InstallationState {
            installed: true,
            installation_id: Some(installation.id),
            all_repositories: installation.repository_selection.as_deref() == Some("all"),
            configure_url: configure_url(Some(installation.id)),
        },
        None => InstallationState {
            installed: false,
            installation_id: None,
            all_repositories: false,
            configure_url: configure_url(None),
        },
    })
}

#[tauri::command]
pub async fn github_list_repositories(
    client: State<'_, GithubClient>,
) -> Result<Vec<GithubRepository>, String> {
    granted_repositories(&client).await
}

#[tauri::command]
pub fn github_logout() -> Result<(), String> {
    delete_credential()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refreshes_one_minute_before_expiration() {
        let credential = StoredCredential {
            access_token: "token".to_owned(),
            refresh_token: Some("refresh".to_owned()),
            access_expires_at: Some(1_060),
            refresh_expires_at: Some(2_000),
        };
        assert!(credential.needs_refresh(1_000));
        assert!(!credential.needs_refresh(999));
    }

    #[test]
    fn non_expiring_token_does_not_refresh() {
        let credential = StoredCredential {
            access_token: "token".to_owned(),
            refresh_token: None,
            access_expires_at: None,
            refresh_expires_at: None,
        };
        assert!(!credential.needs_refresh(u64::MAX - 100));
    }

    /// Cubre el formato del cable en sus dos direcciones. Es la clase de
    /// fallo que no aparece hasta que hay alguien autenticado delante.
    #[test]
    fn user_reads_github_names_and_writes_frontend_names() {
        let user: GithubUser = serde_json::from_str(
            r#"{
                "id": 583231,
                "login": "esdrasclth",
                "name": null,
                "avatar_url": "https://avatars.githubusercontent.com/u/1?v=4",
                "html_url": "https://github.com/esdrasclth",
                "type": "User"
            }"#,
        )
        .expect("GitHub envía los nombres en snake_case");

        assert_eq!(user.login, "esdrasclth");
        assert!(user.name.is_none());
        // Sin nombre, el que se enseña es el login; y el correo `noreply` se
        // compone con el identificador numérico, no con el login a secas.
        assert_eq!(user.display_name(), "esdrasclth");
        assert_eq!(
            user.noreply_email(),
            "583231+esdrasclth@users.noreply.github.com"
        );

        let sent = serde_json::to_string(&user).expect("el usuario se serializa");
        assert!(sent.contains("\"avatarUrl\""), "el frontend espera camelCase: {sent}");
        assert!(sent.contains("\"htmlUrl\""), "el frontend espera camelCase: {sent}");
    }

    #[test]
    fn token_exchange_turns_durations_into_instants() {
        let before = now();
        let credential = TokenExchange {
            access_token: Some("access".to_owned()),
            expires_in: Some(28_800),
            refresh_token: Some("refresh".to_owned()),
            refresh_token_expires_in: Some(15_811_200),
            error: None,
            error_description: None,
            interval: None,
        }
        .into_credential()
        .expect("el intercambio traía un token");

        assert_eq!(credential.access_token, "access");
        assert!(credential.access_expires_at.unwrap() >= before + 28_800);
        assert!(credential.refresh_expires_at.unwrap() >= before + 15_811_200);
    }

    /// Una respuesta sin token no debe guardarse: el mensaje de GitHub es lo
    /// único que puede explicarle a la persona por qué no ha entrado.
    #[test]
    fn token_exchange_without_token_reports_github_message() {
        let error = TokenExchange {
            access_token: None,
            expires_in: None,
            refresh_token: None,
            refresh_token_expires_in: None,
            error: Some("access_denied".to_owned()),
            error_description: Some("El usuario canceló".to_owned()),
            interval: None,
        }
        .into_credential();
        // `StoredCredential` no deriva `Debug` a propósito, para que un token
        // no pueda acabar impreso por descuido; de ahí el match en vez de
        // `expect_err`.
        let Err(error) = error else {
            panic!("una respuesta sin token no debe producir credencial");
        };
        assert_eq!(error, "El usuario canceló");
    }

    /// El permiso de escritura decide si el repositorio podrá publicarse; sin
    /// bloque de permisos GitHub no lo está concediendo.
    #[test]
    fn repository_write_access_comes_from_permissions() {
        let build = |permissions| ApiRepository {
            id: 1,
            name: "spike".to_owned(),
            full_name: "esdrasclth/spike".to_owned(),
            private: true,
            html_url: "https://github.com/esdrasclth/spike".to_owned(),
            clone_url: "https://github.com/esdrasclth/spike.git".to_owned(),
            default_branch: "main".to_owned(),
            permissions,
        };
        let permissions = |push, admin| Some(RepositoryPermissions { push, admin });

        assert!(!GithubRepository::from_api(build(None), 7).can_push);
        assert!(!GithubRepository::from_api(build(permissions(false, false)), 7).can_push);
        assert!(GithubRepository::from_api(build(permissions(true, false)), 7).can_push);
        assert!(GithubRepository::from_api(build(permissions(false, true)), 7).can_push);
        assert_eq!(
            GithubRepository::from_api(build(None), 7).installation_id,
            7
        );
    }
}
