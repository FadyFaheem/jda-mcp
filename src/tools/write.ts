import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureWritePermitted, type Permissions } from "../permissions.js";
import { requireActive } from "./shared.js";
import { formatResult } from "./shared.js";
import { errorResult, jsonResult, type ToolResult } from "./result.js";

export function registerWriteTools(server: McpServer, perms: Permissions): void {
  const runWrite = async (query: string, opSummary: string, autoCommit: boolean): Promise<ToolResult> => {
    let active;
    try {
      active = requireActive();
    } catch (e) {
      return errorResult((e as Error).message);
    }
    const decision = await ensureWritePermitted(server, perms, opSummary);
    if (!decision.allowed) return errorResult(`Permission denied: ${decision.reason}`);
    try {
      const result = await active.client.runQuery(active.sessionKey, query, autoCommit);
      if (result.status !== 0 && result.columns.length === 0) {
        return errorResult(`MOCA status ${result.status}: ${result.message || "write failed"}`);
      }
      return jsonResult({ approvedBy: decision.reason, autoCommit, ...formatResult(result) });
    } catch (e) {
      return errorResult(`Write failed: ${(e as Error).message}`);
    }
  };

  server.registerTool(
    "run_moca_write",
    {
      title: "Run MOCA write (gated)",
      description:
        "Execute an arbitrary MOCA write (create/change/remove/update/delete/commit). DISABLED by default: requires per-operation approval (MCP elicitation) or server start with --allow-write.",
      inputSchema: {
        query: z.string().describe("The MOCA command / [SQL] to execute."),
        autoCommit: z.boolean().optional().describe("Commit the transaction (default false)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ query, autoCommit }): Promise<ToolResult> =>
      runWrite(query, `Command:\n${query}\nautoCommit: ${autoCommit ?? false}`, autoCommit ?? false)
  );

  server.registerTool(
    "update_rows",
    {
      title: "Update rows (gated)",
      description:
        "Build and run [update <table> set <assignments> where <where>]. An explicit WHERE is required. DISABLED by default (approval/--allow-write).",
      inputSchema: {
        table: z.string(),
        assignments: z.string().describe("SET clause, e.g. \"sts = 'X', qty = 5\""),
        where: z.string().describe("WHERE clause (required), e.g. \"wh_id = 'WMD1' and lodnum = '123'\""),
        autoCommit: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ table, assignments, where, autoCommit }): Promise<ToolResult> => {
      if (!where.trim()) return errorResult("Refusing to run UPDATE without a WHERE clause.");
      const sql = `update ${table} set ${assignments} where ${where}`;
      return runWrite(`[${sql}]`, `SQL:\n${sql}\nautoCommit: ${autoCommit ?? false}`, autoCommit ?? false);
    }
  );

  server.registerTool(
    "delete_rows",
    {
      title: "Delete rows (gated)",
      description:
        "Build and run [delete from <table> where <where>]. An explicit WHERE is required. DISABLED by default (approval/--allow-write).",
      inputSchema: {
        table: z.string(),
        where: z.string().describe("WHERE clause (required)."),
        autoCommit: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ table, where, autoCommit }): Promise<ToolResult> => {
      if (!where.trim()) return errorResult("Refusing to run DELETE without a WHERE clause.");
      const sql = `delete from ${table} where ${where}`;
      return runWrite(`[${sql}]`, `SQL:\n${sql}\nautoCommit: ${autoCommit ?? false}`, autoCommit ?? false);
    }
  );
}
