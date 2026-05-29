---
name: 'MOCA Query Instructions and Examples'
description: 'How to write MOCA scripts and SQL for this server'
uriTemplate: 'resource://moca_query_instructions_and_examples'
---
# MOCA Query Guide

MOCA is a command language used by Blue Yonder / JDA / RedPrairie WMS. A script is a pipeline of
commands and SQL joined by operators.

## Syntax essentials
- **Command verbs**: `list user tables`, `publish data where x = 1`, `sl_get db_info`, `ping`.
- **Pipe `|`**: feed one command's results into the next: `list user tables | publish data where ...`.
- **Stream `;`**: separate independent statements.
- **Bracket SQL `[ ... ]`**: embed raw SQL: `[select lodnum, sts from invlod where wh_id = 'WMD1']`.
- **Groovy `[[ ... ]]`**: embed Groovy (advanced).
- **Bind variables `@name`**: reference prior columns/env, e.g. `where table_name = @table_name`.
- **Hints**: `/*+ rule */` optimizer hints and `/*#nolimit*/` to bypass the server row cap are
  preserved; plain `/* ... */` comments are stripped.

## Using `run_moca_query`
- `query` - the MOCA/SQL text.
- `maxRows` - cap returned rows (default 500). Add `/*#nolimit*/` to ask the server for all rows.
- `autoWrapSql` (default true) - a bare `select ...` / `with ...` is auto-wrapped in `[ ]`.
- `autoRetryWithBrackets` (default true) - if a command fails, it is retried wrapped in `[ ]`.

This tool is **read-only**: `create/change/remove/update/delete/insert`, `commit/rollback`,
`truncate`, `alter system/session`, and `execute os command` are blocked. Use the write tools for
changes.

## Value types
Columns carry MOCA type codes: `S`=string, `I`/`P`=int, `L`=long, `F`/`X`=double, `O`=boolean,
`D`=datetime (returned as `YYYY-MM-DD[ HH:MM:SS]`), `V`=binary(base64).

## Examples

### 1. Bracket SQL
```
[select lodnum, sts, wh_id from invlod where wh_id = 'WMD1' and sts = 'L']
```

### 2. Bare SELECT (auto-wrapped)
```
select count(*) cnt from invlod
```

### 3. Command pipe
```
list user tables | publish data where tbl = @table_name
```

### 4. All rows, no cap
```
/*#nolimit*/ [select * from poldat where polcod = 'RF']
```
