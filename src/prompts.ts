import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function userMessage(text: string) {
  return {
    messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
  };
}

/** Reusable workflow prompts (the third MCP primitive next to tools and resources). */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "moca_connect",
    {
      title: "Connect to a MOCA server",
      description: "Discover MOCA servers on this machine, pick one, and open a session.",
    },
    () =>
      userMessage(
        `Help me connect to a MOCA (Blue Yonder / JDA WMS) server:
1. Call 'list_connections'. If a saved profile fits, 'connect' with its connectionId.
2. Otherwise call 'discover_connections' (reads this machine's MOCA client configuration). Show me what was found and ask which one to use. Ask me for the username/password — never invent credentials — and save the profile with 'create_connection' (the password is encrypted at rest).
3. 'connect', then confirm the session with 'get_session_status' and 'get_database_info'.
If connecting fails, report the exact error and suggest what to check (host/port/url, HTTP vs TCP transport, credentials).`
      )
  );

  server.registerPrompt(
    "explore_table",
    {
      title: "Explore a MOCA table",
      description: "Structure, keys, and sample data for one table, with a summary of what it holds.",
      argsSchema: {
        tableName: z.string().describe("Table to explore, e.g. 'pckwrk' or 'invlod'."),
      },
    },
    ({ tableName }) =>
      userMessage(
        `Explore the MOCA table '${tableName}' on the active connection:
1. 'describe_table' for columns, short names and comments; 'list_indexes' and 'list_primary_keys' for keys.
2. Check the database type with 'get_database_info', then sample 5 rows with 'run_moca_query' ("[select * from ${tableName} where rownum <= 5]" on Oracle, "[select top 5 * from ${tableName}]" on MSSQL).
3. Get the row count: "[select count(*) cnt from ${tableName}]".
4. Summarize: what the table stores, the key columns and their meaning, and how it relates to common WMS flows (see resource://moca_common_tables).`
      )
  );

  server.registerPrompt(
    "moca_query_help",
    {
      title: "Write a MOCA query",
      description: "Compose and run a read-only MOCA query for a goal, with correct syntax.",
      argsSchema: {
        goal: z.string().describe("What you want to find out, e.g. 'open picks by zone for WMD1'."),
      },
    },
    ({ goal }) =>
      userMessage(
        `Write and run a read-only MOCA query for this goal: ${goal}

Before writing it:
- Read resource://moca_query_instructions_and_examples for syntax ([SQL] brackets, pipes, @binds, /*#nolimit*/).
- Find the right tables via 'list_tables' / 'find_tables_with_column' / resource://moca_common_tables, and verify columns with 'describe_table'.
Then run it with 'run_moca_query' (for large results use rowFormat: 'arrays' and page with offset/maxRows), sanity-check the output, and explain the result to me. Refine and re-run if it does not answer the goal.`
      )
  );
}
