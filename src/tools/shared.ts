import { z } from "zod";
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

/** MOCA error messages that indicate the session itself died (expired/invalid/not authenticated). */
const SESSION_ERROR_RE =
  /session.{0,30}(expir|invalid|not\s+found)|not\s+(logged\s+in|authenticated)|re-?authenticat/i;

export interface RunOptions {
  autoCommit?: boolean;
  /**
   * Re-login and retry ONCE on transport (status -1) or session-expiry failures.
   * Default true; writes must pass false (a lost response could mean the write
   * already applied, so re-running risks double execution).
   */
  retryTransient?: boolean;
}

/**
 * Run a query on the active session. With retryTransient (the default for
 * reads), a dropped socket or expired MOCA session triggers one re-login and
 * retry, so long-lived MCP sessions self-heal instead of failing until the
 * user manually reconnects.
 */
export async function runOnActive(query: string, opts: RunOptions = {}): Promise<QueryResult> {
  const { autoCommit = false, retryTransient = true } = opts;
  const active = requireActive();
  let result: QueryResult;
  try {
    result = await active.client.runQuery(active.sessionKey, query, autoCommit);
  } catch (e) {
    if (!retryTransient) throw e;
    result = { status: -1, message: (e as Error).message, columns: [], colTypes: [], rows: [] };
  }
  if (!retryTransient) return result;

  const failed = result.status !== 0 && result.columns.length === 0;
  if (!failed) return result;
  const transient = result.status === -1 || SESSION_ERROR_RE.test(result.message);
  if (!transient) return result;

  try {
    const key = await active.client.login();
    if (!key) return result;
    active.sessionKey = key;
    return await active.client.runQuery(key, query, autoCommit);
  } catch {
    return result;
  }
}

/** Run a read query against the active session (no autocommit; self-heals the session). */
export async function runRead(query: string): Promise<QueryResult> {
  return runOnActive(query);
}

export type RowFormat = "objects" | "arrays";

export interface FormatOptions {
  /** Max rows to return after offset (default 500). */
  maxRows?: number;
  /** Rows to skip before returning (client-side paging; default 0). */
  offset?: number;
  /** 'objects' (default): rows keyed by column. 'arrays': positional arrays (token-efficient). */
  rowFormat?: RowFormat;
}

export interface FormattedResult {
  status: number;
  rowCount: number;
  offset: number;
  returned: number;
  truncated: boolean;
  columns: string[];
  rows: Record<string, MocaCell>[] | MocaCell[][];
  message?: string;
}

export function formatResult(result: QueryResult, opts: FormatOptions = {}): FormattedResult {
  const maxRows = opts.maxRows ?? 500;
  const offset = Math.max(0, opts.offset ?? 0);
  const slice = result.rows.slice(offset, offset + maxRows);
  const rows =
    opts.rowFormat === "arrays"
      ? slice
      : slice.map((row) => {
          const obj: Record<string, MocaCell> = {};
          result.columns.forEach((col, i) => {
            obj[col] = row[i] ?? null;
          });
          return obj;
        });
  const out: FormattedResult = {
    status: result.status,
    rowCount: result.rows.length,
    offset,
    returned: slice.length,
    truncated: offset + slice.length < result.rows.length,
    columns: result.columns,
    rows,
  };
  if (result.message) out.message = result.message;
  return out;
}

const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** MCP outputSchema shape for tools that return a formatResult-style table. */
export const formattedResultShape = {
  status: z.number().describe("MOCA status code (0 = success)."),
  rowCount: z.number().describe("Total rows in the fetched result set."),
  offset: z.number().describe("Rows skipped before the first returned row."),
  returned: z.number().describe("Rows returned in this response."),
  truncated: z.boolean().describe("True when more rows exist beyond this page / size cap."),
  columns: z.array(z.string()),
  rows: z
    .array(z.union([z.record(cellSchema), z.array(cellSchema)]))
    .describe("Rows as objects keyed by column (default) or positional arrays (rowFormat: 'arrays')."),
  message: z.string().optional(),
  note: z.string().optional().describe("Present when the result was trimmed to fit the size limit."),
};

/** MCP outputSchema shape for tools that return a compact name list. */
export const listResultShape = {
  status: z.number().describe("MOCA status code (0 = success)."),
  count: z.number().describe("Total values after filtering (before any size-cap trimming)."),
  returned: z.number(),
  truncated: z.boolean(),
  column: z.string().describe("Source column the values were taken from."),
  values: z.array(cellSchema),
  message: z.string().optional(),
  note: z.string().optional().describe("Present when the result was trimmed to fit the size limit."),
};

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
