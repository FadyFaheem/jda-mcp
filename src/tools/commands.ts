import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sqlQuote } from "../moca/util.js";
import { formatResult, runRead } from "./shared.js";
import { errorResult, jsonResult, type ToolResult } from "./result.js";

export function registerCommandTools(server: McpServer): void {
  server.registerTool(
    "list_commands",
    {
      title: "List MOCA commands",
      description:
        "Discover the MOCA command API via 'list active commands' (command, level, type, syntax, description, flags). Optional name filter.",
      inputSchema: {
        like: z.string().optional().describe("Filter: command name contains this substring."),
        maxRows: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ like, maxRows }): Promise<ToolResult> => {
      try {
        const query = like
          ? `list active commands where command like '%${sqlQuote(like)}%'`
          : "list active commands";
        return jsonResult(formatResult(await runRead(query), maxRows ?? 1000));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    }
  );

  server.registerTool(
    "lookup_command",
    {
      title: "Look up a MOCA command",
      description: "Find a specific MOCA command's definition (syntax, type, description) by exact name.",
      inputSchema: { command: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ command }): Promise<ToolResult> => {
      try {
        return jsonResult(formatResult(await runRead(`list active commands where command = '${sqlQuote(command)}'`)));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    }
  );

  server.registerTool(
    "describe_command",
    {
      title: "Describe a command's arguments",
      description: "List the arguments of a MOCA command (via 'list active command arguments').",
      inputSchema: { command: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ command }): Promise<ToolResult> => {
      try {
        return jsonResult(
          formatResult(await runRead(`list active command arguments where command = '${sqlQuote(command)}'`))
        );
      } catch (e) {
        return errorResult((e as Error).message);
      }
    }
  );

  server.registerTool(
    "list_triggers",
    {
      title: "List command triggers",
      description: "List triggers attached to a MOCA command (via 'list active triggers').",
      inputSchema: { command: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ command }): Promise<ToolResult> => {
      try {
        return jsonResult(
          formatResult(await runRead(`list active triggers where command = '${sqlQuote(command)}'`))
        );
      } catch (e) {
        return errorResult((e as Error).message);
      }
    }
  );
}
