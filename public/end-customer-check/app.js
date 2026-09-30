const MODEL = {
  end_customer: "End customer",
  staffing_recruitment: "Staffing or recruiting",
  engineering_services: "Engineering services",
  mixed_uncertain: "Mixed or uncertain",
  unresolved: "Unresolved",
};
const WHY = {
  "text not on the page": "Quote not on the page",
  "text on the page but it does not support the label in context": "Quote does not support it in context",
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

function decisionLabel(r) {
  if (r.decision.status === "accepted") return "Accepted";
  if (r.decision.status === "unverifiable") return "Unverifiable";
  return WHY[r.decision.why] || "Withheld";
}
function pageDate(c) {
  const d = c?.dates;
  if (!d) return "";
  return d.published ? `page dated ${fmtDate(d.published)}` : `no date on the page, read ${fmtDate(d.retrieved)}`;
}

function focalCard(r, usage) {
  const e = r.evidence;
  const c = e.check;
  const p = usage.price_basis;
  const perRow = 3.7 * p.usd_per_data_credit + 5 * p.usd_per_action;
  return `
  <div class="pair">
    <article class="card" aria-label="Account card">
      <div class="card-top">
        <p class="card-name">${esc(r.company)}</p>
        <span class="card-id">Account ${r.id} of 50</span>
      </div>
      <dl class="fields">
        <div class="field"><dt>Its page title</dt><dd class="wrap">${esc(c.page_title)}</dd></div>
        <div class="field"><dt>Model proposed</dt><dd class="wrap"><span class="tag">${esc(MODEL[r.business_model])}</span> ${esc(e.reason)}</dd></div>
        <div class="field"><dt>Source shows</dt><dd class="wrap">${esc(e.review.why)}</dd></div>
        <div class="field"><dt>Decision</dt><dd><span class="verdict held">Accepted as ${esc(MODEL[r.business_model].toLowerCase())}</span></dd></div>
        <div class="field"><dt>Reason for call</dt><dd class="wrap">None yet. It sells its own products and services to clients: a person decides.</dd></div>
        <div class="field"><dt>Cost</dt><dd class="wrap">3.7 data credits and 5 actions, about ${money(perRow)} at Clay prices</dd></div>
      </dl>
    </article>
    <figure class="source" aria-label="The page the quote came from, as re-read">
      <figcaption class="source-bar"><span class="url">${esc(host(c.final_url || e.url))}</span><span class="read">Re-read ${esc(fmtDate(c.retrieved_at))}</span></figcaption>
      <p class="source-text">${esc(c.before)}<mark>${esc(c.match)}</mark>${esc(c.after)}</p>
      <p class="source-foot"><b>Found word for word.</b> ${esc(pageDate(c))}. Page fingerprint ${esc(c.content_sha256.slice(0, 12))}.</p>
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
  const t = d.tally;
  const e = d.evaluation.supported;
  return `<p class="tot-head">The 50, after the checks</p>
    <div class="tot"><span class="n">${t.accepted}</span><span class="l">accepted, ${e.accepted_wrong} of them wrong against the reference</span></div>
    <div class="tot"><span class="n">${t.withheld_text_not_on_page}</span><span class="l">quote not on the page</span></div>
    <div class="tot"><span class="n">${t.withheld_not_supported}</span><span class="l">quote found but not supporting the label</span></div>
    <div class="tot"><span class="n">${t.unverifiable}</span><span class="l">page could not be read</span></div>
    <div class="tot key"><span class="n">${e.middleman_accepted_as_end_customer}</span><span class="l">middlemen let through as end customers</span></div>`;
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
    + col("Supported in context", "Keep it only if the passage, read in context, shows it", s.supported);
}

function rowHtml(r) {
  const acc = r.decision.status === "accepted";
  const ref = r.agrees_with_reference === true ? `<span class="mark p" title="Agrees with the reference review">✓<span class="visually-hidden"> agrees</span></span>`
    : r.agrees_with_reference === false ? `<span class="mark f" title="Reference review says: ${esc(MODEL[r.reference_label])}">✗<span class="visually-hidden"> disagrees</span></span>`
    : `<span class="mark n" title="Nothing accepted to compare">–<span class="visually-hidden"> nothing to compare</span></span>`;
  let detail;
  if (acc) {
    const e = r.evidence, c = e.check;
    detail = `<div>
        <h4>Evidence, found on the page</h4>
        <blockquote class="found">"${esc(e.quote)}"</blockquote>
        <p class="meta"><a href="${esc(e.url)}" rel="nofollow noopener" target="_blank">${esc(host(e.url))}</a>, ${esc(pageDate(c))}</p>
      </div>
      <div>
        <h4>Review in context</h4>
        <p>${esc(e.review.why.replace(/\s*—\s*/g, ", "))}</p>
        ${r.agrees_with_reference === false ? `<p class="meta">Reference review: ${esc(MODEL[r.reference_label].toLowerCase())}.</p>` : ""}
      </div>`;
  } else {
    const where = r.not_accepted?.where ? `: ${WHERE[r.not_accepted.where]}` : "";
    const why = r.decision.status === "unverifiable"
      ? `The cited page could not be read (${esc(r.not_accepted?.check_reason)}), so nothing could be checked.`
      : r.decision.why === "text not on the page" ? `The research step quoted a page, and code did not find the quote on it${esc(where)}.`
      : `The quote is on the page, but read in context it does not show the proposed business model.`;
    detail = `<div><h4>Why it stays unresolved</h4><p>${why} The proposed label is not published.</p></div>
      <div><h4>Why it entered the sample</h4><p>${esc(r.entry_reason)}${r.signal.check?.status === "found" ? ", signal quote found on the page" : ""}.</p></div>`;
  }
  return `<li data-group="${acc ? "accepted" : "unresolved"}">
    <button class="row-main" type="button" aria-expanded="false" aria-controls="d${r.id}">
      <span class="acct"><span class="nm">${esc(r.company)}</span><span class="src">${esc(r.domain)}, ${esc(r.entry_reason.toLowerCase())}</span></span>
      <span class="vd ${acc ? "q" : "u"}">${esc(MODEL[r.business_model])}</span>
      <span class="dc ${acc ? "q" : ""}">${esc(decisionLabel(r))}</span>
      ${ref}
    </button>
    <div class="detail" id="d${r.id}" hidden>${detail}</div>
  </li>`;
}

function steps(d) {
  const u = d.usage, s = u.final_run_by_stage;
  const line = (b, what, x, cost) => `<li><b>${b}</b><span>${what}</span><span class="price">${x.executions} runs${x.skipped ? `, ${x.skipped} skipped by the run condition` : ""}. ${cost}</span></li>`;
  return [
    line("Research", "Use AI with web research (Clay Argon), JSON schema output: business model, reason, URL, quote, date.", s.research, `${s.research.data_credits} data credits, ${s.research.actions} actions.`),
    line("Quote check", "HTTP API column to the checker, with the research URL and quote.", s.quote_check, `${s.quote_check.actions} actions, no credits.`),
    line("Contextual review", "Use AI (Claude Sonnet 5), no web. Only runs if the quote was found.", s.review, `${s.review.data_credits} data credits, ${s.review.actions} actions.`),
    line("Decision", "Formula: accepted, withheld or unverifiable, and the accepted business model.", { executions: 50, skipped: 0 }, "Formulas are free."),
    line("Write and look up", "Send table data to Evidence; Lookup single row reads it back.", s.write_evidence, `${s.write_evidence.actions} actions for the write; the lookup is free.`),
  ].join("");
}

function costLine(d) {
  const u = d.usage;
  return `Final run: <b>${u.final_run.data_credits}</b> data credits and <b>${u.final_run.actions}</b> actions, about <b>${money(u.final_run_usd)}</b>. That is <b>${money(u.per_input_company_usd)}</b> per company in, <b>${money(u.per_accepted_classification_usd)}</b> per accepted classification, <b>${money(u.per_accepted_end_customer_usd)}</b> per accepted end customer. Building and testing used ${u.development.data_credits} more credits. Rows stopped by a cheap filter: ${u.cheap_filter_rows_stopped}; every company in the sample was a US company with a signal, so none was cut. Prices read on clay.com on ${fmtDate(u.measured_on)}; on the unchanged table, Clay offers to rerun only rows whose inputs changed, so a second pass costs nothing.`;
}

function fixtures(d) {
  const text = {
    "F1 fabricated text": (f) => `Quote invented. Code did not find it on the page: withheld.`,
    "F2 unsupported conclusion": (f) => `Quote real, conclusion wrong. The review: ${f.review?.why || ""}`,
    "F3 wrong entity": (f) => `Quote real, but about the client on a vendor's case study. The review: ${f.review?.why || ""}`,
    "F4 stale date": (f) => `Claimed date ${fmtDate(f.claimed_date)}; the page says ${fmtDate(f.check?.dates?.published)}. The label holds, the date does not: a date is never taken from the model.`,
    "F5 unavailable page": (f) => `Page gone (${f.check?.reason}). Unverifiable, not called an invention.`,
  };
  const cut = (s) => (s.length > 170 ? s.slice(0, 170).replace(/\s\S*$/, "") + "..." : s);
  return d.fixtures.map((f) => `<li><b>${esc(f.fixture.replace(/^F\d /, ""))}</b><span>${esc(cut((text[f.fixture] || (() => ""))(f)))}</span></li>`).join("");
}

const CONFIG = `Method:   POST
Endpoint: https://theaipipe.com/end-customer-check/api/verify
Account:  HTTP API (Headers) account with x-check-key
Body:     {"url": "/Research Evidence Url",
           "quote": "/Research Evidence Quote",
           "entity": "/Company"}
Run if:   !!{{Research Evidence Quote}}

Returns:  status        found | absent | unreadable | rejected
          quote_found   true only for found
          before, match, after   the page's own words
          page_title, publisher, final_url, content_sha256
          dates.published, dates.retrieved, verifier_version`;

async function main() {
  const d = await (await fetch("data/results.json", { cache: "no-store" })).json();
  const byId = Object.fromEntries(d.rows.map((r) => [r.id, r]));
  const focal = byId[d.featured.focal];
  const fx = d.fixtures.find((f) => f.fixture === d.featured.fixture);
  document.getElementById("stack").innerHTML = focalCard(focal, d.usage) + (fx ? fixtureCard(fx) : "");
  document.getElementById("totals").innerHTML = totals(d);
  document.getElementById("stages").innerHTML = stages(d);
  const order = (r) => (r.decision.status === "accepted" ? 0 : r.decision.status === "withheld" ? 1 : 2);
  const rows = [...d.rows].sort((a, b) => order(a) - order(b) || a.id - b.id);
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
