const paths: Record<string, string> = {
  open: '<path d="M3.5 6.5h5.2l1.8 2h9.9v9a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z"/>',
  save: '<path d="M5 4.5h10.5L19.5 8.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5Z"/><path d="M8 4.5v5h6v-5M8 19v-5h8v5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/>',
  moon: '<path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>',
  focus: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.4 15.4 4.3 4.3"/>',
  file: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/>',
  up: '<path d="m7 14 5-5 5 5"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  // Líneas de texto con la del medio resaltada: la que el modo mantiene centrada.
  typewriter: '<path d="M4 7h16M4 17h16" opacity=".45"/><path d="M4 12h11"/><path d="M18.5 10.5v3"/>',
  // Panel lateral: el marco de la ventana con su columna izquierda marcada.
  // Dice "esto abre y cierra el panel de la izquierda", que es lo que hace.
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
  // Controles deslizantes: ajustar la apariencia, no configurar el programa.
  sliders: '<path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>',
  export: '<path d="M12 3.5v11M8.5 7 12 3.5 15.5 7"/><path d="M4.5 14v4.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V14"/>',
  print: '<path d="M7 9V4.5h10V9"/><path d="M5.5 9h13a2 2 0 0 1 2 2v5h-3.5M6 16H2.5v-5a2 2 0 0 1 2-2z" /><path d="M7 14h10v6H7z"/>',
};

/** Devuelve un SVG de 24×24 trazado con currentColor. */
export function icon(name: keyof typeof paths | string): string {
  const body = paths[name] ?? "";
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
