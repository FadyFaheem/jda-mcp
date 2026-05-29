---
name: 'MOCA and SQL Functions Reference'
description: 'Built-in MOCA and SQL functions available in queries'
uriTemplate: 'resource://moca_functions_reference'
---
# MOCA / SQL Function Reference

Built-in functions usable in MOCA `where` expressions and bracket SQL.

## String
- `substr(expr, m, n)` - substring from position m, length n.
- `instr(search, lookfor, n)` - index of first occurrence.
- `len(expr)` / `length(expr)` - length.
- `lower(expr)` / `upper(expr)` - case conversion.
- `lpad(expr, length, padstr)` / `rpad(...)` - pad.
- `rtrim(expr)` / `trim(expr)` - trim whitespace.
- `sprintf(fmt, arg)` - format a single value.

## Numeric / conversion
- `to_char(expr, format)` - to string.
- `to_date(expr, format)` - to datetime.
- `to_number(expr)` / `float(expr)` / `int(expr)` / `string(expr)` - casts.
- `dbdate(expr)` - convert to the DB's date format (input `YYYYMMDDHH24MISS`).

## Logic / null handling
- `nvl(expr1, expr2)` - expr1 if not null else expr2.
- `nvl2(expr, ifNotNull, ifNull)`.
- `decode(expr, search1, return1, ..., default)` - inline case.
- `iif(expr, trueExpr, falseExpr)` - inline if.

## Date / system
- `sysdate()` - current date/time.
- `date(expr)` - to datetime.

## Aggregates (SQL)
- `count(expr)`, `sum(expr)`, `avg(expr)`, `min(expr)`, `max(expr)`.

## MOCA helpers
- `dbtype()` - `'ORACLE'`, `'MSSQL'`, or `'DB2'`.
- `nextval(seq)` - next sequence value.
- `rowcount(resultset)` - row count of a result set.
- `command()` - text of the currently executing command.
