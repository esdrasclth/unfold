# Publicar una versión

Sólo para quien mantiene el proyecto. Las actualizaciones automáticas dependen
de que estos pasos se hagan bien: una release mal montada deja a las
instalaciones existentes sin poder actualizarse.

## La clave de firma

La aplicación sólo instala actualizaciones firmadas con la clave privada del
proyecto. Tauri verifica la firma con la clave pública que va incrustada en
`src-tauri/tauri.conf.json` antes de tocar nada, de modo que quien pudiera
suplantar el servidor no puede colar otra cosa en su lugar.

La clave privada vive en `~/.unfold/updater.key` y **no está en el
repositorio**, ni debe estarlo nunca.

> **Si se pierde, no hay recuperación.** Ninguna instalación existente podrá
> volver a actualizarse, porque la firma dejaría de validar. Habría que
> distribuir una versión nueva a mano y pedir a cada usuario que reinstale.
> Guarda una copia en un gestor de contraseñas o en un disco aparte.

Para publicar desde CI, la clave va como secreto en la variable
`TAURI_SIGNING_PRIVATE_KEY`.

## Pasos

**1. Subir la versión** en `src-tauri/tauri.conf.json` y en `package.json`, y
actualizar la versión y la lista de novedades de `src/release.json`. Sincronizar
también `setup/package.json`, ambos `Cargo.toml`, los archivos lock y
`setup/src-tauri/tauri.conf.json`. El instalador empotra el NSIS correspondiente
a su versión de Cargo. Las tres
versiones deben coincidir: la compilación se detiene si alguna queda atrasada.

La bienvenida se muestra una vez por versión instalada, así que escribe allí
las características que realmente cambian para quien acaba de actualizar.

**2. Compilar firmando:**

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$HOME\.unfold\updater.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run release:setup
```

**Ojo con PowerShell 5.1**: `$env:VAR = ""` no crea la variable vacía, la
**borra**, de modo que el recetario de arriba deja la contraseña sin definir y
la compilación falla. Comprobarlo con `Test-Path env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD`,
que debe dar `True`. Desde un shell POSIX no hay problema, porque ahí el prefijo
sí la pasa vacía:

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.unfold/updater.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=   npm run release:setup
```

La segunda variable hace falta **aunque la clave no tenga contraseña**. Si no se
define, Tauri la pide por consola, y en una terminal sin entrada interactiva
—un agente, un paso de CI— lee lo que haya y falla con
`incorrect updater private key password: Wrong password for that key`. El
mensaje induce a pensar que la clave está perdida, y no lo está: para
descartarlo, compara `~/.unfold/updater.key.pub` con el `pubkey` de
`src-tauri/tauri.conf.json`, que deben ser idénticos.

De ahí salen tres artefactos:

| Archivo | Para qué |
| --- | --- |
| `setup/src-tauri/target/release/unfold-setup.exe` | Lo que descarga la gente |
| `src-tauri/target/release/bundle/nsis/Unfold_x.y.z_x64-setup.exe` | Lo que usa el actualizador |
| `…/Unfold_x.y.z_x64-setup.exe.sig` | La firma de ese instalador |

Si no aparece el `.sig`, la clave no se cargó: comprueba la variable. Sin él, la
release no sirve para actualizar.

**3. Escribir `latest.json`**, que es el manifiesto que la aplicación consulta:

```json
{
  "version": "0.2.0",
  "notes": "Qué ha cambiado, en una o dos líneas",
  "pub_date": "2026-09-07T19:45:46Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<el contenido entero del archivo .sig>",
      "url": "https://github.com/esdrasclth/unfold/releases/download/v0.2.0/Unfold_0.2.0_x64-setup.exe"
    }
  }
}
```

La primera línea de `notes` es la que se ve en la franja de aviso dentro de la
aplicación, así que conviene que se entienda sola.

**4. Crear la release** con los cuatro archivos adjuntos: el instalador con
interfaz, el NSIS, su `.sig` y el `latest.json`.

```powershell
gh release create v0.2.0 `
  "Unfold-Setup.exe" `
  "Unfold_0.2.0_x64-setup.exe" `
  "Unfold_0.2.0_x64-setup.exe.sig" `
  "latest.json" `
  --title "Unfold 0.2.0" --notes-file NOTAS.md
```

## Comprobar que funciona

La aplicación lee el manifiesto de
`releases/latest/download/latest.json`, así que **la release debe estar marcada
como «latest»** —no como borrador ni como prerelease— o el actualizador no la
verá.

Con una versión anterior instalada, ábrela y espera unos segundos: debe
aparecer la franja de aviso. La comprobación se hace una vez al día; para
forzarla en una prueba hay que borrar la clave `unfold:ultima-comprobacion` del
almacenamiento local.

## La CSP no puede llevar nonce en `style-src`

Al compilar, Tauri analiza los recursos del frontend y endurece la CSP
inyectando `nonce` y hashes. Si lo hace sobre `style-src`, **rompe la
aplicación instalada**: por especificación, un nonce hace que
`'unsafe-inline'` se ignore por completo, y con él se van los estilos que la
aplicación inyecta en caliente —el tema de CodeMirror y los estilos en línea
con los que se aplican las preferencias—.

El síntoma no parece de CSP: la ventana abre, pero el editor no se desplaza,
la columna pierde su ancho, y el tamaño y el interlineado del panel de
apariencia no hacen nada. En desarrollo no se ve, porque el frontend se sirve
desde Vite y la CSP no se aplica igual; sólo aparece compilando e instalando.

Por eso `style-src` va en `dangerousDisableAssetCspModification`, y hay una
prueba —`scripts/test-csp.mjs`— que salta si alguien lo quita mientras
`'unsafe-inline'` siga ahí.

El IPC va aparte: viaja por su propio protocolo, así que `connect-src` tiene
que permitir `ipc:` y `http://ipc.localhost`. Sin eso, la llamada se bloquea y
Tauri cae a un respaldo por `postMessage` que funciona, pero por el camino
lento y llenando la consola de errores.

## Para inspeccionar una compilación de release

Las devtools van desactivadas, pero el puerto de depuración de WebView2 no
depende de Tauri:

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 \
  ./src-tauri/target/release/unfold.exe
```

Y se conecta uno a `http://127.0.0.1:9223/json/list`. Es la única forma de ver
los errores de CSP de la aplicación empaquetada, que es donde aparecen.

## El endpoint tiene que ser HTTPS

Si `plugins.updater.endpoints` apunta a `http`, **la aplicación ni siquiera
arranca**: se aborta al inicio, y en compilación de release el error es mudo.
Es deliberado, porque un canal en claro permitiría a cualquiera en la red servir
una actualización falsa. Sólo se puede saltar con
`dangerousInsecureTransportProtocol`, que no debe llegar nunca a una versión
publicada.
