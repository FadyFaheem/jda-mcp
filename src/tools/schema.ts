import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sqlQuote } from "../moca/util.js";
import { formatList, formatResult, requireActive, runRead } from "./shared.js";
import { errorResult, jsonResultCapped, type ToolResult } from "./result.js";

type DbType = "ORACLE" | "MSSQL" | "DB2" | "UNKNOWN";

// Column catalog SQL by database type.
const COLUMN_SQL: Record<Exclude<DbType, "UNKNOWN">, string> = {
  ORACLE:
    "select lower(utc.table_name) table_name, utc.column_id, lower(utc.column_name) column_name, " +
    "decode(utc.nullable,'Y',1,0) null_flg, lower(utc.data_type) data_type, " +
    "decode(nvl(utc.data_precision,0),'0',decode(nvl(utc.char_length,0),'0',utc.data_length,utc.char_length),utc.data_precision) length, " +
    "utc.data_scale scale, ucc.comments comments " +
    "from user_tab_columns utc, user_col_comments ucc " +
    "where ucc.table_name = utc.table_name and ucc.column_name = utc.column_name and utc.table_name not like 'BIN$%'",
  MSSQL:
    "select lower(so.name) table_name, colid column_id, lower(sc.name) column_name, sc.isnullable null_flg, 0 pk_flg, " +
    "lower(st.name) data_type, case when lower(st.name) = 'nvarchar' then sc.prec else sc.length end length, sc.scale, " +
    "cast(cd.value as varchar(1000)) comments " +
    "from sysobjects so, systypes st, syscolumns sc " +
    "left outer join sys.extended_properties cd ON cd.major_id = sc.id and cd.minor_id = sc.colid and cd.name = 'MS_Description' " +
    "where st.xtype = sc.xtype and st.xusertype = sc.xusertype and sc.id = so.id and so.xtype in ('U', 'V')",
  DB2:
    "select lower(tabname) table_name, colno column_id, lower(colname) column_name, decode(nulls,'N',0,1) null_flg, " +
    "decode(keyseq,NULL,0,1) pk_flg, lower(typename) data_type, length, scale, remarks comments " +
    "from syscat.columns where tabschema = user",
};

const PK_SQL_ORACLE =
  "select lower(ucc.table_name) table_name, lower(ucc.column_name) column_name " +
  "from user_cons_columns ucc, user_constraints uc " +
  "where ucc.constraint_name = uc.constraint_name and uc.constraint_type = 'P'";

async function detectDbType(): Promise<DbType> {
  try {
    const info = await runRead("sl_get db_info");
    for (const row of info.rows) {
      for (const cell of row) {
        const v = String(cell ?? "").toLowerCase();
        if (v.includes("oracle")) return "ORACLE";
        if (v.includes("db2")) return "DB2";
        if (v.includes("mssql") || v.includes("sql server") || v.includes("microsoft")) return "MSSQL";
      }
    }
  } catch {
    /* fall through */
  }
  return "UNKNOWN";
}

export function registerSchemaTools(server: McpServer): void {
  server.registerTool(
    "get_database_info",
    {
      title: "Database info",
      description: "Get database type/name/schema/version via 'sl_get db_info'.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async (): Promise<ToolResult> => {
      try {
        return jsonResultCapped(formatResult(await runRead("sl_get db_info")));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    }
  );

  server.registerTool(
    "list_tables",
    {
      title: "List tables",
      description:
        "List user table names (via 'list user tables') as a compact, sorted name list. Optional case-insensitive substring filter is applied server-side across ALL tables before any size cap.",
      inputSchema: {
        filter: z.string().optional().describe("Only return tables whose name contains this substring."),
        maxRows: z.number().int().positive().optional().describe("Max names to return (default 5000)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ filter, maxRows }): Promise<ToolResult> => {
      try {
        const res = await runRead("list user tables");
        return jsonResultCapped(formatList(res, { filter, maxRows }));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    }
  );

  server.registerTool(
    "describe_table",
    {
      title: "Describe table",
      description: "List a table's columns, short names and comments (via 'list table columns').",
      inputSchema: { tableName: z.string().describe("Table name, e.g. 'pckwrk'.") },
      annotations: { readOnlyHint: true },
    },
    async ({ tableName }): Promise<ToolResult> => {
      try {
        const res = await runRead(`list table columns where table_name = '${sqlQuote(tableName)}'`);
        return jsonResultCapped(formatResult(res));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    }
  );

  server.registerTool(
    "list_views",
    {
      title: "List views",
      description:
        "List user view names (via 'list user views') as a compact, sorted name list. Optional case-insensitive substring filter is applied server-side before any size cap.",
      inputSchema: {
        filter: z.string().optional().describe("Only return views whose name contains this substring."),
        maxRows: z.number().int().positive().optional().describe("Max names to return (default 5000)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ filter, maxRows }): Promise<ToolResult> => {
      try {
        return jsonResultCapped(formatList(await runRead("list user views"), { filter, maxRows }));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    }
  );

  server.registerTool(
    "list_indexes",
    {
      title: "List indexes",
      description: "List indexes for a table (via 'list table indexes').",
      inputSchema: { tableName: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ tableName }): Promise<ToolResult> => {
      try {
        const res = await runRead(`list table indexes where table_name = '${sqlQuote(tableName)}'`);
        return jsonResultCapped(formatResult(res));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    }
  );

  server.registerTool(
    "find_tables_with_column",
    {
      title: "Find tables with column",
      description: "Find all tables that contain a given column (via 'list tables with column').",
      inputSchema: { columnName: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ columnName }): Promise<ToolResult> => {
      try {
        const res = await runRead(`list tables with column where column_name = '${sqlQuote(columnName)}'`);
        return jsonResultCapped(formatResult(res));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    }
  );

  server.registerTool(
    "list_primary_keys",
    {
      title: "List primary keys",
      description:
        "List primary-key columns. Oracle uses the data dictionary; for MSSQL/DB2 use 'list_indexes' (the unique/primary index).",
      inputSchema: { tableName: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ tableName }): Promise<ToolResult> => {
      try {
        requireActive();
        const db = await detectDbType();
        if (db !== "ORACLE") {
          return errorResult(
            `Primary-key catalog query is implemented for Oracle; detected '${db}'. Use 'list_indexes' to inspect the primary/unique index instead.`
          );
        }
        let sql = PK_SQL_ORACLE;
        if (tableName) sql = `select * from (${sql}) where table_name = lower('${sqlQuote(tableName)}')`;
        return jsonResultCapped(formatResult(await runRead(`[${sql}]`)));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    }
  );

  server.registerTool(
    "list_table_columns_bulk",
    {
      title: "List all columns (bulk)",
      description:
        "Bulk column catalog across all tables using dbtype-aware SQL (Oracle/MSSQL/DB2). Large; capped by maxRows.",
      inputSchema: { maxRows: z.number().int().positive().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ maxRows }): Promise<ToolResult> => {
      try {
        requireActive();
        const db = await detectDbType();
        if (db === "UNKNOWN") return errorResult("Could not determine database type from 'sl_get db_info'.");
        return jsonResultCapped(formatResult(await runRead(`[${COLUMN_SQL[db]}]`), maxRows ?? 5000));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    }
  );
}
