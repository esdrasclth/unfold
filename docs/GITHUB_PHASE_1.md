# GitHub — fase 1

Identidad y seguridad. La fase 0 demostró que el motor Git podía clonar y
publicar; ésta pone la sesión de GitHub dentro de Unfold, guarda el token donde
Windows lo protege y enseña qué repositorios ha autorizado la persona.

Continúa desde [GITHUB_PHASE_0.md](GITHUB_PHASE_0.md).

## Qué entra en esta fase

- Iniciar y cerrar sesión desde la aplicación.
- Guardar el token en Windows Credential Manager.
- Renovarlo solo y descartarlo cuando ya no sirve.
- Listar los repositorios que la GitHub App tiene concedidos.

Clonar, editar y publicar quedan para la fase siguiente: aquí el listado sólo
informa; tocar un repositorio lo abre en GitHub.

## Por qué Device Flow y no PKCE

El plan pedía OAuth con PKCE. GitHub no lo ofrece: su autorización web para
aplicaciones de escritorio sigue exigiendo el *client secret* en el canje del
código, y un secreto incrustado en un instalador que cualquiera puede abrir no
es un secreto. PKCE existe justamente para no necesitarlo, pero GitHub no lo
acepta.

Device Flow resuelve el mismo problema por otra vía y es lo que GitHub
recomienda para clientes públicos:

- Unfold sólo envía su Client ID, que es público por definición.
- El código se autoriza en el navegador, en `github.com`, no en una ventana
  incrustada donde la contraseña pasaría por delante de la aplicación.
- No hace falta abrir un servidor local ni registrar un esquema `unfold://`,
  con lo que tampoco hay un callback que otro programa pueda interceptar.
- La persona ve y confirma exactamente qué cuenta autoriza.

La contrapartida es teclear ocho caracteres. A cambio no hay ningún secreto que
proteger en el cliente.

## Cómo queda el flujo

1. `github_start_device_flow` pide a GitHub el par de códigos. El diálogo
   muestra el código de usuario y abre `https://github.com/login/device`.
2. `github_poll_device_flow` consulta con el intervalo que marca GitHub y
   respeta `slow_down` sumando cinco segundos. El diálogo deja de consultar
   cuando caduca el código, cuando se cancela en GitHub o al cerrarse.
3. Autorizado, el token se guarda cifrado por Windows y la interfaz pasa al
   estado conectado.
4. `github_auth_status` confirma la identidad contra `/user`.
5. `github_list_repositories` recorre las instalaciones de esta App y pagina
   sus repositorios.
6. `github_logout` borra la credencial del equipo.

## Almacenamiento del token

Windows Credential Manager, servicio `com.esdras.unfold.github`, usuario
`oauth`, mediante `keyring`. El contenido es un JSON con el token de acceso, el
de renovación y sus dos caducidades.

Lo que no ocurre en ningún momento:

- el token no llega al frontend: los comandos devuelven identidad y
  repositorios, nunca la credencial;
- no se escribe en `localStorage`, ni en la sesión, ni en el catálogo de
  repositorios;
- no se imprime: `StoredCredential` no deriva `Debug` a propósito, y hay una
  prueba que depende de ello;
- no se guarda dentro de la URL de `origin`, como ya se comprobó en la fase 0.

## Renovación

Los tokens de usuario de una GitHub App caducan a las ocho horas y su token de
renovación a los seis meses. `access_token()` renueva sin que nadie lo pida,
un minuto antes de la caducidad, y serializa la operación con un `Mutex` para
que dos peticiones simultáneas no gasten dos veces el mismo token de
renovación.

La credencial se borra sola cuando ya no puede servir: si caducó y no hay token
de renovación, si el de renovación también caducó, si GitHub rechaza el canje o
si la API responde `401`. En todos esos casos la aplicación vuelve al estado
desconectado en vez de quedarse con una sesión que no funciona.

## Revocación

Cerrar sesión borra la credencial de este equipo. No revoca la autorización en
GitHub, y el diálogo lo dice: la API de revocación exige autenticarse con el
client secret de la App, que por lo explicado arriba el cliente no tiene.

Para revocar de verdad, el pie del diálogo enlaza a
`https://github.com/settings/installations`, donde se puede quitar el acceso o
desinstalar la App. Si eso ocurre, la siguiente llamada devuelve `401` y Unfold
descarta la credencial.

## Alcance de lo que se ve

El listado sólo incluye instalaciones cuyo `app_id` es el de Unfold y que no
estén suspendidas. No se pide `/user/repos`: eso mostraría todos los
repositorios de la cuenta, y Unfold no debe conocer ninguno que no se le haya
concedido. Cada fila indica si es privado, su rama predeterminada y si hay
permiso de escritura, que es lo que decidirá en la fase 2 si puede publicarse.

## Interfaz

- Botón de GitHub en la barra de título, encendido cuando hay sesión.
- `Ctrl+Shift+H` y la entrada «Conectar o revisar GitHub» de la paleta.
  `Ctrl+Shift+G` no servía: dentro del editor ya es «buscar anterior».
- Al arrancar se comprueba el estado con retraso y en silencio. Sin red el
  botón se queda apagado y el editor no se entera.
- Fuera de la aplicación de escritorio el diálogo lo explica y no llama a nada.

## Pruebas

`cargo test` — 7 correctas:

- renovación un minuto antes de caducar, y token sin caducidad que no se renueva;
- el canje convierte duraciones en instantes para los dos tokens;
- una respuesta sin token devuelve el mensaje de GitHub y ninguna credencial;
- el permiso de escritura sale de `push` o `admin`, y su ausencia no lo concede;
- el usuario se lee en `snake_case` y se escribe en `camelCase`.

`npm test` — 88 correctas, sin cambios respecto a la fase 0.
`npm run build` — comprobación de tipos y empaquetado correctos.

Lo que no cubren las pruebas automáticas, por depender de GitHub: el sondeo
completo del Device Flow, la renovación real y la respuesta `401`. Se validaron
a mano contra `esdrasclth/unfold-github-spike`.

## Dos fallos que sólo aparecieron al ejecutar

Ninguno de los dos lo detectaban las pruebas, y conviene que queden anotados
porque los dos son de la misma familia: contratos que sólo se comprueban en
tiempo de ejecución.

**El editor no arrancaba.** `reqwest` viene enlazado con `rustls-no-provider`,
que deja la elección del proveedor criptográfico al programa; construir un
cliente sin haber instalado uno provoca un pánico. `tauri-plugin-updater`
instala `ring` cuando le toca, pero el cliente de GitHub se construía antes.
Ahora `GithubClient::new()` lo instala, y `rustls` está declarado con
`default-features = false` porque sus valores por omisión traerían aws-lc-rs,
un segundo proveedor que en Windows además exige NASM.

El pánico sólo destapó el fallo de fondo: preparar GitHub no puede impedir que
se abra un editor de Markdown. `GithubClient::new()` ya no devuelve `Result`;
guarda un `Option<Client>` y el error sale por el diálogo de GitHub, que es
donde estorba y donde se puede explicar.

**Ningún usuario se podía decodificar.** `GithubUser` sirve a dos formatos —
entra desde GitHub, sale hacia el frontend — y llevaba un `rename_all` sin
dirección, que serde aplica también al leer. GitHub envía `avatar_url`; el
`Deserialize` exigía `avatarUrl`. El renombrado va ahora sólo en la
serialización, y hay una prueba que recorre las dos direcciones. Por lo mismo
se le quitó a `RepositoryPermissions` un `Serialize` que nadie usaba: era la
misma trampa esperando a que alguien añadiera un campo de dos palabras.

## Criterios de salida

- [x] Iniciar sesión desde la aplicación con Device Flow.
- [x] Token en Windows Credential Manager y fuera del frontend.
- [x] Renovación automática y descarte de credenciales inservibles.
- [x] Cierre de sesión local con ruta clara a la revocación en GitHub.
- [x] Listado limitado a los repositorios concedidos a la App.

## Siguiente

Fase 2: clonar un repositorio del listado en
`%LOCALAPPDATA%\com.esdras.unfold\repositories\<id>`, abrir sus `.md` en
pestañas y escribir `github-repositories.json` con los metadatos que la fase 0
dejó definidos.
