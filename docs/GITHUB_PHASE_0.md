# GitHub — fase 0

## Objetivo

Validar antes de construir la interfaz que Unfold puede inspeccionar, clonar y
publicar repositorios con un motor Git nativo, y medir el coste que añade al
instalador.

## Almacenamiento decidido

Las rutas se obtendrán con las APIs de directorios de Tauri; no se construirán
a partir de variables de entorno.

```text
%LOCALAPPDATA%\com.esdras.unfold\
├── repositories\
│   └── <github-repository-id>\
│       └── checkout Git completo
└── github-repositories.json
```

- El ID numérico estable de GitHub evita colisiones por renombres o forks.
- `github-repositories.json` contendrá metadatos no sensibles: ID, `owner/name`,
  rama predeterminada, ruta local, URL remota y último uso.
- Access token y refresh token vivirán en Windows Credential Manager bajo el
  servicio `com.esdras.unfold.github`; nunca en el JSON, `localStorage`, logs o
  la URL de `origin`.
- Al desconectar un repositorio se quitará del catálogo, pero borrar su checkout
  será una acción separada y explícita para no perder cambios locales.

## Alcance de la prueba

El módulo `src-tauri/src/git_probe.rs` —hoy `src-tauri/src/git.rs`, ver la
[fase 2](GITHUB_PHASE_2.md)— enlaza las operaciones reales de
libgit2 que afectan al tamaño del binario:

- abrir e inspeccionar un repositorio;
- obtener rama, HEAD y cambios;
- enumerar archivos `.md` versionados desde el índice;
- clonar usando el helper de credenciales configurado;
- hacer push por un refspec explícito.

Su prueba automatizada crea un remoto Git local, clona, modifica dos documentos,
hace commit y push y vuelve a clonar para comprobar el contenido publicado.

## GitHub App de desarrollo

Propietario: cuenta personal `esdrasclth`.

- App ID: `4879959`.
- Client ID público: `Iv23liir06ihq68sjXCi`.
- Slug: `unfold-development-esdrasclth`.

Configuración propuesta:

- Nombre: `Unfold Development` (si está ocupado, `Unfold Development esdrasclth`).
- Homepage: `https://github.com/esdrasclth/unfold`.
- Callback de desarrollo: se definirá al implementar OAuth; no se enviarán
  secretos a un callback no implementado durante esta prueba.
- Webhooks: desactivados.
- Permisos de repositorio: `Contents: Read and write` y `Metadata: Read-only`.
- Permisos restantes: ninguno.
- Instalación: sólo la cuenta personal y sólo un repositorio privado de prueba.

No se debe descargar ni incorporar una clave privada de GitHub App al cliente.
La app de escritorio actuará mediante un token de usuario.

## Criterios de salida

- [x] Prueba local clone/commit/push en verde.
- [x] Instalador release construido antes y después con tamaños registrados.
- [x] GitHub App instalada únicamente en el repositorio privado de prueba.
- [x] Clone autenticado y push confirmado en ese repositorio sin token en remotos.

## Resultados

### Tamaño release

Medición realizada sobre la versión 0.2.3 con libgit2 1.9.7, HTTPS, libgit2 y
OpenSSL enlazados de forma estática.

| Artefacto | Antes | Con motor Git | Diferencia |
| --- | ---: | ---: | ---: |
| `unfold.exe` | 11,186,176 B | 12,355,072 B | +1,168,896 B (+10.4 %) |
| Instalador NSIS | 7,930,763 B | 8,400,406 B | +469,643 B (+5.9 %) |

El instalador se generó correctamente. El comando de release terminó después
con el aviso esperado de que no estaba disponible la clave privada de firma del
updater; esto no afecta al binario ni a la medición del bundle ya producido.

### Validación local

La prueba de entonces creaba un remoto bare temporal y validaba:

1. clone;
2. detección de `.md` desde el índice;
3. modificación y creación de documentos;
4. commit y push;
5. segundo clone y comparación del contenido publicado.

Resultado: 1 prueba Git correcta y 88 pruebas existentes de Unfold correctas.
La fase 2 la sustituyó por un conjunto más amplio sobre el mismo motor, que
sigue cubriendo el push.

### Validación privada en GitHub

- Repositorio: `esdrasclth/unfold-github-spike` (privado).
- Motor: libgit2 1.9.7 mediante Git Credential Manager.
- Rama: `main`.
- Commit publicado: `56198107a38fc64b198b07bce1a2472311f7b424`.
- Archivo publicado: `unfold-phase-0.md`.
- El remoto conservó una URL HTTPS limpia, sin credenciales.

Esta validación confirma el transporte autenticado y el push del motor. Falta
repetir la autenticación usando específicamente la GitHub App de desarrollo,
que requiere crearla desde la configuración web de la cuenta.

### Registro de la GitHub App

La app `Unfold Development esdrasclth` quedó registrada bajo la cuenta personal.
La API de GitHub confirma `Contents: write`, `Metadata: read` y ningún evento
suscrito. Device Flow produjo correctamente un token de usuario para
`esdrasclth`; durante la comprobación el token sólo existió en memoria y se
descartó al terminar el proceso.

La instalación `160203784` usa selección limitada (`selected`) y GitHub confirmó
que su único repositorio accesible es `esdrasclth/unfold-github-spike`.
