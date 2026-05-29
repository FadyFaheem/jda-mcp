import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { ConnectionProfile, ConnectionType } from "../moca/types.js";
import { decryptSecret, encryptSecret } from "./crypto.js";

export function configDir(): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    path.join(os.homedir(), ".config");
  return path.join(base, "jda-moca-mcp");
}

function configPath(): string {
  return path.join(configDir(), "connections.json");
}

interface StoreFile {
  connections: ConnectionProfile[];
}

function load(): StoreFile {
  try {
    const data = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    if (data && Array.isArray(data.connections)) return data as StoreFile;
  } catch {
    /* default below */
  }
  return { connections: [] };
}

function save(store: StoreFile): void {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(store, null, 2), { mode: 0o600 });
}

/** Connection profile without secrets, safe to return to the client/AI. */
export interface PublicConnection {
  id: string;
  name: string;
  type: ConnectionType;
  url?: string;
  host?: string;
  port?: number;
  username: string;
  hasPassword: boolean;
  timeoutSeconds?: number;
  trustSSLCertificate?: boolean;
  group?: string;
  applId?: string;
  source?: string;
}

function redact(c: ConnectionProfile): PublicConnection {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    url: c.url,
    host: c.host,
    port: c.port,
    username: c.username,
    hasPassword: !!c.passwordEnc,
    timeoutSeconds: c.timeoutSeconds,
    trustSSLCertificate: c.trustSSLCertificate,
    group: c.group,
    applId: c.applId,
    source: c.source,
  };
}

export function listConnections(): PublicConnection[] {
  return load().connections.map(redact);
}

export function getConnectionInternal(id: string): ConnectionProfile | undefined {
  return load().connections.find((c) => c.id === id);
}

export function getConnectionPublic(id: string): PublicConnection | undefined {
  const c = getConnectionInternal(id);
  return c ? redact(c) : undefined;
}

export function getDecryptedPassword(c: ConnectionProfile): string {
  return c.passwordEnc ? decryptSecret(c.passwordEnc, configDir()) : "";
}

export interface UpsertInput {
  name: string;
  type: ConnectionType;
  url?: string;
  host?: string;
  port?: number;
  username: string;
  password?: string;
  timeoutSeconds?: number;
  trustSSLCertificate?: boolean;
  environmentVariables?: Record<string, string>;
  group?: string;
  applId?: string;
  autoCommit?: boolean;
  source?: string;
}

export function createConnection(input: UpsertInput): PublicConnection {
  const store = load();
  const profile: ConnectionProfile = {
    id: randomUUID(),
    name: input.name,
    type: input.type,
    url: input.url,
    host: input.host,
    port: input.port,
    username: input.username,
    passwordEnc: input.password ? encryptSecret(input.password, configDir()) : "",
    timeoutSeconds: input.timeoutSeconds,
    trustSSLCertificate: input.trustSSLCertificate,
    environmentVariables: input.environmentVariables,
    group: input.group,
    applId: input.applId,
    autoCommit: input.autoCommit,
    source: input.source ?? "Manual",
  };
  store.connections.push(profile);
  save(store);
  return redact(profile);
}

export function updateConnection(
  id: string,
  patch: Partial<UpsertInput>
): PublicConnection | undefined {
  const store = load();
  const existing = store.connections.find((c) => c.id === id);
  if (!existing) return undefined;
  if (patch.name !== undefined) existing.name = patch.name;
  if (patch.type !== undefined) existing.type = patch.type;
  if (patch.url !== undefined) existing.url = patch.url;
  if (patch.host !== undefined) existing.host = patch.host;
  if (patch.port !== undefined) existing.port = patch.port;
  if (patch.username !== undefined) existing.username = patch.username;
  if (patch.password) existing.passwordEnc = encryptSecret(patch.password, configDir());
  if (patch.timeoutSeconds !== undefined) existing.timeoutSeconds = patch.timeoutSeconds;
  if (patch.trustSSLCertificate !== undefined) existing.trustSSLCertificate = patch.trustSSLCertificate;
  if (patch.environmentVariables !== undefined) existing.environmentVariables = patch.environmentVariables;
  if (patch.group !== undefined) existing.group = patch.group;
  if (patch.applId !== undefined) existing.applId = patch.applId;
  if (patch.autoCommit !== undefined) existing.autoCommit = patch.autoCommit;
  save(store);
  return redact(existing);
}

export function deleteConnection(id: string): boolean {
  const store = load();
  const before = store.connections.length;
  store.connections = store.connections.filter((c) => c.id !== id);
  if (store.connections.length === before) return false;
  save(store);
  return true;
}

/** Add a discovered/imported connection if an equivalent one isn't already saved. */
export function addIfNew(input: UpsertInput): PublicConnection | null {
  const store = load();
  const dup = store.connections.find(
    (c) =>
      c.type === input.type &&
      (c.url || "") === (input.url || "") &&
      (c.host || "") === (input.host || "") &&
      (c.port || 0) === (input.port || 0) &&
      c.username === input.username
  );
  if (dup) return null;
  return createConnection(input);
}
