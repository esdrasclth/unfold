import { versionsFor, type LocalVersion } from "../history.ts";
export function openHistoryDialog(key: string, current: string, restore: (content: string) => void): void {
  const versions = versionsFor(key); const backdrop = document.createElement("div"); backdrop.className = "history-backdrop";
  const dialog = document.createElement("div"); dialog.className = "history-dialog"; dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-label", "Historial local");
  const title = document.createElement("h2"); title.textContent = "Historial local"; dialog.append(title);
  const list = document.createElement("div"); list.className = "history-list";
  let selected = versions[0];
  const show = (version: LocalVersion) => { selected = version; const pre = dialog.querySelector("pre"); if (pre) pre.textContent = version.content; };
  versions.forEach((version) => { const button = document.createElement("button"); button.type = "button"; button.className = "history-item"; button.textContent = new Date(version.savedAt).toLocaleString("es"); button.addEventListener("click", () => show(version)); list.append(button); });
  const preview = document.createElement("pre"); preview.textContent = versions[0]?.content ?? current; preview.className = "history-preview";
  const compare = document.createElement("button"); compare.textContent = "Comparar con actual"; compare.addEventListener("click", () => {
    if (!selected) return;
    const a = current.split("\n"); const b = selected.content.split("\n");
    preview.textContent = b.map((line, i) => line === a[i] ? `  ${line}` : `- ${a[i] ?? ""}\n+ ${line}`).join("\n");
  });
  const restoreButton = document.createElement("button"); restoreButton.textContent = "Restaurar versión seleccionada"; restoreButton.addEventListener("click", () => { if (selected) { restore(selected.content); backdrop.remove(); } });
  const close = document.createElement("button"); close.textContent = "Cerrar"; close.addEventListener("click", () => backdrop.remove());
  dialog.append(list, preview, compare, restoreButton, close); backdrop.append(dialog); backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) backdrop.remove(); }); document.body.append(backdrop);
}
