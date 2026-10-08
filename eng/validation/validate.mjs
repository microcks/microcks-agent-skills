#!/usr/bin/env node
/**
 * Deterministic repository contract validator.
 *
 * Objective contract errors are separated from quality heuristics. When a base
 * ref is supplied, errors on untouched legacy components remain visible but do
 * not block the change.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseDocument } from "yaml";

const SCHEMA_VERSION = 1;
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MARKETPLACES = [
  ".agents/marketplace.json",
  ".claude-plugin/marketplace.json",
  ".github/plugin/marketplace.json",
];
const MAX_NAME_LENGTH = 64;
const MIN_DESCRIPTION_LENGTH = 10;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_COMPATIBILITY_LENGTH = 500;
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_SKILL_MENU_CHARS = 15_000;
const MIN_TRIALS = 5;

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const toPosix = (value) => value.split(sep).join("/");
const pathParts = (value) => value.split("/").filter(Boolean);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const asString = (value) => typeof value === "string" ? value : "";
const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

function listDirectories(path) {
  if (!existsSync(path) || !statSync(path).isDirectory()) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(path, entry.name))
    .sort();
}

function walkFiles(path) {
  if (!existsSync(path)) return [];
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
}

function parseYaml(text, label) {
  const document = parseDocument(text, { strict: true, uniqueKeys: true });
  if (document.errors.length) {
    throw new Error(`${label}: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  return document.toJS({ maxAliasCount: 100 });
}

function parseJson(text, label) {
  // YAML 1.2 is used only as a duplicate-key detector; JSON.parse remains the
  // grammar authority so JSON extensions are never accepted accidentally.
  const duplicateCheck = parseDocument(text, { strict: true, uniqueKeys: true });
  if (duplicateCheck.errors.length) {
    throw new Error(`${label}: ${duplicateCheck.errors.map((error) => error.message).join("; ")}`);
  }
  return JSON.parse(text);
}

class Validator {
  constructor(root, baseRef, reportPath) {
    this.root = resolve(root);
    this.baseRef = baseRef;
    this.reportPath = reportPath;
    this.findings = [];
    this.plugins = new Map();
    this.changedPaths = new Set();
    this.changedComponents = new Set();
    this.referencedFixtures = new Set();
    this.evalPaths = new Set();
  }

  error(code, path, message, component = "repository") {
    this.findings.push({ severity: "error", status: "warning", code, path, component, message });
  }

  warn(code, path, message, component = "repository") {
    this.findings.push({ severity: "warning", status: "warning", code, path, component, message });
  }

  run() {
    this.loadChanges();
    this.validatePlugins();
    this.validateMarketplaces();
    this.validateRootReadme();
    this.validateEvals();
    this.classifyFindings();
    const report = this.buildReport();
    if (this.reportPath) {
      const destination = isAbsolute(this.reportPath) ? this.reportPath : resolve(this.root, this.reportPath);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
    }
    this.render();
    return report.summary.blockingErrors ? 1 : 0;
  }

  git(args, allowFailure = false) {
    const result = spawnSync("git", args, { cwd: this.root, encoding: "utf8" });
    if (result.status !== 0 && !allowFailure) {
      throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
    }
    return result;
  }

  loadChanges() {
    if (!this.baseRef) return;
    try {
      const changed = this.git(["diff", "--name-only", "--diff-filter=ACMR", this.baseRef, "--"]).stdout;
      const untracked = this.git(["ls-files", "--others", "--exclude-standard"]).stdout;
      for (const path of `${changed}\n${untracked}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
        this.changedPaths.add(path);
        const parts = pathParts(path);
        if (parts[0] === "plugins" && parts.length >= 2) {
          const plugin = parts[1];
          this.changedComponents.add(`plugin:${plugin}`);
          if (parts[2] === "skills" && parts[3]) this.changedComponents.add(`skill:${plugin}/${parts[3]}`);
          if (parts[2] === "agents" && parts[3]) this.changedComponents.add(`agent:${plugin}/${parts[3].replace(/\.agent\.md$/, "")}`);
        }
        if (parts[0] === "tests" && parts[1] && parts[1] !== "repository-skills" && parts[2]) {
          const [plugin, target] = [parts[1], parts[2]];
          this.changedComponents.add(`plugin:${plugin}`);
          if (target.startsWith("agent.")) this.changedComponents.add(`agent:${plugin}/${target.slice(6)}`);
          else {
            this.changedComponents.add(`skill:${plugin}/${target}`);
            this.changedComponents.add(`eval:${plugin}/${target}`);
          }
        }
      }
    } catch (error) {
      this.error("BASE_REF_INVALID", ".", `Cannot compare against base ref '${this.baseRef}': ${error.message}`);
    }
  }

  readJson(path) {
    const absolute = resolve(this.root, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      this.error("FILE_MISSING", path, "Required JSON file is missing");
      return null;
    }
    try {
      return parseJson(readFileSync(absolute, "utf8"), path);
    } catch (error) {
      this.error("JSON_INVALID", path, `Invalid JSON: ${error.message}`);
      return null;
    }
  }

  readYaml(path) {
    try {
      return parseYaml(readFileSync(resolve(this.root, path), "utf8"), path);
    } catch (error) {
      this.error("YAML_INVALID", path, `Invalid YAML: ${error.message}`, this.componentForPath(path));
      return null;
    }
  }

  validatePlugins() {
    const pluginsDir = resolve(this.root, "plugins");
    if (!existsSync(pluginsDir) || !statSync(pluginsDir).isDirectory()) {
      this.error("PLUGINS_MISSING", "plugins", "plugins/ directory is missing");
      return;
    }
    for (const pluginDir of listDirectories(pluginsDir)) this.validatePlugin(pluginDir);
  }

  validatePlugin(pluginDir) {
    const directoryName = basename(pluginDir);
    const component = `plugin:${directoryName}`;
    const manifestPath = `plugins/${directoryName}/plugin.json`;
    const readmePath = `plugins/${directoryName}/README.md`;
    const licensePath = `plugins/${directoryName}/LICENSE`;
    const manifest = this.readJson(manifestPath);
    if (!isObject(manifest)) return;
    const name = asString(manifest.name);
    const version = asString(manifest.version);
    const description = asString(manifest.description);
    const plugin = { name: directoryName, path: `plugins/${directoryName}`, version, description, readme: readmePath, skills: [], agents: [] };
    this.plugins.set(directoryName, plugin);

    this.validateName(name, directoryName, "Plugin", manifestPath, component);
    if (!version || !SEMVER_RE.test(version)) this.error("PLUGIN_VERSION_INVALID", manifestPath, "Plugin version must be valid Semantic Versioning", component);
    this.validateDescription(description, "Plugin", manifestPath, component);
    if (description.toLowerCase().includes("placeholder")) this.warn("PLACEHOLDER_TEXT", manifestPath, "Plugin description still contains placeholder text", component);

    const readme = resolve(this.root, readmePath);
    if (!existsSync(readme) || !statSync(readme).isFile()) this.error("PLUGIN_README_MISSING", readmePath, "Plugin README.md is missing", component);
    else {
      const text = readFileSync(readme, "utf8");
      if (description && !text.includes(description)) this.error("PLUGIN_README_DESCRIPTION", readmePath, "Plugin README does not contain the manifest description", component);
      if (text.toLowerCase().includes("placeholder")) this.warn("PLACEHOLDER_TEXT", readmePath, "Plugin README still contains placeholder text", component);
    }

    const license = resolve(this.root, licensePath);
    if (!existsSync(license) || !lstatSync(license).isSymbolicLink()) this.error("LICENSE_NOT_SYMLINK", licensePath, "LICENSE must be a symbolic link to ../../LICENSE", component);
    else {
      const target = readlinkSync(license);
      if (target !== "../../LICENSE" || realpathSync(license) !== realpathSync(resolve(this.root, "LICENSE"))) {
        this.error("LICENSE_TARGET_INVALID", licensePath, "LICENSE symlink must resolve exactly to the repository root LICENSE", component);
      }
    }

    const skillPaths = this.manifestPaths(manifest.skills);
    const agentPaths = this.manifestPaths(manifest.agents);
    if (!skillPaths.length && !agentPaths.length) this.error("PLUGIN_CONTENT_MISSING", manifestPath, "Plugin must declare at least one skills or agents path", component);
    for (const declared of skillPaths) this.validateDeclaredPath(pluginDir, declared, manifestPath, "skills", component);
    for (const declared of agentPaths) this.validateDeclaredPath(pluginDir, declared, manifestPath, "agents", component);

    for (const skillDir of listDirectories(join(pluginDir, "skills"))) plugin.skills.push(this.validateSkill(directoryName, skillDir, readmePath));
    const agentsDir = join(pluginDir, "agents");
    if (existsSync(agentsDir)) {
      for (const file of walkFiles(agentsDir).filter((path) => dirname(path) === agentsDir && path.endsWith(".agent.md"))) {
        plugin.agents.push(this.validateAgent(directoryName, file, readmePath));
      }
    }
    if (!plugin.skills.length && !plugin.agents.length) this.error("PLUGIN_EMPTY", manifestPath, "Plugin contains no discoverable skill or agent", component);

    const menuSize = plugin.skills.filter((skill) => !skill.reference).reduce((total, skill) => total + this.renderedSkillCost(skill), 0);
    if (menuSize > MAX_SKILL_MENU_CHARS) this.error("SKILL_MENU_TOO_LARGE", manifestPath, `Rendered skill menu is ${menuSize.toLocaleString("en-US")} characters; maximum is ${MAX_SKILL_MENU_CHARS.toLocaleString("en-US")}`, component);
    this.validateVersionBump(plugin);
  }

  manifestPaths(value) {
    if (typeof value === "string") return [value];
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  }

  validateDeclaredPath(pluginDir, declared, manifestPath, kind, component) {
    const parts = pathParts(declared);
    if (isAbsolute(declared) || parts.includes("..")) {
      this.error("PLUGIN_PATH_UNSAFE", manifestPath, `Declared ${kind} path is unsafe: ${declared}`, component);
      return;
    }
    const target = resolve(pluginDir, declared);
    if (!this.isWithin(pluginDir, target)) this.error("PLUGIN_PATH_UNSAFE", manifestPath, `Declared ${kind} path leaves the plugin: ${declared}`, component);
    else if (!existsSync(target)) this.error("PLUGIN_PATH_MISSING", manifestPath, `Declared ${kind} path does not exist: ${declared}`, component);
  }

  validateSkill(pluginName, skillDir, readmePath) {
    const directoryName = basename(skillDir);
    const path = `plugins/${pluginName}/skills/${directoryName}/SKILL.md`;
    const component = `skill:${pluginName}/${directoryName}`;
    const record = { name: directoryName, path, description: "", reference: false, profile: {}, evalPath: null, evalTrials: null };
    const absolute = resolve(this.root, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      this.error("SKILL_FILE_MISSING", path, "SKILL.md is missing", component);
      return record;
    }
    const content = readFileSync(absolute, "utf8");
    const { metadata, body } = this.frontmatter(content, path, component);
    const name = asString(metadata.name);
    const description = asString(metadata.description);
    const compatibility = metadata.compatibility;
    const reference = metadata["disable-model-invocation"] === true;
    Object.assign(record, { name: name || directoryName, description, reference });
    this.validateName(name, directoryName, "Skill", path, component);
    this.validateDescription(description, "Skill", path, component);
    if (compatibility !== undefined && (typeof compatibility !== "string" || !compatibility.trim() || compatibility.length > MAX_COMPATIBILITY_LENGTH)) {
      this.error("SKILL_COMPATIBILITY_INVALID", path, "compatibility must contain 1-500 characters when provided", component);
    }
    this.validateLocalReferences(skillDir, path, body, component);
    this.validateAssets(skillDir, path, component);
    record.profile = this.profileSkill(content, body, path, component);
    if (content.toLowerCase().includes("placeholder")) this.warn("PLACEHOLDER_TEXT", path, "Skill contains placeholder text", component);
    this.requireReadmeLink(readmePath, `./skills/${directoryName}/SKILL.md`, `Skill '${directoryName}' is not linked from the plugin README`, component);

    const evalPath = `tests/${pluginName}/${directoryName}/eval.yaml`;
    if (reference) {
      if (existsSync(resolve(this.root, evalPath))) this.warn("REFERENCE_SKILL_EVAL", evalPath, "Reference skill has a direct-activation eval; verify that indirect coverage is intended", component);
    } else if (!existsSync(resolve(this.root, evalPath))) this.error("SKILL_EVAL_MISSING", evalPath, "Invocable skill is missing its external eval.yaml", component);
    else record.evalPath = evalPath;
    return record;
  }

  validateAgent(pluginName, agentFile, readmePath) {
    const name = basename(agentFile).replace(/\.agent\.md$/, "");
    const path = `plugins/${pluginName}/agents/${basename(agentFile)}`;
    const component = `agent:${pluginName}/${name}`;
    const content = readFileSync(agentFile, "utf8");
    const { metadata } = this.frontmatter(content, path, component);
    const declaredName = asString(metadata.name);
    const description = asString(metadata.description);
    this.validateName(declaredName, name, "Agent", path, component);
    this.validateDescription(description, "Agent", path, component);
    this.requireReadmeLink(readmePath, `./agents/${basename(agentFile)}`, `Agent '${name}' is not linked from the plugin README`, component);
    let evalPath = `tests/${pluginName}/agent.${name}/eval.yaml`;
    if (!existsSync(resolve(this.root, evalPath))) {
      this.error("AGENT_EVAL_MISSING", evalPath, "Agent is missing its external eval.yaml", component);
      evalPath = null;
    }
    return { name, path, description, evalPath, evalTrials: null };
  }

  frontmatter(content, path, component) {
    if (!content.startsWith("---\n")) {
      this.error("FRONTMATTER_MISSING", path, "YAML frontmatter is required", component);
      return { metadata: {}, body: content };
    }
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(content);
    if (!match) {
      this.error("FRONTMATTER_INVALID", path, "YAML frontmatter is not closed", component);
      return { metadata: {}, body: content };
    }
    try {
      const metadata = parseYaml(match[1], path) ?? {};
      if (!isObject(metadata)) {
        this.error("FRONTMATTER_INVALID", path, "YAML frontmatter must be a mapping", component);
        return { metadata: {}, body: content.slice(match[0].length) };
      }
      return { metadata, body: content.slice(match[0].length) };
    } catch (error) {
      this.error("FRONTMATTER_INVALID", path, `Invalid YAML frontmatter: ${error.message}`, component);
      return { metadata: {}, body: content.slice(match[0].length) };
    }
  }

  validateName(name, expected, kind, path, component) {
    if (!name) {
      this.error(`${kind.toUpperCase()}_NAME_MISSING`, path, `${kind} name is required`, component);
      return;
    }
    if (name.length > MAX_NAME_LENGTH || !NAME_RE.test(name)) this.error(`${kind.toUpperCase()}_NAME_INVALID`, path, `${kind} name must be 1-64 lowercase alphanumeric characters separated by single hyphens`, component);
    if (name !== expected) this.error(`${kind.toUpperCase()}_NAME_MISMATCH`, path, `${kind} name '${name}' does not match '${expected}'`, component);
  }

  validateDescription(description, kind, path, component) {
    const length = description.trim().length;
    if (length < MIN_DESCRIPTION_LENGTH || length > MAX_DESCRIPTION_LENGTH) this.error(`${kind.toUpperCase()}_DESCRIPTION_INVALID`, path, `${kind} description must contain ${MIN_DESCRIPTION_LENGTH}-${MAX_DESCRIPTION_LENGTH} characters`, component);
  }

  validateLocalReferences(skillDir, path, body, component) {
    for (const match of body.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split("#", 1)[0].trim();
      if (!target || /^(https?:\/\/|mailto:|#)/i.test(target)) continue;
      const parts = pathParts(target);
      if (isAbsolute(target) || parts.includes("..")) {
        this.error("SKILL_REFERENCE_UNSAFE", path, `Local reference must stay within the skill directory: ${target}`, component);
        continue;
      }
      const resolved = resolve(skillDir, target);
      if (!this.isWithin(skillDir, resolved)) this.error("SKILL_REFERENCE_UNSAFE", path, `Local reference leaves the skill directory: ${target}`, component);
      else if (!existsSync(resolved)) this.error("SKILL_REFERENCE_MISSING", path, `Local reference does not exist: ${target}`, component);
    }
  }

  validateAssets(skillDir, path, component) {
    for (const folder of ["references", "assets", "scripts"]) {
      const root = join(skillDir, folder);
      for (const asset of walkFiles(root)) {
        if (statSync(asset).size > MAX_ASSET_BYTES) this.error("SKILL_ASSET_TOO_LARGE", path, `Bundled asset exceeds 5 MB: ${toPosix(relative(skillDir, asset))}`, component);
      }
    }
  }

  profileSkill(content, body, path, component) {
    const tokens = Math.ceil(content.length / 4);
    const lines = content.split(/\r?\n/).length;
    const sections = [...body.matchAll(/^#{1,4}\s+/gm)].length;
    const codeBlocks = Math.floor([...body.matchAll(/^```/gm)].length / 2);
    const numberedSteps = [...body.matchAll(/^\s*\d+\.\s+/gm)].length;
    const hasWhenToUse = /^#{1,4}\s+when\s+to\s+use/im.test(body);
    const hasWhenNotToUse = /^#{1,4}\s+when\s+not\s+to\s+use/im.test(body);
    const tier = tokens < 400 ? "compact" : tokens <= 2500 ? "detailed" : tokens <= 5000 ? "standard" : "comprehensive";
    if (tokens < 200) this.warn("SKILL_TOO_SPARSE", path, `Skill is only about ${tokens} tokens and may lack actionable guidance`, component);
    else if (tokens > 5000) this.warn("SKILL_COMPREHENSIVE", path, `Skill is about ${tokens} tokens; consider splitting comprehensive guidance`, component);
    else if (tokens > 2500) this.warn("SKILL_LONG", path, `Skill is about ${tokens} tokens and is outside the recommended detailed range`, component);
    if (lines > 500) this.warn("SKILL_LINE_COUNT", path, `Skill has ${lines} lines; progressive disclosure is recommended above 500`, component);
    if (!sections) this.warn("SKILL_STRUCTURE", path, "Skill has no section headings", component);
    if (!codeBlocks) this.warn("SKILL_EXAMPLES", path, "Skill has no code or command examples", component);
    if (!numberedSteps) this.warn("SKILL_WORKFLOW", path, "Skill has no numbered workflow steps", component);
    if (!hasWhenToUse) this.warn("SKILL_ACTIVATION_GUIDANCE", path, "Skill has no 'When to use' section", component);
    return { estimatedTokens: tokens, lineCount: lines, tier, sectionCount: sections, codeBlockCount: codeBlocks, numberedStepCount: numberedSteps, hasWhenToUse, hasWhenNotToUse };
  }

  renderedSkillCost(skill) {
    return `<skill>\n<name>${escapeHtml(skill.name)}</name>\n<description>${escapeHtml(skill.description)}</description>\n<location>project</location>\n</skill>\n`.length;
  }

  requireReadmeLink(readmePath, link, message, component) {
    const path = resolve(this.root, readmePath);
    if (existsSync(path) && !readFileSync(path, "utf8").includes(`](${link})`)) this.error("PLUGIN_README_TARGET_MISSING", readmePath, message, component);
  }

  validateVersionBump(plugin) {
    const prefix = `plugins/${plugin.name}/`;
    if (!this.baseRef || ![...this.changedPaths].some((path) => path.startsWith(prefix))) return;
    const path = `plugins/${plugin.name}/plugin.json`;
    const previous = this.git(["show", `${this.baseRef}:${path}`], true);
    if (previous.status !== 0) return;
    try {
      const previousVersion = parseJson(previous.stdout, `${this.baseRef}:${path}`)?.version;
      if (typeof previousVersion === "string" && this.compareSemver(plugin.version, previousVersion) <= 0) this.error("PLUGIN_VERSION_NOT_BUMPED", path, `Published plugin changed but version was not increased from ${previousVersion}`, `plugin:${plugin.name}`);
    } catch {
      // A malformed base manifest is legacy debt and cannot define a version floor.
    }
  }

  compareSemver(left, right) {
    const parse = (value) => {
      const match = SEMVER_RE.exec(value || "");
      return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ? 0 : 1] : [-1, -1, -1, -1];
    };
    const [a, b] = [parse(left), parse(right)];
    for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
    return 0;
  }

  validateMarketplaces() {
    const registrations = new Map();
    for (const path of MARKETPLACES) {
      const data = this.readJson(path);
      if (!isObject(data) || !Array.isArray(data.plugins)) {
        this.error("MARKETPLACE_INVALID", path, "Marketplace must contain a plugins array");
        continue;
      }
      const items = [];
      const seen = new Set();
      for (const item of data.plugins) {
        if (!isObject(item)) {
          this.error("MARKETPLACE_ENTRY_INVALID", path, "Marketplace plugin entries must be objects");
          continue;
        }
        const name = asString(item.name);
        const source = asString(item.source);
        const description = asString(item.description);
        const component = name ? `plugin:${name}` : "repository";
        if (seen.has(name)) this.error("MARKETPLACE_DUPLICATE", path, `Plugin '${name}' is registered more than once`, component);
        seen.add(name);
        items.push({ name, source, description });
        const plugin = this.plugins.get(name);
        if (!plugin) this.error("MARKETPLACE_ORPHAN", path, `Registered plugin '${name}' does not exist`, component);
        else {
          if (source !== `./plugins/${name}`) this.error("MARKETPLACE_SOURCE", path, `Plugin '${name}' source must be './plugins/${name}'`, component);
          if (description !== plugin.description) this.error("MARKETPLACE_DESCRIPTION", path, `Plugin '${name}' description differs from plugin.json`, component);
        }
      }
      registrations.set(path, items.sort((left, right) => left.name.localeCompare(right.name)));
      for (const name of this.plugins.keys()) if (!seen.has(name)) this.error("MARKETPLACE_REGISTRATION_MISSING", path, `Plugin '${name}' is not registered`, `plugin:${name}`);
    }
    const reference = registrations.get(MARKETPLACES[0]);
    if (reference) {
      const expected = JSON.stringify(reference);
      for (const path of MARKETPLACES.slice(1)) if (registrations.has(path) && JSON.stringify(registrations.get(path)) !== expected) this.error("MARKETPLACE_DRIFT", path, `Plugin registrations differ from ${MARKETPLACES[0]}`);
    }
  }

  validateRootReadme() {
    const path = "README.md";
    const absolute = resolve(this.root, path);
    if (!existsSync(absolute)) {
      this.error("ROOT_README_MISSING", path, "Root README.md is missing");
      return;
    }
    const text = readFileSync(absolute, "utf8");
    for (const plugin of this.plugins.values()) {
      if (!text.includes(`](./plugins/${plugin.name})`)) this.error("ROOT_README_PLUGIN_MISSING", path, `Plugin '${plugin.name}' is not linked in the public catalogue`, `plugin:${plugin.name}`);
      if (plugin.description && !text.includes(plugin.description)) this.error("ROOT_README_DESCRIPTION", path, `Plugin '${plugin.name}' description differs from plugin.json`, `plugin:${plugin.name}`);
    }
  }

  validateEvals() {
    const testsDir = resolve(this.root, "tests");
    if (!existsSync(testsDir)) {
      this.error("TESTS_MISSING", "tests", "tests/ directory is missing");
      return;
    }
    for (const file of walkFiles(testsDir).filter((path) => basename(path) === "eval.yaml")) {
      const path = toPosix(relative(this.root, file));
      this.evalPaths.add(path);
      this.validateEval(path);
    }
    const expected = new Set();
    for (const plugin of this.plugins.values()) {
      for (const skill of plugin.skills) if (skill.evalPath) expected.add(skill.evalPath);
      for (const agent of plugin.agents) if (agent.evalPath) expected.add(agent.evalPath);
    }
    for (const path of [...this.evalPaths].sort()) {
      const parts = pathParts(path);
      if (parts.length >= 4 && parts[1] !== "repository-skills" && !expected.has(path)) this.error("EVAL_ORPHAN", path, "Evaluation does not correspond to a distributed skill or agent", this.componentForPath(path));
    }
    for (const fixture of walkFiles(testsDir).filter((path) => pathParts(toPosix(relative(this.root, path))).includes("fixtures"))) {
      const path = toPosix(relative(this.root, fixture));
      if (!this.referencedFixtures.has(path)) this.warn("FIXTURE_ORPHAN", path, "Fixture is not referenced by an eval.yaml", this.componentForPath(path));
    }
  }

  validateEval(path) {
    const document = this.readYaml(path);
    if (!isObject(document)) return;
    const component = this.componentForPath(path);
    const target = basename(dirname(path));
    const expectedName = target.replace(/^agent\./, "");
    if (document.name !== expectedName) this.error("EVAL_NAME_MISMATCH", path, `Eval name must be '${expectedName}'`, component);
    if ("config" in document && "defaults" in document) this.error("EVAL_CONFIG_CONFLICT", path, "Eval must not declare both config and defaults", component);
    const stimuli = document.stimuli;
    if (!Array.isArray(stimuli) || !stimuli.length) {
      this.error("EVAL_STIMULI_MISSING", path, "Eval must contain at least one stimulus", component);
      return;
    }
    const defaults = isObject(document.defaults) ? document.defaults : {};
    let runs = defaults.runs ?? 1;
    if (!Number.isInteger(runs) || runs < 1) {
      this.error("EVAL_RUNS_INVALID", path, "defaults.runs must be a positive integer", component);
      runs = 1;
    }
    const trials = stimuli.length * runs;
    if (trials < MIN_TRIALS && !target.startsWith("agent.")) this.error("EVAL_UNDERPOWERED", path, `Eval has ${trials} trial(s); at least ${MIN_TRIALS} are required`, component);
    else if (trials <= 7 && !target.startsWith("agent.")) this.warn("EVAL_KNIFE_EDGE", path, `Eval has only ${trials} trials and may reach a verdict only on a near-clean sweep`, component);
    let hasNonActivation = false;
    for (const [offset, stimulus] of stimuli.entries()) {
      const index = offset + 1;
      if (!isObject(stimulus)) {
        this.error("EVAL_STIMULUS_INVALID", path, `Stimulus ${index} must be a mapping`, component);
        continue;
      }
      if (typeof stimulus.name !== "string" || !stimulus.name.trim()) this.error("EVAL_STIMULUS_NAME", path, `Stimulus ${index} needs a non-empty name`, component);
      if (typeof stimulus.prompt !== "string" || !stimulus.prompt.trim()) this.error("EVAL_PROMPT_MISSING", path, `Stimulus ${index} needs a non-empty prompt`, component);
      if (!Array.isArray(stimulus.graders) || !stimulus.graders.length) this.error("EVAL_GRADERS_MISSING", path, `Stimulus ${index} needs at least one grader`, component);
      else this.validateGraders(path, component, index, stimulus.graders, stimulus);
      if (stimulus.expect_activation !== undefined && typeof stimulus.expect_activation !== "boolean") this.error("EVAL_ACTIVATION_TYPE", path, `Stimulus ${index} expect_activation must be boolean`, component);
      hasNonActivation ||= stimulus.expect_activation === false;
    }
    if (!hasNonActivation) this.warn("EVAL_NO_NON_ACTIVATION", path, "Eval has no explicit non-activation scenario", component);
    this.collectFixtureReferences(path, document);
    this.setEvalTrials(path, trials);
  }

  validateGraders(path, component, stimulusIndex, graders, stimulus) {
    const required = {
      "output-contains": ["substring"],
      "output-matches": ["pattern"],
      "file-exists": ["path"],
      "file-contains": ["path", "substring"],
    };
    let semantic = false;
    for (const [offset, grader] of graders.entries()) {
      const index = offset + 1;
      if (!isObject(grader) || typeof grader.type !== "string") {
        this.error("EVAL_GRADER_INVALID", path, `Stimulus ${stimulusIndex} grader ${index} needs a type`, component);
        continue;
      }
      const keys = required[grader.type];
      if (keys && (!isObject(grader.config) || keys.some((key) => typeof grader.config[key] !== "string" || !grader.config[key].trim()))) this.error("EVAL_GRADER_CONFIG", path, `Stimulus ${stimulusIndex} grader '${grader.type}' has missing configuration`, component);
      if (grader.type === "prompt") semantic = true;
    }
    if (semantic && (!Array.isArray(stimulus.rubric) || !stimulus.rubric.length || stimulus.rubric.some((item) => typeof item !== "string" || !item.trim()))) this.error("EVAL_RUBRIC_MISSING", path, `Stimulus ${stimulusIndex} prompt grader requires a non-empty rubric`, component);
  }

  collectFixtureReferences(path, document) {
    const evalDir = dirname(path);
    const sources = [];
    const walk = (value) => {
      if (Array.isArray(value)) for (const child of value) walk(child);
      else if (isObject(value)) for (const [key, child] of Object.entries(value)) {
        if ((key === "src" || key === "source") && typeof child === "string") sources.push(child);
        walk(child);
      }
    };
    walk(document);
    for (const source of sources) {
      const parts = pathParts(source);
      if (isAbsolute(source) || parts.includes("..")) {
        this.error("FIXTURE_PATH_UNSAFE", path, `Fixture source must stay within its eval directory: ${source}`, this.componentForPath(path));
        continue;
      }
      const target = toPosix(join(evalDir, source));
      this.referencedFixtures.add(target);
      if (!existsSync(resolve(this.root, target))) this.error("FIXTURE_MISSING", path, `Referenced fixture does not exist: ${source}`, this.componentForPath(path));
      else if (!this.isGitTracked(target)) this.error("FIXTURE_UNTRACKED", path, `Referenced fixture is not tracked by Git: ${source}`, this.componentForPath(path));
    }
  }

  setEvalTrials(path, trials) {
    const parts = pathParts(path);
    if (parts.length < 4 || parts[1] === "repository-skills") return;
    const [pluginName, target] = [parts[1], parts[2]];
    const plugin = this.plugins.get(pluginName);
    if (!plugin) return;
    const records = target.startsWith("agent.") ? plugin.agents : plugin.skills;
    const name = target.replace(/^agent\./, "");
    const record = records.find((item) => item.name === name);
    if (record) record.evalTrials = trials;
  }

  isGitTracked(path) {
    return this.git(["ls-files", "--error-unmatch", path], true).status === 0;
  }

  componentForPath(path) {
    const parts = pathParts(path);
    if (parts[0] === "plugins" && parts[1]) {
      if (parts[2] === "skills" && parts[3]) return `skill:${parts[1]}/${parts[3]}`;
      if (parts[2] === "agents" && parts[3]) return `agent:${parts[1]}/${parts[3].replace(/\.agent\.md$/, "")}`;
      return `plugin:${parts[1]}`;
    }
    if (parts[0] === "tests" && parts[1] && parts[1] !== "repository-skills" && parts[2]) return parts[2].startsWith("agent.") ? `agent:${parts[1]}/${parts[2].slice(6)}` : `skill:${parts[1]}/${parts[2]}`;
    return "repository";
  }

  isWithin(parent, child) {
    const path = relative(resolve(parent), resolve(child));
    return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
  }

  classifyFindings() {
    for (const finding of this.findings) {
      if (finding.severity === "warning") {
        finding.status = "warning";
        continue;
      }
      if (!this.baseRef) {
        finding.status = "blocking";
        continue;
      }
      const pathChanged = this.changedPaths.has(finding.path) || [...this.changedPaths].some((path) => path.startsWith(`${finding.path.replace(/\/$/, "")}/`));
      const componentChanged = this.changedComponents.has(finding.component);
      finding.status = pathChanged || componentChanged || (finding.component === "repository" && finding.code === "BASE_REF_INVALID") ? "blocking" : "grandfathered";
    }
  }

  buildReport() {
    const count = (status) => this.findings.filter((item) => item.status === status).length;
    const plugins = [...this.plugins.values()].sort((left, right) => left.name.localeCompare(right.name)).map((plugin) => ({
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      path: plugin.path,
      readme: plugin.readme,
      skills: [...plugin.skills].sort((left, right) => left.name.localeCompare(right.name)).map((skill) => ({
        name: skill.name,
        description: skill.description,
        path: skill.path,
        reference: skill.reference,
        profile: skill.profile,
        evaluation: { path: skill.evalPath, trials: skill.evalTrials },
      })),
      agents: [...plugin.agents].sort((left, right) => left.name.localeCompare(right.name)).map((agent) => ({
        name: agent.name,
        description: agent.description,
        path: agent.path,
        evaluation: { path: agent.evalPath, trials: agent.evalTrials },
      })),
    }));
    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      repository: basename(this.root),
      baseRef: this.baseRef ?? null,
      changedPaths: [...this.changedPaths].sort(),
      summary: {
        plugins: this.plugins.size,
        skills: plugins.reduce((total, plugin) => total + plugin.skills.length, 0),
        agents: plugins.reduce((total, plugin) => total + plugin.agents.length, 0),
        evals: this.evalPaths.size,
        blockingErrors: count("blocking"),
        grandfatheredErrors: count("grandfathered"),
        warnings: count("warning"),
      },
      findings: [...this.findings].sort((left, right) => `${left.status}\0${left.path}\0${left.code}`.localeCompare(`${right.status}\0${right.path}\0${right.code}`)),
      catalog: { plugins },
    };
  }

  render() {
    for (const finding of [...this.findings].sort((left, right) => `${left.status}\0${left.path}\0${left.code}`.localeCompare(`${right.status}\0${right.path}\0${right.code}`))) {
      const annotation = finding.status === "blocking" ? "error" : "warning";
      const prefix = finding.status === "grandfathered" ? "grandfathered: " : "";
      console.error(`::${annotation} file=${finding.path}::${finding.code}: ${prefix}${finding.message}`);
    }
    const blocking = this.findings.filter((item) => item.status === "blocking").length;
    const grandfathered = this.findings.filter((item) => item.status === "grandfathered").length;
    const warnings = this.findings.filter((item) => item.status === "warning").length;
    console.log(`Repository validation: ${blocking} blocking error(s), ${grandfathered} grandfathered error(s), ${warnings} warning(s).`);
    if (this.reportPath) console.log(`Validation report: ${this.reportPath}`);
  }
}

const { values } = parseArgs({
  options: {
    root: { type: "string", default: scriptRoot },
    "base-ref": { type: "string" },
    report: { type: "string", default: "artifacts/validation/report.json" },
    help: { type: "boolean", default: false },
  },
  strict: true,
});

if (values.help) {
  console.log("Usage: node eng/validation/validate.mjs [--root path] [--base-ref ref] [--report file]");
  process.exit(0);
}

const validator = new Validator(values.root, values["base-ref"], values.report || null);
process.exitCode = validator.run();
