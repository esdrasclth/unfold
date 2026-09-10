import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { AppState } from "./AppState.ts";
import type { AppActions } from "./commands.ts";

export interface AppContextValue {
  state: AppState;
  actions: AppActions;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("AppContext no está montado");
  return value;
}
