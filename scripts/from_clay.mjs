// Flattens the Clay Accounts table export (private/clay_records_full.json, from Clay's app API) into
// private/clay_records.json, and writes the published copy data/clay_records.json in which a row whose
// decision was not accepted carries none of the research step's proposal (no unsupported label next to a name).
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const raw = JSON.parse(readFileSync(root + "private/clay_records_full.json", "utf8"));
const reference = JSON.parse(readFileSync(root + "private/reference.json", "utf8"));
const F = {
  id: "f_0tm6hgzuTwtwXoGQsjN", company: "f_0tm6hh0tjZmS37xV9fv", domain: "f_0tm6hh0UuEntZbpPk7Y",
  entry_reason: "f_0tm6hh0QvRhzxMNxzbj", signal_url: "f_0tm6hh1PZRqjSg8KZ4X", signal_quote: "f_0tm6hh1NMtt4Kt5qRyD",
  signal_date: "f_0tm6hh1NJBk5J5XaN87", research: "f_0tm6jj7i7YSiWSgzjjU", quote_check: "f_0tm6kiib4kYYB57rXED",
  signal_check: "f_0tm6olrp7PzGvDjjnir", review: "f_0tm6of2ptHbXSXKxPN7", decision: "f_0tm6ofqTzmksvpfKEDb",
};
const val = (r, k) => r.cells[F[k]]?.value ?? null;
const full = (r, k) => r.cells[F[k]]?.externalContent?.fullValue ?? null;
const usage = (r, k) => r.cells[F[k]]?.externalContent?.upfrontCreditUsage ?? null;

const rows = raw
  .filter((r) => val(r, "company"))
  .map((r) => ({
    id: val(r, "id"),
    company: val(r, "company"),
    domain: val(r, "domain"),
    entry_reason: val(r, "entry_reason"),
    signal_url: val(r, "signal_url"),
    signal_quote: val(r, "signal_quote"),
    signal_date: val(r, "signal_date"),
    proposal: full(r, "research"),
    quote_check: full(r, "quote_check"),
    signal_check: full(r, "signal_check"),
    // The review column ran on every row once before its run condition was saved; only rows whose quote was found count.
    review: full(r, "quote_check")?.quote_found ? full(r, "review") : null,
    decision_in_clay: val(r, "decision"),
    last_run_usage: { research: usage(r, "research"), quote_check: usage(r, "quote_check"), signal_check: usage(r, "signal_check"), review: usage(r, "review") },
  }))
  .sort((a, b) => a.id - b.id)
  .map((r) => ({
    ...r,
    // The costly error, precomputed so the published copy can be scored without the withheld proposals.
    middleman_proposed_as_end_customer:
      ["staffing_recruitment", "engineering_services"].includes(reference[String(r.id)].label) && r.proposal?.business_model === "end_customer",
  }));

writeFileSync(root + "private/clay_records.json", JSON.stringify(rows, null, 1));

const accepted = (r) => r.quote_check?.status === "found" && r.review?.supports === true && r.proposal?.evidence_quote;
const pub = rows.map((r) => {
  if (accepted(r)) return r;
  const x = structuredClone(r);
  const ref = reference[String(r.id)].label;
  x.raw_correct = r.proposal?.business_model === ref;
  x.proposal = r.proposal ? { evidence_quote_present: !!r.proposal.evidence_quote, withheld: true } : null;
  if (x.quote_check) {
    x.quote_check = { ...x.quote_check, proposal: null, before: null, match: null, after: null };
  }
  x.review = r.review ? { supports: r.review.supports, why: null } : null;
  x.decision_in_clay = null;
  return x;
});
writeFileSync(root + "data/clay_records.json", JSON.stringify(pub, null, 1));
console.log(rows.length, "rows;", pub.filter((r) => r.proposal?.withheld).length, "published without the proposal");
