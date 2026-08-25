let FIRMS = [], OPPORTUNITIES = [], RULES = [];

async function loadData() {
  const [firms, opportunities, rules] = await Promise.all([
    fetch("data/firms.json").then(r => r.json()),
    fetch("data/opportunities.json").then(r => r.json()),
    fetch("data/rules.json").then(r => r.json())
  ]);
  FIRMS = firms; OPPORTUNITIES = opportunities; RULES = rules;
}

const STATUS_META = {
  GREEN: { icon: "🟢", label: "Eligible", badgeClass: "eligible" },
  YELLOW: { icon: "🟡", label: "Check", badgeClass: "check" },
  RED: { icon: "🔴", label: "Not eligible", badgeClass: "not-eligible" }
};

function reasonIcon(ok) {
  return ok === true ? "✓" : ok === false ? "✗" : "?";
}

const TODAY = new Date("2026-08-23");

function daysSince(dateStr) {
  return Math.floor((TODAY - new Date(dateStr)) / 86400000);
}

// Freshness bucketing per the verification-status plan: recent / recommend re-check / may be outdated.
function freshnessLabel(dateStr) {
  const days = daysSince(dateStr);
  if (days <= 90) return { text: "Verified recently", cls: "fresh" };
  if (days <= 180) return { text: "Verification recommended", cls: "stale-soon" };
  return { text: "Information may be outdated", cls: "stale" };
}

const SOURCE_FIELDS = [
  ["minClassification", "Classification minimum"],
  ["acceptsNonLaw", "Non-law acceptance"],
  ["pgdlRequired", "PGDL requirement"],
  ["pgdlFunded", "PGDL funding"],
  ["maintenanceGrantGBP", "Maintenance grant"]
];

// Dedupe sources by URL — most fields cite the same firm page, no need to repeat it five times.
function collectSources(rules) {
  const byUrl = new Map();
  for (const [key, label] of SOURCE_FIELDS) {
    const field = rules[key];
    if (!field || !field.source) continue;
    const existing = byUrl.get(field.source.url);
    if (existing) existing.labels.push(label);
    else byUrl.set(field.source.url, { url: field.source.url, dateVerified: field.source.dateVerified, status: field.status, labels: [label] });
  }
  return Array.from(byUrl.values());
}

const compareSet = new Set(); // set of opportunity ids selected for comparison
const resultsById = new Map(); // opportunity id -> full result, for building the compare table

function renderCard(result, index) {
  const { firm, opportunity, status, reasons } = result;
  resultsById.set(opportunity.id, result);
  const meta = STATUS_META[status];
  const card = document.createElement("div");
  card.className = "result-card status-" + status.toLowerCase();
  card.setAttribute("data-index", String(index + 1).padStart(2, "0"));

  const applyLink = opportunity.applyUrl
    ? `<a class="apply-link" href="${opportunity.applyUrl}" target="_blank" rel="noopener noreferrer">Apply directly →</a>`
    : `<span class="apply-link apply-link-unknown">Apply page not confirmed — search "${firm.name} training contract"</span>`;

  const reasonsHtml = reasons.map(r =>
    `<li class="reason reason-${r.ok === true ? "ok" : r.ok === false ? "fail" : "unverified"}">
      <span class="reason-icon" aria-hidden="true">${reasonIcon(r.ok)}</span> ${r.text}
    </li>`
  ).join("");

  const oppTypeLabel = opportunity.type === "vac_scheme" ? "Vacation scheme" : "Training contract";
  const uid = "why-" + firm.id + "-" + opportunity.id;
  const compareId = "compare-" + opportunity.id;

  const sources = collectSources(result.rules);
  const newestDate = sources.length ? sources.map(s => s.dateVerified).sort().pop() : null;
  const freshness = newestDate ? freshnessLabel(newestDate) : null;

  const deadlineStatus = RulesEngine.computeOpportunityStatus(opportunity, TODAY);
  const deadlineMeta = RulesEngine.DEADLINE_STATUS_META[deadlineStatus];
  const deadlineDetail = opportunity.dataConfidence === "unverified"
    ? "Date data for this opportunity could not be reliably verified."
    : [
        opportunity.openingDate ? `Opens ${opportunity.openingDate}` : null,
        opportunity.deadline ? `Closes ${opportunity.deadline}` : null,
        opportunity.rolling === true ? "Rolling admissions" : opportunity.rolling === false ? "Not rolling — single window" : null
      ].filter(Boolean).join(" · ") || "No dates published yet.";

  const sourcesHtml = sources.length
    ? `<div class="sources-block">
        <div class="sources-title">Sources &amp; verification</div>
        <ul class="sources-list">
          ${sources.map(s => `
            <li>
              <span class="badge source-status source-status-${s.status.toLowerCase()}">${s.status}</span>
              ${s.labels.join(", ")} — verified ${s.dateVerified}
              <a href="${s.url}" target="_blank" rel="noopener noreferrer">Source →</a>
            </li>
          `).join("")}
        </ul>
      </div>`
    : `<div class="sources-block sources-none">No individually sourced fields for this opportunity — see general notes above.</div>`;

  card.innerHTML = `
    <label class="compare-check"><input type="checkbox" id="${compareId}" ${compareSet.has(opportunity.id) ? "checked" : ""}> Compare</label>
    <div class="firm-name">
      <span class="status-icon" aria-hidden="true">${meta.icon}</span> ${firm.name}
      <span class="badge status-badge status-${status.toLowerCase()}">${meta.label}</span>
    </div>
    <div class="meta">
      ${opportunity.location} · ${oppTypeLabel} · Jurisdiction: UK (England &amp; Wales)
      <span class="badge deadline-badge deadline-${deadlineMeta.cls}" title="${deadlineDetail}">${deadlineMeta.label}</span>
      ${freshness ? `<span class="badge freshness-badge freshness-${freshness.cls}">${freshness.text}</span>` : ""}
    </div>
    <div class="deadline-detail">${deadlineDetail}</div>
    <div class="notes">${opportunity.notes}</div>
    <button class="why-toggle" aria-expanded="false" aria-controls="${uid}">Why? →</button>
    <div id="${uid}" class="why-list" hidden>
      <ul class="reasons-list">${reasonsHtml}</ul>
      ${sourcesHtml}
    </div>
    ${applyLink}
  `;

  card.querySelector(".why-toggle").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const list = card.querySelector(".why-list");
    const expanded = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!expanded));
    list.hidden = expanded;
    btn.textContent = expanded ? "Why? →" : "Hide why ↑";
  });

  card.querySelector(`#${compareId}`).addEventListener("change", (e) => {
    if (e.target.checked) compareSet.add(opportunity.id);
    else compareSet.delete(opportunity.id);
    updateCompareBar();
  });

  return card;
}

function updateCompareBar() {
  const bar = document.getElementById("compare-bar");
  const count = compareSet.size;
  bar.hidden = count === 0;
  document.getElementById("compare-count").textContent = `${count} selected for comparison`;
  document.getElementById("compare-show-btn").disabled = count < 2;
  if (count < 2) document.getElementById("compare-table-wrap").hidden = true;
}

function classLabel(minClass) {
  if (minClass.value === "none") return "None stated";
  if (minClass.value == null) return "Unverified";
  return minClass.value;
}
function yesNo(field) {
  if (field.value === true) return "Yes";
  if (field.value === false) return "No";
  return "Unverified";
}

function renderCompareTable() {
  const wrap = document.getElementById("compare-table-wrap");
  const selected = Array.from(compareSet).map(id => resultsById.get(id)).filter(Boolean);
  if (selected.length < 2) { wrap.hidden = true; return; }

  const rows = [
    ["Firm", r => r.firm.name],
    ["Opportunity", r => r.opportunity.type === "vac_scheme" ? "Vacation scheme" : "Training contract"],
    ["Location", r => r.opportunity.location],
    ["Your match", r => STATUS_META[r.status].icon + " " + STATUS_META[r.status].label],
    ["Classification minimum", r => classLabel(r.rules.minClassification)],
    ["Accepts non-law", r => yesNo(r.rules.acceptsNonLaw)],
    ["PGDL required", r => yesNo(r.rules.pgdlRequired)],
    ["PGDL funded", r => yesNo(r.rules.pgdlFunded)],
    ["Maintenance grant", r => r.rules.maintenanceGrantGBP.value != null ? "£" + r.rules.maintenanceGrantGBP.value.toLocaleString() : "Unverified"],
    ["Apply", r => r.opportunity.applyUrl ? `<a href="${r.opportunity.applyUrl}" target="_blank" rel="noopener noreferrer">Apply →</a>` : "Not confirmed"]
  ];

  let html = `<table class="compare-table"><thead><tr><th>&nbsp;</th>${selected.map(r => `<th>${r.firm.name}</th>`).join("")}</tr></thead><tbody>`;
  rows.forEach(([label, fn]) => {
    html += `<tr><th>${label}</th>${selected.map(r => `<td>${fn(r)}</td>`).join("")}</tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;
  wrap.hidden = false;
}

document.getElementById("compare-show-btn").addEventListener("click", renderCompareTable);
document.getElementById("compare-clear-btn").addEventListener("click", () => {
  compareSet.clear();
  document.querySelectorAll(".compare-check input").forEach(cb => cb.checked = false);
  updateCompareBar();
});

let lastRanked = [];

function renderRanked() {
  const resultsEl = document.getElementById("results");
  const existingToggle = resultsEl.querySelector(".show-filtered-btn");
  const existingWrap = resultsEl.querySelector(".filtered-wrap");
  resultsEl.querySelectorAll(":scope > .result-card, :scope > .empty-state").forEach(c => c.remove());

  const query = document.getElementById("results-search").value.trim().toLowerCase();
  const sortMode = document.getElementById("results-sort").value;
  const pgdlFundedOnly = document.getElementById("filter-pgdl-funded").checked;
  const openNowOnly = document.getElementById("filter-open-now").checked;

  let visible = lastRanked.filter(r => !query || r.firm.name.toLowerCase().includes(query));
  if (pgdlFundedOnly) {
    visible = visible.filter(r => r.rules.pgdlFunded.value === true);
  }
  if (openNowOnly) {
    visible = visible.filter(r => RulesEngine.computeOpportunityStatus(r.opportunity, TODAY) === "OPEN_NOW");
  }
  if (sortMode === "name") {
    visible = [...visible].sort((a, b) => a.firm.name.localeCompare(b.firm.name));
  }

  const frag = document.createDocumentFragment();
  visible.forEach((r, i) => frag.appendChild(renderCard(r, i)));
  if (existingToggle) resultsEl.insertBefore(frag, existingToggle);
  else resultsEl.appendChild(frag);

  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = query ? `No matches for "${query}".` : "No results.";
    if (existingToggle) resultsEl.insertBefore(empty, existingToggle);
    else resultsEl.appendChild(empty);
  }
}

document.getElementById("results-search").addEventListener("input", renderRanked);
document.getElementById("results-sort").addEventListener("change", renderRanked);
document.getElementById("filter-pgdl-funded").addEventListener("change", renderRanked);
document.getElementById("filter-open-now").addEventListener("change", renderRanked);

function renderResults(profile) {
  const { green, yellow, red, all } = RulesEngine.evaluateAll(profile, FIRMS, OPPORTUNITIES, RULES);
  const resultsEl = document.getElementById("results");
  const summaryEl = document.getElementById("results-summary");

  summaryEl.textContent = `${all.length} opportunities checked — 🟢 ${green.length} eligible, 🟡 ${yellow.length} need checking, 🔴 ${red.length} not eligible.`;
  resultsEl.innerHTML = "";
  document.getElementById("results-controls").hidden = all.length === 0;
  document.getElementById("results-search").value = "";
  document.getElementById("results-sort").value = "status";
  document.getElementById("filter-pgdl-funded").checked = false;
  document.getElementById("filter-open-now").checked = false;

  lastRanked = [...green, ...yellow];
  renderRanked();

  if (red.length) {
    const toggle = document.createElement("button");
    toggle.className = "show-filtered-btn";
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = `Show ${red.length} not-eligible firm${red.length === 1 ? "" : "s"} (and why)`;
    const wrap = document.createElement("div");
    wrap.className = "filtered-wrap";
    wrap.hidden = true;
    red.forEach((r, i) => wrap.appendChild(renderCard(r, i)));

    toggle.addEventListener("click", () => {
      const visible = !wrap.hidden;
      wrap.hidden = visible;
      toggle.setAttribute("aria-expanded", String(!visible));
      toggle.textContent = visible
        ? `Show ${red.length} not-eligible firm${red.length === 1 ? "" : "s"} (and why)`
        : "Hide not-eligible firms";
    });

    resultsEl.appendChild(toggle);
    resultsEl.appendChild(wrap);
  }

  document.getElementById("results-section").style.display = "block";
}

const PROFILE_STORAGE_KEY = "eligibility-matcher-profile-v1";

function saveProfile(profile) {
  try { localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile)); } catch (e) { /* localStorage unavailable — not critical */ }
}

function loadSavedProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function applyProfileToForm(profile, form) {
  if (profile.degreeType) form.degreeType.value = profile.degreeType;
  if (profile.classification !== undefined) form.classification.value = profile.classification || "";
  if (profile.location) form.location.value = profile.location;
  if (Array.isArray(profile.opportunityTypes)) {
    form.querySelectorAll('input[name="opportunityType"]').forEach(el => {
      el.checked = profile.opportunityTypes.includes(el.value);
    });
  }
}

document.getElementById("profile-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const profile = {
    degreeType: form.degreeType.value,
    classification: form.classification.value || null,
    opportunityTypes: Array.from(form.querySelectorAll('input[name="opportunityType"]:checked')).map(el => el.value),
    location: form.location.value
  };

  if (profile.opportunityTypes.length === 0) {
    alert("Select at least one opportunity type.");
    return;
  }

  saveProfile(profile);
  renderResults(profile);
  document.getElementById("results-section").scrollIntoView({ behavior: "smooth" });
});

const savedProfile = loadSavedProfile();
if (savedProfile) {
  applyProfileToForm(savedProfile, document.getElementById("profile-form"));
}

loadData().catch(err => {
  document.getElementById("results-summary").textContent = "Couldn't load firm data — please refresh the page.";
  console.error(err);
});
