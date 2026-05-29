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

/** Mutating SQL keywords (leading keyword inside a [ ... ] bracket-SQL block). */
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
]);

/**
 * Throw ReadOnlyViolation if a MOCA script would mutate data. Allowlist/denylist
 * based: blocks the unsafe pattern, mutating bracket-SQL DML, and mutating MOCA
 * verbs at the head of each `;`/`|` segment. Read verbs (select/list/publish
 * data/sl_get/get/ping/noop/describe and unknown verbs) are permitted.
 */
export function assertReadOnly(script: string): void {
  const cleaned = stripMocaComments(script);

  const unsafe = UNSAFE_RE.exec(cleaned);
  if (unsafe) {
    throw new ReadOnlyViolation(
      `Blocked in read-only mode: unsafe operation '${unsafe[1].replace(/\s+/g, " ")}'.`
    );
  }

  for (const m of cleaned.matchAll(/\[([\s\S]*?)\]/g)) {
    const inner = m[1].trim().replace(/^\(+\s*/, "");
    const kw = inner.split(/\s+/)[0]?.toLowerCase();
    if (kw && MUTATING_SQL.has(kw)) {
      throw new ReadOnlyViolation(`Blocked in read-only mode: SQL '${kw}' statement.`);
    }
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
