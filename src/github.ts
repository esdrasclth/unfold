import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./files.ts";

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type DevicePollState = "pending" | "slow_down" | "authorized" | "expired" | "denied";

export interface DevicePollResult {
  state: DevicePollState;
  retryAfter: number;
}

export interface GithubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
}

export interface GithubAuthStatus {
  connected: boolean;
  user: GithubUser | null;
  /**
   * Caducidad del token de acceso, en segundos Unix. No sirve para avisar de
   * nada: se renueva solo cada pocas horas sin que el usuario intervenga.
   */
  expiresAt: number | null;
  /**
   * Caducidad del token de refresco. Ésta sí acaba la sesión: cuando vence hay
   * que volver a autorizar la aplicación a mano.
   */
  refreshExpiresAt?: number | null;
}

export interface GithubRepository {
  id: number;
  installationId: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  canPush: boolean;
}

/**
 * Estado de la instalación de la GitHub App.
 *
 * Una App sólo ve los repositorios que su instalación le concede y no puede
 * ampliarse a sí misma. Esto es lo que permite darse cuenta de que el acceso
 * está limitado y llevar a la pantalla de GitHub donde se cambia.
 */
export interface InstallationState {
  installed: boolean;
  installationId: number | null;
  /** La instalación da acceso a todos los repositorios de la cuenta. */
  allRepositories: boolean;
  configureUrl: string;
}

function requireDesktop(): void {
  if (!isTauri) throw new Error("La conexión con GitHub requiere la aplicación de escritorio");
}

export async function startGithubDeviceFlow(): Promise<DeviceAuthorization> {
  requireDesktop();
  return invoke<DeviceAuthorization>("github_start_device_flow");
}

export async function pollGithubDeviceFlow(deviceCode: string): Promise<DevicePollResult> {
  requireDesktop();
  return invoke<DevicePollResult>("github_poll_device_flow", { deviceCode });
}

export async function githubAuthStatus(): Promise<GithubAuthStatus> {
  if (!isTauri) return { connected: false, user: null, expiresAt: null };
  return invoke<GithubAuthStatus>("github_auth_status");
}

export async function listGithubRepositories(): Promise<GithubRepository[]> {
  requireDesktop();
  return invoke<GithubRepository[]>("github_list_repositories");
}

export async function githubInstallationState(): Promise<InstallationState> {
  requireDesktop();
  return invoke<InstallationState>("github_installation_state");
}

export async function logoutGithub(): Promise<void> {
  requireDesktop();
  await invoke("github_logout");
}

export async function openGithubUrl(url: string): Promise<void> {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}
