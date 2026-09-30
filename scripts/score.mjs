// Builds public/end-customer-check/data/results.json from the Clay table export.
//
//   npm run score        (node scripts/score.mjs)
//
// Inputs, from private/ when present (the full export), else from the published copies in data/:
//   clay_records.json    the Accounts table as exported from Clay (full cell values; the published copy has the
//                        research proposal removed for every row that was not accepted)
//   reference.json       the reference review (the published copy keeps only rows whose label was accepted)
//   evaluation.json      step-by-step comparison with the reference; computed from private/, published as is,
//                        because it needs the withheld proposals
//   absent_where.json    for quotes the checker did not find: page metadata only, page source, or nowhere
//   fixtures.json, usage.json, featured.json, sample_rule.json, sample_corrections.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { decide } from "../src/policy.js";

const root = new URL("..", import.meta.url).pathname;
const PRIVATE = existsSync(root + "private/clay_records.json") && process.env.SCORE_SRC !== "data/";
const SRC = PRIVATE ? "private/" : "data/";
const read = (p) => JSON.parse(readFileSync(root + p, "utf8"));
const rows = read(SRC + "clay_records.json");
const reference = read(SRC + "reference.json");
const absentWhere = read("data/absent_where.json");
const fixtures = read("data/fixtures.json");
const usage = read("data/usage.json");
const featured = read("data/featured.json");
const corrections = read("data/sample_corrections.json");

const MIDDLEMEN = new Set(["staffing_recruitment", "engineering_services"]);

const CLAY_STATUS = (s) => (s === "accepted" ? "accepted" : s === "routed to a person" ? "routed" : String(s || "").split(":")[0].trim());

const out = [];
for (const r of rows) {
  const d = decide(r.facts);
  if (r.decision_in_clay && CLAY_STATUS(r.decision_in_clay) !== d.status) {
    throw new Error(`decision mismatch on row ${r.id}: clay "${r.decision_in_clay}" vs script "${d.status}"`);
  }
  const shown = d.status === "accepted" || d.status === "routed";
  const ref = reference[String(r.id)];
  const row = {
    id: r.id,
    company: r.company,
    domain: r.domain,
    sample_correction: corrections[String(r.id)] || null,
    entry_reason: r.entry_reason,
    signal: { url: r.signal_url, quote: r.signal_quote, date: r.signal_date || null, check: slim(r.signal_check) },
    decision: d,
    business_model: d.status === "accepted" ? r.proposal.business_model : d.status === "routed" ? "mixed_uncertain" : "unresolved",
    decision_in_clay: r.decision_in_clay,
  };
  if (shown) {
    row.reference = { label: ref.label, confidence: ref.confidence };
    row.agrees_with_reference = r.proposal.business_model === ref.label;
    row.evidence = {
      reason: r.proposal.reason,
      url: r.proposal.evidence_url,
      quote: r.proposal.evidence_quote,
      claimed_date: r.proposal.evidence_published_date || null,
      check: slim(r.quote_check, true),
      review: r.review,
    };
  } else {
    row.not_accepted = {
      where: d.why === "text not on the page" ? absentWhere[String(r.id)] || null : null,
      check_reason: r.quote_check?.reason || null,
    };
  }
  out.push(row);
}

function slim(c, keepContext = false) {
  if (!c) return null;
  const s = {
    status: c.status, reason: c.reason, quote_found: c.quote_found, http_status: c.http_status,
    original_url: c.original_url, final_url: c.final_url, retrieved_at: c.retrieved_at,
    content_sha256: c.content_sha256, page_title: c.page_title, publisher: c.publisher,
    dates: c.dates, verifier_version: c.verifier_version,
  };
  if (keepContext) Object.assign(s, { before: c.before, match: c.match, after: c.after });
  return s;
}

// Step-by-step comparison with the reference. It needs the withheld proposals, so it is computed from private/ only.
let evaluation;
if (PRIVATE) {
  const byId = Object.fromEntries(out.map((r) => [r.id, r]));
  const stage = (keep) => {
    const acc = rows.filter((r) => keep(r, byId[r.id]));
    const right = acc.filter((r) => r.proposal?.business_model === reference[String(r.id)].label);
    return {
      accepted: acc.length,
      accepted_correct: right.length,
      accepted_wrong: acc.length - right.length,
      middleman_accepted_as_end_customer: acc.filter((r) => MIDDLEMEN.has(reference[String(r.id)].label) && r.proposal?.business_model === "end_customer").length,
    };
  };
  evaluation = {
    raw: stage(() => true),
    text_present: stage((r) => r.quote_check?.status === "found"),
    supported: stage((r, o) => o.decision.status === "accepted"),
    note: "The last step counts accepted rows only. A label that the review confirms as mixed would be routed to a person, not counted; none was in this run.",
  };
  writeFileSync(root + "data/evaluation.json", JSON.stringify(evaluation, null, 1));
} else {
  evaluation = read("data/evaluation.json");
}

const count = (f) => out.filter(f).length;
const tally = {
  companies: out.length,
  accepted: count((r) => r.decision.status === "accepted"),
  routed: count((r) => r.decision.status === "routed"),
  withheld_text_not_on_page: count((r) => r.decision.why === "text not on the page"),
  withheld_not_supported: count((r) => r.decision.why === "text on the page but it does not support the label in context"),
  withheld_third_party: count((r) => r.decision.why === "evidence from a third-party site"),
  withheld_other: count((r) => r.decision.status === "withheld" && !["text not on the page", "text on the page but it does not support the label in context", "evidence from a third-party site"].includes(r.decision.why)),
  unverifiable: count((r) => r.decision.status === "unverifiable"),
  refused: count((r) => r.decision.status === "refused"),
  not_on_page_where: out.filter((r) => r.not_accepted?.where).reduce((a, r) => ((a[r.not_accepted.where] = (a[r.not_accepted.where] || 0) + 1), a), {}),
  accepted_by_model: out.filter((r) => r.decision.status === "accepted").reduce((a, r) => ((a[r.business_model] = (a[r.business_model] || 0) + 1), a), {}),
  signal_found: count((r) => r.signal.check?.status === "found"),
  cheap_filter_stops: 0,
};
const cost = {
  per_input_company_usd: +(usage.final_run_usd_exact / tally.companies).toFixed(4),
  per_accepted_classification_usd: +(usage.final_run_usd_exact / tally.accepted).toFixed(4),
  per_accepted_end_customer_usd: +(usage.final_run_usd_exact / (tally.accepted_by_model.end_customer || 1)).toFixed(4),
};

const results = { run_date: "2026-09-30", policy: "Demo evidence policy v3", sample_rule: read("data/sample_rule.json"), featured, tally, evaluation, usage, cost, fixtures, rows: out };
writeFileSync(process.env.SCORE_OUT || root + "public/end-customer-check/data/results.json", JSON.stringify(results, null, 1));
if (!process.env.SCORE_QUIET) console.log(JSON.stringify({ tally, evaluation, cost }, null, 1));
