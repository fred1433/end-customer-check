# end-customer-check

A Clay workflow that classifies a company as an end customer or a middleman (staffing or recruiting firm,
engineering services, mixed) and only accepts a label its own website supports. Tested on a 50-company benchmark:
a public sample selected by me, not a client-provided list.

Page: https://theaipipe.com/end-customer-check/

## How it works

In a Clay workbook (trial workspace, 2026-09-30), three tables:

- **Accounts** (50 rows). Research: Use AI with web research (Clay Argon), JSON schema output (business model,
  reason, evidence URL, verbatim quote, printed date). Quote check: HTTP API column that sends the URL and quote to the
  checker in this repository. Contextual review: Use AI (Claude Sonnet 5, no web), run only when the quote was found; it
  reads the passage with the page's own words around it and tests one proposition per business model
  (`prompts/propositions.md`). Signal check: the same HTTP column on the quote that brought the company into the sample.
  Decision: a formula (the same rules as `src/policy.js`): the page must be on the account's own domain, judged on the
  final URL after redirects; a label that fits both readings is routed to a person; otherwise accepted, withheld,
  unverifiable or refused. Send table data writes every decision to Evidence; Lookup single row reads it back.
- **Evidence**: one row per account decision.
- **Adversarial fixtures** (5 rows): made-up companies on test pages (`public/end-customer-check/fixtures/`), built to
  fail in five ways: invented quote, real quote with the wrong conclusion, quote about another company, stale date,
  page gone.

The checker (`src/verify.js`, deployed as `src/worker.js`) downloads the cited page, turns it into visible text and
looks for the quote after normalizing case, spaces, quotes and dashes. It answers `found`, `absent`, `unreadable` or
`rejected`, with the page's own words around the match, title, publisher, final URL, a SHA-256 of the text, the
publication date the page itself declares (never a date the model gives) and the retrieval time. It needs a key in the
`x-check-key` header, only fetches domains on a list, re-checks every redirect, caps time and size, and calls no model.
Send `domain` with the account's domain and it also returns `on_own_site` for the final URL.

## Results (2026-09-30)

Of 50 companies: 23 labels accepted, 1 routed to a person (a mission statement that fits both readings), 13 withheld
because the quote was not on the page, 6 withheld because the quote did not support the label in context, 6 pages
that could not be read, and 1 refused because our sample had the wrong domain (heritagegrocers.com instead of
heritagegrocersgroup.com: our error). No evidence came from a third-party site. Against the reference review: research
alone 43 of 50 right; keeping only quotes found on the page, 25 of 30; keeping only labels on the company's own site
and supported in context, 22 of 23. No middleman was accepted as an end customer at any step.

Final run: 171 data credits and 230 actions (research 50, quote check 50, signal check 50, review 30, write 50), about
$9.73: $0.19 per company, $0.42 per accepted classification, $0.75 per accepted end customer. These are marginal
costs on Clay's Growth plan, the first with HTTP API columns ($495 a month billed monthly, clay.com, 2026-09-30).
Details: `public/end-customer-check/data/results.json` and `data/usage.json`.

## Run the tests on a clean clone

Requires Node 20 or later. No dependencies.

```sh
npm test          # the checker (matching, dates, blocked addresses, domain list, redirects, timeouts, size cap,
                  # key, rate limits) and the scorer (the published results are rebuilt from data/ alone, no
                  # withheld proposal is published, the policy matches)
npm run score     # rebuilds public/end-customer-check/data/results.json (from data/ on a clone)
```

`scripts/from_clay.mjs` and `scripts/diagnose_absent.mjs` read the full Clay export, which is not published (see below).

## Data

- `data/clay_records.json`: the Accounts table as exported from Clay, every cell. For a row whose decision was not
  accepted, the research step's proposal (label, reason, quote) is removed: an unsupported label is not published next
  to a company name.
- `data/reference.json`: the reference review (a business-model label from reading the company's own pages, with
  sources), published only for the 24 companies whose label was accepted or routed.
- `data/evaluation.json`: the step-by-step comparison with the reference. It needs the withheld proposals, so it is
  computed from the private export and published as totals only.
- `data/fixtures.json`, `data/usage.json`, `data/sample_rule.json`, `data/absent_where.json`.

## What this does not prove

- A quote on a page proves the words are there, not that they are true or current.
- The contextual review is another model; it can agree with a weak passage. The reference is a careful reading, not
  ground truth.
- The 50 companies were picked by me from public signals; results on another list can differ.
- "Not on the page" means not in the visible text code downloaded: 4 of the 13 were the page's meta description, and a
  page that builds its text in the browser can hide a real quote.
- Full account qualification was not assessed. "Engineering services" means software and IT work sold to others.
- One reference label is debatable: Carahsoft, which resells software and services to government. Its label was not
  accepted either way.
- The Evidence table was rewritten once after the policy gained the own-site and routing rules; the workspace
  balance figures in `data/usage.json` were read before that rewrite.
