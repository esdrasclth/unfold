import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";

/**
 * Instalador de Unfold.
 *
 * La interfaz es HTML y CSS; por debajo ejecuta el instalador NSIS en modo
 * silencioso, que es quien hace el trabajo de verdad: registro, accesos
 * directos, asociación de los `.md` y desinstalador. Así se gana el diseño sin
 * reescribir la maquinaria, que es la parte que conviene no tocar.
 */

const VERSION = "0.1.1";

const icono = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
  punto:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  carpeta:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 6.5h5.2l1.8 2h9.9v9a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z"/></svg>',
  cerrar:
    '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="m2 2 8 8M10 2l-8 8"/></svg>',
};

/** Ilustración del panel: un documento con marcas de Markdown desplegándose. */
const arte = `
<svg viewBox="0 0 260 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="72" cy="118" r="46" fill="#b4572a" opacity=".16"/>
  <g transform="rotate(-4 130 100)">
    <rect x="72" y="34" width="118" height="146" rx="9" fill="#faf9f7"/>
    <path d="M172 34h18l-18 18z" fill="#e2ded6"/>
    <text x="88" y="66" font-family="Georgia, serif" font-size="15" fill="#b4572a">#</text>
    <rect x="104" y="56" width="58" height="9" rx="4.5" fill="#c9c4bb"/>
    <text x="88" y="92" font-family="Georgia, serif" font-size="13" fill="#b4572a">##</text>
    <rect x="110" y="83" width="52" height="8" rx="4" fill="#d5d0c7"/>
    <circle cx="92" cy="112" r="2.6" fill="#b4572a"/>
    <rect x="102" y="108" width="60" height="7" rx="3.5" fill="#ddd8cf"/>
    <circle cx="92" cy="130" r="2.6" fill="#b4572a"/>
    <rect x="102" y="126" width="46" height="7" rx="3.5" fill="#ddd8cf"/>
    <circle cx="92" cy="148" r="2.6" fill="#b4572a"/>
    <rect x="102" y="144" width="54" height="7" rx="3.5" fill="#ddd8cf"/>
  </g>
  <g transform="rotate(7 214 60)">
    <rect x="188" y="40" width="46" height="34" rx="8" fill="#2a2825"/>
    <text x="211" y="63" font-family="Georgia, serif" font-size="17" fill="#faf9f7" text-anchor="middle">**</text>
  </g>
  <g transform="rotate(-8 48 168)">
    <rect x="22" y="150" width="56" height="32" rx="8" fill="#2a2825"/>
    <text x="50" y="171" font-family="Georgia, serif" font-size="14" fill="#faf9f7" text-anchor="middle">[ ]( )</text>
  </g>
</svg>`;

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <aside class="panel">
    <h2 class="panel-name">Unfold</h2>
    <p class="panel-tagline">Escribe en Markdown.<br />Lee un documento.</p>
    <div class="panel-rule"></div>
    <div class="panel-art">${arte}</div>
    <p class="panel-foot">Editor de código<br />abierto</p>
  </aside>

  <main class="main">
    <div class="titlebar" data-tauri-drag-region>
      <button class="close" id="cerrar" title="Cerrar" aria-label="Cerrar">${icono.cerrar}</button>
    </div>

    <nav class="steps" id="pasos">
      <span class="step is-active" data-step="0">01</span>
      <span class="step" data-step="1">02</span>
      <span class="step" data-step="2">03</span>
    </nav>

  <section class="pane is-current" data-pane="0">
      <h1>Te damos la bienvenida</h1>
      <p class="lead">
        Un editor Markdown que se ve como el documento final mientras escribes,
        sin panel dividido y sin tocar tus archivos.
      </p>
      <ul class="points">
        <li>${icono.punto}<span>Vista previa en vivo: la sintaxis se oculta y reaparece bajo el cursor</span></li>
        <li>${icono.punto}<span>Tus <code>.md</code> siguen siendo texto plano: nada se reescribe al guardar</span></li>
        <li>${icono.punto}<span>Arranca en menos de medio segundo y ocupa unos 5 MB</span></li>
      </ul>
      <div class="actions">
        <button class="btn is-primary" data-ir="1">Continuar</button>
      </div>
      <button class="text-link" id="mostrar-desinstalar" type="button">¿Ya tienes Unfold? Desinstalar</button>
      <p class="footnote">Versión ${VERSION} · Windows 10 y 11</p>
    </section>

    <section class="pane" data-pane="1">
      <h1>Todo listo para comenzar</h1>
      <p class="lead">Instala la aplicación y empieza a escribir sin distracciones.</p>

      <div class="field">
        <label class="field-label" for="ruta">Ubicación de instalación</label>
        <div class="field-row">
          <input id="ruta" spellcheck="false" />
          <button class="browse" id="elegir" title="Elegir carpeta" aria-label="Elegir carpeta">${icono.carpeta}</button>
        </div>
      </div>

      <div class="options">
        <label class="check">
          <input type="checkbox" id="escritorio" checked />
          <span class="box">${icono.check}</span>
          <span>Crear acceso directo en el escritorio</span>
        </label>
        <label class="check">
          <input type="checkbox" id="abrir" checked />
          <span class="box">${icono.check}</span>
          <span>Abrir Unfold al finalizar</span>
        </label>
      </div>

      <div class="actions">
        <button class="btn is-quiet" data-ir="0">Atrás</button>
        <button class="btn is-primary" id="instalar">Instalar</button>
      </div>
      <p class="footnote" id="pie-tamano">Versión ${VERSION}</p>
    </section>

    <section class="pane" data-pane="2">
      <h1 id="titulo-final">Instalando</h1>
      <p class="lead" id="lead-final">Esto tarda unos segundos.</p>
      <div class="progress" id="barra"><span></span></div>
      <p class="status" id="estado">Copiando archivos…</p>
      <div id="fallo"></div>
      <div class="actions">
        <button class="btn is-primary" id="listo" disabled>Listo</button>
      </div>
      <p class="footnote">Versión ${VERSION}</p>
    </section>

    <section class="pane" data-pane="3">
      <h1>Desinstalar Unfold</h1>
      <p class="lead">Quita la aplicación de este equipo. Tus documentos Markdown no se borrarán.</p>
      <label class="check uninstall-option"><input type="checkbox" id="borrar-datos" /><span class="box">${icono.check}</span><span>Borrar también preferencias y datos locales</span></label>
      <div class="actions"><button class="btn is-quiet" id="cancelar-desinstalar">Cancelar</button><button class="btn is-danger" id="desinstalar">Desinstalar</button></div>
    </section>
  </main>
`;

const el = {
  pasos: [...document.querySelectorAll<HTMLElement>(".step")],
  panes: [...document.querySelectorAll<HTMLElement>(".pane")],
  ruta: document.querySelector<HTMLInputElement>("#ruta")!,
  escritorio: document.querySelector<HTMLInputElement>("#escritorio")!,
  abrir: document.querySelector<HTMLInputElement>("#abrir")!,
  instalar: document.querySelector<HTMLButtonElement>("#instalar")!,
  listo: document.querySelector<HTMLButtonElement>("#listo")!,
  barra: document.querySelector<HTMLElement>("#barra")!,
  estado: document.querySelector<HTMLElement>("#estado")!,
  fallo: document.querySelector<HTMLElement>("#fallo")!,
  titulo: document.querySelector<HTMLElement>("#titulo-final")!,
  lead: document.querySelector<HTMLElement>("#lead-final")!,
  tamano: document.querySelector<HTMLElement>("#pie-tamano")!,
  desinstalar: document.querySelector<HTMLButtonElement>("#desinstalar")!,
  borrarDatos: document.querySelector<HTMLInputElement>("#borrar-datos")!,
};

let instalado = false;

function mostrar(indice: number): void {
  el.panes.forEach((pane, i) => pane.classList.toggle("is-current", i === indice));
  el.pasos.forEach((step, i) => {
    step.classList.toggle("is-active", i === indice);
    step.classList.toggle("is-done", i < indice);
  });
}

for (const boton of document.querySelectorAll<HTMLElement>("[data-ir]")) {
  boton.addEventListener("click", () => mostrar(Number(boton.dataset.ir)));
}

document.querySelector("#cerrar")!.addEventListener("click", () => {
  void getCurrentWindow().close();
});
document.querySelector("#mostrar-desinstalar")!.addEventListener("click", () => mostrar(3));
document.querySelector("#cancelar-desinstalar")!.addEventListener("click", () => mostrar(0));
el.desinstalar.addEventListener("click", () => void (async () => {
  el.desinstalar.disabled = true;
  try { await invoke("desinstalar", { destino: el.ruta.value, borrarDatos: el.borrarDatos.checked }); await getCurrentWindow().close(); }
  catch (error) { el.desinstalar.disabled = false; alert(String(error)); }
})());

document.querySelector("#elegir")!.addEventListener("click", () => {
  void (async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const elegida = await open({ directory: true, defaultPath: el.ruta.value });
    if (typeof elegida === "string") el.ruta.value = elegida;
  })();
});

el.instalar.addEventListener("click", () => {
  void instalar();
});

el.listo.addEventListener("click", () => {
  void (async () => {
    if (instalado && el.abrir.checked) await invoke("abrir_unfold", { destino: el.ruta.value });
    await getCurrentWindow().close();
  })();
});

async function instalar(): Promise<void> {
  mostrar(2);
  el.fallo.innerHTML = "";
  el.listo.disabled = true;
  el.barra.classList.remove("is-done");
  el.estado.textContent = "Copiando archivos…";

  try {
    await invoke("instalar", {
      destino: el.ruta.value,
      accesoDirecto: el.escritorio.checked,
    });
    instalado = true;
    el.barra.classList.add("is-done");
    el.titulo.textContent = "Unfold está listo";
    el.lead.textContent = "Ya puedes escribir. Encontrarás la aplicación en el menú de inicio.";
    el.estado.textContent = `Instalado en ${el.ruta.value}`;
    el.listo.textContent = el.abrir.checked ? "Abrir Unfold" : "Cerrar";
  } catch (error) {
    el.barra.classList.add("is-done");
    el.titulo.textContent = "No se pudo instalar";
    el.lead.textContent = "El instalador no llegó a terminar.";
    el.estado.textContent = "";
    // Se enseña el motivo tal cual: un instalador que falla en silencio deja
    // al usuario sin nada que hacer.
    el.fallo.innerHTML = `<p class="error">${String(error)}</p>`;
    el.listo.textContent = "Cerrar";
  } finally {
    el.listo.disabled = false;
  }
}

// Estado inicial que depende del sistema
void (async () => {
  el.ruta.value = await invoke<string>("destino_por_defecto");
  const megas = await invoke<number>("tamano_instalador");
  el.tamano.textContent = `Versión ${VERSION} · ${megas} MB`;
})();
