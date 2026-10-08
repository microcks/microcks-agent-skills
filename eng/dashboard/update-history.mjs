#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    results: { type: "string", multiple: true, default: [] },
    history: { type: "string", default: "dashboard-data/history.json" },
    commit: { type: "string" },
    run: { type: "string" },
    url: { type: "string" },
    help: { type: "boolean", default: false },
  },
  strict: true,
});

if (values.help || !values.results.length) {
  console.log("Usage: node eng/dashboard/update-history.mjs --results <results.json> [...] [--history file] [--commit sha] [--run id] [--url link]");
  process.exit(values.help ? 0 : 2);
}

const root = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const historyPath = resolve(root, values.history);
let history = { schemaVersion: 1, skills: {} };
try {
  history = JSON.parse(readFileSync(historyPath, "utf8"));
} catch {
  // First publication starts from an empty history.
}
if (history.schemaVersion !== 1 || typeof history.skills !== "object") {
  throw new Error(`Unsupported dashboard history: ${historyPath}`);
}

for (const resultInput of values.results) {
  const result = JSON.parse(readFileSync(resolve(root, resultInput), "utf8"));
  for (const verdict of result.verdicts ?? []) {
    const match = /^plugins\/([^/]+)\/skills\/([^/]+)$/.exec(verdict.skillPath ?? "");
    if (!match) continue;
    const key = `${match[1]}/${match[2]}`;
    const entry = {
      id: `${values.run ?? "local"}:${key}:${result.timestamp ?? "unknown"}`,
      timestamp: result.timestamp ?? new Date().toISOString(),
      commit: values.commit ?? null,
      run: values.run ?? null,
      url: values.url ?? null,
      model: result.model ?? "unknown",
      judgeModel: result.judgeModel ?? "unknown",
      state: verdict.conclusive === false || verdict.underpowered === true
        ? "inconclusive"
        : verdict.regressed === true
          ? "regression"
          : verdict.passed === true
            ? "pass"
            : "no-improvement",
      reason: verdict.reason ?? "",
      netWin: verdict.netWin ?? 0,
      trialCount: verdict.trialCount ?? 0,
      signTest: {
        wins: verdict.signTest?.wins ?? 0,
        ties: verdict.signTest?.ties ?? 0,
        losses: verdict.signTest?.losses ?? 0,
        pValue: verdict.signTest?.pValue ?? null,
      },
    };
    const previous = Array.isArray(history.skills[key]) ? history.skills[key] : [];
    const deduplicated = previous.filter((item) => item.id !== entry.id);
    history.skills[key] = [...deduplicated, entry]
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
      .slice(-5);
  }
}

history.updatedAt = new Date().toISOString();
mkdirSync(dirname(historyPath), { recursive: true });
writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`);
console.log(`Updated dashboard history: ${historyPath}`);
