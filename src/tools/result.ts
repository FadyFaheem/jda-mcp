export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function jsonResult(value: unknown): ToolResult {
  return textResult(JSON.stringify(value, null, 2));
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Upper bound (in characters) for a single tool-result body. MCP clients cap how
 * much tool output they will accept (Claude defaults to ~25k tokens and rejects
 * larger results). ~40k chars of pretty-printed JSON stays comfortably under that
 * even for token-dense numeric/structured content. Override with the
 * JDA_MCP_MAX_RESULT_CHARS environment variable.
 */
export const DEFAULT_MAX_RESULT_CHARS: number = (() => {
  const raw = process.env.JDA_MCP_MAX_RESULT_CHARS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 2000 ? n : 40000;
})();

interface RowBag {
  rows?: unknown[];
  [key: string]: unknown;
}

/** Copy of a result holding only the first `keep` rows, with truncation metadata. */
function withTrimmedRows(value: RowBag, allRows: unknown[], keep: number, maxChars: number): RowBag {
  return {
    ...value,
    rows: allRows.slice(0, keep),
    returned: keep,
    truncated: true,
    note:
      `Output truncated to ${keep} of ${allRows.length} returned rows to stay under the ` +
      `response size limit (~${maxChars} chars). Narrow the query (add a WHERE clause or ` +
      `select fewer columns), lower maxRows, or page through the results.`,
  };
}

/**
 * Serialize a tool value as pretty JSON, trimming its `rows` array (if present) so
 * the serialized result stays at or under `maxChars`. This prevents MCP clients
 * from rejecting / offloading oversized tool output. When the value has no `rows`
 * to trim (or its metadata alone exceeds the budget) the string is hard-truncated
 * with a marker as a last resort.
 */
export function jsonResultCapped(value: unknown, maxChars: number = DEFAULT_MAX_RESULT_CHARS): ToolResult {
  let json = JSON.stringify(value, null, 2);
  if (json.length <= maxChars) return textResult(json);

  const bag = value as RowBag;
  const rows = bag?.rows;
  if (Array.isArray(rows) && rows.length > 0) {
    // Binary search for the largest row count whose serialization fits the budget.
    let lo = 0;
    let hi = rows.length;
    let best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const candidate = JSON.stringify(withTrimmedRows(bag, rows, mid, maxChars), null, 2);
      if (candidate.length <= maxChars) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    json = JSON.stringify(withTrimmedRows(bag, rows, best, maxChars), null, 2);
    if (json.length <= maxChars) return textResult(json);
  }

  const marker = "\n\n... output truncated to fit the response size limit ...";
  return textResult(json.slice(0, Math.max(0, maxChars - marker.length)) + marker);
}
