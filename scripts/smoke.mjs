// Smoke test: spawn the built server over stdio, list tools/resources/prompts, and
// call tools that don't require a live MOCA connection (including the read-only guard).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` -> ${detail}` : ""}`);
  if (!ok) failures++;
}

// Pass the full environment through to the child so c8's NODE_V8_COVERAGE reaches
// the spawned server (the MCP stdio transport otherwise filters env vars).
const transport = new StdioClientTransport({
  command: "node",
  args: ["build/index.js"],
  env: process.env,
});
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("TOOLS (" + tools.tools.length + "):", tools.tools.map((t) => t.name).join(", "));
const runQuery = tools.tools.find((t) => t.name === "run_moca_query");
check("run_moca_query declares outputSchema", !!runQuery?.outputSchema);

const resources = await client.listResources();
console.log("RESOURCES (" + resources.resources.length + "):", resources.resources.map((r) => r.uri).join(", "));

const prompts = await client.listPrompts();
console.log("PROMPTS (" + prompts.prompts.length + "):", prompts.prompts.map((p) => p.name).join(", "));
check("3 prompts registered", prompts.prompts.length === 3);

const prompt = await client.getPrompt({ name: "explore_table", arguments: { tableName: "invlod" } });
check("explore_table prompt renders", prompt.messages?.[0]?.content?.text?.includes("invlod") === true);

const status = await client.callTool({ name: "get_session_status", arguments: {} });
console.log("get_session_status ->", status.content[0].text);
check("get_session_status has structuredContent", !!status.structuredContent);

const list = await client.callTool({ name: "list_connections", arguments: {} });
console.log("list_connections ->", list.content[0].text.slice(0, 200));

const disc = await client.callTool({ name: "discover_connections", arguments: {} });
console.log("discover_connections ->", disc.content[0].text.slice(0, 400));

// Read-only guard: each of these must be blocked BEFORE any connection is needed.
const blocked = [
  ["MOCA verb", "delete from foo where x=1", "'delete'"],
  ["CTE-smuggled DML", "[with c as (select 1 from dual) delete from t]", "'delete'"],
  ["multi-statement", "[select 1 from dual; drop table x]", "'drop'"],
  ["line-comment mask", "[-- sneaky\ndelete from t]", "'delete'"],
  ["exec", "[exec xp_cmdshell 'dir']", "'exec'"],
  ["select into", "[select * into evil from t]", "'into'"],
];
for (const [label, query, expect] of blocked) {
  const res = await client.callTool({ name: "run_moca_query", arguments: { query } });
  const text = res.content[0].text;
  check(
    `guard blocks ${label}`,
    res.isError === true && text.includes("Blocked in read-only mode") && text.includes(expect),
    text
  );
}

// A legitimate read must pass the guard and fail only on the missing connection.
const legit = await client.callTool({
  name: "run_moca_query",
  arguments: { query: "select count(*) cnt from invlod" },
});
check(
  "guard allows plain SELECT (fails on no connection)",
  legit.isError === true && legit.content[0].text.includes("No active connection"),
  legit.content[0].text
);

const ov = await client.readResource({ uri: "resource://moca_server_overview" });
console.log("overview resource bytes:", ov.contents[0].text.length);

await client.close();
if (failures > 0) {
  console.error(`SMOKE FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log("SMOKE OK");
