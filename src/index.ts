#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { parsePermissions } from "./permissions.js";

async function main(): Promise<void> {
  const perms = parsePermissions(process.argv.slice(2), process.env);
  const server = buildServer(perms);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs MUST go to stderr (stdout is the JSON-RPC channel).
  console.error(
    `${SERVER_NAME} v${SERVER_VERSION} running on stdio ` +
      `(writes ${perms.allowWrite ? "PRE-APPROVED via --allow-write" : "require per-operation approval / disabled"})`
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
