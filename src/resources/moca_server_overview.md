---
name: 'MOCA MCP Server Overview'
description: 'What this server does and the full tool catalog'
uriTemplate: 'resource://moca_server_overview'
---
# JDA / Blue Yonder MOCA MCP Server

This server lets an AI connect to MOCA (Blue Yonder / JDA / RedPrairie WMS) servers, run
read-only queries, discover schema and the MOCA command API, and manage reusable, encrypted
connection profiles. Writes are disabled by default and require explicit approval.

## Typical workflow

1. **Find a server** - `discover_connections` reads this machine's MOCA client configuration
   (Windows registry `SOFTWARE\Mchugh\Client` and the RedPrairie `DLXClientConfig.xml`). Or
   list what's already saved with `list_connections`.
2. **Save it** - `create_connection` (the password is encrypted at rest with Windows DPAPI).
3. **Connect** - `connect` by `connectionId` (or inline details, with `save: true` to persist).
4. **Explore** - `get_database_info`, `list_tables`, `describe_table`, `find_tables_with_column`,
   `list_commands`.
5. **Query** - `run_moca_query`. Raw SQL is auto-wrapped in `[ ]` and retried bracketed on failure.

## Tool catalog

### Connections / session
- `list_connections` / `get_connection` - view saved profiles (no secrets).
- `create_connection` / `update_connection` / `delete_connection` - manage profiles.
- `test_connection` - connect + log in to verify.
- `connect` / `disconnect` / `get_session_status` - manage the active session.
- `discover_connections` - auto-find servers configured on this machine.
- `import_connections` - import discovered servers into the local store.

### Query (read-only)
- `run_moca_query` - run MOCA / `[SQL]`; mutating verbs are blocked here. Page big results with
  `offset` + `maxRows`, and use `rowFormat: 'arrays'` to fit far more rows per response.

### Schema discovery
- `get_database_info`, `list_tables`, `describe_table`, `list_views`, `list_indexes`,
  `find_tables_with_column`, `list_primary_keys`, `list_table_columns_bulk`.

### MOCA command repository
- `list_commands` / `lookup_command`, `describe_command`, `list_triggers`.

### Writes (disabled by default)
- `run_moca_write`, `update_rows`, `delete_rows` - each requires per-operation approval (MCP
  elicitation) or starting the server with `--allow-write`. The AI can request, but cannot
  self-grant.

## Prompts
- `moca_connect` - discover/pick a server and open a session.
- `explore_table` - structure, keys, sample rows and a summary for one table.
- `moca_query_help` - compose and run a read-only query for a stated goal.

## Safety model
- Reads pass a read-only guard that blocks mutating MOCA verbs and unsafe operations
  (`commit`, `truncate`, `alter system/session`, `execute os command`), every statement in a
  bracket-SQL block (multi-statement, CTE-smuggled DML, `select into`, `exec`/`call`/PL-SQL),
  with string literals and `--` comments neutralized before scanning.
- Writes are gated; `--allow-write` pre-approves them for trusted setups.
- Read sessions self-heal: one automatic re-login + retry after a dropped socket or expired
  session. Writes never auto-retry.
