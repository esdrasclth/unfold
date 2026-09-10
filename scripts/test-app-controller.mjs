import assert from "node:assert/strict";
import { AppController } from "../src/app/AppController.ts";

const settle = () => new Promise((resolve) => setImmediate(resolve));
let assertions = 0;
const check = (actual, expected, message) => {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
};

function harness(options = {}) {
  const opened = [];
  const saved = [];
  const workspaces = [];
  const published = [];
  const services = {
    documents: {
      open: async () => opened.shift() ?? null,
      save: async (request) => {
        saved.push(request);
        return options.saveTarget === undefined ? request.path : options.saveTarget;
      },
    },
    persistence: {
      load: async () => options.workspace ?? null,
      save: async (workspace) => { workspaces.push(structuredClone(workspace)); },
    },
    repositories: {
      publishDocument: async (path) => { published.push(path); },
    },
    github: {
      session: async () => ({
        connected: true,
        login: "ada",
        name: "Ada Lovelace",
        avatarUrl: "https://example.test/ada.png",
      }),
    },
  };
  const decisions = [...(options.decisions ?? [])];
  const controller = new AppController(services, undefined, {
    confirmClose: async () => decisions.shift() ?? "cancel",
  });
  return { controller, opened, saved, workspaces, published };
}

check(globalThis.document, undefined, "el controlador se carga sin DOM");

{
  const h = harness({ saveTarget: "C:/notas/renombrado.md", decisions: ["discard"] });
  let notifications = 0;
  const unsubscribe = h.controller.store.subscribe(() => { notifications += 1; });
  check(h.controller.store.getState().tabs.length, 1, "empieza con un documento utilizable");

  h.opened.push({ path: "C:/notas/uno.md", name: "uno.md", content: "hola" });
  await h.controller.openFile();
  let state = h.controller.store.getState();
  check(state.tabs.length, 1, "el primer archivo sustituye el borrador intacto");
  check(state.document, {
    name: "uno.md", path: "C:/notas/uno.md", dirty: false, conflict: false,
  });

  h.opened.push({ path: "C:/notas/uno.md", name: "uno.md", content: "no reemplazar" });
  await h.controller.openFile();
  check(h.controller.store.getState().tabs.length, 1, "una ruta abierta no se duplica");

  h.controller.documentChanged("hola, editado");
  check(h.controller.store.getState().document.dirty, true, "CodeMirror puede marcar cambios");
  check(await h.controller.saveFile(true), true, "guardar devuelve el resultado al componente");
  state = h.controller.store.getState();
  check(state.document.path, "C:/notas/renombrado.md", "guardar como actualiza la ruta");
  check(state.document.name, "renombrado.md", "guardar como actualiza el nombre");
  check(state.document.dirty, false, "guardar limpia el indicador");
  check(h.saved[0], {
    path: "C:/notas/uno.md", content: "hola, editado", saveAs: true,
  }, "el servicio recibe datos, no estado de interfaz");

  await h.controller.publish();
  check(h.published, ["C:/notas/renombrado.md"], "publicar usa la ruta activa");
  check(h.controller.store.getState().notice?.kind, "success");

  h.controller.createDocument();
  await settle();
  check(h.controller.store.getState().tabs.length, 2, "crear no reemplaza el documento abierto");
  await h.controller.publish();
  check(h.published.length, 1, "un borrador sin ruta no llega al repositorio");
  check(h.controller.store.getState().notice?.kind, "info");

  h.controller.documentChanged("borrador");
  const draftId = h.controller.store.getState().activeTabId;
  await h.controller.closeTab(draftId);
  check(h.controller.store.getState().tabs.length, 1, "descartar cierra un borrador sucio");

  h.controller.togglePanel("outline");
  check(h.controller.store.getState().panels.outline, true, "el controlador conmuta paneles");
  await h.controller.refreshGithub();
  check(h.controller.store.getState().github, {
    connected: true,
    busy: false,
    login: "ada",
    name: "Ada Lovelace",
    avatarUrl: "https://example.test/ada.png",
  });
  check(notifications > 0, true, "el store notifica cambios");
  check(h.workspaces.length > 0, true, "las acciones programan persistencia");
  unsubscribe();
}

{
  let finishSave;
  const services = {
    documents: {
      open: async () => ({ path: "C:/lento.md", name: "lento.md", content: "antes" }),
      save: async () => new Promise((resolve) => { finishSave = resolve; }),
    },
    persistence: { load: async () => null, save: async () => {} },
    repositories: { publishDocument: async () => {} },
    github: { session: async () => ({ connected: false, login: null, name: null, avatarUrl: null }) },
  };
  const controller = new AppController(services);
  await controller.openFile();
  controller.documentChanged("snapshot");
  const pending = controller.saveFile();
  await settle();
  controller.documentChanged("edición posterior");
  finishSave("C:/lento.md");
  check(await pending, false, "el snapshot escrito no declara guardada una edición posterior");
  check(controller.store.getState().document.dirty, true, "una edición posterior sigue sucia");
}

{
  const workspace = {
    active: 99,
    tabs: [
      { path: "C:/a.md", name: "a.md", dirty: false, content: "a", anchor: 0, head: 0, scrollTop: 0 },
      { path: null, name: "borrador", dirty: true, content: "b", anchor: 1, head: 1, scrollTop: 20 },
    ],
  };
  const h = harness({ workspace });
  await h.controller.restore();
  const state = h.controller.store.getState();
  check(state.tabs.length, 2, "restore reemplaza el documento inicial");
  check(state.document.name, "borrador", "el índice restaurado se limita al rango");
  check(state.document.dirty, true, "el borrador restaurado conserva cambios");
}

console.log(`${assertions} de ${assertions} pruebas del controlador correctas`);
