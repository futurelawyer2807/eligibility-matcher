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

function renderCard(result, index) {
  const { firm, opportunity, status, reasons } = result;
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

  card.innerHTML = `
    <div class="firm-name">
      <span class="status-icon" aria-hidden="true">${meta.icon}</span> ${firm.name}
      <span class="badge status-badge status-${status.toLowerCase()}">${meta.label}</span>
    </div>
    <div class="meta">${opportunity.location} · ${oppTypeLabel} · Jurisdiction: UK (England &amp; Wales)</div>
    <div class="notes">${opportunity.notes}</div>
    <button class="why-toggle" aria-expanded="false" aria-controls="${uid}">Why? →</button>
    <ul id="${uid}" class="why-list" hidden>${reasonsHtml}</ul>
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

  return card;
}

let lastRanked = [];

function renderRanked() {
  const resultsEl = document.getElementById("results");
  const existingToggle = resultsEl.querySelector(".show-filtered-btn");
  const existingWrap = resultsEl.querySelector(".filtered-wrap");
  resultsEl.querySelectorAll(":scope > .result-card, :scope > .empty-state").forEach(c => c.remove());

  const query = document.getElementById("results-search").value.trim().toLowerCase();
  const sortMode = document.getElementById("results-sort").value;

  let visible = lastRanked.filter(r => !query || r.firm.name.toLowerCase().includes(query));
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

function renderResults(profile) {
  const { green, yellow, red, all } = RulesEngine.evaluateAll(profile, FIRMS, OPPORTUNITIES, RULES);
  const resultsEl = document.getElementById("results");
  const summaryEl = document.getElementById("results-summary");

  summaryEl.textContent = `${all.length} opportunities checked — 🟢 ${green.length} eligible, 🟡 ${yellow.length} need checking, 🔴 ${red.length} not eligible.`;
  resultsEl.innerHTML = "";
  document.getElementById("results-controls").hidden = all.length === 0;
  document.getElementById("results-search").value = "";
  document.getElementById("results-sort").value = "status";

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

  renderResults(profile);
  document.getElementById("results-section").scrollIntoView({ behavior: "smooth" });
});

loadData().catch(err => {
  document.getElementById("results-summary").textContent = "Couldn't load firm data — please refresh the page.";
  console.error(err);
});
