#!/usr/bin/env node
/**
 * Parse a maintainer `/evals [plugin] [skill]` pull-request comment.
 *
 * CLI usage (GitHub Actions): COMMENT_BODY="/evals plugin1 skill1" node eval-request.mjs
 * Writes `requested`, `valid`, `plugin`, `skill`, and `error` to $GITHUB_OUTPUT when set,
 * otherwise prints them as key=value lines.
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const COMMAND = "/evals";
const NAME = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
export const USAGE = "Usage: `/evals`, `/evals <plugin>`, or `/evals <plugin> <skill>`.";

export function parseEvalCommand(body) {
  const firstLine = String(body ?? "").split(/\r?\n/, 1)[0].trim();
  const [command, ...args] = firstLine.split(/\s+/).filter(Boolean);
  if (command !== COMMAND) {
    return { requested: false, valid: false, plugin: "", skill: "", error: "" };
  }

  const invalid = (error) => ({ requested: true, valid: false, plugin: "", skill: "", error });
  if (args.length > 2) return invalid(`Too many arguments. ${USAGE}`);
  const [plugin = "", skill = ""] = args;
  if (plugin && !NAME.test(plugin)) return invalid(`Invalid plugin name. ${USAGE}`);
  if (skill && !NAME.test(skill)) return invalid(`Invalid skill name. ${USAGE}`);
  return { requested: true, valid: true, plugin, skill, error: "" };
}

function main() {
  const result = parseEvalCommand(process.env.COMMENT_BODY);
  const lines = [
    `requested=${result.requested}`,
    `valid=${result.valid}`,
    `plugin=${result.plugin}`,
    `skill=${result.skill}`,
    `error=${result.error}`,
  ].join("\n");
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
  } else {
    console.log(lines);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
