#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    report: { type: "string", default: "artifacts/validation/report.json" },
    history: { type: "string", default: "dashboard-data/history.json" },
    output: { type: "string", default: "artifacts/dashboard" },
    help: { type: "boolean", default: false },
  },
  strict: true,
});

if (values.help) {
  console.log("Usage: node eng/dashboard/build.mjs [--report file] [--history file] [--output dir]");
  process.exit(0);
}

const root = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const source = join(root, "eng/dashboard/site");
const output = resolve(root, values.output);
const reportPath = resolve(root, values.report);
const historyPath = resolve(root, values.history);

const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
};

const report = readJson(reportPath, null);
if (!report || report.schemaVersion !== 1 || !report.catalog) {
  throw new Error(`Validation report is missing or unsupported: ${reportPath}`);
}
const history = readJson(historyPath, { schemaVersion: 1, skills: {} });
if (history.schemaVersion !== 1 || typeof history.skills !== "object") {
  throw new Error(`Dashboard history is unsupported: ${historyPath}`);
}

mkdirSync(output, { recursive: true });
cpSync(source, output, { recursive: true });
mkdirSync(join(output, "data"), { recursive: true });
const publicData = {
  schemaVersion: 1,
  generatedAt: report.generatedAt,
  summary: report.summary,
  plugins: report.catalog.plugins,
  findings: report.findings.map(({ severity, status, code, path, component, message }) => ({ severity, status, code, path, component, message })),
  history: history.skills,
};
writeFileSync(join(output, "data/catalog.json"), `${JSON.stringify(publicData, null, 2)}\n`);
writeFileSync(join(output, ".nojekyll"), "");
console.log(`Dashboard built at ${output} from ${basename(reportPath)}`);
