import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertReadOnly, ReadOnlyViolation } from "../moca/readonly.js";
import { formattedResultShape, formatResult, requireActive, runOnActive } from "./shared.js";
import { errorResult, jsonResultCapped, type ToolResult } from "./result.js";

function isBracketed(q: string): boolean {
  const t = q.trim();
  return t.startsWith("[") && t.endsWith("]");
}

/** Wrap a bare SQL statement in [ ] so it is valid MOCA (desktop MOCA client behavior). */
function maybeWrapSql(q: string): string {
  const t = q.trim();
  if (isBracketed(t)) return t;
  if (/^(select|with)\b/i.test(t)) return `[${t}]`;
  return q;
}

export function registerQueryTools(server: McpServer): void {
  server.registerTool(
    "run_moca_query",
    {
      title: "Run MOCA query (read-only)",
      description:
        "Execute a read-only MOCA command/SQL against the active connection. Mutating verbs are blocked here (use the write tools, which require approval). Raw SQL is auto-wrapped in [ ] and retried bracketed on failure. Page large results with offset+maxRows ('truncated'/'rowCount' tell you when and how much), and use rowFormat:'arrays' to fit many more rows per response.",
      inputSchema: {
        query: z.string().describe("MOCA command or [SQL]. Use /*#nolimit*/ to bypass the server row limit."),
        maxRows: z.number().int().positive().optional().describe("Max rows to return after 'offset' (default 500)."),
        offset: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "Rows to skip before returning (default 0). Pages client-side over the fetched result set; combine with maxRows and check 'truncated'/'rowCount'."
          ),
        rowFormat: z
          .enum(["objects", "arrays"])
          .optional()
          .describe(
            "'objects' (default): each row is {column: value}. 'arrays': rows are positional arrays matching 'columns' — far fewer tokens, so more rows fit per response."
          ),
        maxChars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Max characters in the JSON response; rows are trimmed to fit so the result is not rejected for being too large (default ~40000)."
          ),
        autoWrapSql: z.boolean().optional().describe("Auto-wrap bare SELECT/WITH in [ ] (default true)."),
        autoRetryWithBrackets: z.boolean().optional().describe("Retry wrapped in [ ] on failure (default true)."),
      },
      outputSchema: formattedResultShape,
      annotations: { readOnlyHint: true },
    },
    async ({
      query,
      maxRows,
      offset,
      rowFormat,
      maxChars,
      autoWrapSql,
      autoRetryWithBrackets,
    }): Promise<ToolResult> => {
      const wrap = autoWrapSql !== false;
      const retry = autoRetryWithBrackets !== false;
      let q = wrap ? maybeWrapSql(query) : query;

      // Validate the script before requiring a connection so guard violations
      // are reported even when no session is active.
      try {
        assertReadOnly(q);
      } catch (e) {
        if (e instanceof ReadOnlyViolation) return errorResult(e.message);
        throw e;
      }

      try {
        requireActive();
      } catch (e) {
        return errorResult((e as Error).message);
      }

      try {
        let result = await runOnActive(q);
        if (result.status !== 0 && retry && !isBracketed(q)) {
          const q2 = `[${query.trim()}]`;
          try {
            assertReadOnly(q2);
            const retried = await runOnActive(q2);
            if (retried.status === 0 || retried.columns.length > 0) {
              q = q2;
              result = retried;
            }
          } catch {
            /* keep original result */
          }
        }
        if (result.status !== 0 && result.columns.length === 0) {
          return errorResult(`MOCA status ${result.status}: ${result.message || "query failed"}`);
        }
        return jsonResultCapped(formatResult(result, { maxRows: maxRows ?? 500, offset, rowFormat }), maxChars);
      } catch (e) {
        return errorResult(`Query failed: ${(e as Error).message}`);
      }
    }
  );
}
