import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface ParsedDoc {
  name: string;
  description: string;
  uri: string;
  body: string;
}

function parseFrontmatter(raw: string, fallbackName: string): ParsedDoc {
  let name = fallbackName;
  let description = "";
  let uri = `resource://${fallbackName}`;
  let body = raw;

  if (raw.startsWith("---")) {
    const end = raw.indexOf("\n---", 3);
    if (end !== -1) {
      const fm = raw.slice(3, end).trim();
      body = raw.slice(end + 4).replace(/^\r?\n/, "");
      for (const line of fm.split(/\r?\n/)) {
        const m = /^(\w+)\s*:\s*(.*)$/.exec(line.trim());
        if (!m) continue;
        const key = m[1].toLowerCase();
        const value = m[2].trim().replace(/^['"]|['"]$/g, "");
        if (key === "name") name = value;
        else if (key === "description") description = value;
        else if (key === "uritemplate" || key === "uri") uri = value;
      }
    }
  }
  return { name, description, uri, body };
}

/** Load every markdown file next to this module and register it as an MCP resource. */
export function registerResources(server: McpServer): void {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return;
  }
  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    const doc = parseFrontmatter(raw, file.replace(/\.md$/, ""));
    server.registerResource(
      doc.name,
      doc.uri,
      { title: doc.name, description: doc.description, mimeType: "text/markdown" },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: doc.body }],
      })
    );
  }
}
