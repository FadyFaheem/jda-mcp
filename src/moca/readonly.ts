import { stripMocaComments } from "./util.js";

export class ReadOnlyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadOnlyViolation";
  }
}

/**
 * Operations that are not permitted in read-only mode: scripts containing
 * these are treated as unsafe and refused.
 */
const UNSAFE_RE = /\b(commit|truncate|alter\s+system|alter\s+session|execute\s+os\s+command)\b/i;

/** Mutating MOCA verbs (leading verb of a command segment). */
const MUTATING_MOCA_VERBS = new Set([
  "create",
  "change",
  "remove",
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "truncate",
  "do",
  "execute",
  "import",
  "apply",
  "sync",
  "commit",
  "rollback",
  "nodbcommit",
  "nodbrollback",
  "prepare",
]);

/** Mutating / unsafe SQL keywords when leading a statement inside a [ ... ] block. */
const MUTATING_SQL = new Set([
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "truncate",
  "merge",
  "create",
  "grant",
  "revoke",
  "exec",
  "execute",
  "call",
  "begin",
  "declare",
  "lock",
]);

/** Keywords that mutate when they appear at the TOP level of a SELECT/WITH statement. */
const TOP_LEVEL_SQL_DML = new Set(["insert", "update", "delete", "merge", "into"]);

/**
 * Single-pass lexer that blanks single-quoted string literals (handling ''
 * escapes) and strips `--` line comments, with correct precedence between the
 * two. This prevents literals from hiding or faking keywords, and prevents
 * `-- comment` lines from masking a mutating statement that follows.
 */
function sanitizeForScan(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") {
      out += "''";
      i++;
      while (i < text.length) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "-" && text[i + 1] === "-") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Scan a SELECT/WITH statement for mutating keywords at parenthesis depth 0.
 * Catches CTE smuggling ("with c as (...) delete from t"), MSSQL
 * "select ... into newtable", and "select ... for update", while ignoring
 * keywords inside subqueries (depth > 0).
 */
function topLevelViolation(stmt: string): string | null {
  let depth = 0;
  for (const m of stmt.matchAll(/[()]|[A-Za-z_][A-Za-z0-9_$#]*/g)) {
    const tok = m[0];
    if (tok === "(") depth++;
    else if (tok === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && TOP_LEVEL_SQL_DML.has(tok.toLowerCase())) return tok.toLowerCase();
  }
  return null;
}

/** Throw if a bracket-SQL block contains a mutating statement (checks EVERY `;`-separated statement). */
function assertSqlReadOnly(sqlBlock: string): void {
  for (const stmt of sqlBlock.split(";")) {
    const s = stmt.trim().replace(/^\(+\s*/, "");
    if (!s) continue;
    const kw = s.split(/\s+/)[0]?.toLowerCase();
    if (!kw) continue;
    if (MUTATING_SQL.has(kw)) {
      throw new ReadOnlyViolation(`Blocked in read-only mode: SQL '${kw}' statement.`);
    }
    if (kw === "with" || kw === "select") {
      const v = topLevelViolation(s);
      if (v) {
        throw new ReadOnlyViolation(
          `Blocked in read-only mode: SQL '${v}' at the top level of a ${kw.toUpperCase()} statement.`
        );
      }
    }
  }
}

/**
 * Throw ReadOnlyViolation if a MOCA script would mutate data. Allowlist/denylist
 * based: blocks the unsafe pattern, mutating bracket-SQL DML (every statement in
 * the block, including CTE-smuggled DML and SELECT INTO), and mutating MOCA verbs
 * at the head of each `;`/`|` segment. String literals and `--` comments are
 * neutralized before scanning. Read verbs (select/list/publish data/sl_get/get/
 * ping/noop/describe and unknown verbs) are permitted.
 */
export function assertReadOnly(script: string): void {
  const cleaned = sanitizeForScan(stripMocaComments(script));

  const unsafe = UNSAFE_RE.exec(cleaned);
  if (unsafe) {
    throw new ReadOnlyViolation(
      `Blocked in read-only mode: unsafe operation '${unsafe[1].replace(/\s+/g, " ")}'.`
    );
  }

  for (const m of cleaned.matchAll(/\[([\s\S]*?)\]/g)) {
    assertSqlReadOnly(m[1]);
  }

  const withoutSql = cleaned.replace(/\[([\s\S]*?)\]/g, " ");
  for (const seg of withoutSql.split(/[;|]/)) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const firstWord = trimmed.replace(/^[\s(!^@-]+/, "").split(/\s+/)[0]?.toLowerCase();
    if (firstWord && MUTATING_MOCA_VERBS.has(firstWord)) {
      throw new ReadOnlyViolation(`Blocked in read-only mode: MOCA verb '${firstWord}'.`);
    }
  }
}
