const MODEL = {
  end_customer: "End customer",
  staffing_recruitment: "Staffing or recruiting",
  engineering_services: "Engineering services",
  mixed_uncertain: "Mixed",
  unresolved: "Unresolved",
};
const WHY = {
  "text not on the page": "Quote not on the page",
  "text on the page but it does not support the label in context": "Quote does not support it",
  "evidence from a third-party site": "Evidence from another site",
  "no quote": "No quote",
  "quote too short": "Quote too short",
};
const WHERE = {
  "page metadata only": "the quote is the page's meta description, not its visible text",
  "page source outside visible text": "the words are in the page's code, not its visible text",
  "nowhere on the page": "the words are nowhere on the page",
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDate = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const host = (u) => { try { const x = new URL(u); return x.host.replace(/^www\./, "") + x.pathname.replace(/\/$/, ""); } catch { return u || ""; } };
const money = (n) => "$" + n.toFixed(2);
const noDash = (s) => String(s ?? "").replace(/\s*—\s*/g, ", ");
// Page builders leave component names in the visible text ("108-GradientText"); they are cut from the display only.
const tidy = (s) => String(s ?? "").replace(/\b\d{2,3}-[A-Z][A-Za-z]+\b/g, "...").replace(/(\.\.\.\s*)+/g, "... ").trim();

function decisionLabel(r) {
  const s = r.decision.status;
  if (s === "accepted") return "Accepted";
  if (s === "routed") return "Routed to a person";
  if (s === "unverifiable") return "Page could not be read";
  if (s === "refused") return "Refused: our sample error";
  return WHY[r.decision.why] || "Withheld";
}
function readLine(c) {
  const read = `Read ${fmtDate(c?.dates?.retrieved || c?.retrieved_at)}`;
  return c?.dates?.published ? `${read}. Publication metadata says ${fmtDate(c.dates.published)}; the policy does not use it.` : `${read}. No publication date on the page.`;
}

function focalCard(r, d) {
  const e = r.evidence, c = e.check, p = d.usage.price_basis;
  const perRow = 3.7 * p.usd_per_data_credit + 5 * p.usd_per_action;
  return `
  <div class="pair">
    <article class="card" aria-label="Account card">
      <div class="card-top">
        <p class="card-name">${esc(r.company)}</p>
        <span class="card-id">Account ${r.id} of 50</span>
      </div>
      <dl class="fields">
        <div class="field"><dt>Its page title</dt><dd>${esc(c.page_title)}</dd></div>
        <div class="field"><dt>Model proposed</dt><dd><span class="tag">Engineering services.</span> Managed IT services for businesses, not staffing and not its own product.</dd></div>
        <div class="field"><dt>Checks</dt><dd>Quote found word for word on ntiva.com. The review, reading it in context: Ntiva itself sells managed IT services to other organizations.</dd></div>
        <div class="field"><dt>Decision</dt><dd><span class="verdict held">Accepted: engineering services</span></dd></div>
        <div class="field"><dt>Reason for call</dt><dd>Do not call. It sells IT work to other companies.</dd></div>
        <div class="field"><dt>Cost</dt><dd>3.7 data credits and 5 actions, about ${money(perRow)}</dd></div>
      </dl>
    </article>
    <figure class="source" aria-label="The page the quote came from, as re-read">
      <figcaption class="source-bar"><span class="url">${esc(host(c.final_url || e.url))}</span><span class="read">Re-read ${esc(fmtDate(c.retrieved_at))}</span></figcaption>
      <p class="source-text">${esc(tidy(c.before).slice(-150).replace(/^\S*\s/, "... "))} <mark>${esc(c.match)}</mark> ${esc(tidy(c.after).slice(0, 110).replace(/\s\S*$/, " ..."))}</p>
      <p class="source-foot"><b>Found word for word.</b> ${esc(readLine(c))} Fingerprint ${esc(c.content_sha256.slice(0, 12))}.</p>
    </figure>
  </div>`;
}

function fixtureCard(f) {
  return `
  <div class="fallen">
    <article class="card" aria-label="A test fixture whose label fell">
      <div class="card-top">
        <p class="card-name">${esc(f.company)}</p>
        <span class="card-id">Test fixture, made-up company</span>
      </div>
      <dl class="fields">
        <div class="field"><dt>Proposed</dt><dd><span class="verdict struck">${esc(MODEL[f.claimed_business_model])}</span><span class="fell-note">withheld</span></dd></div>
      </dl>
      <blockquote class="fallen-quote">"${esc(f.quote)}"</blockquote>
      <p class="fallen-why">The words are on the page. Read in context, they say the company hired an offshore partner: it buys engineering, it does not sell it.</p>
    </article>
  </div>`;
}

function totals(d) {
  const t = d.tally, e = d.evaluation.supported;
  const line = (n, l, cls = "") => `<div class="tot ${cls}"><span class="n">${n}</span><span class="l">${l}</span></div>`;
  return `<p class="tot-head">The 50, after the checks</p>`
    + line(t.accepted, `accepted, ${e.accepted_wrong} of them wrong against the reference`)
    + line(t.routed, "routed to a person: the evidence shows both")
    + line(t.withheld_text_not_on_page, "quote not on the page")
    + line(t.withheld_not_supported, "quote found but not supporting the label")
    + line(t.unverifiable, "page could not be read")
    + line(t.refused, "refused because our sample had the wrong domain")
    + line(e.middleman_accepted_as_end_customer, "middlemen let through as end customers", "key");
}

function stages(d) {
  const s = d.evaluation;
  const col = (name, sub, x) => `
    <div class="stage">
      <p class="stage-name">${name}</p>
      <p class="stage-sub">${sub}</p>
      <p class="stage-n"><b>${x.accepted}</b> accepted</p>
      <p class="stage-w ${x.accepted_wrong ? "bad" : ""}"><b>${x.accepted_wrong}</b> wrong</p>
    </div>`;
  return col("Research alone", "Take every label the research step returns", s.raw)
    + col("Quote on the page", "Keep a label only if code finds its quote", s.text_present)
    + col("Supported in context", "Keep it only if the passage, on the company's own site and read in context, shows it", s.supported);
}

function rowHtml(r) {
  const shown = r.decision.status === "accepted" || r.decision.status === "routed";
  const acc = r.decision.status === "accepted";
  const ref = !shown ? `<span class="mark n" title="Nothing accepted to compare">–<span class="visually-hidden"> nothing to compare</span></span>`
    : r.agrees_with_reference ? `<span class="mark p" title="Agrees with the reference review">✓<span class="visually-hidden"> agrees</span></span>`
    : `<span class="mark f" title="Reference review: ${esc(MODEL[r.reference.label])}">✗<span class="visually-hidden"> disagrees</span></span>`;
  let detail;
  if (shown) {
    const e = r.evidence, c = e.check;
    detail = `<div>
        <h4>Evidence, found on the page</h4>
        <blockquote class="found">"${esc(e.quote)}"</blockquote>
        <p class="meta"><a href="${esc(e.url)}" rel="nofollow noopener" target="_blank">${esc(host(e.url))}</a>. ${esc(readLine(c))}</p>
      </div>
      <div>
        <h4>Review in context</h4>
        <p>${esc(noDash(e.review.why))}</p>
        ${r.decision.status === "routed" ? `<p class="meta">A mission statement that fits both readings: the policy sends it to a person instead of counting it.</p>` : ""}
        ${acc && !r.agrees_with_reference ? `<p class="meta">Reference review: ${esc(MODEL[r.reference.label].toLowerCase())}.</p>` : ""}
      </div>`;
  } else {
    let why;
    if (r.decision.status === "refused") why = r.sample_correction?.note || "The checker refused the cited domain.";
    else if (r.decision.status === "unverifiable") why = `The cited page could not be read (${esc(r.not_accepted?.check_reason)}), so nothing could be checked.`;
    else if (r.decision.why === "text not on the page") why = `The research step quoted a page, and code did not find the quote on it${r.not_accepted?.where ? `: ${WHERE[r.not_accepted.where]}` : ""}.`;
    else if (r.decision.why === "evidence from a third-party site") why = "The quote was found, but on another company's site.";
    else why = "The quote is on the page, but read in context it does not show the proposed business model.";
    detail = `<div><h4>Why it stays unresolved</h4><p>${esc(why)} The proposed label is not published.</p></div>
      <div><h4>Why it entered the sample</h4><p>${esc(r.entry_reason)}${r.signal.check?.status === "found" ? ", signal quote found on the page" : ""}.</p></div>`;
  }
  const dom = r.sample_correction?.domain ? `${r.domain} (real site: ${r.sample_correction.domain})` : r.domain;
  return `<li data-group="${acc ? "accepted" : "unresolved"}">
    <button class="row-main" type="button" aria-expanded="false" aria-controls="d${r.id}">
      <span class="acct"><span class="nm">${esc(r.company)}</span><span class="src">${esc(dom)}, ${esc(r.entry_reason.toLowerCase())}</span></span>
      <span class="vd ${acc ? "q" : "u"}">${esc(MODEL[r.business_model])}</span>
      <span class="dc ${acc ? "q" : ""}">${esc(decisionLabel(r))}</span>
      ${ref}
    </button>
    <div class="detail" id="d${r.id}" hidden>${detail}</div>
  </li>`;
}

function steps(d) {
  const s = d.usage.final_run_by_stage;
  const line = (b, what, x, cost) => `<li><b>${b}</b><span>${what}</span><span class="price">${x.executions} runs${x.skipped ? `, ${x.skipped} skipped by the run condition` : ""}. ${cost}</span></li>`;
  return [
    line("Research", "Use AI with web research (Clay Argon), JSON schema output: business model, reason, URL, quote, date.", s.research, `${s.research.data_credits} data credits, ${s.research.actions} actions.`),
    line("Quote check", "HTTP API column to the checker, with the research URL and quote.", s.quote_check, `${s.quote_check.actions} actions, no credits.`),
    line("Signal check", "HTTP API column to the same checker, with the signal quote that brought the company into the sample.", s.signal_check, `${s.signal_check.actions} actions, no credits.`),
    line("Contextual review", "Use AI (Claude Sonnet 5), no web. Only runs if the quote was found.", s.review, `${s.review.data_credits} data credits, ${s.review.actions} actions.`),
    line("Decision", "Formula: own-site check on the final URL, then accepted, routed to a person, withheld, unverifiable or refused.", { executions: 50, skipped: 0 }, "Formulas are free."),
    line("Write and look up", "Send table data to Evidence; Lookup single row reads it back.", s.write_evidence, `${s.write_evidence.actions} actions for the write; the lookup is free.`),
  ].join("");
}

function costLine(d) {
  const u = d.usage, c = d.cost;
  return `Final run: <b>${u.final_run.data_credits}</b> data credits and <b>${u.final_run.actions}</b> actions, about <b>${money(u.final_run_usd_exact)}</b>: <b>${money(c.per_input_company_usd)}</b> per company in, <b>${money(c.per_accepted_classification_usd)}</b> per accepted classification, <b>${money(c.per_accepted_end_customer_usd)}</b> per accepted end customer. These are marginal costs on Clay's Growth plan, the first with HTTP API columns ($495 a month billed monthly: 40,000 actions and 6,000 data credits, clay.com on ${fmtDate(u.measured_on)}). Building and testing used ${u.development.data_credits} more data credits. Rows stopped by a cheap filter: 0; every company in the sample was a US company with a signal.`;
}

function fixtures(d) {
  const text = {
    "F1 fabricated text": () => "Quote invented. Code did not find it on the page, so the label was withheld and the review never ran.",
    "F2 unsupported conclusion": () => "Quote real, conclusion wrong. The review: the insurer hired an offshore partner as a client; it does not sell engineering.",
    "F3 wrong entity": () => "Quote real, but about the client on a vendor's case study. The review: it says nothing about what the vendor sells.",
    "F4 stale date": (f) => `Claimed date ${fmtDate(f.claimed_date)}; the page says ${fmtDate(f.check?.dates?.published)}. The label holds; a date is never taken from the model.`,
    "F5 unavailable page": (f) => `Page gone (${f.check?.reason === "http_404" ? "404" : f.check?.reason}). Unverifiable, not called an invention.`,
  };
  return d.fixtures.map((f) => `<li><b>${esc(f.fixture.replace(/^F\d /, "").replace(/^./, (x) => x.toUpperCase()))}</b><span>${esc((text[f.fixture] || (() => ""))(f))}</span></li>`).join("");
}

const CONFIG = `In the Accounts table: Add enrichment > HTTP API > Configure

Account    an HTTP API (Headers) account holding the x-check-key header
Method     POST
Endpoint   https://theaipipe.com/end-customer-check/api/verify
Body       {"url": "", "quote": "", "entity": ""}
           inside each pair of quotes, type / and pick the column:
           Research Evidence Url, Research Evidence Quote, Company
           (optional: "domain" with the Domain column; this table checks
           the domain in the Decision formula instead)
Run if     !!{{Research Evidence Quote}}

The answer: status (found, absent, unreadable, rejected), quote_found,
before / match / after, page_title, publisher, final_url,
content_sha256, dates.published, dates.retrieved, verifier_version`;

async function main() {
  const d = await (await fetch("data/results.json", { cache: "no-store" })).json();
  const byId = Object.fromEntries(d.rows.map((r) => [r.id, r]));
  const fx = d.fixtures.find((f) => f.fixture === d.featured.fixture);
  document.getElementById("stack").innerHTML = focalCard(byId[d.featured.focal], d) + (fx ? fixtureCard(fx) : "");
  document.getElementById("totals").innerHTML = totals(d);
  document.getElementById("stages").innerHTML = stages(d);
  const rank = { accepted: 0, routed: 1, withheld: 2, unverifiable: 3, refused: 4 };
  const rows = [...d.rows].sort((a, b) => rank[a.decision.status] - rank[b.decision.status] || a.id - b.id);
  const ol = document.getElementById("rows");
  ol.innerHTML = rows.map(rowHtml).join("");
  ol.addEventListener("click", (e) => {
    const b = e.target.closest(".row-main");
    if (!b) return;
    const det = document.getElementById(b.getAttribute("aria-controls"));
    const open = b.getAttribute("aria-expanded") === "true";
    b.setAttribute("aria-expanded", String(!open));
    det.hidden = open;
  });
  document.querySelectorAll(".filters button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filters button").forEach((x) => x.setAttribute("aria-pressed", String(x === btn)));
      const f = btn.dataset.filter;
      ol.querySelectorAll("li").forEach((li) => { li.hidden = !(f === "all" || li.dataset.group === f); });
    }));
  document.getElementById("steps").innerHTML = steps(d);
  document.getElementById("cost").innerHTML = costLine(d);
  document.getElementById("fixtures").innerHTML = fixtures(d);
  document.getElementById("sample-rule").textContent = d.sample_rule.rule;
  document.getElementById("config").textContent = CONFIG;
  document.getElementById("copy").addEventListener("click", async (e) => {
    try { await navigator.clipboard.writeText(CONFIG); e.target.textContent = "Copied"; } catch { e.target.textContent = "Select and copy"; }
  });
}
main().catch(() => { document.getElementById("stack").innerHTML = '<p class="loading">The account data did not load. Reload the page.</p>'; });
