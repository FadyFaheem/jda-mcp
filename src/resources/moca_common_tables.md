---
name: 'Common Blue Yonder / JDA WMS Tables'
description: 'Starter map of common WMS tables and areas (living doc)'
uriTemplate: 'resource://moca_common_tables'
---
# Common WMS Tables (starter)

A small, curated starting point. The authoritative, instance-specific list comes from
`list_tables` / `describe_table` against your connection - prefer those for anything not listed here.

## Configuration / policies
- **POLDAT** - policies (configuration). Accessed via the `POLDAT_VIEW` view and the
  `list/create/change/remove policy` commands. Three-way key: `POLCOD` (code), `POLVAR` (variable),
  `POLVAL` (value); further scoped by `WH_ID` and `SRTSEQ`.

## Security / users
- **les_usr_ath** - user authority. Common column `usr_id`.

## Inventory (typical RedPrairie/BY schema; verify per instance)
- **invlod** - load (license plate) inventory; e.g. `lodnum`, `wh_id`, `sts`.
- **invsub** / **invdtl** - inventory sub-load / detail.

## Work / picking (verify per instance)
- **pckwrk** - pick work; **pckmov** - pick moves.

## How to extend this map
- `list_tables { filter: "..." }` to find tables by name fragment.
- `describe_table { tableName: "..." }` for columns + comments.
- `find_tables_with_column { columnName: "lodnum" }` to trace a key across tables.
- `list_commands { like: "..." }` to find the commands that operate on an area.

> Note: exact table/column names vary by WMS version and customizations. Always confirm with the
> schema-discovery tools before relying on a name.
