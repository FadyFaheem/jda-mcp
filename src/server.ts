import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Permissions } from "./permissions.js";
import { registerConnectionTools } from "./tools/connections.js";
import { registerQueryTools } from "./tools/query.js";
import { registerSchemaTools } from "./tools/schema.js";
import { registerCommandTools } from "./tools/commands.js";
import { registerWriteTools } from "./tools/write.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts.js";

export const SERVER_NAME = "jda-moca-mcp";
export const SERVER_VERSION = "0.3.0";

const INSTRUCTIONS = `MCP server for MOCA / Blue Yonder (JDA) WMS.

Workflow:
1. Find a server: 'discover_connections' (reads this machine's MOCA client configuration) or 'list_connections'.
2. Save one with 'create_connection' (password is encrypted at rest), then 'connect' (or 'connect' with inline details).
3. Explore: 'get_database_info', 'list_tables', 'describe_table', 'find_tables_with_column', 'list_commands'.
4. Query with 'run_moca_query' (read-only; raw SQL is auto-wrapped in [ ]).

Query/schema tools return structured content alongside the JSON text. For large results, page with
'offset' + 'maxRows' (watch 'truncated'/'rowCount') and pass rowFormat:'arrays' to fit far more rows
per response. Read sessions self-heal: a dropped socket or expired MOCA session triggers one automatic
re-login and retry.

Reads are unrestricted; writes (run_moca_write / update_rows / delete_rows) are DISABLED by default and require
per-operation approval (elicitation) or starting the server with --allow-write.

Prompts 'moca_connect', 'explore_table' and 'moca_query_help' provide guided workflows.
See the resource 'resource://moca_server_overview' and the other moca_* resources for full guidance.`;

export function buildServer(perms: Permissions): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS }
  );

  registerConnectionTools(server);
  registerQueryTools(server);
  registerSchemaTools(server);
  registerCommandTools(server);
  registerWriteTools(server, perms);
  registerResources(server);
  registerPrompts(server);

  return server;
}
