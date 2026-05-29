import { getActive } from "../session.js";
import type { MocaCell, QueryResult } from "../moca/types.js";

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

export interface ListResult {
  status: number;
  /** Total values after filtering (before any size-cap trimming). */
  count: number;
  returned: number;
  truncated: boolean;
  /** Name of the source column the values were taken from. */
  column: string;
  values: MocaCell[];
  message?: string;
}

/** Pick the column index to list: an explicit name, else a *name-like column, else the first. */
function pickListColumn(columns: string[], preferred?: string): number {
  if (preferred) {
    const i = columns.indexOf(preferred);
    if (i >= 0) return i;
  }
  const named = columns.findIndex((c) => /(^|_)(table|view|name)$/i.test(c) || /name/i.test(c));
  return named >= 0 ? named : 0;
}

/**
 * Compact projection of a single-column listing (e.g. table/view names) into a flat,
 * sorted `values` array. This is far more token-efficient than rows-of-objects, so
 * many more names fit under the response size limit. Filtering is applied to the full
 * result set (case-insensitive substring) BEFORE any size-cap trimming.
 */
export function formatList(
  result: QueryResult,
  opts: { column?: string; filter?: string; maxRows?: number } = {}
): ListResult {
  const maxRows = opts.maxRows ?? 5000;
  const idx = pickListColumn(result.columns, opts.column);
  const column = result.columns[idx] ?? opts.column ?? "value";

  let values: MocaCell[] = result.rows.map((r) => r[idx] ?? null);
  if (opts.filter) {
    const f = opts.filter.toLowerCase();
    values = values.filter((v) => String(v ?? "").toLowerCase().includes(f));
  }
  values.sort((a, b) => String(a ?? "").localeCompare(String(b ?? "")));

  const total = values.length;
  const truncated = total > maxRows;
  if (truncated) values = values.slice(0, maxRows);

  const out: ListResult = {
    status: result.status,
    count: total,
    returned: values.length,
    truncated,
    column,
    values,
  };
  if (result.message) out.message = result.message;
  return out;
}
