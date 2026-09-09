//! Búsqueda de texto en todas las raíces del explorador.
//!
//! `Ctrl+F` busca dentro del documento abierto. Con un árbol de cuarenta
//! archivos delante, lo que hace falta es lo otro: dónde está esa frase, en
//! cuál de todos. El explorador ya sabía enseñar los archivos y filtrarlos por
//! nombre; esto añade filtrar por lo que dicen dentro.
//!
//! Recorre repositorios conectados y carpetas locales por igual, porque para
//! quien busca son lo mismo: sitios donde puede estar lo que escribió.

use serde::Serialize;
use std::path::Path;
use tauri::AppHandle;

/// Cuánto se trae de vuelta.
///
/// Una búsqueda de una letra encuentra decenas de miles de líneas, y ni caben
/// en la pantalla ni sirven de nada: lo que sirve es afinar. Los topes son por
/// archivo y en total, para que un solo archivo enorme no se coma el cupo.
const MAX_POR_ARCHIVO: usize = 20;
const MAX_TOTAL: usize = 300;
/// Más allá de esto la línea se corta: es una lista de resultados, no el texto.
const MAX_LINEA: usize = 300;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    /// Raíz a la que pertenece, para poder agrupar en la interfaz.
    pub root_id: i64,
    pub root_name: String,
    pub path: String,
    pub relative: String,
    /// Empezando en uno, que es como las cuenta quien lee.
    pub line: usize,
    pub text: String,
    /// Dónde empieza y acaba lo encontrado dentro de `text`, para resaltarlo.
    pub from: usize,
    pub to: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchReport {
    pub hits: Vec<Hit>,
    /// Verdadero cuando se llegó al tope y hay más de lo que se enseña.
    pub truncated: bool,
}

/// Una raíz que buscar: de dónde salen sus documentos ya lo sabe quien llama.
pub struct Root {
    pub id: i64,
    pub name: String,
    pub documents: Vec<(String, String)>,
}

/// Busca sin distinguir mayúsculas ni el caso de las tildes ya escritas.
///
/// Se compara en minúsculas y no con expresiones regulares: quien escribe en
/// esta caja busca una frase, no un patrón, y un `(` suelto no puede hacer que
/// la búsqueda falle.
fn buscar_en(texto: &str, aguja: &str, mut hit: impl FnMut(usize, &str, usize, usize)) -> usize {
    let mut encontrados = 0;
    for (numero, linea) in texto.lines().enumerate() {
        if encontrados >= MAX_POR_ARCHIVO {
            break;
        }
        let Some(posicion) = linea.to_lowercase().find(aguja) else {
            continue;
        };
        // `to_lowercase` puede cambiar el número de bytes, así que la posición
        // se busca otra vez sobre el original para no cortar por medio de un
        // carácter. Si no aparece tal cual, se resalta desde el principio.
        let (desde, hasta) = match linea.find(aguja) {
            Some(exacto) => (exacto, exacto + aguja.len()),
            None => (posicion.min(linea.len()), linea.len()),
        };
        let recortada = if linea.len() > MAX_LINEA {
            let corte = linea
                .char_indices()
                .map(|(i, _)| i)
                .take_while(|i| *i <= MAX_LINEA)
                .last()
                .unwrap_or(0);
            &linea[..corte]
        } else {
            linea
        };
        hit(
            numero + 1,
            recortada,
            desde.min(recortada.len()),
            hasta.min(recortada.len()),
        );
        encontrados += 1;
    }
    encontrados
}

fn recorrer(roots: Vec<Root>, aguja: &str) -> SearchReport {
    let mut hits = Vec::new();
    let mut truncated = false;

    'raices: for root in roots {
        for (path, relative) in root.documents {
            if hits.len() >= MAX_TOTAL {
                truncated = true;
                break 'raices;
            }
            // Un archivo ilegible o binario no puede cortar la búsqueda: se
            // salta y se sigue con los demás.
            let Ok(texto) = std::fs::read_to_string(Path::new(&path)) else {
                continue;
            };
            buscar_en(&texto, aguja, |line, text, from, to| {
                hits.push(Hit {
                    root_id: root.id,
                    root_name: root.name.clone(),
                    path: path.clone(),
                    relative: relative.clone(),
                    line,
                    text: text.to_owned(),
                    from,
                    to,
                });
            });
        }
    }

    SearchReport { hits, truncated }
}

#[tauri::command]
pub async fn search_documents(
    app: AppHandle,
    catalog: tauri::State<'_, crate::repositories::Catalog>,
    query: String,
) -> Result<SearchReport, String> {
    let aguja = query.trim().to_lowercase();
    if aguja.is_empty() {
        return Ok(SearchReport {
            hits: Vec::new(),
            truncated: false,
        });
    }

    let mut roots = crate::folders::search_roots(&app)?;
    roots.extend(crate::repositories::search_roots(&app, &catalog)?);

    tauri::async_runtime::spawn_blocking(move || recorrer(roots, &aguja))
        .await
        .map_err(|_| "La búsqueda se interrumpió".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hits_de(texto: &str, aguja: &str) -> Vec<(usize, String, usize, usize)> {
        let mut salida = Vec::new();
        buscar_en(texto, aguja, |line, text, from, to| {
            salida.push((line, text.to_owned(), from, to));
        });
        salida
    }

    #[test]
    fn finds_the_line_and_where_the_match_starts() {
        let texto = "primera línea\nla frase buscada está aquí\núltima\n";
        let hits = hits_de(texto, "frase");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].0, 2, "las líneas se cuentan desde uno");
        assert_eq!(&hits[0].1[hits[0].2..hits[0].3], "frase");
    }

    /// Quien busca escribe como le sale; encontrar sólo lo que coincide en caja
    /// convertiría la búsqueda en un juego de adivinar.
    #[test]
    fn the_search_ignores_case() {
        assert_eq!(hits_de("Una GUÍA de estilo\n", "guía").len(), 1);
        assert_eq!(hits_de("una guía de estilo\n", "guía").len(), 1);
    }

    /// Una letra sola encuentra el documento entero. El tope por archivo es lo
    /// que impide que un archivo se coma la lista de resultados.
    #[test]
    fn there_is_a_ceiling_per_file() {
        let texto = "hay una a aquí\n".repeat(50);
        assert_eq!(hits_de(&texto, "a").len(), MAX_POR_ARCHIVO);
    }

    /// Es una lista de resultados, no un visor: una línea de diez mil
    /// caracteres no puede entrar entera.
    #[test]
    fn very_long_lines_are_cut() {
        let texto = format!("aguja{}\n", "x".repeat(2_000));
        let hits = hits_de(&texto, "aguja");
        assert_eq!(hits.len(), 1);
        assert!(hits[0].1.len() <= MAX_LINEA + 4, "la línea se recorta");
        assert!(hits[0].1.starts_with("aguja"));
    }

    /// Se busca una frase, no un patrón: un paréntesis suelto no puede hacer
    /// que la búsqueda falle ni que encuentre de más.
    #[test]
    fn punctuation_is_literal_not_a_pattern() {
        assert_eq!(hits_de("una funcion(a) aquí\n", "funcion(a)").len(), 1);
        assert_eq!(hits_de("una funcionXaX aquí\n", "funcion(a)").len(), 0);
    }
}
