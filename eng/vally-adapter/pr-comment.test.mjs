import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadVerdicts, MARKER, renderComment, verdictLabel } from "./pr-comment.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const RUN_URL = "https://github.com/microcks/microcks-agent-skills/actions/runs/1";

function writeResult(root, plugin, skill, verdict) {
  const directory = join(root, plugin, skill);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "results.json"), JSON.stringify({
    model: "test-model",
    judgeModel: "test-judge",
    verdicts: [{
      skillName: skill,
      skillPath: `plugins/${plugin}/skills/${skill}`,
      conclusive: true,
      underpowered: false,
      passed: true,
      regressed: false,
      netWin: 1,
      signTest: { wins: 5, ties: 0, losses: 0, discordant: 5, pValue: 0.03125, alpha: 0.05 },
      trialCount: 5,
      scenarios: [{ scenarioName: "SECRET_PROMPT", trials: [{ winner: "treatment", evidence: "SECRET_EVIDENCE" }] }],
      reason: "credibly better",
      ...verdict,
    }],
  }));
}

test("renders aggregate verdicts without raw evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "microcks-pr-comment-"));
  writeResult(root, "plugin1", "skill1", {});
  writeResult(root, "plugin1", "skill2", { passed: false, underpowered: true, trialCount: 2, netWin: -0.5 });
  mkdirSync(join(root, "_experiment", "x"), { recursive: true });
  writeFileSync(join(root, "_experiment", "x", "results.json"), "not json");

  const body = renderComment({ rows: loadVerdicts(root), sha: SHA, runUrl: RUN_URL, scope: "plugin1" });

  assert.ok(body.startsWith(`${MARKER}\n`));
  assert.match(body, /Commit `0123456` · scope `plugin1` · \[workflow run\]\(https:\/\/github.com\//);
  assert.match(body, /`test-model` judged by `test-judge`/);
  assert.match(body, /\| `plugin1\/skill1` \| ✅ Credibly better \| 5\/0\/0 \| 0\.031 \| 5 \| \+100% \|/);
  assert.match(body, /\| `plugin1\/skill2` \| ⚠️ Underpowered \| .* \| 2 \| -50% \|/);
  assert.doesNotMatch(body, /SECRET_PROMPT|SECRET_EVIDENCE/);
});

test("reports a failed run without verdicts", () => {
  const body = renderComment({ rows: [], sha: SHA, runUrl: RUN_URL, outcome: "failure" });
  assert.match(body, /status `failure`\. No verdict was produced\./);
  assert.doesNotMatch(body, /\| Skill \|/);
});

test("announces a queued evaluation for the frozen commit", () => {
  const body = renderComment({ rows: [], sha: SHA, runUrl: RUN_URL, outcome: "queued", scope: "plugin1/skill1" });
  assert.match(body, /Commit `0123456` · scope `plugin1\/skill1`/);
  assert.match(body, /⏳ Evaluation queued/);
  assert.doesNotMatch(body, /WARNING|No adapted verdict/);
});

test("neutralises unexpected identifiers and links", () => {
  const body = renderComment({
    rows: [{ skill: "plugin1/skill1", model: "bad`model", judgeModel: "judge", verdict: { conclusive: true } }],
    sha: "not-a-sha",
    runUrl: "javascript:alert(1)",
    scope: "x|y",
  });
  assert.match(body, /Commit `unknown` · scope `unknown` · workflow run\n/);
  assert.doesNotMatch(body, /javascript:/);
});

test("labels every verdict state", () => {
  assert.equal(verdictLabel({ conclusive: false }), "⚠️ Incomplete");
  assert.equal(verdictLabel({ conclusive: true, regressed: true }), "❌ Credibly worse");
  assert.equal(verdictLabel({ conclusive: true }), "➖ No credible improvement");
});

test("writes the comment through the CLI", () => {
  const root = mkdtempSync(join(tmpdir(), "microcks-pr-comment-cli-"));
  writeResult(join(root, "results"), "plugin1", "skill1", {});
  const output = join(root, "comment.md");
  execFileSync(process.execPath, [
    new URL("./pr-comment.mjs", import.meta.url).pathname,
    "--results-dir", join(root, "results"),
    "--sha", SHA,
    "--run-url", RUN_URL,
    "--output", output,
  ]);
  assert.match(readFileSync(output, "utf8"), /plugin1\/skill1/);
});
