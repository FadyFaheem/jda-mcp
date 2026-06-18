export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  /** MCP structured tool output: clients can consume this without re-parsing the text. */
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Attach the value as MCP structuredContent when it is a plain object. */
function withStructured(result: ToolResult, value: unknown): ToolResult {
  if (isPlainObject(value)) result.structuredContent = value;
  return result;
}

export function jsonResult(value: unknown): ToolResult {
  return withStructured(textResult(JSON.stringify(value, null, 2)), value);
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
  values?: unknown[];
  [key: string]: unknown;
}

/** Array properties that may be trimmed to fit the budget, in priority order. */
const TRIMMABLE_KEYS = ["rows", "values"] as const;

/** Find the first present, non-empty trimmable array on the value (rows, then values). */
function trimmableKey(bag: RowBag | undefined): (typeof TRIMMABLE_KEYS)[number] | undefined {
  if (!bag) return undefined;
  for (const k of TRIMMABLE_KEYS) {
    const arr = bag[k];
    if (Array.isArray(arr) && arr.length > 0) return k;
  }
  return undefined;
}

/** Copy of a result holding only the first `keep` items of `key`, with truncation metadata. */
function withTrimmed(
  value: RowBag,
  key: (typeof TRIMMABLE_KEYS)[number],
  all: unknown[],
  keep: number,
  maxChars: number
): RowBag {
  const unit = key === "values" ? "items" : "rows";
  return {
    ...value,
    [key]: all.slice(0, keep),
    returned: keep,
    truncated: true,
    note:
      `Output truncated to ${keep} of ${all.length} ${unit} to stay under the response size ` +
      `limit (~${maxChars} chars). Narrow the result (use the 'filter' argument or a WHERE ` +
      `clause, or select fewer columns), lower maxRows, page with 'offset', or use ` +
      `rowFormat: 'arrays' to fit more rows per response.`,
  };
}

/**
 * Last-resort shape-preserving fallback: empty the trimmable arrays and clip any
 * oversized string fields. Keeps the object valid against the tool's declared
 * output schema so structuredContent can always be returned.
 */
function clippedFallback(bag: RowBag, maxChars: number): RowBag {
  const out: RowBag = { ...bag };
  for (const k of TRIMMABLE_KEYS) {
    if (Array.isArray(out[k])) out[k] = [];
  }
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === "string" && v.length > 2000) out[k] = `${v.slice(0, 2000)} ...`;
  }
  out.returned = 0;
  out.truncated = true;
  out.note =
    `Result was too large to return (over ~${maxChars} chars) even after trimming. ` +
    `Narrow the result (filter/WHERE, fewer columns) and retry.`;
  return out;
}

/**
 * Serialize a tool value as pretty JSON, trimming its largest array (`rows`, else
 * `values`) so the serialized result stays at or under `maxChars`. This prevents
 * MCP clients from rejecting / offloading oversized tool output. When there is no
 * array to trim (or its metadata alone exceeds the budget) the string is
 * hard-truncated with a marker as a last resort.
 */
export function jsonResultCapped(value: unknown, maxChars: number = DEFAULT_MAX_RESULT_CHARS): ToolResult {
  let json = JSON.stringify(value, null, 2);
  if (json.length <= maxChars) return withStructured(textResult(json), value);

  const bag = value as RowBag;
  const key = trimmableKey(bag);
  if (key) {
    const all = bag[key] as unknown[];
    // Binary search for the largest item count whose serialization fits the budget.
    let lo = 0;
    let hi = all.length;
    let best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const candidate = JSON.stringify(withTrimmed(bag, key, all, mid, maxChars), null, 2);
      if (candidate.length <= maxChars) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const trimmed = withTrimmed(bag, key, all, best, maxChars);
    json = JSON.stringify(trimmed, null, 2);
    if (json.length <= maxChars) return withStructured(textResult(json), trimmed);
  }

  if (isPlainObject(value)) {
    const clipped = clippedFallback(value as RowBag, maxChars);
    json = JSON.stringify(clipped, null, 2);
    if (json.length <= maxChars) return withStructured(textResult(json), clipped);
  }

  const marker = "\n\n... output truncated to fit the response size limit ...";
  return textResult(json.slice(0, Math.max(0, maxChars - marker.length)) + marker);
}
