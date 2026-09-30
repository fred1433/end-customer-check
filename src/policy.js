import { onOwnSite } from "./verify.js";

// Demo evidence policy v2. The Decision formula in the Clay table implements the same rules.
export function decisionOf(r, domain) {
  const q = r.quote_check || {};
  if (!(r.proposal?.evidence_quote || r.proposal?.evidence_quote_present)) return { status: "withheld", why: "no quote" };
  if (q.status === "rejected" && /^quote_/.test(q.reason || "")) return { status: "withheld", why: "quote too short" };
  if (q.status === "rejected" && q.reason === "domain_not_allowed") return { status: "refused", why: "domain not on the checker's list" };
  if (q.status === "unreadable" || q.status === "rejected") return { status: "unverifiable", why: q.reason };
  if (q.status === "absent") return { status: "withheld", why: "text not on the page" };
  if (onOwnSite(q.final_url, domain) === false) return { status: "withheld", why: "evidence from a third-party site" };
  if (r.review?.supports === true && r.proposal_is_mixed) return { status: "routed", why: "the evidence shows both: a person decides" };
  if (r.review?.supports === true) return { status: "accepted", why: "text on the company's own page, and it supports the label in context" };
  if (r.review?.supports === false) return { status: "withheld", why: "text on the page but it does not support the label in context" };
  return { status: "pending", why: "" };
}
