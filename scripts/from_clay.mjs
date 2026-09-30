// Flattens the Clay Accounts table export (private/clay_records_full.json, from Clay's app API) into
// private/clay_records.json, and writes the published copy data/clay_records.json in which a row whose
// decision was not accepted carries none of the research step's proposal (no unsupported label next to a name).
import { readFileSync, writeFileSync } from "node:fs";
import { factsOf, decide } from "../src/policy.js";

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
const usage = (r, k) => {
  const x = r.cells[F[k]]?.externalContent;
  if (!x) return null;
  // Clay records an upfront charge and an additional (reconciliation) charge per cell; refunds are flagged.
  return { upfront: x.upfrontCreditUsage?.totalCost ?? 0, additional: x.additionalCreditUsage?.totalCost ?? 0, actions: (x.upfrontCreditUsage?.actionExecutionsUsed ?? 0) + (x.additionalCreditUsage?.actionExecutionsUsed ?? 0), refunded: !!x.isRefunded };
};

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
    review: full(r, "review"),
    decision_in_clay: val(r, "decision"),
    last_run_usage: { research: usage(r, "research"), quote_check: usage(r, "quote_check"), signal_check: usage(r, "signal_check"), review: usage(r, "review") },
  }))
  .sort((a, b) => a.id - b.id)
  .map((r) => ({ ...r, facts: factsOf(r) }));

const STATUS = (s) => (s === "accepted" ? "accepted" : s === "routed to a person" ? "routed" : String(s || "").split(":")[0]);
for (const r of rows) {
  const js = decide(r.facts).status;
  if (STATUS(r.decision_in_clay) !== js) throw new Error(`row ${r.id}: Clay says "${r.decision_in_clay}", src/policy.js says "${js}"`);
}

writeFileSync(root + "private/clay_records.json", JSON.stringify(rows, null, 1));

const pub = rows.map((r) => {
  const d = decide(r.facts);
  if (d.status === "accepted" || d.status === "routed") return r;
  // Not accepted: the research step's proposal (label, reason, quote, URL) is not published. The facts and the
  // neutral decision Clay recorded stay, so the policy can be re-run on every row.
  const x = structuredClone(r);
  x.proposal = r.proposal ? { evidence_quote_present: !!r.proposal.evidence_quote, withheld: true } : null;
  x.facts = { ...r.facts, label: null };
  if (x.quote_check) x.quote_check = { ...x.quote_check, proposal: null, before: null, match: null, after: null, final_url: x.quote_check.status === "found" ? x.quote_check.final_url : null };
  x.review = r.review ? { supports: r.review.supports } : null;
  return x;
});
writeFileSync(root + "data/clay_records.json", JSON.stringify(pub, null, 1));
const shownIds = new Set(pub.filter((r) => !r.proposal?.withheld && r.proposal).map((r) => String(r.id)));
writeFileSync(root + "data/reference.json", JSON.stringify(Object.fromEntries(Object.entries(reference).filter(([id]) => shownIds.has(id))), null, 1));
console.log(rows.length, "rows;", pub.filter((r) => r.proposal?.withheld).length, "published without the proposal;", shownIds.size, "reference labels published");
