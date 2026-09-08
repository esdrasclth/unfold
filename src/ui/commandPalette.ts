export interface CommandAction {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void;
}

export function openCommandPalette(actions: readonly CommandAction[]): void {
  closeCommandPalette();
  const backdrop = document.createElement("div");
  backdrop.className = "command-palette-backdrop";
  const dialog = document.createElement("div");
  dialog.className = "command-palette";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Paleta de comandos");
  const input = document.createElement("input");
  input.className = "command-palette-input";
  input.placeholder = "Buscar una acción…";
  input.setAttribute("aria-label", "Buscar comandos");
  const list = document.createElement("div");
  list.className = "command-palette-list";
  const render = () => {
    list.replaceChildren();
    const query = input.value.trim().toLowerCase();
    actions.filter((a) => !query || a.label.toLowerCase().includes(query)).forEach((action, index) => {
      const button = document.createElement("button");
      button.className = "command-palette-item";
      button.type = "button";
      button.textContent = action.label;
      if (action.shortcut) button.title = action.shortcut;
      button.dataset.index = String(index);
      button.addEventListener("click", () => { closeCommandPalette(); action.run(); });
      list.append(button);
    });
  };
  input.addEventListener("input", render);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCommandPalette();
    if (event.key === "Enter") list.querySelector<HTMLButtonElement>("button")?.click();
    if (event.key === "ArrowDown") { event.preventDefault(); list.querySelector<HTMLButtonElement>("button")?.focus(); }
  });
  list.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (event.key === "ArrowDown") { event.preventDefault(); (target.nextElementSibling as HTMLButtonElement | null)?.focus(); }
    if (event.key === "ArrowUp") { event.preventDefault(); ((target.previousElementSibling as HTMLButtonElement | null) ?? input).focus(); }
  });
  backdrop.addEventListener("mousedown", (event) => { if (event.target === backdrop) closeCommandPalette(); });
  dialog.append(input, list);
  backdrop.append(dialog);
  document.body.append(backdrop);
  render();
  input.focus();
}

export function closeCommandPalette(): void {
  document.querySelector(".command-palette-backdrop")?.remove();
}
