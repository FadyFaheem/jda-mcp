---
name: 'MOCA Command Repository Reference'
description: 'Discovering the MOCA command API (commands, arguments, triggers)'
uriTemplate: 'resource://moca_commands_reference'
---
# MOCA Command Repository

MOCA business logic is organized into **commands** layered by **component level** (CompLevel,
e.g. `DCSint`, `MCSbase`, `SeamLES`, `GTSdev`). You can introspect the whole API at runtime.

## Tools
- `list_commands` -> `list active commands` (optional `like` substring filter).
- `lookup_command` -> exact-name lookup.
- `describe_command` -> `list active command arguments where command = '<c>'`.
- `list_triggers` -> `list active triggers where command = '<c>'`.

## Columns returned by `list active commands`
`command`, `cmplvl` (component level), `type`, `syntax`, `description`, and flags such as
`readonly`, `insecure`/`security`, `disabled`, and `new_trans` (requires-new-transaction).

`type` is one of:
- **Local Syntax** - implemented as a MOCA script (other commands + SQL).
- **C Function** - native C (the `functn` column names it).
- **Java Method** - native Java.

## Examples
```
list_commands { like: "inventory" }
lookup_command { command: "list inventory" }
describe_command { command: "create inventory" }
list_triggers { command: "move inventory" }
```

## Tip
Reading a command's `syntax` and arguments tells you exactly how to call it (which `where` args it
accepts), which is often faster than querying tables directly.
