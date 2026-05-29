import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { XMLParser } from "fast-xml-parser";
import type { ConnectionType } from "../moca/types.js";

export interface DiscoveredConnection {
  name: string;
  type: ConnectionType;
  host?: string;
  port?: number;
  url?: string;
  username?: string;
  source: string;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (name) => name === "MOCAServer",
});

/**
 * Discover MOCA servers already configured on this machine:
 *  - HKLM\SOFTWARE\Mchugh\Client\<env>\MOCA Servers\<server> (HostName/PortNumber)
 *  - %APPDATA%/%PROGRAMDATA%\RedPrairie\DLXClient\DLXClientConfig.xml
 */
export function discoverConnections(): DiscoveredConnection[] {
  const out: DiscoveredConnection[] = [];
  const seen = new Set<string>();
  const add = (c: DiscoveredConnection) => {
    const key = `${c.type}|${c.host || ""}|${c.port || ""}|${c.url || ""}|${c.name}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };

  for (const c of readRegistry()) add(c);
  for (const c of readDlxClientConfigs()) add(c);
  return out;
}

function readRegistry(): DiscoveredConnection[] {
  if (process.platform !== "win32") return [];
  const roots = ["HKLM\\SOFTWARE\\Mchugh\\Client", "HKLM\\SOFTWARE\\WOW6432Node\\Mchugh\\Client"];
  const result: DiscoveredConnection[] = [];
  for (const root of roots) {
    let stdout = "";
    try {
      stdout = execFileSync("reg", ["query", root, "/s"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      continue;
    }
    let currentKey = "";
    const values: Record<string, string> = {};
    const flush = () => {
      if (currentKey && /\\MOCA Servers\\[^\\]+$/i.test(currentKey)) {
        const name = currentKey.split("\\").pop() || values["HostName"] || "";
        const d = toDiscovered(name, values["HostName"] || "", values["PortNumber"] || "", undefined, "Registry");
        if (d) result.push(d);
      }
    };
    for (const line of stdout.split(/\r?\n/)) {
      if (/^HKEY_/i.test(line.trim())) {
        flush();
        currentKey = line.trim();
        for (const k of Object.keys(values)) delete values[k];
      } else {
        const m = /^\s+(\S+)\s+REG_\w+\s+(.*)$/.exec(line);
        if (m) values[m[1]] = m[2].trim();
      }
    }
    flush();
  }
  return result;
}

function readDlxClientConfigs(): DiscoveredConnection[] {
  const candidates: string[] = [];
  const rel = path.join("RedPrairie", "DLXClient", "DLXClientConfig.xml");
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, rel));
  if (process.env.PROGRAMDATA) {
    candidates.push(path.join(process.env.PROGRAMDATA, rel));
    const dir = path.join(process.env.PROGRAMDATA, "RedPrairie", "DLXClient");
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.toLowerCase().endsWith(".xml")) candidates.push(path.join(dir, f));
      }
    } catch {
      /* ignore */
    }
  }

  const result: DiscoveredConnection[] = [];
  for (const file of candidates) {
    let doc: unknown;
    try {
      doc = xml.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const servers = navigate(doc, ["ClientConfig", "MOCAServers", "MOCAServer"]);
    for (const s of asArray(servers)) {
      const obj = s as Record<string, unknown>;
      const host = strOf(obj["HostName"]);
      const port = strOf(obj["PortNumber"]);
      const name = strOf(obj["@_Name"]) || strOf(obj["Name"]) || host;
      const d = toDiscovered(name, host, port, undefined, "DLXClient");
      if (d) result.push(d);
    }
  }
  return result;
}

function navigate(doc: unknown, pathSegs: string[]): unknown {
  let node: unknown = doc;
  for (const seg of pathSegs) {
    if (node == null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

function asArray(v: unknown): unknown[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Classify a discovered entry as http (if HostName is a URL) or tcp (host+port). */
function toDiscovered(
  name: string,
  host: string,
  portStr: string,
  username: string | undefined,
  source: string
): DiscoveredConnection | null {
  if (!host) return null;
  if (/^https?:\/\//i.test(host)) {
    return { name: name || host, type: "http", url: host, username, source };
  }
  const port = parseInt(portStr || "", 10);
  if (!port) return null;
  return { name: name || host, type: "tcp", host, port, username, source };
}

function strOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const t = (v as Record<string, unknown>)["#text"];
    return t == null ? "" : String(t);
  }
  return String(v);
}
