// Copies the markdown resource files into the build output, since tsc does not
// copy non-TS assets. Run as part of `npm run build`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(root, "..", "src", "resources");
const outDir = path.join(root, "..", "build", "resources");

fs.mkdirSync(outDir, { recursive: true });
let copied = 0;
for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".md")) {
    fs.copyFileSync(path.join(srcDir, entry.name), path.join(outDir, entry.name));
    copied++;
  }
}
console.log(`copy-resources: copied ${copied} markdown file(s) to build/resources`);
