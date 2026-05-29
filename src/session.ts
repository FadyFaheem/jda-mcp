import type { ConnectionProfile, MocaClient } from "./moca/types.js";

export interface ActiveSession {
  client: MocaClient;
  profile: ConnectionProfile;
  sessionKey: string;
  connectedAt: Date;
}

let active: ActiveSession | null = null;

export function getActive(): ActiveSession | null {
  return active;
}

export function setActive(session: ActiveSession): void {
  active = session;
}

export function clearActive(): void {
  active = null;
}
