# JDA / Blue Yonder MOCA MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets any MCP-capable AI
(Cursor, Claude Desktop, VS Code) connect to **MOCA** servers (Blue Yonder / JDA / RedPrairie WMS),
run **read-only** queries, discover **schema** and the **MOCA command API**, and manage **encrypted,
reusable connection profiles**. Writes are implemented but **disabled by default** and require
per-operation human approval (MCP elicitation) or an explicit `--allow-write` flag.

## Features

- **Two transports**: MOCA XML over HTTP/HTTPS, and the legacy TCP wire protocol (V101/V103).
- **Connection profiles**: create/save/reuse connection strings; passwords encrypted at rest with
  Windows DPAPI (CurrentUser), with an AES fallback for non-Windows dev.
- **Machine-based discovery**: `discover_connections` reads this machine's MOCA client configuration
  (Windows registry `SOFTWARE\Mchugh\Client` and the RedPrairie `DLXClientConfig.xml`).
- **Read-only by default**: a guard blocks mutating verbs and unsafe operations.
- **Schema + command discovery**: tables, columns, indexes, primary keys, descriptions, and the full
  MOCA command repository (with syntax/arguments/triggers).
- **Self-documenting**: ships markdown reference resources (`resource://moca_*`).

## Build

```bash
npm install
npm run build
```

This compiles to `build/` and copies the markdown resources to `build/resources/`.

## Run

```bash
# read-only (default)
node build/index.js

# enable writes without per-operation prompts (use with caution)
node build/index.js --allow-write
```

The server speaks MCP over **stdio**. Logs go to stderr; stdout is the JSON-RPC channel.

## Configure an MCP client

Replace `C:\path\to\JDA_MCP` below with the absolute path to this project on your machine.

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "jda-moca": {
      "command": "node",
      "args": ["C:\\path\\to\\JDA_MCP\\build\\index.js"]
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "jda-moca": {
      "command": "node",
      "args": ["C:\\path\\to\\JDA_MCP\\build\\index.js"]
    }
  }
}
```

To allow writes, add `"--allow-write"` to `args` (and understand the risk). Otherwise writes prompt
for approval in clients that support MCP elicitation (e.g. Cursor 1.5+).

## Tools

- **Connections**: `list_connections`, `get_connection`, `create_connection`, `update_connection`,
  `delete_connection`, `test_connection`, `connect`, `disconnect`, `get_session_status`,
  `discover_connections`, `import_connections`.
- **Query**: `run_moca_query` (read-only; auto-wraps bare SQL in `[ ]`).
- **Schema**: `get_database_info`, `list_tables`, `describe_table`, `list_views`, `list_indexes`,
  `find_tables_with_column`, `list_primary_keys`, `list_table_columns_bulk`.
- **Commands**: `list_commands`, `lookup_command`, `describe_command`, `list_triggers`.
- **Writes (gated)**: `run_moca_write`, `update_rows`, `delete_rows`.

## Security

- Passwords are encrypted at rest and never returned by any tool.
- The local store lives at `%APPDATA%\jda-moca-mcp\connections.json`.
- Read-only is enforced at the query layer; writes require explicit approval.

## Quick smoke test

```bash
node scripts/smoke.mjs
```

Lists tools/resources and exercises a few no-connection tools against the built server.

## Project layout

```
src/
  index.ts            entry (stdio, arg parsing)
  server.ts           builds the McpServer, registers tools + resources
  permissions.ts      --allow-write + per-operation elicitation gate
  session.ts          active session state
  moca/               types, util, value coercion, HTTP + TCP clients, read-only guard, factory
  config/             crypto (DPAPI), connection store, machine discovery
  tools/              connections, query, schema, commands, write
  resources/          loader + moca_*.md reference docs
scripts/
  copy-resources.mjs  build step (copies *.md to build/resources)
  smoke.mjs           stdio smoke test
```
