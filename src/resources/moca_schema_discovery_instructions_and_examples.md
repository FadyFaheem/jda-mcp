---
name: 'MOCA Schema Discovery Instructions and Examples'
description: 'How to find tables, columns, indexes and descriptions'
uriTemplate: 'resource://moca_schema_discovery'
---
# Schema Discovery

These tools wrap MOCA's database-agnostic data-dictionary commands (work on Oracle, SQL Server and
DB2 without you needing to know which).

## Tools
- `get_database_info` -> `sl_get db_info` (db type / name / schema / version).
- `list_tables` -> `list user tables` (optional `filter` substring).
- `describe_table` -> `list table columns where table_name = '<t>'` (column name, short name, comment).
- `list_views` -> `list user views`.
- `list_indexes` -> `list table indexes where table_name = '<t>'`.
- `find_tables_with_column` -> `list tables with column where column_name = '<c>'`.
- `list_primary_keys` -> primary-key columns (Oracle via the data dictionary; MSSQL/DB2: use
  `list_indexes`).
- `list_table_columns_bulk` -> a single dbtype-aware catalog query returning every column
  (large; capped by `maxRows`).

## Recommended exploration order
1. `get_database_info` - confirm the backend.
2. `list_tables` with a `filter` (e.g. `"pck"`) to narrow down.
3. `describe_table` on a candidate to see columns + comments.
4. `find_tables_with_column` to trace a column (e.g. `lodnum`) across tables.

## Examples
```
list_tables { filter: "pck" }
describe_table { tableName: "pckwrk" }
find_tables_with_column { columnName: "lodnum" }
list_indexes { tableName: "invlod" }
```
