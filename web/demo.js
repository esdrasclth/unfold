/*
 * La animación de la portada, los títulos que se pliegan, el conmutador de la
 * captura y la versión real.
 *
 * La animación reproduce la mecánica del editor y no una idea aproximada de
 * ella: mientras el cursor está en la línea, sus marcadores se ven —atenuados,
 * en monoespaciada— y el texto ya lleva su formato. Cuando el cursor baja a la
 * siguiente, los marcadores se encogen hasta ocupar cero y en su sitio
 * aparecen la viñeta, la casilla o la tabla. Ese es el orden de causas que hay
 * en la aplicación: la línea se pliega porque el cursor la ha dejado.
 */

const GUION = [
  "# Notas de la reunión",
  "Enviamos el informe el **viernes**.",
  "- [x] Repasar los números",
  "- [ ] Escribir el resumen",
  {
    tabla: {
      cabecera: ["Tarea", "Quién", "Día"],
      filas: [
        ["Informe", "Ana", "vie"],
        ["Resumen", "Leo", "lun"],
      ],
    },
  },
  "> Sin prisa, pero sin pausa.",
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
 * Monta una línea vacía y devuelve sus huecos en orden de escritura. Cada
 * hueco lleva su propio nodo de texto, para ir añadiendo caracteres sin borrar
 * el cursor, que vive dentro del elemento.
 */
function construirLinea(fuente) {
  const linea = analizarLinea(fuente);
  const div = document.createElement("div");
  div.className = linea.clase ? `ln ${linea.clase}` : "ln";
  const huecos = [];

  const hueco = (el, texto) => {
    const nodo = document.createTextNode("");
    el.appendChild(nodo);
    div.appendChild(el);
    huecos.push({ el, nodo, texto });
  };

  if (linea.marca) {
    const mk = document.createElement("span");
    mk.className = "mk";
    hueco(mk, linea.marca);
  }

  // La viñeta y la casilla no se escriben: aparecen al plegarse la línea.
  if (linea.pieza) {
    const pieza = document.createElement("span");
    pieza.className = "pieza";
    // Una tarea lleva las dos cosas: sigue siendo un elemento de lista, así que
    // el editor le pone su viñeta y además la casilla.
    const punto = document.createElement("span");
    punto.className = "punto";
    punto.textContent = "• ";
    pieza.appendChild(punto);

    if (linea.pieza.tipo === "caja") {
      const caja = document.createElement("span");
      caja.className = linea.pieza.marcada ? "caja marcada" : "caja";
      pieza.appendChild(caja);
    }
    div.appendChild(pieza);
  }

  for (const trozo of linea.trozos) {
    if (!trozo.marca) {
      hueco(document.createElement("span"), trozo.texto);
      continue;
    }
    const abre = document.createElement("span");
    abre.className = "mk";
    hueco(abre, trozo.marca);

    const cuerpo = document.createElement(trozo.etiqueta);
    if (trozo.clase) cuerpo.className = trozo.clase;
    hueco(cuerpo, trozo.texto);

    const cierra = document.createElement("span");
    cierra.className = "mk";
    hueco(cierra, trozo.marca);
  }

  return { nodo: div, huecos };
}

/**
 * La tabla se escribe con tuberías y luego se cierra sobre sí misma mientras
 * la tabla de verdad se abre debajo. Las dos mitades animan su altura con
 * `grid-template-rows` de 0fr a 1fr, que es lo que permite abrir algo cuya
 * altura no se conoce de antemano sin medirla a mano.
 */
function construirTabla(modelo) {
  const bloque = document.createElement("div");
  bloque.className = "bloque-tabla";

  const fuente = document.createElement("div");
  fuente.className = "tabla-fuente";
  const dentroFuente = document.createElement("div");
  fuente.appendChild(dentroFuente);

  const filasFuente = [
    `| ${modelo.cabecera.join(" | ")} |`,
    `| ${modelo.cabecera.map(() => "---").join(" | ")} |`,
    ...modelo.filas.map((f) => `| ${f.join(" | ")} |`),
  ];

  const huecos = [];
  for (const texto of filasFuente) {
    const ln = document.createElement("div");
    ln.className = "ln";
    const nodo = document.createTextNode("");
    ln.appendChild(nodo);
    dentroFuente.appendChild(ln);
    huecos.push({ el: ln, nodo, texto });
  }

  const hecha = document.createElement("div");
  hecha.className = "tabla-hecha";
  const dentroHecha = document.createElement("div");
  const tabla = document.createElement("table");

  const thead = document.createElement("thead");
  const trCab = document.createElement("tr");
  for (const celda of modelo.cabecera) {
    const th = document.createElement("th");
    th.textContent = celda;
    trCab.appendChild(th);
  }
  thead.appendChild(trCab);
  tabla.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const fila of modelo.filas) {
    const tr = document.createElement("tr");
    for (const celda of fila) {
      const td = document.createElement("td");
      td.textContent = celda;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tabla.appendChild(tbody);

  dentroHecha.appendChild(tabla);
  hecha.appendChild(dentroHecha);
  bloque.append(fuente, hecha);

  // La tabla se escribe más deprisa: son cuatro filas muy parecidas y a ritmo
  // normal el bucle entero se hacía largo de mirar.
  return { nodo: bloque, huecos, ritmo: 15 };
}

function construir(entrada) {
  return typeof entrada === "string" ? construirLinea(entrada) : construirTabla(entrada.tabla);
}

/* ── Reproducción ───────────────────────────────────────────────────────── */

const contenedor = document.getElementById("lineas");
const demo = document.getElementById("demo");
const menosMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/*
 * Una puerta que la animación atraviesa en cada pausa. Mientras la ventana
 * está oculta o la demostración fuera de la pantalla se queda cerrada, y no se
 * gasta un solo fotograma en algo que nadie ve.
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
  for (const entrada of GUION) {
    const { nodo, huecos } = construir(entrada);
    for (const h of huecos) h.nodo.data = h.texto;
    nodo.classList.add("plegada");
    contenedor.appendChild(nodo);
  }
}

async function reproducir() {
  const cursor = document.createElement("span");
  cursor.className = "cursor";

  for (;;) {
    contenedor.textContent = "";
    let anterior = null;

    for (const entrada of GUION) {
      const { nodo, huecos, ritmo } = construir(entrada);
      contenedor.appendChild(nodo);

      // El cursor baja: es esto, y no un temporizador, lo que pliega lo de arriba.
      nodo.appendChild(cursor);
      if (anterior) {
        anterior.classList.add("plegada");
        await pausa(260);
      }

      for (const h of huecos) {
        h.el.appendChild(cursor);
        for (const caracter of h.texto) {
          h.nodo.data += caracter;
          await pausa((ritmo ?? RITMO) + Math.random() * 30);
        }
      }

      await pausa(420);
      anterior = nodo;
    }

    cursor.remove();
    anterior.classList.add("plegada");
    await pausa(3000);
  }
}

if (contenedor) {
  if (menosMovimiento) {
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

/* ── Los títulos de la propia página se despliegan ──────────────────────── */

/*
 * Cada título llega con su `#` o su `##` en el margen y lo suelta al entrar en
 * pantalla. Al pasar el ratón vuelve, que es lo que hace el editor cuando el
 * cursor entra en la línea. Va en el margen y no en el flujo del texto para
 * que aparecer y desaparecer no mueva ni un píxel de lo que se está leyendo.
 */
const titulos = document.querySelectorAll(".titulo");

if (menosMovimiento) {
  for (const titulo of titulos) titulo.classList.add("plegado");
} else {
  const vigilante = new IntersectionObserver(
    (entradas) => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        const espera = Number(entrada.target.dataset.plegar ?? 500);
        setTimeout(() => entrada.target.classList.add("plegado"), espera);
        vigilante.unobserve(entrada.target);
      }
    },
    { threshold: 0.55 },
  );

  for (const titulo of titulos) vigilante.observe(titulo);
}

/* ── Saber si ya se está bajando ────────────────────────────────────────── */

/*
 * Un punto invisible a 90 px del principio. Cuando deja de verse es que el
 * visitante ya ha bajado: la barra se despega del papel y el galón que invita
 * a seguir se retira, porque a partir de ahí sobra.
 *
 * Con un observador y no con un oyente de `scroll`: el navegador avisa solo,
 * sin ejecutar nada en cada píxel de desplazamiento.
 */
const hero = document.querySelector(".hero");
const centinela = document.querySelector(".centinela");

if (centinela) {
  new IntersectionObserver(
    ([entrada]) => {
      const bajando = !entrada.isIntersecting;
      document.documentElement.classList.toggle("desplazado", bajando);
      if (hero) hero.classList.toggle("bajando", bajando);
    },
    { threshold: 0 },
  ).observe(centinela);
}

/* ── Entradas al aparecer ───────────────────────────────────────────────── */

/*
 * Cada grupo lleva su paso de retardo, para que las piezas de una misma fila
 * no entren todas de golpe. El estado oculto se enciende desde aquí y no desde
 * la hoja de estilos: si este guion no llega a ejecutarse, la página se ve
 * entera igualmente.
 */
/*
 * Si la página se abre en una pestaña de fondo no se monta nada: una pestaña
 * que no pinta tampoco entrega observaciones, y montar la entrada allí deja el
 * contenido invisible hasta que alguien mire. Sin animación se ve igual de
 * bien; en blanco, no.
 */
if (!menosMovimiento && !document.hidden) {
  document.documentElement.classList.add("con-animaciones");

  const grupos = [
    [".hero-texto > *", 80],
    [".hero-demo", 0],
    [".pilares article", 90],
    [".captura-cabecera, .bajada, .captura", 70],
    [".lista-larga li", 45],
    [".explicacion-texto, .pares", 110],
    [".pasos li", 90],
    [".aviso", 0],
    [".cierre > *", 90],
  ];

  const alAparecer = new IntersectionObserver(
    (entradas) => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        entrada.target.classList.add("visible");
        alAparecer.unobserve(entrada.target);
      }
    },
    // Un margen negativo abajo para que nada se encienda justo en el borde,
    // cuando todavía no se está mirando.
    { threshold: 0.1, rootMargin: "0px 0px -40px 0px" },
  );

  for (const [selector, paso] of grupos) {
    const piezas = document.querySelectorAll(selector);
    piezas.forEach((pieza, i) => {
      pieza.classList.add("revelar");
      if (paso) pieza.style.setProperty("--retardo", `${i * paso}ms`);
      alAparecer.observe(pieza);
    });
  }

  /*
   * Red de seguridad. Si por lo que sea el observador no llega a entregar
   * nada, lo que queda no es una animación sin hacer: es contenido invisible.
   * Pasados dos segundos se enseña todo lo que ya debería verse.
   */
  setTimeout(() => {
    for (const pieza of document.querySelectorAll(".revelar:not(.visible)")) {
      if (pieza.getBoundingClientRect().top < innerHeight) pieza.classList.add("visible");
    }
  }, 2000);
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
    partes.push("sin instalador de administrador");
    meta.textContent = partes.join(" · ");

    const cierre = document.getElementById("meta-cierre");
    if (cierre) cierre.textContent = `${datos.tag_name} · Windows 10 y 11`;
  } catch {
    // Sin conexión con la API el texto por defecto sigue siendo correcto.
  }
}

mostrarVersion();
