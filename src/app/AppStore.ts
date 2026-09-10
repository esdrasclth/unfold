import type { AppState } from "./AppState.ts";

export type AppStateListener = (state: AppState) => void;

/** Store mínimo observable; no conoce Preact, DOM ni persistencia. */
export class AppStore {
  private state: AppState;
  private readonly listeners = new Set<AppStateListener>();

  constructor(initial: AppState) {
    this.state = initial;
  }

  getState(): AppState {
    return this.state;
  }

  setState(next: AppState): void {
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  update(reducer: (state: AppState) => AppState): void {
    this.setState(reducer(this.state));
  }

  subscribe(listener: AppStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
