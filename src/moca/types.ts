export type ConnectionType = "http" | "tcp";

/** A saved MOCA connection profile. */
export interface ConnectionProfile {
  id: string;
  name: string;
  type: ConnectionType;
  /** http(s)://host:port/service  (HTTP transport) */
  url?: string;
  /** host (TCP transport) */
  host?: string;
  /** port (TCP transport) */
  port?: number;
  username: string;
  /** Encrypted password envelope (dpapi:.. or aesgcm:..). Never logged/returned. */
  passwordEnc: string;
  timeoutSeconds?: number;
  /** For https URLs: skip certificate validation (TrustSSLCertificate). */
  trustSSLCertificate?: boolean;
  /** Extra MOCA environment variables sent with every request. */
  environmentVariables?: Record<string, string>;
  group?: string;
  applId?: string;
  autoCommit?: boolean;
  /** Where the connection was discovered: Manual | Registry | DLXClient | ... */
  source?: string;
}

export type MocaCell = string | number | boolean | null;

export interface QueryResult {
  status: number;
  message: string;
  columns: string[];
  /** Per-column MOCA type code (e.g. 'S','I','F','D'). */
  colTypes: string[];
  rows: MocaCell[][];
}

export interface MocaClient {
  /** Authenticate; returns a session key ('' on failure). */
  login(): Promise<string>;
  /** Execute a query on the active session. */
  runQuery(sessionKey: string, query: string, autoCommit?: boolean): Promise<QueryResult>;
  /** Close/cleanup the session. */
  logout(sessionKey: string): Promise<void>;
}
