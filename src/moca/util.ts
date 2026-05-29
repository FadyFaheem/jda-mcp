/** Escape text for an XML attribute value. */
export function xmlEscape(text: string | null | undefined): string {
  if (text == null) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&apos;")
    .replace(/"/g, "&quot;");
}

/**
 * Escape text for XML element content (e.g. <query>). Single/double quotes are
 * left as-is because MOCA expects literal quotes inside the query text.
 */
export function xmlEscapeContent(text: string | null | undefined): string {
  if (text == null) return "";
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Remove SQL block comments from a MOCA query while preserving MOCA hints:
 * any block comment whose body starts with '+' or '#' (optimizer/server hints
 * like the rule hint or the nolimit hint) is kept. '--' is left untouched.
 */
export function stripMocaComments(query: string): string {
  const result = query.replace(/\/\*([\s\S]*?)\*\//g, (match, body: string) => {
    const stripped = body.replace(/^\s+/, "");
    return stripped.startsWith("+") || stripped.startsWith("#") ? match : "";
  });
  return result
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

/** Escape a single-quoted SQL/MOCA string literal value. */
export function sqlQuote(value: string): string {
  return value.replace(/'/g, "''");
}
