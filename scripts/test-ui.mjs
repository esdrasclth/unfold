/** Pruebas DOM de los flujos donde habían escapado regresiones visuales. */
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

const { window } = parseHTML("<!doctype html><html><body></body></html>");
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async () => {} } });
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
for (const name of ["Node", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Event"]) {
  globalThis[name] = window[name];
}
window.Element.prototype.scrollIntoView = () => {};

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const repository = {
  id: 7,
  fullName: "unfold/notas",
  defaultBranch: "main",
  cloneUrl: "https://github.com/unfold/notas.git",
  private: true,
  canPush: true,
  path: "C:\\repos\\notas",
  lastUsed: 1,
  branch: "main",
  head: "abc",
  changed: 1,
  ahead: 0,
  behind: 0,
  hasUpstream: true,
  missing: false,
};
const documents = [{
  path: "C:\\repos\\notas\\guia.md",
  relative: "guia.md",
  tracked: true,
  state: "modified",
}];

const calls = [];
let changesFingerprint = "abc:blob:old";
const replies = {
  github_connected_repositories: () => [repository],
  github_repository_documents: () => documents,
  github_repository_state: () => repository,
  github_repository_changes: () => [{
    relative: "guia.md",
    state: "modified",
    deleted: false,
    staged: false,
    fingerprint: changesFingerprint,
  }],
  github_repository_diff: ({ expanded }) => ({
    relative: "guia.md",
    binary: false,
    fingerprint: "abc:blob:reviewed",
    truncated: !expanded,
    additions: 1,
    deletions: 1,
    shownLines: 6,
    totalLines: expanded ? 6 : 9,
    patch: "diff --git a/guia.md b/guia.md\n--- a/guia.md\n+++ b/guia.md\n@@ -1 +1 @@\n-viejo\n+nuevo\n",
  }),
  github_publish: () => ({
    commit: "123456789",
    advance: "upToDate",
    pushed: true,
    problem: null,
    repository,
  }),
  github_commit_identity: () => ({ name: "Ada", email: "ada@example.com", source: "gitConfig" }),
  github_auth_status: () => ({
    connected: true,
    user: { login: "ada", name: "Ada", avatarUrl: "avatar.png", htmlUrl: "https://github.com/ada" },
    expiresAt: null,
  }),
  github_list_repositories: () => [],
  github_installation_state: () => ({
    installed: true,
    installationId: 1,
    allRepositories: true,
    configureUrl: "https://github.com/settings/installations/1",
  }),
  github_touch_repository: () => undefined,
  github_logout: () => undefined,
};
window.__TAURI_INTERNALS__ = {
  invoke: async (command, args) => {
    calls.push([command, args]);
    if (!(command in replies)) throw new Error(`Invocación sin sustituir: ${command}`);
    return replies[command](args);
  },
};

const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};
const key = (value) => {
  const event = new window.Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "key", { value });
  return event;
};

const { confirmDialog } = await import("../src/ui/confirmDialog.ts");
const { openGithubDialog } = await import("../src/ui/githubDialog.ts");
const { openCommitDialog } = await import("../src/ui/commitDialog.ts");
const { RepositoryPanel } = await import("../src/ui/repositoryPanel.ts");
const { TabBar } = await import("../src/ui/tabBar.ts");

// GitHub: cuenta y acciones están arriba; Escape pertenece al modal superior.
openGithubDialog();
await flush();
assert.ok(document.querySelector(".github-content")?.firstElementChild?.classList.contains("github-account"));
document.querySelector(".github-more").dispatchEvent(new window.Event("click", { bubbles: true }));
document.querySelector('[data-action="logout"]').dispatchEvent(new window.Event("click", { bubbles: true }));
await flush();
assert.ok(document.querySelector(".dialog-backdrop"));
document.dispatchEvent(key("Escape"));
await flush();
assert.equal(document.querySelector(".dialog-backdrop"), null);
assert.ok(document.querySelector(".github-backdrop"), "Escape no debe cerrar el diálogo inferior");
document.querySelector(".github-close").dispatchEvent(new window.Event("click", { bubbles: true }));

// Commit: escribir/marcar conserva el textarea y cada archivo abre un diff legible.
openCommitDialog(repository);
await flush();
const textarea = document.querySelector(".commit-message");
textarea.value = "Aclara la guía";
textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
const checkbox = document.querySelector('.commit-change input[type="checkbox"]');
checkbox.checked = false;
checkbox.dispatchEvent(new window.Event("change", { bubbles: true }));
assert.equal(document.querySelector(".commit-message"), textarea, "marcar no debe reconstruir el campo de mensaje");
document.querySelector(".commit-change-name").dispatchEvent(new window.Event("click", { bubbles: true }));
await flush();
assert.equal(document.querySelector(".commit-diff-line.is-deletion")?.textContent, "-viejo");
assert.equal(document.querySelector(".commit-diff-line.is-addition")?.textContent, "+nuevo");
// El recuento va en la fila y no dentro del desplegable, para que siga a la
// vista con el diff plegado; y el galón dice si la fila está abierta.
assert.equal(document.querySelector(".commit-change-count")?.textContent, "+1 −1");
assert.equal(document.querySelector(".commit-diff-summary"), null);
assert.equal(document.querySelector(".commit-change-name")?.getAttribute("aria-expanded"), "true");
assert.ok(document.querySelector(".commit-chevron"), "la fila anuncia que se despliega");
document.querySelector(".commit-diff-more").dispatchEvent(new window.Event("click", { bubbles: true }));
await flush();
assert.equal(calls.findLast(([command]) => command === "github_repository_diff")[1].expanded, true);
assert.equal(document.querySelector(".commit-diff-more"), null);
const upper = confirmDialog("Confirmar", "¿Cerrar?", [{ label: "Cancelar", value: "cancel", cancel: true }]);
document.dispatchEvent(key("Escape"));
assert.equal(await upper, "cancel");
assert.ok(document.querySelector(".commit-dialog"));
changesFingerprint = "abc:blob:fresh";
document.querySelector(".commit-refresh").dispatchEvent(new window.Event("click", { bubbles: true }));
await flush();
assert.equal(document.querySelector(".commit-message").value, "Aclara la guía");
assert.equal(document.querySelector('.commit-change input[type="checkbox"]').checked, false);
const diffReads = calls.filter(([command]) => command === "github_repository_diff").length;
document.querySelector(".commit-change-name").dispatchEvent(new window.Event("click", { bubbles: true }));
await flush();
assert.equal(calls.filter(([command]) => command === "github_repository_diff").length, diffReads + 1);
const refreshedCheckbox = document.querySelector('.commit-change input[type="checkbox"]');
refreshedCheckbox.checked = true;
refreshedCheckbox.dispatchEvent(new window.Event("change", { bubbles: true }));
document.querySelector(".commit-actions .github-primary").dispatchEvent(new window.Event("click", { bubbles: true }));
await flush();
const publishCall = calls.findLast(([command]) => command === "github_publish");
assert.deepEqual(publishCall[1].paths, [{ relative: "guia.md", fingerprint: "abc:blob:reviewed" }]);
document.querySelector(".github-close").dispatchEvent(new window.Event("click", { bubbles: true }));

// Panel: cachea documentos, actualiza sólo uno y expone crear dentro del repo.
const root = document.createElement("aside");
document.body.append(root);
let created = null;
const panel = new RepositoryPanel(root, {
  onOpen: () => {},
  onManage: () => {},
  onPublish: () => {},
  onCreate: (value) => { created = value; },
  watchRepositories: false,
});
await panel.refresh();
const readsAfterFirstLoad = calls.filter(([command]) => command === "github_repository_documents").length;
await panel.refresh();
assert.equal(calls.filter(([command]) => command === "github_repository_documents").length, readsAfterFirstLoad);
root.querySelector(".repos-create").dispatchEvent(new window.Event("click", { bubbles: true }));
assert.equal(created, repository);
// El pie arranca sin cuenta y se rellena cuando llega la sesión; la foto puede
// no cargar nunca, así que la inicial tiene que estar debajo pase lo que pase.
assert.ok(root.querySelector(".repos-account-anon"), "sin sesión, el hueco lleva el octocat");
panel.setAccount({
  connected: true,
  user: { login: "ada", name: "Ada Lovelace", avatarUrl: "avatar.png", htmlUrl: "" },
  expiresAt: null,
});
assert.equal(root.querySelector("#repos-account-name").textContent, "Ada Lovelace");
assert.equal(root.querySelector(".repos-account-initial").textContent, "A");
assert.ok(root.querySelector("#repos-manage").classList.contains("is-connected"));
// Cuenta y contador comparten renglón: el pie no puede crecer.
assert.equal(root.querySelector("#repos-account-meta").textContent, "@ada · 1 repositorio");

// El aviso sustituye a la línea en vez de añadir otra, y sólo lo dispara el
// token de refresco: el de acceso se renueva solo y avisar de él sería mentir.
const enDias = (dias) => Math.floor(Date.now() / 1000) + dias * 86400;
const sesion = (refreshExpiresAt) => ({
  connected: true,
  user: { login: "ada", name: "Ada Lovelace", avatarUrl: "", htmlUrl: "" },
  expiresAt: enDias(0),
  refreshExpiresAt,
});
panel.setAccount(sesion(enDias(120)));
assert.equal(root.querySelector("#repos-account-meta").textContent, "@ada · 1 repositorio");
assert.equal(root.querySelector("#repos-manage").classList.contains("is-expiring"), false);
panel.setAccount(sesion(enDias(3)));
assert.equal(root.querySelector("#repos-account-meta").textContent, "La sesión caduca en 3 días");
assert.ok(root.querySelector("#repos-manage").classList.contains("is-expiring"));
panel.setAccount(sesion(enDias(-1)));
assert.equal(
  root.querySelector("#repos-account-meta").textContent,
  "La sesión ha caducado: vuelve a conectar",
);
await panel.refreshPath(documents[0].path);
assert.equal(calls.at(-2)[0], "github_repository_state");
assert.equal(calls.at(-1)[0], "github_repository_documents");

// Watcher: una recarga no duplica observadores y dispose los detiene.
const watchedRoot = document.createElement("aside");
let watchStarts = 0;
let watchStops = 0;
let watchedCallback = null;
const watchedPanel = new RepositoryPanel(watchedRoot, {
  onOpen: () => {},
  onManage: () => {},
  onPublish: () => {},
  onCreate: () => {},
  watch: async (_path, callback) => {
    watchStarts += 1;
    watchedCallback = callback;
    return () => { watchStops += 1; };
  },
});
await watchedPanel.refresh();
await flush();
await watchedPanel.refresh();
await flush();
assert.equal(watchStarts, 1);
const statesBeforeDispose = calls.filter(([command]) => command === "github_repository_state").length;
watchedPanel.dispose();
assert.equal(watchStops, 1);
watchedCallback({ paths: ["C:\\repos\\notas\\guia.md"], type: "any" });
await flush();
assert.equal(calls.filter(([command]) => command === "github_repository_state").length, statesBeforeDispose);

// La única pestaña conserva su aspa y se puede cerrar con ratón.
const tabsRoot = document.createElement("div");
let closed = null;
new TabBar(tabsRoot, { activate: () => {}, close: (id) => { closed = id; } }).render(
  [{ id: 3, name: "guia.md", path: null, dirty: false, state: {} }],
  3,
);
assert.ok(tabsRoot.querySelector(".tab-close"));
tabsRoot.querySelector(".tab-close").dispatchEvent(new window.Event("click", { bubbles: true }));
assert.equal(closed, 3);

console.log("41 de 41 pruebas DOM de interfaz correctas");
