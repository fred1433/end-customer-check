import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalize, htmlToText, findQuote, metadataDate, dateOnPage, blockedTarget, fetchPage,
  verifyEvidence, hostAllowed, onOwnSite,
} from "../src/verify.js";
import worker from "../src/worker.js";

const PAGE = `<!doctype html><html><head><title>Acme Mutual</title>
<meta property="article:published_time" content="2025-11-04T09:00:00Z">
<script>var fake = "we are a staffing agency and this text is hidden";</script>
<style>.x{content:"hidden"}</style></head>
<body><nav>Home | About</nav>
<h1>Acme Mutual moves claims to Azure</h1>
<p>Published November 4, 2025</p>
<p>Acme Mutual&rsquo;s   internal engineering team rebuilt the claims portal on .NET&nbsp;8 and Azure App Service,
replacing a 20-year-old mainframe front end.</p>
<p>The company employs more than 1,200 people in Des Moines, Iowa.</p>
${"<p>Filler paragraph about policyholders and service levels.</p>".repeat(10)}
</body></html>`;

function fakeFetch(map) {
  return async (url, init) => {
    const entry = map[url];
    if (!entry) throw new TypeError("fetch failed");
    if (entry.hang) {
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => {
        const e = new Error("aborted"); e.name = "AbortError"; reject(e);
      }));
    }
    const body = entry.body ?? "";
    return new Response(body, {
      status: entry.status ?? 200,
      headers: { "content-type": entry.type ?? "text/html; charset=utf-8", ...(entry.headers || {}) },
    });
  };
}
const NOW = () => new Date("2026-09-30T12:00:00Z");

test("normalize unifies quotes, dashes, spaces and case", () => {
  assert.equal(normalize("Acme’s  “New” Portal — 2025"), `acme's "new" portal - 2025`);
});

test("htmlToText drops scripts and styles, decodes entities", () => {
  const t = htmlToText(PAGE);
  assert.ok(!t.includes("hidden"));
  assert.ok(t.includes("Acme Mutual's"));
});

test("a verbatim quote is found despite curly quotes, spacing and case", () => {
  const r = findQuote(htmlToText(PAGE), "Acme Mutual's internal engineering team rebuilt the claims portal on .NET 8");
  assert.equal(r.status, "found");
  assert.equal(r.reason, "exact");
});

test("a paraphrase is absent", () => {
  const r = findQuote(htmlToText(PAGE), "Acme Mutual's engineers rebuilt the claims portal using .NET 8");
  assert.equal(r.status, "absent");
});

test("text that only lives in a script tag does not count", () => {
  const r = findQuote(htmlToText(PAGE), "we are a staffing agency and this text is hidden");
  assert.equal(r.status, "absent");
});

test("a quote with an ellipsis needs every fragment, in order, close together", () => {
  const text = htmlToText(PAGE);
  assert.equal(findQuote(text, "internal engineering team rebuilt the claims portal ... replacing a 20-year-old mainframe front end").status, "found");
  assert.equal(findQuote(text, "replacing a 20-year-old mainframe front end ... internal engineering team rebuilt the claims portal").status, "absent");
});

test("a quote too short to prove anything is refused", () => {
  const r = findQuote(htmlToText(PAGE), "Azure App Service");
  assert.equal(r.status, "absent");
  assert.equal(r.reason, "quote_too_short");
});

test("dates: metadata first, printed dates recognised, nothing inferred", () => {
  assert.deepEqual(metadataDate(PAGE), { date: "2025-11-04", source: "page metadata" });
  assert.equal(dateOnPage(htmlToText(PAGE), "2025-11-04"), true);
  assert.equal(dateOnPage(htmlToText(PAGE), "2025-11-05"), false);
  assert.equal(metadataDate("<p>no date here</p>"), null);
});

test("private, local and non-http targets are refused before any request", () => {
  for (const u of ["http://localhost/", "http://127.0.0.1/", "http://10.0.0.8/x", "http://192.168.1.1/", "http://172.20.0.1/",
    "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[fd00::1]/", "file:///etc/passwd", "ftp://example.com/",
    "http://printer.local/", "http://example.com:8080/", "http://user:pw@example.com/", "http://intranet/", "http://0x7f000001/"]) {
    assert.ok(blockedTarget(u), `should block ${u}`);
  }
  assert.equal(blockedTarget("https://www.example.com/news/2025/azure"), null);
});

test("a redirect to a private address is refused", async () => {
  const f = fakeFetch({ "https://a.example.com/": { status: 302, headers: { location: "http://127.0.0.1/admin" } } });
  const r = await fetchPage("https://a.example.com/", { fetchImpl: f });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "private_address");
});

const Q = "rebuilt the claims portal on .NET 8 and Azure App Service";

test("four outcomes are kept apart: found, absent, unreadable, rejected", async () => {
  const f = fakeFetch({
    "https://acme.example.com/news": { body: PAGE },
    "https://blocked.example.com/": { status: 403, body: "Forbidden" },
    "https://cf.example.com/": { body: "<html><title>Just a moment...</title><body>Just a moment... Enable JavaScript and cookies to continue</body></html>" },
    "https://pdf.example.com/case.pdf": { type: "application/pdf", body: "%PDF-1.7" },
  });
  const found = await verifyEvidence({ url: "https://acme.example.com/news", quote: Q, date: "2025-11-04", entity: "Acme Mutual" }, { fetchImpl: f, now: NOW });
  assert.equal(found.status, "found");
  assert.equal(found.quote_found, true);
  assert.equal(found.ok, true);
  assert.equal(found.dates.published, "2025-11-04");
  assert.equal(found.dates.retrieved, "2026-09-30");
  assert.equal(found.page_title, "Acme Mutual");
  assert.match(found.content_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(found.proposal, { url: "https://acme.example.com/news", quote: Q, date: "2025-11-04", entity: "Acme Mutual", domain: null });
  const absent = await verifyEvidence({ url: "https://acme.example.com/news", quote: "we partner with leading offshore development firms for all engineering" }, { fetchImpl: f, now: NOW });
  assert.equal(absent.status, "absent");
  assert.equal(absent.quote_found, false);
  assert.equal(absent.ok, true, "the page was read");
  for (const u of ["https://blocked.example.com/", "https://cf.example.com/", "https://pdf.example.com/case.pdf", "https://nowhere.example.com/"]) {
    const r = await verifyEvidence({ url: u, quote: Q }, { fetchImpl: f, now: NOW });
    assert.equal(r.status, "unreadable", u);
    assert.equal(r.quote_found, false);
    assert.equal(r.ok, false);
  }
  const trivial = await verifyEvidence({ url: "https://acme.example.com/news", quote: "Azure App Service" }, { fetchImpl: f, now: NOW });
  assert.equal(trivial.status, "rejected");
  assert.equal(trivial.reason, "quote_too_short");
});

test("a claimed date the page does not print is reported as such, never adopted", async () => {
  const f = fakeFetch({ "https://acme.example.com/news": { body: PAGE.replace(/<meta[^>]+>/, "").replace("Published November 4, 2025", "") } });
  const r = await verifyEvidence({ url: "https://acme.example.com/news", quote: Q, date: "2025-06-01" }, { fetchImpl: f, now: NOW });
  assert.equal(r.status, "found");
  assert.equal(r.dates.published, null);
  assert.equal(r.dates.published_source, "none found");
  assert.equal(r.dates.claimed, "2025-06-01");
  assert.equal(r.dates.claimed_printed_on_page, false);
});

test("a page that never answers times out as unreadable", async () => {
  const f = fakeFetch({ "https://slow.example.com/": { hang: true } });
  const r = await verifyEvidence({ url: "https://slow.example.com/", quote: Q }, { fetchImpl: f, now: NOW, timeoutMs: 50 });
  assert.equal(r.status, "unreadable");
  assert.equal(r.reason, "timeout");
});

test("the download stops at the size cap", async () => {
  const big = PAGE + "<p>" + "x ".repeat(3_000_000) + "</p>";
  const f = fakeFetch({ "https://big.example.com/": { body: big } });
  const r = await fetchPage("https://big.example.com/", { fetchImpl: f, maxBytes: 100_000 });
  assert.equal(r.ok, true);
  assert.ok(r.html.length <= 100_000);
});

test("the domain list is enforced, on the first URL and on every redirect", async () => {
  assert.equal(hostAllowed("https://www.acme.example.com/a", ["acme.example.com"]), true);
  assert.equal(hostAllowed("https://acme.example.com.evil.net/a", ["acme.example.com"]), false);
  assert.equal(hostAllowed("https://notacme.example.com/a", ["acme.example.com"]), false);
  assert.equal(hostAllowed("https://acme.example.com/", []), false, "an empty list allows nothing");
  const f = fakeFetch({
    "https://acme.example.com/go": { status: 301, headers: { location: "https://elsewhere.example.net/page" } },
    "https://elsewhere.example.net/page": { body: PAGE },
  });
  const outside = await verifyEvidence({ url: "https://elsewhere.example.net/page", quote: Q }, { fetchImpl: f, now: NOW, allowedHosts: ["acme.example.com"] });
  assert.equal(outside.status, "rejected");
  assert.equal(outside.reason, "domain_not_allowed");
  const hop = await verifyEvidence({ url: "https://acme.example.com/go", quote: Q }, { fetchImpl: f, now: NOW, allowedHosts: ["acme.example.com"] });
  assert.equal(hop.status, "unreadable");
  assert.equal(hop.reason, "redirect_to_domain_not_allowed");
});

const ENV = (over = {}) => ({
  ASSETS: { fetch: async () => new Response("<html></html>", { headers: { "content-type": "text/html" } }) },
  CHECK_KEY: "test-key-123",
  ALLOWED_HOSTS: "example.com",
  LIMITER: { limit: async () => ({ success: true }) },
  GLOBAL_LIMITER: { limit: async () => ({ success: true }) },
  ...over,
});
const post = (body, headers = { "x-check-key": "test-key-123" }) =>
  new Request("https://theaipipe.com/end-customer-check/api/verify", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

test("the Worker refuses a request without the right key", async () => {
  let r = await worker.fetch(post({ url: "https://example.com/", quote: Q }, {}), ENV());
  assert.equal(r.status, 401);
  r = await worker.fetch(post({ url: "https://example.com/", quote: Q }, { "x-check-key": "test-key-12" }), ENV());
  assert.equal(r.status, 401);
  r = await worker.fetch(post({ url: "https://example.com/", quote: Q }), ENV({ CHECK_KEY: "" }));
  assert.equal(r.status, 401, "no key configured means no access");
});

test("the Worker validates input types and body size", async () => {
  let r = await worker.fetch(post("{bad"), ENV());
  assert.equal(r.status, 400);
  r = await worker.fetch(post({ url: "https://example.com/", quote: ["not", "a", "string"] }), ENV());
  assert.equal(r.status, 400);
  r = await worker.fetch(post("x".repeat(9000)), ENV());
  assert.equal(r.status, 400);
  r = await worker.fetch(new Request("https://theaipipe.com/end-customer-check/api/verify"), ENV());
  assert.equal(r.status, 405);
});

test("the Worker refuses private addresses and domains off the list without fetching", async () => {
  let r = await worker.fetch(post({ url: "http://169.254.169.254/latest/meta-data/", quote: Q }), ENV());
  let b = await r.json();
  assert.equal(b.status, "rejected");
  assert.equal(b.reason, "private_address");
  r = await worker.fetch(post({ url: "https://not-on-the-list.org/", quote: Q }), ENV());
  b = await r.json();
  assert.equal(b.reason, "domain_not_allowed");
});

test("the Worker answers 429 when a limit is hit", async () => {
  let r = await worker.fetch(post({ url: "https://example.com/", quote: Q }), ENV({ LIMITER: { limit: async () => ({ success: false }) } }));
  assert.equal(r.status, 429);
  r = await worker.fetch(post({ url: "https://example.com/", quote: Q }), ENV({ GLOBAL_LIMITER: { limit: async () => ({ success: false }) } }));
  assert.equal(r.status, 429);
});

test("static pages carry a noindex header", async () => {
  const r = await worker.fetch(new Request("https://theaipipe.com/end-customer-check/"), ENV());
  assert.equal(r.headers.get("x-robots-tag"), "noindex, nofollow");
});

test("the context keeps the page's own words and case around the match", () => {
  const r = findQuote(htmlToText(PAGE), "acme mutual's internal engineering team rebuilt the claims portal");
  assert.equal(r.status, "found");
  assert.equal(r.match, "Acme Mutual's internal engineering team rebuilt the claims portal");
  assert.ok(r.after.startsWith(" on .NET 8 and Azure App Service"));
});

test("inputs are trimmed: a mapped value with a trailing newline reads the right page", async () => {
  const f = fakeFetch({ "https://acme.example.com/news": { body: PAGE } });
  const r = await verifyEvidence({ url: "https://acme.example.com/news\n", quote: Q + "\n", entity: "Acme Mutual\n" }, { fetchImpl: f, now: NOW });
  assert.equal(r.status, "found");
  assert.equal(r.proposal.url, "https://acme.example.com/news");
});

test("evidence must come from the account's own site: host compared to the account domain after redirects", async () => {
  assert.equal(onOwnSite("https://www.taylorfarms.com/about", "taylorfarms.com"), true);
  assert.equal(onOwnSite("https://careers.taylorfarms.com/jobs", "www.taylorfarms.com"), true);
  assert.equal(onOwnSite("https://www.microsoft.com/en/customers/story/taylor-farms", "taylorfarms.com"), false);
  assert.equal(onOwnSite("https://taylorfarms.com.evil.net/", "taylorfarms.com"), false);
  assert.equal(onOwnSite("https://nottaylorfarms.com/", "taylorfarms.com"), false);
  assert.equal(onOwnSite("https://x.example.com/", ""), null);
  const f = fakeFetch({
    "https://story.example.net/acme": { body: PAGE },
    "https://acme.example.com/go": { status: 301, headers: { location: "https://story.example.net/acme" } },
  });
  const third = await verifyEvidence({ url: "https://story.example.net/acme", quote: Q, domain: "acme.example.com" }, { fetchImpl: f, now: NOW });
  assert.equal(third.status, "found");
  assert.equal(third.on_own_site, false, "found, but on a third-party site");
  const hop = await verifyEvidence({ url: "https://acme.example.com/go", quote: Q, domain: "acme.example.com" }, { fetchImpl: f, now: NOW });
  assert.equal(hop.on_own_site, false, "judged on the final URL, not the one cited");
});
