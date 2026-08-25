const TODAY = new Date("2026-08-23");

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function statTile(num, label, cls) {
  const t = el("div", "stat-tile" + (cls ? " " + cls : ""));
  t.appendChild(el("div", "stat-num", String(num)));
  t.appendChild(el("div", "stat-label", label));
  return t;
}

function fieldPill(field) {
  if (!field) return `<span class="pill pill-not_verified">N/A</span>`;
  return `<span class="pill pill-${field.status.toLowerCase()}">${field.status}</span>`;
}

function buildTable(tableEl, headers, rows) {
  const thead = tableEl.querySelector("thead");
  const tbody = tableEl.querySelector("tbody");
  thead.innerHTML = `<tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr>`;
  tbody.innerHTML = rows.length
    ? rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}" style="color:var(--faint); font-style:italic;">None — nothing in this category right now.</td></tr>`;
}

async function run() {
  const [firms, opportunities, rules] = await Promise.all([
    fetch("data/firms.json").then(r => r.json()),
    fetch("data/opportunities.json").then(r => r.json()),
    fetch("data/rules.json").then(r => r.json())
  ]);

  const firmById = Object.fromEntries(firms.map(f => [f.id, f]));
  const rulesByOpp = Object.fromEntries(rules.map(r => [r.opportunityId, r]));

  const enriched = opportunities.map(o => ({
    opp: o,
    firm: firmById[o.firmId],
    rules: rulesByOpp[o.id],
    deadlineStatus: RulesEngine.computeOpportunityStatus(o, TODAY)
  }));

  // --- Summary tiles ---
  const unverifiedDates = enriched.filter(e => e.opp.dataConfidence === "unverified");
  const closedNoReopen = enriched.filter(e => e.deadlineStatus === "CLOSED" && !e.opp.openingDate);
  const noApplyUrl = enriched.filter(e => !e.opp.applyUrl);
  const noClassData = enriched.filter(e => e.rules.minClassification.status === "NOT_VERIFIED");
  const noNonLawData = enriched.filter(e => e.rules.acceptsNonLaw.status === "NOT_VERIFIED");
  const openNow = enriched.filter(e => e.deadlineStatus === "OPEN_NOW");

  const summary = document.getElementById("summary");
  summary.appendChild(statTile(firms.length, "Firms"));
  summary.appendChild(statTile(opportunities.length, "Opportunities"));
  summary.appendChild(statTile(openNow.length, "Open now"));
  summary.appendChild(statTile(unverifiedDates.length, "Unverified date sources", unverifiedDates.length ? "warn" : ""));
  summary.appendChild(statTile(closedNoReopen.length, "Closed, no reopen date", closedNoReopen.length ? "warn" : ""));
  summary.appendChild(statTile(noApplyUrl.length, "Missing apply URL", noApplyUrl.length ? "bad" : ""));
  summary.appendChild(statTile(noClassData.length, "No classification data", "warn"));
  summary.appendChild(statTile(noNonLawData.length, "No non-law data", noNonLawData.length ? "warn" : ""));

  // --- Unverified date sources ---
  buildTable(
    document.getElementById("table-unverified"),
    ["Firm", "Type", "Note", "Source"],
    unverifiedDates.map(e => [
      e.firm.name,
      e.opp.type,
      e.opp.notes || "",
      e.opp.applyUrl ? `<a href="${e.opp.applyUrl}" target="_blank" rel="noopener noreferrer">Link</a>` : "—"
    ])
  );

  // --- Closed, no reopen date ---
  buildTable(
    document.getElementById("table-closed-no-reopen"),
    ["Firm", "Type", "Last known deadline", "Cycle", "Source"],
    closedNoReopen.map(e => [
      e.firm.name,
      e.opp.type,
      e.opp.deadline || "—",
      e.opp.cycleYear || "—",
      e.opp.applyUrl ? `<a href="${e.opp.applyUrl}" target="_blank" rel="noopener noreferrer">Link</a>` : "—"
    ])
  );

  // --- Missing apply URL ---
  buildTable(
    document.getElementById("table-no-url"),
    ["Firm", "Type", "Location"],
    noApplyUrl.map(e => [e.firm.name, e.opp.type, e.opp.location])
  );

  // --- Unverified rules fields ---
  buildTable(
    document.getElementById("table-unverified-fields"),
    ["Firm", "Type", "Classification min", "Non-law accepted", "PGDL funded"],
    enriched
      .filter(e => e.rules.minClassification.status === "NOT_VERIFIED" || e.rules.acceptsNonLaw.status === "NOT_VERIFIED")
      .map(e => [
        e.firm.name,
        e.opp.type,
        fieldPill(e.rules.minClassification),
        fieldPill(e.rules.acceptsNonLaw),
        fieldPill(e.rules.pgdlFunded)
      ])
  );

  // --- Full register ---
  buildTable(
    document.getElementById("table-all"),
    ["Firm", "Type", "Deadline status", "Opens", "Closes", "Data confidence", "Class. min"],
    enriched
      .sort((a, b) => a.firm.name.localeCompare(b.firm.name))
      .map(e => [
        e.firm.name,
        e.opp.type,
        RulesEngine.DEADLINE_STATUS_META[e.deadlineStatus].label,
        e.opp.openingDate || "—",
        e.opp.deadline || "—",
        e.opp.dataConfidence || "normal",
        e.rules.minClassification.value ?? "—"
      ])
  );
}

run();
