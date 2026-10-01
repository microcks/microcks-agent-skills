const summary = document.querySelector("#summary");
const catalog = document.querySelector("#catalog");
const status = document.querySelector("#status");
const search = document.querySelector("#search");
let data;

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
}[character]));

const latest = (plugin, skill) => {
  const values = data.history[`${plugin}/${skill}`] ?? [];
  return values.length ? values.at(-1) : null;
};

const badge = (state, text = state) => `<span class="badge ${escapeHtml(state)}">${escapeHtml(text)}</span>`;

const spark = (entries) => {
  if (!entries.length) return "";
  return `<div class="spark" title="Last ${entries.length} evaluations">${entries.slice(-5).map((entry) => {
    const height = Math.max(5, Math.round((Math.abs(entry.netWin ?? 0) * 20) + 6));
    return `<i class="${escapeHtml(entry.state)}" style="height:${height}px" title="${escapeHtml(entry.state)}: ${escapeHtml(entry.reason)}"></i>`;
  }).join("")}</div>`;
};

const renderSummary = () => {
  const skills = data.plugins.flatMap((plugin) => plugin.skills);
  const evaluated = skills.filter((skill) => skill.evaluation.path).length;
  const withResults = data.plugins.reduce((count, plugin) => count + plugin.skills.filter((skill) => latest(plugin.name, skill.name)).length, 0);
  const metrics = [
    [data.plugins.length, "Installable plugins"],
    [skills.length, "Distributed skills"],
    [`${evaluated}/${skills.length}`, "Skills with evaluation specs"],
    [withResults, "Skills with public runtime evidence"],
  ];
  summary.innerHTML = metrics.map(([value, label]) => `<article class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`).join("");
};

const render = () => {
  const query = search.value.trim().toLowerCase();
  const plugins = data.plugins.map((plugin) => ({
    ...plugin,
    skills: plugin.skills.filter((skill) => `${plugin.name} ${plugin.description} ${skill.name} ${skill.description}`.toLowerCase().includes(query)),
  })).filter((plugin) => plugin.skills.length || `${plugin.name} ${plugin.description}`.toLowerCase().includes(query));

  status.textContent = `${plugins.length} plugin${plugins.length === 1 ? "" : "s"} shown`;
  if (!plugins.length) {
    catalog.innerHTML = '<div class="empty">No plugin or skill matches this search.</div>';
    return;
  }
  catalog.innerHTML = plugins.map((plugin) => `
    <article class="plugin">
      <header class="plugin-header">
        <div>
          <p class="eyebrow">Version ${escapeHtml(plugin.version)}</p>
          <h3>${escapeHtml(plugin.name)}</h3>
          <p>${escapeHtml(plugin.description)}</p>
        </div>
        <div class="plugin-actions">
          <a class="button" href="https://github.com/microcks/microcks-agent-skills/tree/main/${escapeHtml(plugin.path)}">README</a>
        </div>
      </header>
      <table class="skills">
        <thead><tr><th>Skill</th><th>Profile</th><th>Evidence</th><th>Trend</th></tr></thead>
        <tbody>${plugin.skills.map((skill) => {
          const history = data.history[`${plugin.name}/${skill.name}`] ?? [];
          const result = latest(plugin.name, skill.name);
          const evidence = skill.reference
            ? badge("reference", "Reference")
            : result
              ? `<a href="${escapeHtml(result.url ?? "#")}" aria-label="Open evaluation run">${badge(result.state)}</a>`
              : badge("no-data", skill.evaluation.path ? "No runtime data" : "No eval");
          return `<tr>
            <td data-label="Skill"><div class="skill-name">${escapeHtml(skill.name)}</div><div class="skill-description">${escapeHtml(skill.description || "No description available")}</div></td>
            <td data-label="Profile"><div class="profile">${escapeHtml(skill.profile.tier ?? "unknown")} · ~${escapeHtml(skill.profile.estimatedTokens ?? 0)} tokens · ${escapeHtml(skill.profile.lineCount ?? 0)} lines</div></td>
            <td data-label="Evidence">${evidence}</td>
            <td data-label="Trend">${spark(history)}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>
    </article>`).join("");
};

try {
  const response = await fetch("data/catalog.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  data = await response.json();
  renderSummary();
  render();
  search.addEventListener("input", render);
} catch (error) {
  status.textContent = "Dashboard data could not be loaded.";
  catalog.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
}
