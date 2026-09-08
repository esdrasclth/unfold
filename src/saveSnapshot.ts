/** Completa sólo el documento que inició el guardado y conserva cambios posteriores. */
export async function saveSnapshot(
  tab: { path: string | null; name: string; dirty: boolean },
  content: string,
  write: () => Promise<string | null>,
  currentContent: () => string,
): Promise<boolean> {
  const target = await write();
  if (!target) return false;
  tab.path = target;
  tab.name = target.split(/[\\/]/).pop() ?? target;
  tab.dirty = currentContent() !== content;
  return true;
}
