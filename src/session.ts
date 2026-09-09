/**
 * Pestañas, borradores y posición, para volver donde se dejó.
 *
 * En disco y no en `localStorage`: guarda el contenido completo de las
 * pestañas con cambios sin guardar, y compartía cuota con el historial, de
 * modo que un documento grande podía impedir guardar los borradores. Es lo
 * único de la aplicación que custodia texto que todavía no está en ningún
 * archivo, así que era el peor sitio donde podía fallar.
 */

import type { TabSnapshot } from "./tabs.ts";
import { store, type Store } from "./store.ts";

const FORMAT_VERSION = 1;

export interface SessionSnapshot {
  version: number;
  active: number;
  tabs: TabSnapshot[];
}

export async function saveSession(
  snapshot: Omit<SessionSnapshot, "version">,
  en: Store = store,
): Promise<void> {
  try {
    await en.write("session", JSON.stringify({ ...snapshot, version: FORMAT_VERSION }));
  } catch (error) {
    console.error("No se pudo guardar la sesión", error);
  }
}

export async function loadSession(en: Store = store): Promise<SessionSnapshot | null> {
  try {
    const raw = await en.read("session");
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SessionSnapshot>;
    if (value.version !== FORMAT_VERSION || !Array.isArray(value.tabs)) return null;
    const tabs = value.tabs.filter((tab): tab is TabSnapshot =>
      typeof tab === "object" && tab !== null &&
      typeof tab.name === "string" && typeof tab.content === "string" &&
      (typeof tab.path === "string" || tab.path === null) &&
      typeof tab.dirty === "boolean" && Number.isSafeInteger(tab.anchor) &&
      Number.isSafeInteger(tab.head) && Number.isFinite(tab.scrollTop),
    );
    const selected = value.tabs[Number.isSafeInteger(value.active) ? value.active! : 0];
    return tabs.length ? { version: FORMAT_VERSION, active: Math.max(0, tabs.indexOf(selected)), tabs } : null;
  } catch {
    return null;
  }
}

export async function clearSession(en: Store = store): Promise<void> {
  await en.clear("session");
}
