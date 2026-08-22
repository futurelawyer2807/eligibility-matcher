const CLASS_RANK = { "1st": 4, "2:1": 3, "2:2": 2, "3rd": 1 };

function matchFirms(profile) {
  const userRank = CLASS_RANK[profile.classification] ?? null;

  const results = FIRMS.map(firm => {
    const reasons = [];
    let eliminated = false;

    // Degree type filter
    if (firm.degreeType !== "both") {
      if (firm.degreeType !== profile.degreeType) {
        eliminated = true;
        reasons.push(`This firm's confirmed route is ${firm.degreeType} only.`);
      }
    }

    // Academic classification filter — only eliminates when the firm has a CONFIRMED minimum
    if (!eliminated && firm.classificationRank != null && userRank != null) {
      if (userRank < firm.classificationRank) {
        eliminated = true;
        const label = Object.keys(CLASS_RANK).find(k => CLASS_RANK[k] === firm.classificationRank);
        reasons.push(`Requires a confirmed minimum of ${label} — below your stated classification.`);
      }
    }

    // Opportunity type filter — hard filter, user explicitly chose these
    const wantsMatch = profile.opportunityTypes.some(t => firm.opportunityTypes.includes(t));
    if (!eliminated && !wantsMatch) {
      eliminated = true;
      reasons.push(`Doesn't currently offer the opportunity type(s) you selected.`);
    }

    // Location filter — city-token overlap, so "London / Birmingham" still matches a London-only firm.
    // Never eliminates a firm whose location is an unspecific "Multiple UK offices" — we don't have confirmed
    // per-city data for it, so filtering would mean guessing.
    if (!eliminated && profile.location !== "UK-wide" && firm.location !== "Multiple UK offices") {
      const cities = s => s.split("/").map(t => t.trim());
      const overlap = cities(firm.location).some(c => cities(profile.location).includes(c));
      if (!overlap) {
        eliminated = true;
        reasons.push(`Only confirmed in ${firm.location}, not ${profile.location}.`);
      }
    }

    // Score for ranking (higher = better fit), only relevant if not eliminated
    let score = 0;
    if (firm.maintenanceGrant) score += firm.maintenanceGrant / 1000;
    if (firm.pgdlFunded) score += 5;
    if (firm.verified === "confirmed") score += 3;
    if (firm.verified === "partial") score += 1;

    return { firm, eliminated, reasons, score };
  });

  const eligible = results.filter(r => !r.eliminated).sort((a, b) => b.score - a.score);
  const filteredOut = results.filter(r => r.eliminated);

  return { eligible, filteredOut };
}

function renderBadges(firm) {
  let html = `<span class="badge eligible">ELIGIBLE</span>`;
  if (firm.pgdlRequired) {
    if (firm.pgdlFunded) {
      html += `<span class="badge pgdl">PGDL FUNDED${firm.maintenanceGrant ? " + £" + firm.maintenanceGrant.toLocaleString() + " GRANT" : ""}</span>`;
    } else {
      html += `<span class="badge unverified">PGDL REQUIRED — FUNDING TBC</span>`;
    }
  }
  if (firm.verified !== "confirmed") {
    html += `<span class="badge unverified">${firm.verified === "unconfirmed" ? "VERIFY DIRECTLY" : "PARTIALLY VERIFIED"}</span>`;
  }
  return html;
}

function renderResults(profile) {
  const { eligible, filteredOut } = matchFirms(profile);
  const resultsEl = document.getElementById("results");
  const summaryEl = document.getElementById("results-summary");

  summaryEl.textContent = `${eligible.length} eligible opportunit${eligible.length === 1 ? "y" : "ies"} found out of ${FIRMS.length} firms in the dataset.`;

  resultsEl.innerHTML = "";

  eligible.forEach(({ firm }, i) => {
    const card = document.createElement("div");
    card.className = "result-card";
    card.setAttribute("data-index", String(i + 1).padStart(2, "0"));
    const classLabel = firm.classificationRank != null
      ? Object.keys(CLASS_RANK).find(k => CLASS_RANK[k] === firm.classificationRank) + " minimum"
      : "No confirmed classification minimum";
    const applyLink = firm.applyUrl
      ? `<a class="apply-link" href="${firm.applyUrl}" target="_blank" rel="noopener noreferrer">Apply directly →</a>`
      : `<span class="apply-link apply-link-unknown">Apply page not confirmed — search "${firm.name} training contract"</span>`;
    card.innerHTML = `
      <div class="firm-name">${firm.name}</div>
      <div class="badges">${renderBadges(firm)}</div>
      <div class="notes">${firm.notes}</div>
      <div class="meta">${firm.location} · ${firm.opportunityTypes.map(t => t === "vac_scheme" ? "Vacation scheme" : "Training contract").join(", ")} · ${classLabel}</div>
      ${applyLink}
    `;
    resultsEl.appendChild(card);
  });

  if (filteredOut.length) {
    const toggle = document.createElement("button");
    toggle.className = "show-filtered-btn";
    toggle.textContent = `Show ${filteredOut.length} filtered-out firm${filteredOut.length === 1 ? "" : "s"} (and why)`;
    const filteredWrap = document.createElement("div");
    filteredWrap.className = "filtered-wrap";
    filteredWrap.style.display = "none";

    filteredOut.forEach(({ firm, reasons }) => {
      const card = document.createElement("div");
      card.className = "result-card filtered";
      card.innerHTML = `
        <div class="firm-name">${firm.name}</div>
        <div class="badges"><span class="badge filtered-badge">NOT SHOWN AS ELIGIBLE</span></div>
        <div class="notes">${reasons.join(" ")}</div>
      `;
      filteredWrap.appendChild(card);
    });

    toggle.addEventListener("click", () => {
      const visible = filteredWrap.style.display !== "none";
      filteredWrap.style.display = visible ? "none" : "block";
      toggle.textContent = visible
        ? `Show ${filteredOut.length} filtered-out firm${filteredOut.length === 1 ? "" : "s"} (and why)`
        : `Hide filtered-out firms`;
    });

    resultsEl.appendChild(toggle);
    resultsEl.appendChild(filteredWrap);
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
