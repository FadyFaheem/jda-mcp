import http from "node:http";
import https from "node:https";
import { XMLParser } from "fast-xml-parser";
import type { MocaCell, MocaClient, QueryResult } from "./types.js";
import { coerceMocaValue } from "./coerce.js";
import { sqlQuote, xmlEscape, xmlEscapeContent } from "./util.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === "column" || name === "row" || name === "field",
});

function findFirst(node: unknown, name: string): unknown {
  if (node == null || typeof node !== "object") return undefined;
  const obj = node as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(obj, name)) return obj[name];
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        const r = findFirst(item, name);
        if (r !== undefined) return r;
      }
    } else if (v && typeof v === "object") {
      const r = findFirst(v, name);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

function textOf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (typeof node === "object") {
    const t = (node as Record<string, unknown>)["#text"];
    return t == null ? "" : String(t);
  }
  return "";
}

export interface HttpClientOptions {
  url: string;
  userId: string;
  password: string;
  timeoutSeconds?: number;
  trustSSLCertificate?: boolean;
  applId?: string;
  localeId?: string;
  extraEnv?: Record<string, string>;
}

export class MocaHttpClient implements MocaClient {
  private readonly url: string;
  private readonly userId: string;
  private readonly password: string;
  private readonly timeoutSeconds: number;
  private readonly trustSSLCertificate: boolean;
  private readonly applId: string;
  private readonly localeId: string;
  private readonly extraEnv: Record<string, string>;

  constructor(opts: HttpClientOptions) {
    this.url = opts.url;
    this.userId = opts.userId;
    this.password = opts.password;
    this.timeoutSeconds = opts.timeoutSeconds ?? defaultHttpTimeout(opts.url);
    this.trustSSLCertificate = opts.trustSSLCertificate ?? false;
    this.applId = opts.applId || "NO_APPLID";
    this.localeId = opts.localeId || "US_ENGLISH";
    this.extraEnv = opts.extraEnv || {};
  }

  private buildRequestXml(sessionKey: string, queryText: string): string {
    const query = xmlEscapeContent(queryText || "");
    const vars: string[] = [
      `<var name="LOCALE_ID" value="${xmlEscape(this.localeId)}"/>`,
      `<var name="USR_ID" value="${xmlEscape(this.userId)}"/>`,
    ];
    if (sessionKey) vars.push(`<var name="SESSION_KEY" value="${xmlEscape(sessionKey)}"/>`);
    for (const [k, v] of Object.entries(this.extraEnv)) {
      vars.push(`<var name="${xmlEscape(k)}" value="${xmlEscape(v)}"/>`);
    }
    return (
      `<moca-request autocommit="true">` +
      `<environment>${vars.join("")}</environment>` +
      `<query>${query}</query>` +
      `</moca-request>`
    );
  }

  async login(): Promise<string> {
    const loginXml =
      `<moca-request autocommit="true"><environment></environment>` +
      `<query>login user where usr_id = '${sqlQuote(this.userId)}' and usr_pswd = '${sqlQuote(this.password)}'</query>` +
      `</moca-request>`;
    // Transport/HTTP errors propagate with their real cause (ECONNREFUSED,
    // timeout, TLS, HTTP status) so callers can distinguish "server
    // unreachable" from "bad credentials".
    const resp = await this.postXml(loginXml);
    if (!resp) return "";
    let doc: unknown;
    try {
      doc = parser.parse(resp);
    } catch {
      return "";
    }
    const statusText = textOf(findFirst(doc, "status")).trim();
    if (statusText && statusText !== "0") {
      const msg = textOf(findFirst(doc, "message")).trim();
      throw new Error(msg ? `MOCA login rejected: ${msg}` : `MOCA login rejected (status ${statusText}).`);
    }

    const sid = textOf(findFirst(doc, "session-id")).trim();
    if (sid) return sid;

    // Legacy: a field whose text contains uid=.. sid=..
    const data = findFirst(doc, "data");
    const metadata = findFirst(doc, "metadata");
    const columns = metaColumns(metadata);
    const rows = dataRows(data);
    const skIdx = columns.findIndex((c) => c.name === "session_key");
    if (skIdx >= 0 && rows.length > 0) {
      const sk = textOf(rows[0][skIdx]).trim();
      if (sk) return sk;
    }
    for (const row of rows) {
      for (const field of row) {
        const content = textOf(field).trim();
        if (content.includes("uid=") && content.includes("sid=")) return content;
      }
    }
    // login succeeded (status 0) but no explicit session — return a marker.
    return statusText === "0" ? "http_session" : "";
  }

  async runQuery(sessionKey: string, queryText: string): Promise<QueryResult> {
    let resp: string;
    try {
      resp = await this.postXml(this.buildRequestXml(sessionKey, queryText));
    } catch (e) {
      return emptyResult(-1, (e as Error).message);
    }
    if (!resp) return emptyResult(-1, "Empty response from server");
    let doc: unknown;
    try {
      doc = parser.parse(resp);
    } catch (e) {
      return emptyResult(-1, `XML parse error: ${(e as Error).message}`);
    }
    const statusText = textOf(findFirst(doc, "status")).trim();
    const status = statusText ? parseInt(statusText, 10) : 0;

    const columns = metaColumns(findFirst(doc, "metadata"));
    const colNames = columns.map((c) => c.name);
    const colTypes = columns.map((c) => c.type);

    const rawRows = dataRows(findFirst(doc, "data"));
    const rows: MocaCell[][] = rawRows.map((fields) =>
      fields.map((field, idx) => {
        const isNull =
          field != null &&
          typeof field === "object" &&
          (field as Record<string, unknown>)["@_null"] === "true";
        return coerceMocaValue(colTypes[idx] || "S", textOf(field), isNull);
      })
    );

    if (status !== 0 && colNames.length === 0) {
      const msg = textOf(findFirst(doc, "message")).trim() || `MOCA status ${status}`;
      return { status, message: msg, columns: [], colTypes: [], rows: [] };
    }
    return { status, message: "", columns: colNames, colTypes, rows };
  }

  async logout(sessionKey: string): Promise<void> {
    if (!sessionKey || sessionKey === "http_session") return;
    try {
      await this.postXml(this.buildRequestXml(sessionKey, "logout user"));
    } catch {
      /* ignore */
    }
  }

  /** POST the request XML. Rejects with a descriptive error on any transport/HTTP failure. */
  private postXml(xml: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let u: URL;
      try {
        u = new URL(this.url);
      } catch {
        reject(new Error(`Invalid MOCA service URL: ${this.url}`));
        return;
      }
      const isHttps = u.protocol === "https:";
      const lib = isHttps ? https : http;
      const body = Buffer.from(xml, "utf8");
      const options: https.RequestOptions = {
        method: "POST",
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        headers: {
          "Content-Type": "application/moca-xml",
          Accept: "application/xml",
          "User-Agent": `${this.applId}/1.0`,
          "Content-Length": body.length,
        },
        timeout: this.timeoutSeconds * 1000,
      };
      if (isHttps && this.trustSSLCertificate) options.rejectUnauthorized = false;

      const req = lib.request(options, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode ?? "?"} from ${u.host} (expected 200 from the MOCA service).`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      });
      req.on("error", (e: NodeJS.ErrnoException) => {
        reject(new Error(`${e.code ? `${e.code}: ` : ""}${e.message} (POST ${u.host})`));
      });
      req.on("timeout", () => {
        // destroy(err) re-emits as 'error', which rejects with this message.
        req.destroy(new Error(`Timed out after ${this.timeoutSeconds}s waiting for ${u.host}.`));
      });
      req.write(body);
      req.end();
    });
  }
}

interface MetaColumn {
  name: string;
  type: string;
}

function metaColumns(metadata: unknown): MetaColumn[] {
  if (metadata == null || typeof metadata !== "object") return [];
  const cols = (metadata as Record<string, unknown>)["column"];
  if (!Array.isArray(cols)) return [];
  return cols.map((c) => {
    const obj = (c ?? {}) as Record<string, unknown>;
    return {
      name: String(obj["@_name"] ?? ""),
      type: String(obj["@_type"] ?? "S"),
    };
  });
}

function dataRows(data: unknown): unknown[][] {
  if (data == null || typeof data !== "object") return [];
  const rows = (data as Record<string, unknown>)["row"];
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const obj = (row ?? {}) as Record<string, unknown>;
    const fields = obj["field"];
    return Array.isArray(fields) ? fields : [];
  });
}

function emptyResult(status: number, message: string): QueryResult {
  return { status, message, columns: [], colTypes: [], rows: [] };
}

/** Long-running job ports (e.g. :4600) get a shorter cap; others a generous one. */
export function defaultHttpTimeout(url: string): number {
  return (url || "").toLowerCase().includes(":4600") ? 9 * 60 : 30 * 60;
}
