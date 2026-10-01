import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseEvalCommand } from "./eval-request.mjs";

test("ignores comments that are not an /evals command", () => {
  for (const body of ["", "LGTM", "please run /evals", "/evalsplugin1", "/eval plugin1"]) {
    assert.equal(parseEvalCommand(body).requested, false, body);
  }
});

test("accepts every supported scope", () => {
  assert.deepEqual(parseEvalCommand("/evals"), { requested: true, valid: true, plugin: "", skill: "", error: "" });
  assert.deepEqual(parseEvalCommand("  /evals plugin1  "), { requested: true, valid: true, plugin: "plugin1", skill: "", error: "" });
  assert.deepEqual(parseEvalCommand("/evals plugin1 skill-1\nthanks!"), { requested: true, valid: true, plugin: "plugin1", skill: "skill-1", error: "" });
});

test("rejects unsafe or excessive arguments", () => {
  for (const body of ["/evals ../plugin", "/evals plugin1 skill;rm", "/evals -x", "/evals a b c", "/evals plugin1 $(id)"]) {
    const result = parseEvalCommand(body);
    assert.equal(result.requested, true, body);
    assert.equal(result.valid, false, body);
    assert.match(result.error, /Usage/, body);
  }
});

test("writes GitHub Actions outputs", () => {
  const output = join(mkdtempSync(join(tmpdir(), "microcks-eval-request-")), "output");
  execFileSync(process.execPath, [new URL("./eval-request.mjs", import.meta.url).pathname], {
    env: { ...process.env, COMMENT_BODY: "/evals plugin1 skill1", GITHUB_OUTPUT: output },
  });
  assert.equal(readFileSync(output, "utf8"), "requested=true\nvalid=true\nplugin=plugin1\nskill=skill1\nerror=\n");
});
