// Pure eligibility rules engine — no DOM access, deterministic, testable in isolation.
// Input: a user profile + one opportunity's rules record. Output: a three-tier result with reasons.
//
// Status vocabulary for any individual data field:
//   CONFIRMED       — verified directly on the firm's own current page
//   LIKELY          — verified via a secondary source (e.g. Chambers Student quoting the firm), or the
//                     firm's page could not be independently re-checked this pass
//   NOT_VERIFIED    — no source found; the engine never eliminates a candidate on a NOT_VERIFIED field
//
// Result status:
//   GREEN  — meets every CONFIRMED/LIKELY requirement found
//   YELLOW — meets what's verified, but at least one relevant field is NOT_VERIFIED (needs a manual check)
//   RED    — fails a CONFIRMED or LIKELY requirement

const CLASS_RANK = { "1st": 4, "2:1": 3, "2:2": 2, "3rd": 1 };

// GPA bands, ordinal low-to-high — US firms almost never publish an exact cutoff (unlike UK
// classification language), so most minGPA fields will honestly be NOT_VERIFIED rather than
// filled with an invented number.
const GPA_RANK = { "3.9+": 5, "3.7-3.89": 4, "3.5-3.69": 3, "3.0-3.49": 2, "below-3.0": 1 };

// Jurisdiction metadata — every opportunity carries one of these codes. Adding a new
// jurisdiction means adding an entry here plus (if its academic system doesn't map onto
// UK classification or US GPA) a new ranked scale, not bending an existing one.
const JURISDICTIONS = {
  "uk-england-wales": { label: "UK (England & Wales)", country: "uk" },
  "usa-ny": { label: "USA (New York)", country: "usa" }
};

function evaluateOpportunity(profile, opportunity, rules) {
  const reasons = [];
  let status = "GREEN";
  let hasUnverifiedFactor = false;

  function fail(text) {
    status = "RED";
    reasons.push({ ok: false, text });
  }
  function pass(text) {
    reasons.push({ ok: true, text });
  }
  function unverified(text) {
    hasUnverifiedFactor = true;
    reasons.push({ ok: null, text });
  }

  // Opportunity type — always a hard filter, this is what the user explicitly asked for
  if (!profile.opportunityTypes.includes(opportunity.type)) {
    return {
      status: "HIDDEN",
      reasons: [{ ok: false, text: "Not the opportunity type you selected." }]
    };
  }

  // Jurisdiction — a hard filter, same as opportunity type. A UK-only candidate shouldn't
  // see NY summer-associate programs cluttering their results, and vice versa.
  const jurisdictionMeta = JURISDICTIONS[opportunity.jurisdiction];
  const jurisdictionCountry = jurisdictionMeta ? jurisdictionMeta.country : null;
  if (!profile.jurisdictions.includes(jurisdictionCountry)) {
    return {
      status: "HIDDEN",
      reasons: [{ ok: false, text: "Not the jurisdiction you selected." }]
    };
  }

  const isUS = jurisdictionCountry === "usa";

  // Degree type / non-law acceptance — meaningless in the US system, where every lawyer holds
  // a JD regardless of undergraduate major, so there's no "non-law route" question to ask.
  if (!isUS) {
    const nonLaw = rules.acceptsNonLaw;
    if (profile.degreeType === "non-law") {
      if (nonLaw.value === true) {
        pass(fieldStatusLabel(nonLaw.status) + " — this firm accepts non-law applicants.");
      } else if (nonLaw.value === false) {
        fail("This firm's confirmed route is law-degree only.");
      } else {
        unverified("Whether non-law applicants are accepted has not been verified for this firm.");
      }
    }
  }

  // Academic threshold — UK classification and US GPA are different measurement systems,
  // never compared against each other; each opportunity is evaluated only on its own system's terms.
  if (isUS) {
    const minGPA = rules.minGPA;
    if (!minGPA || minGPA.status === "NOT_VERIFIED" || minGPA.value === null) {
      unverified("No confirmed GPA minimum found — US firms rarely publish one, but an unofficial bar may still exist.");
    } else if (minGPA.value === "none") {
      pass("Confirmed: no minimum GPA requirement stated.");
    } else {
      const userRank = GPA_RANK[profile.gpa] ?? null;
      const firmRank = GPA_RANK[minGPA.value] ?? null;
      if (userRank == null) {
        unverified(`This firm states a GPA minimum of ${minGPA.value} — you didn't provide a GPA band to check against.`);
      } else if (userRank < firmRank) {
        fail(`States a GPA minimum of ${minGPA.value} — below your stated band.`);
      } else {
        pass(`Your stated GPA band meets the ${minGPA.value} minimum.`);
      }
    }
  } else {
    const minClass = rules.minClassification;
    if (minClass.status === "NOT_VERIFIED" || minClass.value === null) {
      unverified("No confirmed classification minimum found — this firm may or may not have an unpublished bar.");
    } else if (minClass.value === "none") {
      pass("Confirmed: no minimum degree classification requirement.");
    } else {
      const userRank = CLASS_RANK[profile.classification] ?? null;
      const firmRank = CLASS_RANK[minClass.value] ?? null;
      if (userRank == null) {
        unverified(`This firm requires a ${fieldStatusLabel(minClass.status).toLowerCase()} minimum of ${minClass.value} — you didn't provide a classification to check against.`);
      } else if (userRank < firmRank) {
        fail(`Requires a ${fieldStatusLabel(minClass.status).toLowerCase()} minimum of ${minClass.value} — below your stated ${profile.classification}.`);
      } else {
        pass(`Your ${profile.classification} meets the ${fieldStatusLabel(minClass.status).toLowerCase()} minimum of ${minClass.value}.`);
      }
    }
  }

  // Location
  if (profile.location !== "UK-wide" && profile.location !== "US-wide" && opportunity.location !== "Multiple UK offices") {
    const cities = s => s.split("/").map(t => t.trim());
    const overlap = cities(opportunity.location).some(c => cities(profile.location).includes(c));
    if (!overlap) {
      fail(`Only confirmed in ${opportunity.location}, not ${profile.location}.`);
    }
  }

  // Note: rightToWorkRequired / internationalAccepted / sqeRequired are tracked in the data model
  // (see data/rules.json) for future profile questions, but the current form doesn't ask the user
  // about nationality, right-to-work status, or SQE stage — so those fields aren't evaluated here.
  // Surfacing "unverified" on a question nobody asked would make every result YELLOW for no reason.

  if (status === "RED") return { status, reasons };
  if (hasUnverifiedFactor) return { status: "YELLOW", reasons };
  return { status: "GREEN", reasons };
}

function fieldStatusLabel(status) {
  return status === "CONFIRMED" ? "Confirmed" : status === "LIKELY" ? "Likely" : "Unverified";
}

// Deadline/opening-window status, computed fresh from raw dates rather than trusting a
// pre-baked label — so it stays correct as "today" moves forward, and every opportunity
// resolves the same way regardless of when each was researched.
//
// UNVERIFIED   — the underlying date data itself couldn't be trusted (site blocked automated
//                access, or the firm's own page had an internally contradictory date)
// OPEN_NOW     — today falls inside the opening/deadline window
// OPENING_SOON — a future opening date is known
// CLOSED       — the deadline has passed and no future opening date is known
// NOT_YET_ANNOUNCED — neither an opening date nor a deadline has been published
function computeOpportunityStatus(opportunity, today) {
  if (opportunity.dataConfidence === "unverified") return "UNVERIFIED";

  const opening = opportunity.openingDate ? new Date(opportunity.openingDate) : null;
  const deadline = opportunity.deadline ? new Date(opportunity.deadline) : null;

  if (opening && deadline) {
    if (today < opening) return "OPENING_SOON";
    if (today > deadline) return "CLOSED";
    return "OPEN_NOW";
  }
  if (opening) {
    return today >= opening ? "OPEN_NOW" : "OPENING_SOON";
  }
  if (deadline) {
    return today > deadline ? "CLOSED" : "OPEN_NOW";
  }
  return "NOT_YET_ANNOUNCED";
}

const DEADLINE_STATUS_META = {
  OPEN_NOW: { label: "Open now", cls: "open-now" },
  OPENING_SOON: { label: "Opening soon", cls: "opening-soon" },
  CLOSED: { label: "Closed", cls: "closed" },
  NOT_YET_ANNOUNCED: { label: "Not yet announced", cls: "not-announced" },
  UNVERIFIED: { label: "Dates unverified", cls: "unverified" }
};

// Evaluate a full opportunity list against a profile, joining in firm + rules records.
function evaluateAll(profile, firms, opportunities, rules) {
  const firmById = Object.fromEntries(firms.map(f => [f.id, f]));
  const rulesByOpp = Object.fromEntries(rules.map(r => [r.opportunityId, r]));

  const results = opportunities.map(opp => {
    const r = rulesByOpp[opp.id];
    const evalResult = evaluateOpportunity(profile, opp, r);
    return { firm: firmById[opp.firmId], opportunity: opp, rules: r, ...evalResult };
  });

  const visible = results.filter(r => r.status !== "HIDDEN");
  return {
    green: visible.filter(r => r.status === "GREEN"),
    yellow: visible.filter(r => r.status === "YELLOW"),
    red: visible.filter(r => r.status === "RED"),
    all: visible
  };
}

const RulesEngine = { evaluateOpportunity, evaluateAll, CLASS_RANK, GPA_RANK, JURISDICTIONS, fieldStatusLabel, computeOpportunityStatus, DEADLINE_STATUS_META };

if (typeof module !== "undefined" && module.exports) {
  module.exports = RulesEngine;
}
if (typeof window !== "undefined") {
  window.RulesEngine = RulesEngine;
}
