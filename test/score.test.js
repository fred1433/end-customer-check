import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decisionOf } from "../src/policy.js";

const root = new URL("..", import.meta.url).pathname;
const load = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

test("the published results are rebuilt from the published data alone", () => {
  const out = join(mkdtempSync(join(tmpdir(), "ecc-")), "results.json");
  execFileSync(process.execPath, [join(root, "scripts/score.mjs")], { env: { ...process.env, SCORE_SRC: "data/", SCORE_OUT: out, SCORE_QUIET: "1" } });
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), load("public/end-customer-check/data/results.json"));
});

test("nothing is published for a decision that was not accepted or routed: no proposal, no reference label", () => {
  const data = load("data/clay_records.json");
  const reference = load("data/reference.json");
  const results = load("public/end-customer-check/data/results.json");
  for (const r of results.rows.filter((x) => !["accepted", "routed"].includes(x.decision.status))) {
    assert.equal(r.business_model, "unresolved");
    assert.equal(r.evidence, undefined);
    assert.equal(r.reference, undefined);
    assert.equal(reference[String(r.id)], undefined, `row ${r.id} publishes a reference label`);
    const src = data.find((x) => x.id === r.id);
    assert.equal(src.proposal?.business_model, undefined);
    assert.equal(src.proposal?.evidence_quote, undefined);
    assert.equal(src.raw_correct, undefined);
    assert.equal(src.middleman_proposed_as_end_customer, undefined);
    assert.equal(src.review?.why ?? null, null);
  }
});

test("policy: a quote found on another company's site is withheld, a mixed label is routed, a refused domain is not 'unreadable'", () => {
  const base = { proposal: { evidence_quote: "x", business_model: "end_customer" }, review: { supports: true } };
  assert.equal(decisionOf({ ...base, quote_check: { status: "found", final_url: "https://www.acme.com/about" } }, "acme.com").status, "accepted");
  assert.deepEqual(decisionOf({ ...base, quote_check: { status: "found", final_url: "https://www.microsoft.com/en/customers/story/acme" } }, "acme.com"),
    { status: "withheld", why: "evidence from a third-party site" });
  assert.equal(decisionOf({ ...base, proposal_is_mixed: true, quote_check: { status: "found", final_url: "https://acme.com/" } }, "acme.com").status, "routed");
  assert.equal(decisionOf({ ...base, quote_check: { status: "rejected", reason: "domain_not_allowed" } }, "acme.com").status, "refused");
  assert.equal(decisionOf({ ...base, quote_check: { status: "unreadable", reason: "http_403" } }, "acme.com").status, "unverifiable");
});

test("every accepted row passed all three checks on its own domain", () => {
  const results = load("public/end-customer-check/data/results.json");
  const t = results.tally;
  for (const r of results.rows.filter((x) => x.decision.status === "accepted")) {
    assert.equal(r.evidence.check.status, "found");
    assert.equal(r.evidence.review.supports, true);
    const h = new URL(r.evidence.check.final_url).hostname.replace(/^www\./, "");
    assert.ok(h === r.domain || h.endsWith("." + r.domain), `${r.company}: ${h}`);
  }
  assert.equal(t.accepted + t.routed + t.withheld_text_not_on_page + t.withheld_not_supported + t.withheld_third_party + t.withheld_other + t.unverifiable + t.refused, 50);
});
