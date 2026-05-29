import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConnectionProfile, ConnectionType } from "../moca/types.js";
import { createClient } from "../moca/factory.js";
import {
  addIfNew,
  createConnection,
  deleteConnection,
  getConnectionInternal,
  getConnectionPublic,
  getDecryptedPassword,
  listConnections,
  updateConnection,
} from "../config/store.js";
import { discoverConnections } from "../config/discovery.js";
import { clearActive, getActive, setActive } from "../session.js";
import { errorResult, jsonResult, textResult, type ToolResult } from "./result.js";

const connectionShape = {
  name: z.string().describe("Friendly name for the connection profile."),
  type: z.enum(["http", "tcp"]).describe("Transport: 'http' (XML over HTTP/HTTPS) or 'tcp' (legacy wire protocol)."),
  url: z.string().optional().describe("HTTP: full service URL, e.g. http://host:4600/service"),
  host: z.string().optional().describe("TCP: hostname."),
  port: z.number().int().optional().describe("TCP: port."),
  username: z.string().describe("MOCA user id."),
  password: z.string().optional().describe("MOCA password (stored encrypted at rest)."),
  timeoutSeconds: z.number().int().positive().optional(),
  trustSSLCertificate: z.boolean().optional().describe("HTTPS only: skip certificate validation."),
  environmentVariables: z.record(z.string(), z.string()).optional().describe("Extra MOCA env vars sent with every request."),
  group: z.string().optional(),
  applId: z.string().optional().describe("Application id (HTTP User-Agent)."),
};

interface InlineTarget {
  connectionId?: string;
  type?: ConnectionType;
  url?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  trustSSLCertificate?: boolean;
  environmentVariables?: Record<string, string>;
  applId?: string;
  timeoutSeconds?: number;
  name?: string;
}

function resolveTarget(input: InlineTarget): { profile: ConnectionProfile; password: string } {
  if (input.connectionId) {
    const profile = getConnectionInternal(input.connectionId);
    if (!profile) throw new Error(`No saved connection with id '${input.connectionId}'.`);
    return { profile, password: getDecryptedPassword(profile) };
  }
  if (!input.type) throw new Error("Provide either 'connectionId' or inline connection details (type, ...).");
  if (!input.username) throw new Error("Inline connection requires 'username'.");
  const profile: ConnectionProfile = {
    id: "",
    name: input.name || `${input.host || input.url || "moca"}`,
    type: input.type,
    url: input.url,
    host: input.host,
    port: input.port,
    username: input.username,
    passwordEnc: "",
    timeoutSeconds: input.timeoutSeconds,
    trustSSLCertificate: input.trustSSLCertificate,
    environmentVariables: input.environmentVariables,
    applId: input.applId,
    source: "Inline",
  };
  return { profile, password: input.password || "" };
}

export function registerConnectionTools(server: McpServer): void {
  server.registerTool(
    "list_connections",
    {
      title: "List connections",
      description: "List saved MOCA connection profiles (secrets are never returned).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async (): Promise<ToolResult> => jsonResult({ connections: listConnections() })
  );

  server.registerTool(
    "get_connection",
    {
      title: "Get connection",
      description: "Get a saved connection profile by id (no secrets).",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }): Promise<ToolResult> => {
      const c = getConnectionPublic(id);
      return c ? jsonResult(c) : errorResult(`No connection with id '${id}'.`);
    }
  );

  server.registerTool(
    "create_connection",
    {
      title: "Create connection",
      description:
        "Save a new connection profile (a reusable 'connection string'). Password is encrypted at rest.",
      inputSchema: connectionShape,
      annotations: { readOnlyHint: false },
    },
    async (input): Promise<ToolResult> => {
      try {
        const created = createConnection(input);
        return jsonResult({ created });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    }
  );

  server.registerTool(
    "update_connection",
    {
      title: "Update connection",
      description: "Update fields of a saved connection profile.",
      inputSchema: {
        id: z.string(),
        name: z.string().optional(),
        type: z.enum(["http", "tcp"]).optional(),
        url: z.string().optional(),
        host: z.string().optional(),
        port: z.number().int().optional(),
        username: z.string().optional(),
        password: z.string().optional(),
        timeoutSeconds: z.number().int().positive().optional(),
        trustSSLCertificate: z.boolean().optional(),
        environmentVariables: z.record(z.string(), z.string()).optional(),
        group: z.string().optional(),
        applId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ id, ...patch }): Promise<ToolResult> => {
      const updated = updateConnection(id, patch);
      return updated ? jsonResult({ updated }) : errorResult(`No connection with id '${id}'.`);
    }
  );

  server.registerTool(
    "delete_connection",
    {
      title: "Delete connection",
      description: "Delete a saved connection profile (local config only).",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id }): Promise<ToolResult> =>
      deleteConnection(id) ? textResult(`Deleted connection '${id}'.`) : errorResult(`No connection with id '${id}'.`)
  );

  const targetShape = {
    connectionId: z.string().optional().describe("Id of a saved connection to use."),
    type: z.enum(["http", "tcp"]).optional(),
    url: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    trustSSLCertificate: z.boolean().optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    name: z.string().optional(),
  };

  server.registerTool(
    "test_connection",
    {
      title: "Test connection",
      description: "Connect and log in to verify a connection works (by saved id or inline details).",
      inputSchema: targetShape,
      annotations: { readOnlyHint: true },
    },
    async (input): Promise<ToolResult> => {
      let target;
      try {
        target = resolveTarget(input);
      } catch (e) {
        return errorResult((e as Error).message);
      }
      try {
        const client = createClient(target.profile, target.password);
        const session = await client.login();
        await client.logout(session);
        return session
          ? textResult(`OK: connected and logged in as '${target.profile.username}'.`)
          : errorResult("Login failed (check host/port/url, username and password).");
      } catch (e) {
        return errorResult(`Connection failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "connect",
    {
      title: "Connect",
      description:
        "Open and activate a MOCA session (by saved id or inline details). Subsequent query/schema tools use this session. Optionally save inline details as a new profile.",
      inputSchema: { ...targetShape, save: z.boolean().optional().describe("Save inline details as a new connection profile.") },
      annotations: { readOnlyHint: false },
    },
    async (input): Promise<ToolResult> => {
      let target;
      try {
        target = resolveTarget(input);
      } catch (e) {
        return errorResult((e as Error).message);
      }
      try {
        if (!input.connectionId && input.save && target.profile.type) {
          const saved = createConnection({
            name: target.profile.name,
            type: target.profile.type,
            url: target.profile.url,
            host: target.profile.host,
            port: target.profile.port,
            username: target.profile.username,
            password: target.password,
            trustSSLCertificate: target.profile.trustSSLCertificate,
            environmentVariables: target.profile.environmentVariables,
            applId: target.profile.applId,
            timeoutSeconds: target.profile.timeoutSeconds,
          });
          target.profile.id = saved.id;
        }
        const client = createClient(target.profile, target.password);
        const sessionKey = await client.login();
        if (!sessionKey) return errorResult("Login failed (check credentials and host/url).");
        const existing = getActive();
        if (existing) {
          try {
            await existing.client.logout(existing.sessionKey);
          } catch {
            /* ignore */
          }
        }
        setActive({ client, profile: target.profile, sessionKey, connectedAt: new Date() });
        return textResult(
          `Connected to '${target.profile.name}' as '${target.profile.username}'` +
            (target.profile.id ? ` (id ${target.profile.id}).` : ".")
        );
      } catch (e) {
        return errorResult(`Connect failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "disconnect",
    {
      title: "Disconnect",
      description: "Close the active MOCA session.",
      inputSchema: {},
      annotations: { readOnlyHint: false },
    },
    async (): Promise<ToolResult> => {
      const active = getActive();
      if (!active) return textResult("No active connection.");
      try {
        await active.client.logout(active.sessionKey);
      } catch {
        /* ignore */
      }
      clearActive();
      return textResult("Disconnected.");
    }
  );

  server.registerTool(
    "get_session_status",
    {
      title: "Session status",
      description: "Show whether a MOCA session is active and which connection it uses.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async (): Promise<ToolResult> => {
      const active = getActive();
      if (!active) return jsonResult({ connected: false });
      return jsonResult({
        connected: true,
        name: active.profile.name,
        type: active.profile.type,
        host: active.profile.host,
        url: active.profile.url,
        username: active.profile.username,
        connectedAt: active.connectedAt.toISOString(),
      });
    }
  );

  server.registerTool(
    "discover_connections",
    {
      title: "Discover connections",
      description:
        "Auto-discover MOCA servers configured on this machine (Windows registry and the RedPrairie client configuration). Optionally save the discovered servers as connection profiles.",
      inputSchema: { save: z.boolean().optional().describe("Save newly discovered servers as connection profiles.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ save }): Promise<ToolResult> => {
      const discovered = discoverConnections();
      let savedCount = 0;
      if (save) {
        for (const d of discovered) {
          const created = addIfNew({
            name: d.name,
            type: d.type,
            url: d.url,
            host: d.host,
            port: d.port,
            username: d.username || "",
            source: d.source,
          });
          if (created) savedCount++;
        }
      }
      return jsonResult({ discovered, savedCount: save ? savedCount : undefined });
    }
  );

  server.registerTool(
    "import_connections",
    {
      title: "Import connections",
      description:
        "Import MOCA connections discovered on this machine into the local profile store (skips duplicates).",
      inputSchema: {},
      annotations: { readOnlyHint: false },
    },
    async (): Promise<ToolResult> => {
      const discovered = discoverConnections();
      const imported: string[] = [];
      for (const d of discovered) {
        const created = addIfNew({
          name: d.name,
          type: d.type,
          url: d.url,
          host: d.host,
          port: d.port,
          username: d.username || "",
          source: d.source,
        });
        if (created) imported.push(created.id);
      }
      return jsonResult({ importedCount: imported.length, importedIds: imported });
    }
  );
}
