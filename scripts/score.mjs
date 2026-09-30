// Builds public/end-customer-check/data/results.json from the Clay table export.
//
//   node scripts/score.mjs
//
// Inputs (private/ when present, else the published copies in data/):
//   clay_records.json   the Accounts table as exported from Clay (one object per row, full cell values)
//   reference.json      the reference review: a business-model label per company, read from its own pages
//   absent_where.json   for quotes the checker did not find: page metadata only, page source, or nowhere
//   fixtures.json       the labelled adversarial fixtures table, exported from Clay
//   usage.json          Actions and Data Credits, per stage, for the final run and for development
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const SRC = process.env.SCORE_SRC || (existsSync(root + "private/clay_records.json") ? "private/" : "data/");
const read = (p) => JSON.parse(readFileSync(root + p, "utf8"));
const rows = read(SRC + "clay_records.json");
const reference = read(SRC + "reference.json");
const absentWhere = existsSync(root + SRC + "absent_where.json") ? read(SRC + "absent_where.json") : {};
const fixtures = existsSync(root + SRC + "fixtures.json") ? read(SRC + "fixtures.json") : [];
const usage = read("data/usage.json");
const featured = read("data/featured.json");

const MIDDLEMEN = new Set(["staffing_recruitment", "engineering_services"]);

function decisionOf(r) {
  const q = r.quote_check || {};
  if (!(r.proposal?.evidence_quote || r.proposal?.evidence_quote_present)) return { status: "withheld", why: "no quote" };
  if (q.status === "rejected" && /^quote_/.test(q.reason || "")) return { status: "withheld", why: "quote too short" };
  if (q.status === "unreadable" || q.status === "rejected") return { status: "unverifiable", why: q.reason };
  if (q.status === "absent") return { status: "withheld", why: "text not on the page" };
  if (r.review?.supports === true) return { status: "accepted", why: "text on the page and it supports the label in context" };
  if (r.review?.supports === false) return { status: "withheld", why: "text on the page but it does not support the label in context" };
  return { status: "pending", why: "" };
}

const out = [];
for (const r of rows) {
  const ref = reference[String(r.id)];
  const d = decisionOf(r);
  if (d.status !== r.decision_in_clay?.split(":")[0].trim() && r.decision_in_clay) {
    // The Clay formula and this script implement the same policy; a mismatch is a bug worth failing on.
    throw new Error(`decision mismatch on row ${r.id}: clay "${r.decision_in_clay}" vs script "${d.status}"`);
  }
  const accepted = d.status === "accepted";
  const row = {
    id: r.id,
    company: r.company,
    domain: r.domain,
    entry_reason: r.entry_reason,
    signal: { url: r.signal_url, quote: r.signal_quote, date: r.signal_date || null, check: slim(r.signal_check) },
    decision: d,
    business_model: accepted ? r.proposal.business_model : "unresolved",
    agrees_with_reference: accepted ? r.proposal.business_model === ref.label : null,
    reference_label: ref.label,
    reference_confidence: ref.confidence,
  };
  if (accepted) {
    row.evidence = {
      reason: r.proposal.reason,
      url: r.proposal.evidence_url,
      quote: r.proposal.evidence_quote,
      claimed_date: r.proposal.evidence_published_date || null,
      check: slim(r.quote_check, true),
      review: r.review,
    };
  } else {
    // Nothing the research step proposed is published for a decision that was not accepted.
    row.not_accepted = {
      where: d.why === "text not on the page" ? absentWhere[String(r.id)] || null : null,
      check_reason: r.quote_check?.reason || null,
    };
  }
  const correct = r.raw_correct ?? r.proposal?.business_model === ref.label;
  row.stages = {
    raw: { accepted: true, correct },
    text_present: { accepted: r.quote_check?.status === "found", correct },
    supported: { accepted, correct },
  };
  row.middleman_proposed_as_end_customer = !!r.middleman_proposed_as_end_customer;
  row.reference_is_middleman = MIDDLEMEN.has(ref.label);
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

function stage(key) {
  const acc = out.filter((r) => r.stages[key].accepted);
  const right = acc.filter((r) => r.stages[key].correct);
  const wrong = acc.filter((r) => !r.stages[key].correct);
  return {
    accepted: acc.length,
    accepted_correct: right.length,
    accepted_wrong: wrong.length,
    not_accepted: out.length - acc.length,
    // The costly error for a firm selling engineering teams: a middleman let through as an end customer.
    middleman_accepted_as_end_customer: acc.filter((r) => r.middleman_proposed_as_end_customer).length,
    wrong_rows: wrong.map((r) => r.id),
  };
}

const count = (f) => out.filter(f).length;
const tally = {
  companies: out.length,
  accepted: count((r) => r.decision.status === "accepted"),
  withheld_text_not_on_page: count((r) => r.decision.why === "text not on the page"),
  withheld_not_supported: count((r) => r.decision.why === "text on the page but it does not support the label in context"),
  withheld_other: count((r) => r.decision.status === "withheld" && !["text not on the page", "text on the page but it does not support the label in context"].includes(r.decision.why)),
  unverifiable: count((r) => r.decision.status === "unverifiable"),
  not_on_page_where: Object.values(absentWhere).reduce((a, w) => ((a[w] = (a[w] || 0) + 1), a), {}),
  accepted_by_model: out.filter((r) => r.decision.status === "accepted").reduce((a, r) => ((a[r.business_model] = (a[r.business_model] || 0) + 1), a), {}),
  signal_found: count((r) => r.signal.check?.status === "found"),
  cheap_filter_stops: 0,
};
const evaluation = { raw: stage("raw"), text_present: stage("text_present"), supported: stage("supported") };

usage.per_accepted_classification_usd = +(usage.final_run_usd / tally.accepted).toFixed(3);
usage.per_accepted_end_customer_usd = +(usage.final_run_usd / (tally.accepted_by_model.end_customer || 1)).toFixed(3);
const results = { run_date: "2026-09-30", sample_rule: read("data/sample_rule.json"), featured, tally, evaluation, usage, fixtures, rows: out };
writeFileSync(process.env.SCORE_OUT || root + "public/end-customer-check/data/results.json", JSON.stringify(results, null, 1));
if (!process.env.SCORE_QUIET) console.log(JSON.stringify({ tally, evaluation: Object.fromEntries(Object.entries(evaluation).map(([k, v]) => [k, { ...v, wrong_rows: v.wrong_rows.join(",") }])) }, null, 1));
