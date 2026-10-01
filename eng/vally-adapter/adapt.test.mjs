import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const root = mkdtempSync(join(tmpdir(), "microcks-vally-adapter-"));
const runDir = join(root, "experiment");
const outputRoot = join(root, "results");
const fakeVally = join(root, "fake-vally.mjs");
const adapter = new URL("./adapt.mjs", import.meta.url);

function writeJsonl(path, records) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

function record(variant, trialIndex) {
  return {
    type: "trial-result",
    evalFilePath: "/repo/tests/plugin1/skill1/eval.yaml",
    variant,
    stimulus: "Creates examples",
    trialIndex,
    status: "success",
    gradeResult: { score: 1, passed: true },
  };
}

writeJsonl(join(runDir, "baseline", "results.jsonl"), Array.from({ length: 5 }, (_, index) => record("baseline", index)));
writeJsonl(join(runDir, "skilled", "results.jsonl"), Array.from({ length: 5 }, (_, index) => record("skilled", index)));
writeFileSync(fakeVally, `
  import { writeFileSync } from "node:fs";
  const output = process.argv[process.argv.indexOf("--output") + 1];
  writeFileSync(output, JSON.stringify({
    summary: { meanScore: 0.4, ciLow: 0.2, ciHigh: 0.6, wins: 5, ties: 0, losses: 0, winRate: 1, trialCount: 5, erroredCount: 0 },
    stimuli: [{ stimulusName: "Creates examples", meanScore: 0.4, trials: Array.from({ length: 5 }, () => ({ winner: "treatment" })) }],
    unmatchedBaseline: [], unmatchedTreatment: []
  }) + "\\n");
`);

const result = execFileSync(process.execPath, [
  adapter.pathname,
  "--experiment-dir", runDir,
  "--output-root", outputRoot,
  "--vally", `${process.execPath} ${fakeVally}`,
  "--model", "test-model",
  "--judge-model", "test-judge",
], { encoding: "utf8" });

const output = JSON.parse(readFileSync(join(outputRoot, "plugin1", "skill1", "results.json"), "utf8"));

test("writes a credible per-skill improvement verdict", () => {
  assert.match(result, /Wrote 1 results.json/);
  assert.equal(output.model, "test-model");
  assert.equal(output.judgeModel, "test-judge");
  assert.equal(output.verdicts[0].passed, true);
  assert.equal(output.verdicts[0].underpowered, false);
  assert.deepEqual(output.verdicts[0].signTest, { wins: 5, ties: 0, losses: 0, discordant: 5, pValue: 0.03125, alpha: 0.05 });
});
