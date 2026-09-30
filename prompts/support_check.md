# Contextual review prompt (Clay "Use AI", no web research)

Runs only when the quote check found the passage on the page. It reads what the page says around the passage, not
the research column's reasoning. Frozen on 2026-09-30 before the benchmark run.

---

Target company: /Company (website /Domain)
Page title: /Page Title
Publisher: /Publisher
Text before the passage: /Before
Passage: /Match
Text after the passage: /After

Proposition to test: /Proposition

Does this evidence, read in its context, establish the proposition about the target company itself? Answer no when
the passage describes another organization (a client, a partner, a vendor, a customer quoted on the page), when it
only fits the proposition among other readings, or when it describes a job opening rather than the business.

Return: supports (true or false), why (one sentence).
