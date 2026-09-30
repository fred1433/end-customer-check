// Runs the exact formula text used in the Clay Decision column against src/policy.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decisionOf, bindingOf } from "../src/policy.js";

const root = new URL("..", import.meta.url).pathname;
const formula = (name) => {
  const text = readFileSync(root + "prompts/" + name, "utf8").trim();
  const src = text.replace(/\{\{([^}]+)\}\}/g, (_, col) => `v[${JSON.stringify(col)}]`);
  return new Function("v", `return ${src};`);
};
const clayDecision = formula("clay_decision_formula.txt");
const clayBinding = formula("clay_binding_formula.txt");
const status = (s) => (s === "accepted" ? "accepted" : s === "routed to a person" ? "routed" : s.split(":")[0]);

// One row as Clay's columns see it, and the same row as src/policy.js sees it.
function row({ domain = "acme.com", label = "engineering_services", url = "https://www.acme.com/about", quote = "Acme sells managed IT services to other organizations across Texas.", check, review }) {
  return {
    clay: { Domain: domain, "Research Business Model": label, "Research Evidence Url": url, "Research Evidence Quote": quote, "Quote check": check, "Contextual review": review },
    js: { domain, proposal: { business_model: label, evidence_url: url, evidence_quote: quote }, quote_check: check, review },
  };
}
const found = (over = {}) => ({ status: "found", quote_found: true, final_url: "https://www.acme.com/about", proposal: { url: "https://www.acme.com/about", quote: "Acme sells managed IT services to other organizations across Texas." }, ...over });
const goodBinding = bindingOf("acme.com", "engineering_services", "https://www.acme.com/about", "Acme sells managed IT services to other organizations across Texas.");

const cases = {
  "all checks positive, same input": [row({ check: found(), review: { supports: true, binding: goodBinding } }), "accepted"],
  "no check object, no domain (judge case 1)": [row({ domain: "", check: undefined, review: { supports: true } }), "pending"],
  "pending check, stale positive review (judge case 2)": [row({ check: { status: "pending", proposal: found().proposal }, review: { supports: true, binding: goodBinding } }), "withheld"],
  "quote on another domain, blank account domain (judge case 3)": [row({ domain: "", check: found({ final_url: "https://www.microsoft.com/story" }), review: { supports: true, binding: bindingOf("", "engineering_services", "https://www.acme.com/about", "Acme sells managed IT services to other organizations across Texas.") } }), "withheld"],
  "status found but quote_found false (judge case 4)": [row({ check: found({ quote_found: false }), review: { supports: true, binding: goodBinding } }), "withheld"],
  "label and quote changed, old check and review kept (judge case 5)": [row({ label: "end_customer", quote: "Acme builds all of its software in-house for its own stores.", check: found(), review: { supports: true, binding: goodBinding } }), "withheld"],
  "label changed only, old review kept": [row({ label: "end_customer", check: found(), review: { supports: true, binding: goodBinding } }), "withheld"],
  "quote on a third-party site": [row({ check: found({ final_url: "https://www.microsoft.com/en/customers/story/acme" }), review: { supports: true, binding: goodBinding } }), "withheld"],
  "mixed label supported": [row({ label: "mixed_uncertain", check: found(), review: { supports: true, binding: bindingOf("acme.com", "mixed_uncertain", "https://www.acme.com/about", "Acme sells managed IT services to other organizations across Texas.") } }), "routed"],
  "review says no": [row({ check: found(), review: { supports: false, binding: goodBinding } }), "withheld"],
  "page unreadable": [row({ check: { status: "unreadable", reason: "error_page", proposal: found().proposal }, review: null }), "unverifiable"],
  "domain refused": [row({ check: { status: "rejected", reason: "domain_not_allowed", proposal: found().proposal } }), "refused"],
  "quote absent": [row({ check: { status: "absent", reason: "not_on_page", proposal: found().proposal } }), "withheld"],
};

for (const [name, [r, expected]] of Object.entries(cases)) {
  test(`policy and Clay formula agree: ${name}`, () => {
    assert.equal(decisionOf(r.js).status, expected, "src/policy.js");
    assert.equal(status(clayDecision(r.clay)), expected, "Clay Decision formula");
  });
}

test("the Clay binding formula and bindingOf give the same fingerprint", () => {
  const r = row({});
  assert.equal(clayBinding(r.clay), goodBinding);
});

test("every published row: the decision Clay recorded equals the decision recomputed from the published facts", async () => {
  const { decide } = await import("../src/policy.js");
  const data = JSON.parse(readFileSync(root + "data/clay_records.json", "utf8"));
  for (const r of data) {
    assert.ok(r.decision_in_clay, `row ${r.id} has a recorded Clay decision`);
    assert.equal(decide(r.facts).status, status(r.decision_in_clay), `row ${r.id}`);
  }
});
