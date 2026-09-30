# Research column prompt (Clay "Use AI", web research on)

Frozen on 2026-09-30 before the benchmark run. Output fields are enforced by a JSON schema in the column.

---

Company: /Company
Website: /Domain

Decide the company's business model, for a firm that sells software engineering teams and must not call middlemen.

- end_customer: sells something other than engineering services (including its own software product) and buys or
  builds engineering for itself.
- staffing_recruitment: supplies staff, contractors or recruiting to other organizations.
- engineering_services: sells software engineering, IT consulting, implementation, offshore or nearshore development,
  or managed IT services to other organizations.
- mixed_uncertain: its own pages show both, or too little to tell.

A tagline such as "IT solutions and consulting" never decides on its own. Look for what is sold, to whom, and by which
part of the company.

Evidence: one passage of 12 to 40 words copied character for character from a page on the company's own website
(/Domain or a subdomain), that on its own shows the business model. Code will download that URL and search for the
passage; a paraphrase, a passage from another site, or a page it cannot read means the answer is not accepted.
evidence_published_date is the date printed on that page (YYYY-MM-DD) or empty. Never infer a date.

Return: business_model, reason (one sentence), evidence_url, evidence_quote, evidence_published_date.
