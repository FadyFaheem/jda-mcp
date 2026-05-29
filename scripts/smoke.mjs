// Smoke test: spawn the built server over stdio, list tools/resources, and call
// a couple of tools that don't require a live MOCA connection.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["build/index.js"] });
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("TOOLS (" + tools.tools.length + "):", tools.tools.map((t) => t.name).join(", "));

const resources = await client.listResources();
console.log("RESOURCES (" + resources.resources.length + "):", resources.resources.map((r) => r.uri).join(", "));

const status = await client.callTool({ name: "get_session_status", arguments: {} });
console.log("get_session_status ->", status.content[0].text);

const list = await client.callTool({ name: "list_connections", arguments: {} });
console.log("list_connections ->", list.content[0].text);

const disc = await client.callTool({ name: "discover_connections", arguments: {} });
console.log("discover_connections ->", disc.content[0].text.slice(0, 400));

const guard = await client.callTool({ name: "run_moca_query", arguments: { query: "delete from foo where x=1" } });
console.log("run_moca_query(guard) -> isError=" + guard.isError + " " + guard.content[0].text);

const ov = await client.readResource({ uri: "resource://moca_server_overview" });
console.log("overview resource bytes:", ov.contents[0].text.length);

await client.close();
console.log("SMOKE OK");
