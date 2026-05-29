import { getActive } from "../session.js";
import type { QueryResult } from "../moca/types.js";

export function requireActive() {
  const active = getActive();
  if (!active) {
    throw new Error(
      "No active connection. Use 'connect' first (see 'list_connections' / 'create_connection' / 'discover_connections')."
    );
  }
  return active;
}

/** Run a read query against the active session (no autocommit). */
export async function runRead(query: string): Promise<QueryResult> {
  const active = requireActive();
  return active.client.runQuery(active.sessionKey, query, false);
}

export interface FormattedResult {
  status: number;
  rowCount: number;
  returned: number;
  truncated: boolean;
  columns: string[];
  rows: Record<string, unknown>[];
  message?: string;
}

export function formatResult(result: QueryResult, maxRows = 500): FormattedResult {
  const truncated = result.rows.length > maxRows;
  const slice = truncated ? result.rows.slice(0, maxRows) : result.rows;
  const rows = slice.map((row) => {
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
  const out: FormattedResult = {
    status: result.status,
    rowCount: result.rows.length,
    returned: rows.length,
    truncated,
    columns: result.columns,
    rows,
  };
  if (result.message) out.message = result.message;
  return out;
}
