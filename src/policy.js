// Demo evidence policy v3. The Decision formula in the Clay table (prompts/clay_decision_formula.txt) implements the
// same rules; test/policy.test.js runs that formula text against this file.
import { onOwnSite } from "./verify.js";

const t = (v) => String(v ?? "").trim();

// A short fingerprint of the input a check or a review was run on: the account's domain and the research step's
// label, URL and quote. The review is asked to copy it back; a review whose fingerprint differs was run on another input.
export function bindingOf(domain, label, url, quote) {
  const s = [domain, label, url, quote].map(t).join("|");
  let h = 5381;
  for (const ch of s) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(16);
}

// Everything the decision needs, as facts. Built from the raw Clay row by factsOf(); the published data carries
// these facts for every row, without the research step's proposal for rows that were not accepted.
export function factsOf(r) {
  const p = r.proposal || {};
  const q = r.quote_check || null;
  const rv = r.review || null;
  const domain = t(r.domain);
  const current = bindingOf(domain, p.business_model, p.evidence_url, p.evidence_quote);
  return {
    has_quote: !!t(p.evidence_quote),
    check_present: !!(q && q.status),
    check_for_this_input: !!q && t(q.proposal?.url) === t(p.evidence_url) && t(q.proposal?.quote) === t(p.evidence_quote),
    check_status: q?.status ?? null,
    check_reason: q?.reason ?? null,
    quote_found: q?.quote_found === true,
    has_domain: !!domain,
    on_own_site: domain && q?.final_url ? onOwnSite(q.final_url, domain) === true : false,
    review_present: !!rv && (rv.supports === true || rv.supports === false),
    review_for_this_input: !!rv && t(rv.binding) === current,
    supports: rv?.supports === true,
    label: p.business_model ?? null,
  };
}

export function decide(f) {
  if (!f.has_quote) return { status: "withheld", why: "no quote" };
  if (!f.check_present) return { status: "pending", why: "quote not checked yet" };
  if (!f.check_for_this_input) return { status: "withheld", why: "check was run on another input" };
  if (f.check_status === "rejected" && /^quote_/.test(f.check_reason || "")) return { status: "withheld", why: "quote too short" };
  if (f.check_status === "rejected" && f.check_reason === "domain_not_allowed") return { status: "refused", why: "domain not on the checker's list" };
  if (f.check_status === "unreadable" || f.check_status === "rejected") return { status: "unverifiable", why: f.check_reason };
  if (f.check_status === "absent") return { status: "withheld", why: "text not on the page" };
  if (f.check_status !== "found" || !f.quote_found) return { status: "withheld", why: "check not positive" };
  if (!f.has_domain) return { status: "withheld", why: "no account domain" };
  if (!f.on_own_site) return { status: "withheld", why: "evidence from a third-party site" };
  if (!f.review_present) return { status: "pending", why: "review not run yet" };
  if (!f.review_for_this_input) return { status: "withheld", why: "review was run on another input" };
  if (!f.supports) return { status: "withheld", why: "text on the page but it does not support the label in context" };
  if (f.label === "mixed_uncertain") return { status: "routed", why: "the evidence shows both: a person decides" };
  return { status: "accepted", why: "text on the company's own page, and it supports the label in context" };
}

export const decisionOf = (r) => decide(factsOf(r));
