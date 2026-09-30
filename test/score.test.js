import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

test("the published results are reproduced from the published data alone", () => {
  const out = join(mkdtempSync(join(tmpdir(), "ecc-")), "results.json");
  execFileSync(process.execPath, [join(root, "scripts/score.mjs")], { env: { ...process.env, SCORE_SRC: "data/", SCORE_OUT: out, SCORE_QUIET: "1" } });
  const fresh = JSON.parse(readFileSync(out, "utf8"));
  const published = JSON.parse(readFileSync(join(root, "public/end-customer-check/data/results.json"), "utf8"));
  assert.deepEqual(fresh, published);
});

test("no research proposal is published for a decision that was not accepted", () => {
  const data = JSON.parse(readFileSync(join(root, "data/clay_records.json"), "utf8"));
  const results = JSON.parse(readFileSync(join(root, "public/end-customer-check/data/results.json"), "utf8"));
  for (const r of results.rows.filter((x) => x.decision.status !== "accepted")) {
    assert.equal(r.business_model, "unresolved");
    assert.equal(r.evidence, undefined);
    const src = data.find((x) => x.id === r.id);
    assert.equal(src.proposal?.business_model, undefined, `row ${r.id} leaks a proposed label`);
    assert.equal(src.proposal?.evidence_quote, undefined, `row ${r.id} leaks a proposed quote`);
    assert.equal(src.review?.why ?? null, null);
  }
});

test("the policy is applied the same way in Clay and in the scorer", () => {
  const results = JSON.parse(readFileSync(join(root, "public/end-customer-check/data/results.json"), "utf8"));
  const accepted = results.rows.filter((r) => r.decision.status === "accepted");
  for (const r of accepted) {
    assert.equal(r.evidence.check.status, "found");
    assert.equal(r.evidence.review.supports, true);
  }
  assert.equal(results.tally.accepted + results.tally.withheld_text_not_on_page + results.tally.withheld_not_supported + results.tally.withheld_other + results.tally.unverifiable, 50);
});
