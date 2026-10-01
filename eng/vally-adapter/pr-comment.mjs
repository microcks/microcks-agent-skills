#!/usr/bin/env node
/**
 * Render adapted Vally verdicts as an aggregate-only pull-request comment.
 *
 * Usage:
 *   node pr-comment.mjs --results-dir <dir> --sha <commit> --run-url <url> \
 *     [--outcome queued|success|failure|cancelled|skipped] [--scope <label>] [--output <file>]
 *
 * Only verdict metrics are rendered. Prompts, evidence, and trajectories stay
 * in the workflow artifacts.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const MARKER = "<!-- vally-evals -->";
const NAME = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

function safe(value, pattern = LABEL) {
  const text = String(value ?? "");
  return pattern.test(text) ? text : "unknown";
}

function findResults(directory) {
  if (!directory || !existsSync(directory)) return [];
  const found = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "_experiment") continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...findResults(path));
    else if (entry === "results.json") found.push(path);
  }
  return found;
}

function identity(verdict, file, root) {
  const fromSkillPath = /^plugins\/([^/]+)\/skills\/([^/]+)$/.exec(verdict.skillPath ?? "");
  const [plugin, skill] = fromSkillPath
    ? [fromSkillPath[1], fromSkillPath[2]]
    : relative(root, file).split(sep).slice(-3, -1);
  return `${safe(plugin, NAME)}/${safe(skill ?? verdict.skillName, NAME)}`;
}

export function verdictLabel(verdict) {
  if (!verdict.conclusive) return "⚠️ Incomplete";
  if (verdict.underpowered) return "⚠️ Underpowered";
  if (verdict.passed) return "✅ Credibly better";
  if (verdict.regressed) return "❌ Credibly worse";
  return "➖ No credible improvement";
}

function number(value, digits) {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function percent(value) {
  if (!Number.isFinite(value)) return "n/a";
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

export function loadVerdicts(resultsDir) {
  const rows = [];
  for (const file of findResults(resultsDir).sort()) {
    const result = JSON.parse(readFileSync(file, "utf8"));
    for (const verdict of result.verdicts ?? []) {
      rows.push({
        skill: identity(verdict, file, resultsDir),
        model: safe(result.model),
        judgeModel: safe(result.judgeModel),
        verdict,
      });
    }
  }
  return rows.sort((left, right) => left.skill.localeCompare(right.skill));
}

export function renderComment({ rows, sha, runUrl, outcome = "success", scope = "all" }) {
  const shortSha = /^[0-9a-f]{40}$/i.test(sha ?? "") ? sha.slice(0, 7) : "unknown";
  const run = /^https:\/\/[^\s)]+$/.test(runUrl ?? "") ? `[workflow run](${runUrl})` : "workflow run";
  const lines = [
    MARKER,
    "## Vally evaluation",
    "",
    `Commit \`${shortSha}\` · scope \`${safe(scope)}\` · ${run}`,
  ];

  const models = [...new Set(rows.map((row) => `\`${row.model}\` judged by \`${row.judgeModel}\``))];
  if (models.length) lines.push(`Model: ${models.join(", ")}`);
  lines.push("");

  if (outcome === "queued") {
    lines.push("⏳ Evaluation queued. It starts once a maintainer approves the `vally-evaluation` environment for this commit.", "");
  } else if (outcome !== "success") {
    lines.push(`> [!WARNING]`, `> The evaluation job finished with status \`${safe(outcome)}\`.${rows.length ? " Verdicts below may be partial." : " No verdict was produced."}`, "");
  }

  if (rows.length) {
    lines.push(
      "| Skill | Verdict | W/T/L | p-value | Trials | Net win |",
      "|-------|---------|-------|---------|--------|---------|",
    );
    for (const { skill, verdict } of rows) {
      const sign = verdict.signTest ?? {};
      lines.push(`| \`${skill}\` | ${verdictLabel(verdict)} | ${sign.wins ?? 0}/${sign.ties ?? 0}/${sign.losses ?? 0} | ${number(sign.pValue, 3)} | ${verdict.trialCount ?? 0} | ${percent(verdict.netWin)} |`);
    }
    lines.push("");
  } else if (outcome === "success") {
    lines.push("No adapted verdict was produced for this scope.", "");
  }

  lines.push(
    "<sub>Advisory skill-versus-baseline comparison. A verdict is credible only with at least five trials and a one-sided sign test at p ≤ 0.05. Prompts and trajectories are never posted here; they stay in the run's workflow artifacts (14-day retention).</sub>",
  );
  return `${lines.join("\n")}\n`;
}

function main() {
  const { values } = parseArgs({
    options: {
      "results-dir": { type: "string", default: "eval-results" },
      sha: { type: "string", default: "" },
      "run-url": { type: "string", default: "" },
      outcome: { type: "string", default: "success" },
      scope: { type: "string", default: "all" },
      output: { type: "string" },
    },
    strict: true,
  });
  const body = renderComment({
    rows: loadVerdicts(values["results-dir"]),
    sha: values.sha,
    runUrl: values["run-url"],
    outcome: values.outcome,
    scope: values.scope,
  });
  if (values.output) writeFileSync(values.output, body);
  else process.stdout.write(body);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
