/*
 * La animación de la portada, el conmutador de la captura y la versión real.
 *
 * La animación reproduce la mecánica del editor y no una idea aproximada de
 * ella: mientras el cursor está en la línea, sus marcadores se ven —atenuados,
 * en monoespaciada— y el texto ya lleva su formato. Cuando el cursor baja a la
 * línea siguiente, los marcadores se encogen hasta ocupar cero y en su sitio
 * aparecen la viñeta o la casilla. Ese es exactamente el orden de causas que
 * hay en la aplicación: la línea se pliega porque el cursor la ha dejado.
 */

const GUION = [
  "# Notas de la reunión",
  "Enviamos el informe el **viernes**.",
  "- [x] Revisar los números",
  "- [ ] Escribir el resumen",
  "> Sin prisa, pero sin pausa.",
  "Se publica con `npm run release`.",
];

const RITMO = 27; // milisegundos por carácter, más una pizca de azar

/** Marcadores de principio de línea. El orden importa: `- [x]` antes que `-`. */
function analizarLinea(fuente) {
  const patrones = [
    { re: /^(#{1,6}) /, clase: (m) => "h" + m[1].length },
    { re: /^> /, clase: () => "cita" },
    { re: /^- \[([ xX])\] /, pieza: (m) => ({ tipo: "caja", marcada: m[1] !== " " }) },
    { re: /^- /, pieza: () => ({ tipo: "punto" }) },
  ];

  for (const patron of patrones) {
    const m = patron.re.exec(fuente);
    if (!m) continue;
    return {
      clase: patron.clase ? patron.clase(m) : "",
      marca: m[0],
      pieza: patron.pieza ? patron.pieza(m) : null,
      trozos: analizarEnLinea(fuente.slice(m[0].length)),
    };
  }

  return { clase: "", marca: "", pieza: null, trozos: analizarEnLinea(fuente) };
}

/** Negrita, cursiva y código; es todo lo que necesita el guion. */
function analizarEnLinea(texto) {
  const trozos = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let desde = 0;
  let m;

  while ((m = re.exec(texto)) !== null) {
    if (m.index > desde) trozos.push({ texto: texto.slice(desde, m.index) });
    if (m[1] !== undefined) trozos.push({ marca: "**", etiqueta: "strong", texto: m[1] });
    else if (m[2] !== undefined) trozos.push({ marca: "*", etiqueta: "em", texto: m[2] });
    else trozos.push({ marca: "`", etiqueta: "span", clase: "cod", texto: m[3] });
    desde = m.index + m[0].length;
  }

  if (desde < texto.length) trozos.push({ texto: texto.slice(desde) });
  return trozos;
}

/**
 * Monta la línea entera vacía y devuelve los huecos en orden de escritura.
 * Cada hueco lleva su propio nodo de texto, para poder ir añadiendo caracteres
 * sin borrar el cursor, que vive dentro del elemento.
 */
function construir(linea) {
  const div = document.createElement("div");
  div.className = linea.clase ? `ln ${linea.clase}` : "ln";
  const huecos = [];

  const hueco = (el) => {
    const nodo = document.createTextNode("");
    el.appendChild(nodo);
    div.appendChild(el);
    huecos.push({ el, nodo, texto: "" });
    return huecos[huecos.length - 1];
  };

  if (linea.marca) {
    const mk = document.createElement("span");
    mk.className = "mk";
    hueco(mk).texto = linea.marca;
  }

  // La viñeta y la casilla no se escriben: aparecen al plegarse la línea.
  if (linea.pieza) {
    const pieza = document.createElement("span");
    pieza.className = "pieza";
    if (linea.pieza.tipo === "punto") {
      pieza.classList.add("punto");
      pieza.textContent = "• ";
    } else {
      const caja = document.createElement("span");
      caja.className = linea.pieza.marcada ? "caja marcada" : "caja";
      pieza.appendChild(caja);
    }
    div.appendChild(pieza);
  }

  for (const trozo of linea.trozos) {
    if (!trozo.marca) {
      hueco(document.createElement("span")).texto = trozo.texto;
      continue;
    }
    const abre = document.createElement("span");
    abre.className = "mk";
    hueco(abre).texto = trozo.marca;

    const cuerpo = document.createElement(trozo.etiqueta);
    if (trozo.clase) cuerpo.className = trozo.clase;
    hueco(cuerpo).texto = trozo.texto;

    const cierra = document.createElement("span");
    cierra.className = "mk";
    hueco(cierra).texto = trozo.marca;
  }

  return { div, huecos };
}

/* ── Reproducción ───────────────────────────────────────────────────────── */

const contenedor = document.getElementById("lineas");
const demo = document.getElementById("demo");

/*
 * Una puerta que la animación atraviesa en cada pausa. Mientras la ventana
 * está oculta o la demostración fuera de la pantalla se queda cerrada, y no
 * se gasta un solo fotograma en algo que nadie ve.
 */
let abrir = null;
let puerta = Promise.resolve();

function cerrarPuerta() {
  if (!abrir) puerta = new Promise((resolver) => (abrir = resolver));
}

function abrirPuerta() {
  if (abrir) {
    abrir();
    abrir = null;
  }
}

async function pausa(ms) {
  await new Promise((resolver) => setTimeout(resolver, ms));
  await puerta;
}

function estatico() {
  for (const fuente of GUION) {
    const { div, huecos } = construir(analizarLinea(fuente));
    for (const h of huecos) h.nodo.data = h.texto;
    div.classList.add("plegada");
    contenedor.appendChild(div);
  }
}

async function reproducir() {
  const cursor = document.createElement("span");
  cursor.className = "cursor";

  for (;;) {
    contenedor.textContent = "";
    let anterior = null;

    for (const fuente of GUION) {
      const { div, huecos } = construir(analizarLinea(fuente));
      contenedor.appendChild(div);

      // El cursor baja: es esto, y no un temporizador, lo que pliega la de arriba.
      div.appendChild(cursor);
      if (anterior) {
        anterior.classList.add("plegada");
        await pausa(240);
      }

      for (const h of huecos) {
        h.el.appendChild(cursor);
        for (const caracter of h.texto) {
          h.nodo.data += caracter;
          await pausa(RITMO + Math.random() * 30);
        }
      }

      await pausa(430);
      anterior = div;
    }

    cursor.remove();
    anterior.classList.add("plegada");
    await pausa(2800);
  }
}

if (contenedor) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    estatico();
  } else {
    new IntersectionObserver(
      ([entrada]) => (entrada.isIntersecting ? abrirPuerta() : cerrarPuerta()),
      { threshold: 0.15 },
    ).observe(demo);

    const segunVisibilidad = () => (document.hidden ? cerrarPuerta() : abrirPuerta());
    document.addEventListener("visibilitychange", segunVisibilidad);
    // Y el estado de partida: si la pestaña se abre en segundo plano el evento
    // no llega nunca, y sin esto la animación se consumiría sin que nadie la vea.
    segunVisibilidad();

    reproducir();
  }
}

/* ── Conmutador de la captura ───────────────────────────────────────────── */

const captura = document.getElementById("captura");
const botones = document.querySelectorAll(".conmutador button");

// Se precarga la otra para que el cambio sea instantáneo y no parpadee.
if (captura) new Image().src = "captura-oscuro.png";

for (const boton of botones) {
  boton.addEventListener("click", () => {
    for (const otro of botones) otro.classList.toggle("activo", otro === boton);
    captura.src = `captura-${boton.dataset.tema}.png`;
  });
}

/* ── Versión publicada ──────────────────────────────────────────────────── */

/*
 * Enriquece el texto de debajo del botón con la versión real. El enlace ya
 * apunta a la descarga correcta sin necesidad de esto, así que si la API de
 * GitHub falla o agota su límite de peticiones, no se pierde nada.
 */
async function mostrarVersion() {
  const meta = document.getElementById("meta");
  if (!meta) return;

  try {
    const respuesta = await fetch(
      "https://api.github.com/repos/esdrasclth/unfold/releases/latest",
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!respuesta.ok) return;

    const datos = await respuesta.json();
    const exe = (datos.assets ?? []).find((a) => a.name === "Unfold-Setup.exe");
    const partes = [datos.tag_name, "Windows 10 y 11"];
    if (exe) partes.push(`${(exe.size / 1048576).toFixed(1).replace(".", ",")} MB`);
    partes.push("gratis y de código abierto");
    meta.textContent = partes.join(" · ");
  } catch {
    // Sin conexión con la API el texto por defecto sigue siendo correcto.
  }
}

mostrarVersion();
