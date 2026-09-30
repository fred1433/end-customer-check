# end-customer-check

A Clay workflow that classifies a company as an end customer or a middleman (staffing or recruiting firm,
engineering services, mixed) and only keeps a label its own website supports. Tested on a 50-company benchmark:
a public sample selected by me, not a client-provided list.

Page: https://theaipipe.com/end-customer-check/

## How it works

In a Clay workbook (trial workspace, 2026-09-30):

- **Accounts** (50 rows).
  - Research: Use AI with web research (Clay Argon), JSON schema output (business model, reason, evidence URL,
    verbatim quote, printed date). Prompt: `prompts/classify.md`.
  - Quote check: HTTP API column that sends the URL and quote to the checker in this repository.
  - Signal check: the same column on the quote that brought the company into the sample.
  - Binding: a formula that fingerprints the input (domain, label, URL, quote), `prompts/clay_binding_formula.txt`.
  - Contextual review: Use AI (Claude Sonnet 5, no web), run only when the quote was found. It reads the passage with
    the page's own words around it, tests one proposition per business model (`prompts/propositions.md`), and must
    copy the fingerprint back (`prompts/support_check.md`).
  - Decision: a formula, `prompts/clay_decision_formula.txt`, the same policy as `src/policy.js`
    (`test/policy.test.js` runs the formula text against the code, case by case).
  - Send table data writes each account's latest decision to Evidence; Lookup single row reads it back.
- **Evidence**: one row per account, the latest decision. Not a version history.
- **Adversarial fixtures** (5 rows): made-up companies on test pages (`public/end-customer-check/fixtures/`).

**Policy v3.** A label is kept only if, for the same input, the quote check says `found` with `quote_found: true`,
the final URL is on the account's own domain, and the review says `supports: true` and returns the current
fingerprint. A missing domain, a check or review run on another input, or anything not positive keeps the row
unresolved. A label the review confirms as mixed is routed to a person. The target is the company at the sample's
domain, not its parent group; "engineering services" means software and IT work sold to others; too little evidence
is withheld, not mixed.

**The checker** (`src/verify.js`, deployed as `src/worker.js`) downloads the page and matches the quote in text
extracted from the fetched HTML: scripts, styles, comments and elements hidden in the HTML (`hidden`,
`aria-hidden="true"`, inline `display:none` or `visibility:hidden`) are removed; CSS- or script-driven visibility is
not evaluated. It answers `found`, `absent`, `unreadable` (blocked, error or challenge page, timeout, not HTML, or a
download cut at the size cap: `incomplete_download`, never "absent") or `rejected` (bad input, domain not on the
list). It returns the page's own words around the match, title, publisher, final URL, a SHA-256 of the text, the
publication date only if the page's metadata declares one (a date merely printed in the text is not one), and the
retrieval time. It needs a key in the `x-check-key` header, only fetches domains on a list, re-checks every redirect,
caps time and size, and calls no model. Its rate limits are Cloudflare's per-location limiters (30 a minute per IP,
60 a minute per location), not a hard global cap. Send `domain` and it also returns `on_own_site`.

## Results (2026-09-30)

13 end customers on the call list, 10 middlemen excluded, 27 unresolved and not called (12 quotes not
on the page, 7 quotes not supporting the label in context, 7 pages that could not be read or were error pages, 1
refused because our sample had the wrong domain: heritagegrocers.com instead of heritagegrocersgroup.com, our error).
The 10 excluded are 9 engineering services firms and 1 staffing firm. One of the 23 decided labels disagrees with the
reference. No evidence came from a third-party site.

Against the reference: research alone keeps 50 labels, 43 agreeing; keeping only quotes found on the page, 30 and 25;
all checks, 23 and 22. The one disagreement (Celsior) is about subtype and scope: the reference reads the brand
together with its parent group, an IT staffing firm, as mixed; both readings exclude it. No middleman was labelled an
end customer after the checks, and none before them either: this sample does not show the checks preventing that
error. It shows them removing 21 labels that agreed with the reference and 6 that did not, all lacking checkable
evidence.

**Credit breakdown.** The final configuration costs 171 data credits and 230 actions for the 50 rows (research 150
credits and 50 actions, quote check 50 actions, signal check 50, review 21 credits and 30 actions, write 50): the charge
Clay recorded for the cells the final configuration runs, upfront plus reconciliation, no refunds. The 20 review cells
it skips still carry 14 credits and 20 actions from an earlier pass, counted in development. About $9.73: $0.19 per company,
$0.42 per decided company, $0.75 per end customer on the call list. These are marginal costs on Clay's Growth plan,
the first with HTTP API columns ($495 a month billed monthly, clay.com, 2026-09-30). Building, testing and two
rescoring passes used another 56.1 data credits and 339 actions (balance read 2026-09-30 18:39 UTC). Details in
`data/usage.json`.

**Provenance.** The company sample and the research prompt were fixed before research. The same records were later
rescored twice after reviews: policy v2 added the own-site rule and routing of mixed labels; policy v3 requires
positive evidence from the same input, and the quote and signal checks were rerun with checker 2026-09-30.5 (one row,
Carle Health, moved from "not on the page" to "error page"). The reference is agent-generated: two agents that had not
seen the classifier's output read each company's own pages.

## Run the tests on a clean clone

Requires Node 20 or later. No dependencies.

```sh
npm test          # checker, policy against the Clay formulas, and scorer (the published results are rebuilt from
                  # data/ alone; no withheld proposal is published; Clay's recorded decision equals the policy on
                  # every row)
npm run score     # rebuilds public/end-customer-check/data/results.json (from data/ on a clone)
```

`scripts/from_clay.mjs` and `scripts/diagnose_absent.mjs` read the full Clay export, which is not published.

## Data

- `data/clay_records.json`: the Accounts table as exported from Clay. Every row keeps the decision Clay recorded and
  the facts the policy uses. For an unresolved row, the research step's proposal (label, reason, quote,
  URL) is removed: an unsupported label is not published next to a company name.
- `data/reference.json`: the reference labels, published only for the 23 decided rows.
- `data/evaluation.json`: the step-by-step comparison with the reference, as totals (it needs the withheld proposals).
- `data/fixtures.json`, `data/usage.json`, `data/sample_rule.json`, `data/absent_where.json`,
  `data/sample_corrections.json`.

## What this does not prove

- A quote on a page proves the words are there, not that they are true or current.
- The review is another model; it can agree with a weak passage.
- The 50 companies were picked by me from public signals; 17 of those signals are undated. Results on another list
  can differ.
- "Not on the page" means not in the text extracted from the fetched HTML: of the 12, 4 quotes were the page's meta
  description, 2 had their opening on the page with words dropped or changed further on, and 6 were nowhere on it. A
  page that builds its text in the browser can hide a real quote.
- The stale-date fixture shows date extraction, not a comparison: its claimed date was not sent to the checker.
- One reference label is debatable: Carahsoft, which resells software and services to government. It stays
  unresolved either way.
- Full account qualification was not assessed.
