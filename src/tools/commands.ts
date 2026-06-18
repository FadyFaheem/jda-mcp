import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sqlQuote } from "../moca/util.js";
import { formatResult, formattedResultShape, runRead } from "./shared.js";
import { errorResult, jsonResultCapped, type ToolResult } from "./result.js";

export function registerCommandTools(server: McpServer): void {
  server.registerTool(
    "list_commands",
    {
      title: "List MOCA commands",
      description:
        "Discover the MOCA command API via 'list active commands' (command, level, type, syntax, description, flags). Optional name filter.",
      inputSchema: {
        like: z.string().optional().describe("Filter: command name contains this substring."),
        maxRows: z.number().int().positive().optional().describe("Max rows to return (default 1000)."),
      },
      outputSchema: formattedResultShape,
      annotations: { readOnlyHint: true },
    },
    async ({ like, maxRows }): Promise<ToolResult> => {
      try {
        const query = like
          ? `list active commands where command like '%${sqlQuote(like)}%'`
          : "list active commands";
        return jsonResultCapped(formatResult(await runRead(query), { maxRows: maxRows ?? 1000 }));
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
      inputSchema: { command: z.string().describe("Exact command name, e.g. 'list inventory'.") },
      outputSchema: formattedResultShape,
      annotations: { readOnlyHint: true },
    },
    async ({ command }): Promise<ToolResult> => {
      try {
        return jsonResultCapped(formatResult(await runRead(`list active commands where command = '${sqlQuote(command)}'`)));
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
      inputSchema: { command: z.string().describe("Exact command name, e.g. 'list inventory'.") },
      outputSchema: formattedResultShape,
      annotations: { readOnlyHint: true },
    },
    async ({ command }): Promise<ToolResult> => {
      try {
        return jsonResultCapped(
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
      inputSchema: { command: z.string().describe("Exact command name the triggers fire on.") },
      outputSchema: formattedResultShape,
      annotations: { readOnlyHint: true },
    },
    async ({ command }): Promise<ToolResult> => {
      try {
        return jsonResultCapped(
          formatResult(await runRead(`list active triggers where command = '${sqlQuote(command)}'`))
        );
      } catch (e) {
        return errorResult((e as Error).message);
      }
    }
  );
}
