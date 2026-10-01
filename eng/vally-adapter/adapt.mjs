#!/usr/bin/env node
/**
 * Convert a Vally experiment's baseline and skilled JSONL records into one
 * comparison verdict per external skill evaluation.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: options } = parseArgs({
  options: {
    "experiment-dir": { type: "string" },
    "output-root": { type: "string", default: "eval-results" },
    "baseline-variant": { type: "string", default: "baseline" },
    "skilled-variant": { type: "string", default: "skilled" },
    vally: { type: "string", default: "npx --yes @microsoft/vally-cli@0.12.0" },
    model: { type: "string", default: "unknown" },
    "judge-model": { type: "string", default: "unknown" },
    help: { type: "boolean", default: false },
  },
  strict: true,
});

if (options.help || !options["experiment-dir"]) {
  console.log(`Usage: node adapt.mjs --experiment-dir <run-dir> [options]

Compare baseline and skilled Vally records per eval and write:
  <output-root>/<plugin>/<skill>/results.json`);
  process.exit(options.help ? 0 : 1);
}

const SIGN_TEST_ALPHA = 0.05;
const MIN_CREDIBLE_TRIALS = 5;

function parseJsonl(file) {
  const text = readFileSync(file, "utf8").trim();
  return text ? text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
}

function evalFileOf(record) {
  return record.experiment?.evalFile ?? record.evalFilePath ?? "";
}

function groupByEval(records) {
  const grouped = new Map();
  for (const record of records.filter((record) => record.type === "trial-result")) {
    const evalFile = evalFileOf(record);
    if (!evalFile) continue;
    const values = grouped.get(evalFile) ?? [];
    values.push(record);
    grouped.set(evalFile, values);
  }
  return grouped;
}

function identity(evalFile) {
  const skill = basename(dirname(evalFile));
  const plugin = basename(dirname(dirname(evalFile)));
  return { plugin, skill, skillPath: `plugins/${plugin}/skills/${skill}` };
}

function splitCommand(command) {
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return tokens.map((token) => token.replace(/^(?:"|')|(?:"|')$/g, ""));
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let value = 1;
  for (let index = 1; index <= k; index += 1) value = (value * (n - k + index)) / index;
  return value;
}

function signTestPValue(wins, losses) {
  const discordant = wins + losses;
  if (discordant === 0) return 1;
  const favored = Math.max(wins, losses);
  let tail = 0;
  for (let count = favored; count <= discordant; count += 1) tail += choose(discordant, count);
  return tail / 2 ** discordant;
}

function comparisonVerdict(report, evaluation) {
  const summary = report.summary ?? {};
  const wins = summary.wins ?? 0;
  const ties = summary.ties ?? 0;
  const losses = summary.losses ?? 0;
  const trialCount = summary.trialCount ?? wins + ties + losses;
  const discordant = wins + losses;
  const pValue = signTestPValue(wins, losses);
  const unmatchedTrialCount = (report.unmatchedBaseline?.length ?? 0) + (report.unmatchedTreatment?.length ?? 0);
  const erroredCount = summary.erroredCount ?? 0;
  const conclusive = erroredCount === 0 && unmatchedTrialCount === 0 && wins + ties + losses === trialCount;
  const underpowered = conclusive && trialCount < MIN_CREDIBLE_TRIALS;
  const passed = conclusive && !underpowered && wins > losses && pValue <= SIGN_TEST_ALPHA;
  const regressed = conclusive && !underpowered && losses > wins && pValue <= SIGN_TEST_ALPHA;
  const netWin = trialCount ? (wins - losses) / trialCount : 0;
  const reason = !conclusive
    ? `incomplete comparison (${erroredCount} errored, ${unmatchedTrialCount} unmatched trial(s))`
    : underpowered
      ? `underpowered (${trialCount} trial(s); a credible verdict needs at least ${MIN_CREDIBLE_TRIALS})`
      : passed
        ? `credibly better (${wins}W/${ties}T/${losses}L, sign test p=${pValue.toFixed(3)})`
        : regressed
          ? `credibly worse (${wins}W/${ties}T/${losses}L, sign test p=${pValue.toFixed(3)})`
          : `no credible improvement (${wins}W/${ties}T/${losses}L, sign test p=${pValue.toFixed(3)})`;

  return {
    skillName: evaluation.skill,
    skillPath: evaluation.skillPath,
    conclusive,
    underpowered,
    minCredibleTrials: MIN_CREDIBLE_TRIALS,
    passed,
    regressed,
    netWin,
    signTest: { wins, ties, losses, discordant, pValue, alpha: SIGN_TEST_ALPHA },
    meanScore: summary.meanScore ?? 0,
    confidenceInterval: { low: summary.ciLow ?? null, high: summary.ciHigh ?? null, level: 0.95 },
    winRate: summary.winRate ?? null,
    trialCount,
    erroredCount,
    unmatchedTrialCount,
    scenarios: (report.stimuli ?? []).map((stimulus) => ({
      scenarioName: stimulus.stimulusName ?? "Unnamed scenario",
      meanScore: stimulus.meanScore ?? 0,
      trials: (stimulus.trials ?? []).map((trial) => ({
        winner: trial.winner ?? "tie",
        magnitude: trial.magnitude ?? null,
        evidence: trial.evidence ?? "",
        errored: trial.errored ?? false,
      })),
    })),
    reason,
  };
}

function compare(baseline, skilled, output) {
  const [binary, ...prefix] = splitCommand(options.vally);
  if (!binary) throw new Error("Vally command is empty");
  execFileSync(binary, [...prefix, "compare", "--baseline", baseline, "--treatment", skilled, "--judge-model", options["judge-model"], "--output", output], { stdio: "inherit" });
  return parseJsonl(output)[0] ?? null;
}

const runDirectory = resolve(options["experiment-dir"]);
const outputRoot = resolve(options["output-root"]);
const baseline = groupByEval(parseJsonl(join(runDirectory, options["baseline-variant"], "results.jsonl")));
const skilled = groupByEval(parseJsonl(join(runDirectory, options["skilled-variant"], "results.jsonl")));
const evaluations = [...new Set([...baseline.keys(), ...skilled.keys()])].sort();
const temporary = mkdtempSync(join(tmpdir(), "microcks-vally-adapter-"));
let written = 0;
let incomplete = 0;

try {
  for (const evalFile of evaluations) {
    const baselineRecords = baseline.get(evalFile) ?? [];
    const skilledRecords = skilled.get(evalFile) ?? [];
    const evaluation = identity(evalFile);
    if (!baselineRecords.length || !skilledRecords.length) {
      console.warn(`⚠ ${evaluation.plugin}/${evaluation.skill}: missing baseline or skilled records`);
      incomplete += 1;
      continue;
    }

    const prefix = `${evaluation.plugin}__${evaluation.skill}`;
    const baselineFile = join(temporary, `${prefix}__baseline.jsonl`);
    const skilledFile = join(temporary, `${prefix}__skilled.jsonl`);
    const compareFile = join(temporary, `${prefix}__compare.jsonl`);
    writeFileSync(baselineFile, `${baselineRecords.map(JSON.stringify).join("\n")}\n`);
    writeFileSync(skilledFile, `${skilledRecords.map(JSON.stringify).join("\n")}\n`);

    let report;
    try {
      report = compare(baselineFile, skilledFile, compareFile);
    } catch (error) {
      console.warn(`⚠ ${evaluation.plugin}/${evaluation.skill}: Vally compare failed: ${error.message}`);
      incomplete += 1;
      continue;
    }
    if (!report) {
      console.warn(`⚠ ${evaluation.plugin}/${evaluation.skill}: Vally compare wrote no report`);
      incomplete += 1;
      continue;
    }

    const verdict = comparisonVerdict(report, evaluation);
    const result = { model: options.model, judgeModel: options["judge-model"], timestamp: new Date().toISOString(), verdicts: [verdict] };
    const directory = join(outputRoot, evaluation.plugin, evaluation.skill);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "results.json"), `${JSON.stringify(result, null, 2)}\n`);
    written += 1;
    console.log(`${verdict.passed ? "✅" : verdict.underpowered || !verdict.conclusive ? "⚠️" : "❌"} ${evaluation.plugin}/${evaluation.skill}: ${verdict.reason}`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log(`Wrote ${written} results.json file(s) under ${outputRoot}${incomplete ? ` (${incomplete} incomplete)` : ""}`);
if (written === 0) process.exitCode = 1;
