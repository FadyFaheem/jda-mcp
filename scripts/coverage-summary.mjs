// Renders coverage/coverage-summary.json as a small markdown table.
// Used by CI to append a coverage report to the GitHub Actions job summary;
// also handy locally (`node scripts/coverage-summary.mjs`). Never fails the
// build: if the summary file is missing it prints a note and exits 0.
import fs from "node:fs";

const summaryPath = "coverage/coverage-summary.json";

if (!fs.existsSync(summaryPath)) {
  console.log(`> No coverage summary found at \`${summaryPath}\`. Run \`npm run coverage\` first.`);
  process.exit(0);
}

const { total } = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const cell = (m) => `${m.pct}% (${m.covered}/${m.total})`;

const lines = [
  "## Coverage (smoke test)",
  "",
  "| Metric | Coverage |",
  "| --- | --- |",
  `| Statements | ${cell(total.statements)} |`,
  `| Branches | ${cell(total.branches)} |`,
  `| Functions | ${cell(total.functions)} |`,
  `| Lines | ${cell(total.lines)} |`,
  "",
  "_Full HTML report is attached to the workflow run as the `coverage-report` artifact._",
];

console.log(lines.join("\n"));
