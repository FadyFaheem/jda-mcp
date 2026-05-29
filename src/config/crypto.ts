import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

interface DpapiModule {
  Dpapi: {
    protectData(data: Uint8Array, entropy: Uint8Array | null, scope: string): Uint8Array;
    unprotectData(data: Uint8Array, entropy: Uint8Array | null, scope: string): Uint8Array;
  };
  isPlatformSupported: boolean;
}

let dpapi: DpapiModule | null = null;
try {
  dpapi = require("@primno/dpapi") as DpapiModule;
} catch {
  dpapi = null;
}

const DPAPI_PREFIX = "dpapi:";
const AES_PREFIX = "aesgcm:";

export function isDpapiActive(): boolean {
  return !!(dpapi && dpapi.isPlatformSupported);
}

/** Encrypt a secret for at-rest storage. Prefers Windows DPAPI (CurrentUser). */
export function encryptSecret(plain: string, configDir: string): string {
  if (!plain) return "";
  if (dpapi && dpapi.isPlatformSupported) {
    const enc = dpapi.Dpapi.protectData(Buffer.from(plain, "utf8"), null, "CurrentUser");
    return DPAPI_PREFIX + Buffer.from(enc).toString("base64");
  }
  // Fallback: AES-256-GCM with a machine-local key file (non-Windows dev only).
  const key = getOrCreateAesKey(configDir);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return AES_PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(envelope: string, configDir: string): string {
  if (!envelope) return "";
  if (envelope.startsWith(DPAPI_PREFIX)) {
    if (!dpapi || !dpapi.isPlatformSupported) {
      throw new Error("This secret was encrypted with Windows DPAPI but DPAPI is unavailable here.");
    }
    const data = Buffer.from(envelope.slice(DPAPI_PREFIX.length), "base64");
    return Buffer.from(dpapi.Dpapi.unprotectData(data, null, "CurrentUser")).toString("utf8");
  }
  if (envelope.startsWith(AES_PREFIX)) {
    const key = getOrCreateAesKey(configDir);
    const raw = Buffer.from(envelope.slice(AES_PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  }
  // Unknown/legacy plaintext.
  return envelope;
}

function getOrCreateAesKey(configDir: string): Buffer {
  const keyPath = path.join(configDir, ".keyfile");
  try {
    const existing = fs.readFileSync(keyPath);
    if (existing.length === 32) return existing;
  } catch {
    /* create below */
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}
