---
name: 'MOCA Write Operations Instructions'
description: 'How writes work and how approval is granted'
uriTemplate: 'resource://moca_write_operations'
---
# Write Operations (gated)

Write tools are fully implemented but **disabled by default**. They never run without explicit
authorization.

## Tools
- `run_moca_write { query, autoCommit? }` - arbitrary MOCA write (create/change/remove/update/
  delete/commit). Skips the read-only guard.
- `update_rows { table, assignments, where, autoCommit? }` - builds `[update <table> set <assignments> where <where>]`.
- `delete_rows { table, where, autoCommit? }` - builds `[delete from <table> where <where>]`.

`update_rows` and `delete_rows` **require an explicit WHERE** and refuse to run without one.

## How approval works
Each write calls an approval gate **per operation**:
1. If the server was started with `--allow-write`, the operation runs (operator pre-approval).
2. Otherwise, if the client supports **MCP elicitation**, the human is shown the exact statement
   and must approve it. Approval is not cached - every write re-prompts.
3. If neither applies, the write is refused with guidance.

The AI can *request* a write, but it can never grant itself permission.

## autoCommit
`autoCommit` defaults to **false** (changes are not committed). Set `autoCommit: true` only when you
intend to persist. Without a commit, MOCA rolls back at session end.

## Examples
```
update_rows { table: "invlod", assignments: "sts = 'X'", where: "wh_id = 'WMD1' and lodnum = '00000123'", autoCommit: true }
delete_rows { table: "usr_data", where: "usr_id = 'TEMP'", autoCommit: true }
run_moca_write { query: "change inventory where invsts = 'OK' and lodnum = '00000123'", autoCommit: true }
```
