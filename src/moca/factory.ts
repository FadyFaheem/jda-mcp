import type { ConnectionProfile, MocaClient } from "./types.js";
import { MocaHttpClient, defaultHttpTimeout } from "./httpClient.js";
import { MocaTcpClient } from "./tcpClient.js";

/** Build the right MOCA client for a profile + decrypted password. */
export function createClient(profile: ConnectionProfile, password: string): MocaClient {
  if (profile.type === "http") {
    if (!profile.url) throw new Error("HTTP connection requires a 'url'.");
    return new MocaHttpClient({
      url: profile.url,
      userId: profile.username,
      password,
      timeoutSeconds: profile.timeoutSeconds ?? defaultHttpTimeout(profile.url),
      trustSSLCertificate: profile.trustSSLCertificate,
      applId: profile.applId,
      extraEnv: profile.environmentVariables,
    });
  }
  if (!profile.host || !profile.port) {
    throw new Error("TCP connection requires 'host' and 'port'.");
  }
  return new MocaTcpClient({
    host: profile.host,
    port: profile.port,
    userId: profile.username,
    password,
    timeoutSeconds: profile.timeoutSeconds ?? 30,
    extraEnv: profile.environmentVariables,
  });
}
