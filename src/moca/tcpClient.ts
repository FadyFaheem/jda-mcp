import net from "node:net";
import type { MocaCell, MocaClient, QueryResult } from "./types.js";
import { coerceMocaValue } from "./coerce.js";
import { sqlQuote } from "./util.js";

const CARET = 0x5e; // '^'

/** Buffered async reader over a net.Socket for the MOCA wire protocol. */
class MocaSocket {
  private buf: Buffer = Buffer.alloc(0);
  private waiters: Array<() => void> = [];
  private closed = false;
  private error?: Error;

  constructor(private readonly sock: net.Socket) {
    sock.on("data", (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.wake();
    });
    sock.on("close", () => {
      this.closed = true;
      this.wake();
    });
    sock.on("error", (e: Error) => {
      this.error = e;
      this.closed = true;
      this.wake();
    });
    sock.on("timeout", () => {
      this.error = new Error("socket timeout");
      this.closed = true;
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      this.wake();
    });
  }

  private wake() {
    const w = this.waiters;
    this.waiters = [];
    for (const fn of w) fn();
  }

  private waitMore(): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private async readByte(): Promise<number | null> {
    while (this.buf.length === 0) {
      if (this.closed) return null;
      await this.waitMore();
    }
    const b = this.buf[0];
    this.buf = this.buf.subarray(1);
    return b;
  }

  /** Read up to a '^' delimiter (or 21 bytes), matching the reference reader. */
  async readToken(): Promise<string | null> {
    const bytes: number[] = [];
    for (;;) {
      const b = await this.readByte();
      if (b === null) return bytes.length ? Buffer.from(bytes).toString("latin1") : null;
      if (b === CARET) break;
      bytes.push(b);
      if (bytes.length > 20) break;
    }
    return Buffer.from(bytes).toString("latin1");
  }

  async readExact(n: number): Promise<Buffer | null> {
    while (this.buf.length < n) {
      if (this.closed) return this.buf.length ? Buffer.from(this.buf) : null;
      await this.waitMore();
    }
    const out = Buffer.from(this.buf.subarray(0, n));
    this.buf = this.buf.subarray(n);
    return out;
  }

  drainSync(): Buffer {
    const b = this.buf;
    this.buf = Buffer.alloc(0);
    return b;
  }

  write(data: Buffer) {
    this.sock.write(data);
  }

  close() {
    try {
      this.sock.destroy();
    } catch {
      /* ignore */
    }
  }

  get failed() {
    return this.error;
  }
}

interface ParsedResponse {
  status: number | null;
  message: string;
  isError: boolean;
  columns: string[];
  rows: string[][];
  colTypes: string;
}

const V103_VERSION_INFO = "~0~~0~~-1^";

function buildPacket(
  command: string,
  envVars: string,
  autoCommit: boolean,
  version: "V101" | "V103",
  internal: boolean
): Buffer {
  const cmd = command || "";
  const cmdLen = cmd.length;
  const flags = ((cmdLen % 18) << 8) | 2 | (autoCommit ? 0 : 1);
  const flagsStr = String(flags).padStart(6, "0");
  const envSection = internal ? "^" : `${envVars}^`;
  const body =
    version === "V101"
      ? `^${envSection}${flagsStr}^${cmd}`
      : `^${V103_VERSION_INFO}${envSection}${flagsStr}^${cmd}`;
  const bodyBytes = Buffer.from(body, "utf8");
  const bodyLenStr =
    version === "V101" ? String(bodyBytes.length).padStart(6, "0") : String(bodyBytes.length);
  const header = Buffer.from(`${version}^${bodyLenStr}^`, "utf8");
  return Buffer.concat([header, bodyBytes]);
}

function connectSocket(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    sock.setTimeout(timeoutMs);
    const onError = (e: Error) => {
      cleanup();
      reject(e);
    };
    const onTimeout = () => {
      cleanup();
      sock.destroy();
      reject(new Error("connect timeout"));
    };
    const onConnect = () => {
      cleanup();
      resolve(sock);
    };
    function cleanup() {
      sock.off("error", onError);
      sock.off("timeout", onTimeout);
      sock.off("connect", onConnect);
    }
    sock.on("error", onError);
    sock.on("timeout", onTimeout);
    sock.on("connect", onConnect);
  });
}

/** Low-level MOCA TCP connection (V101/V103 wire protocol). */
class MocaTcpConnection {
  socket: MocaSocket | null = null;
  sessionKey = "";
  protocolVersion: "V101" | "V103" = "V103";

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number
  ) {}

  /** Open the socket; returns null on success or the underlying error. */
  async connect(): Promise<Error | null> {
    this.close();
    try {
      const raw = await connectSocket(this.host, this.port, this.timeoutMs);
      this.socket = new MocaSocket(raw);
      return null;
    } catch (e) {
      return e as Error;
    }
  }

  close() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  async sendCommand(
    command: string,
    envVars = "",
    autoCommit = true,
    version?: "V101" | "V103",
    internal = false
  ): Promise<string | null> {
    if (!this.socket) return null;
    const ver = version || this.protocolVersion;
    try {
      this.socket.write(buildPacket(command, envVars, autoCommit, ver, internal));
      return await this.readResponse();
    } catch {
      return null;
    }
  }

  private async readResponse(): Promise<string | null> {
    if (!this.socket) return null;
    const first = await this.socket.readToken();
    if (first === null) return null;
    let bodyLen: number;
    if (first.startsWith("V10")) {
      const lenTok = await this.socket.readToken();
      if (lenTok === null) return null;
      const n = parseInt(lenTok, 10);
      if (Number.isNaN(n)) {
        return `${first}^${lenTok}^` + this.socket.drainSync().toString("utf8");
      }
      bodyLen = n;
    } else {
      const n = parseInt(first, 10);
      if (Number.isNaN(n)) {
        return `${first}^` + this.socket.drainSync().toString("utf8");
      }
      bodyLen = n;
    }
    const content = await this.socket.readExact(bodyLen);
    return content === null ? null : content.toString("utf8");
  }

  async handshake(): Promise<boolean> {
    this.protocolVersion = "V103";
    const raw = await this.sendCommand("get encryption information", "", true, undefined, true);
    if (raw === null) return false;
    const status = this.parseResponse(raw).status;
    if (status === 501) {
      this.protocolVersion = "V101";
      return true;
    }
    if (status === 503) return false;
    return status === 0 || status !== null;
  }

  parseResponse(response: string): ParsedResponse {
    const result: ParsedResponse = {
      status: null,
      message: "",
      isError: false,
      columns: [],
      rows: [],
      colTypes: "",
    };
    if (!response) {
      result.isError = true;
      result.message = "Empty response";
      return result;
    }
    try {
      this.parseV103(response, result);
    } catch (e) {
      const parts = response.split("^");
      if (parts.length >= 2) {
        const s = parseInt(parts[1], 10);
        if (!Number.isNaN(s)) {
          result.status = s;
          result.isError = s !== 0;
        }
      }
      if (result.isError && !result.message) result.message = `Parse error: ${(e as Error).message}`;
    }
    return result;
  }

  private parseV103(response: string, result: ParsedResponse) {
    const parts = response.split("^");
    if (parts.length < 2) return;
    let idx = 1; // skip context field

    const s = parseInt(parts[idx], 10);
    if (Number.isNaN(s)) return;
    result.status = s;
    result.isError = s !== 0;
    idx++;

    let errLen = 0;
    if (idx < parts.length) {
      const e = parseInt(parts[idx], 10);
      if (!Number.isNaN(e)) errLen = e;
    }
    idx++;

    if (errLen > 0 && idx < parts.length) {
      result.message = parts[idx].slice(0, errLen);
      idx++;
    }
    if (idx < parts.length && parts[idx] === "") idx++;

    if (result.isError) {
      const msgParts = parts.slice(idx).filter((p) => p && !p.startsWith("~"));
      if (msgParts.length && !result.message) result.message = msgParts.join(" ");
      return;
    }

    let rowCount = 0;
    if (idx < parts.length) {
      const r = parseInt(parts[idx], 10);
      if (!Number.isNaN(r)) rowCount = r;
    }
    idx++;

    let colCount = 0;
    if (idx < parts.length) {
      const c = parseInt(parts[idx], 10);
      if (!Number.isNaN(c)) colCount = c;
    }
    idx++;

    if (idx < parts.length) result.colTypes = parts[idx];
    idx++;

    const colNames: string[] = [];
    if (idx < parts.length) {
      const tildeParts = parts[idx].split("~").filter((p) => p);
      for (let i = 0; i < tildeParts.length; i += 5) colNames.push(tildeParts[i]);
    }
    result.columns = colNames.slice(0, colCount);
    idx++;

    if (idx < parts.length) {
      const dataStr = parts.slice(idx).join("^");
      result.rows = this.parseDataValues(dataStr, colCount, rowCount);
    }
  }

  private parseDataValues(data: string, colCount: number, rowCount: number): string[][] {
    const rows: string[][] = [];
    let pos = 0;
    for (let r = 0; r < rowCount; r++) {
      const row: string[] = [];
      for (let c = 0; c < colCount; c++) {
        if (pos >= data.length) {
          row.push("");
          continue;
        }
        pos += 1; // skip type char
        let lenStr = "";
        while (pos < data.length && data[pos] !== "^") {
          lenStr += data[pos];
          pos += 1;
        }
        pos += 1; // skip '^'
        const valLen = parseInt(lenStr, 10);
        const len = Number.isNaN(valLen) ? 0 : valLen;
        const value = len > 0 ? data.slice(pos, pos + len) : "";
        pos += len;
        row.push(value);
      }
      rows.push(row);
    }
    return rows;
  }
}

export interface TcpClientOptions {
  host: string;
  port: number;
  userId: string;
  password: string;
  timeoutSeconds?: number;
  extraEnv?: Record<string, string>;
}

export class MocaTcpClient implements MocaClient {
  private readonly host: string;
  private readonly port: number;
  private readonly userId: string;
  private readonly password: string;
  private readonly timeoutSeconds: number;
  private readonly extraEnv: Record<string, string>;
  private conn: MocaTcpConnection | null = null;

  constructor(opts: TcpClientOptions) {
    this.host = opts.host;
    this.port = opts.port;
    this.userId = opts.userId;
    this.password = opts.password;
    this.timeoutSeconds = opts.timeoutSeconds ?? 30;
    this.extraEnv = opts.extraEnv || {};
  }

  async login(): Promise<string> {
    const conn = new MocaTcpConnection(this.host, this.port, this.timeoutSeconds * 1000);
    const connectErr = await conn.connect();
    if (connectErr) {
      throw new Error(`TCP connect to ${this.host}:${this.port} failed: ${connectErr.message}`);
    }
    if (!(await conn.handshake())) {
      conn.close();
      throw new Error(
        `MOCA handshake with ${this.host}:${this.port} failed (is this a MOCA TCP service port?).`
      );
    }
    const loginCmd = `login user where usr_id = '${sqlQuote(this.userId)}' and usr_pswd = '${sqlQuote(this.password)}'`;
    const env = `USR_ID=${this.userId}`;
    const raw = await conn.sendCommand(loginCmd, env, true);
    if (raw === null) {
      conn.close();
      throw new Error(`No response to login from ${this.host}:${this.port} (connection dropped).`);
    }
    const parsed = conn.parseResponse(raw);
    if (parsed.status !== 0) {
      conn.close();
      throw new Error(
        parsed.message
          ? `MOCA login rejected: ${parsed.message}`
          : `MOCA login rejected (status ${parsed.status}).`
      );
    }
    const skIdx = parsed.columns.indexOf("session_key");
    if (skIdx >= 0 && parsed.rows.length > 0 && skIdx < parsed.rows[0].length) {
      conn.sessionKey = parsed.rows[0][skIdx];
    }
    this.conn = conn;
    return conn.sessionKey || "tcp_session";
  }

  async runQuery(_sessionKey: string, queryText: string, autoCommit = true): Promise<QueryResult> {
    if (!this.conn || !this.conn.socket) {
      return {
        status: -1,
        message: "Not connected (TCP session closed or dropped).",
        columns: [],
        colTypes: [],
        rows: [],
      };
    }
    const sk = this.conn.sessionKey || "";
    const envPairs = [`USR_ID=${this.userId}`, `SESSION_KEY=${sk}`];
    for (const [k, v] of Object.entries(this.extraEnv)) envPairs.push(`${k}=${v}`);
    const env = envPairs.join(":");

    const raw = await this.conn.sendCommand(queryText, env, autoCommit);
    if (raw === null) {
      return {
        status: -1,
        message: "No response (TCP connection dropped mid-request).",
        columns: [],
        colTypes: [],
        rows: [],
      };
    }
    const parsed = this.conn.parseResponse(raw);
    if (parsed.status !== 0 && parsed.columns.length === 0) {
      return {
        status: parsed.status ?? -1,
        message: parsed.message || `MOCA status ${parsed.status}`,
        columns: [],
        colTypes: [],
        rows: [],
      };
    }
    const colTypes = parsed.columns.map((_c, i) => parsed.colTypes[i] || "S");
    const rows: MocaCell[][] = parsed.rows.map((row) =>
      row.map((val, i) => coerceMocaValue(colTypes[i] || "S", val, val === ""))
    );
    return { status: parsed.status ?? 0, message: "", columns: parsed.columns, colTypes, rows };
  }

  async logout(_sessionKey: string): Promise<void> {
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
  }
}
