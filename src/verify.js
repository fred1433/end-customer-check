// Evidence checks shared by the Worker (live endpoint) and the local batch runner.
// No model is called anywhere in this file: it downloads a page and looks for text.

export const LIMITS = {
  maxBytes: 2_000_000,
  timeoutMs: 15000,
  maxRedirects: 3,
  maxQuoteChars: 600,
  minQuoteWords: 8,
  maxUrlChars: 2048,
};

// ---------- text normalization ----------

const ENTITY = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'",
  rdquo: '"', ldquo: '"', ndash: "-", mdash: "-", hellip: "...", reg: "®", trade: "™",
  copy: "©", middot: "·", bull: "•", shy: "",
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    const v = ENTITY[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

// Visible text of an HTML page, script/style/template/noscript removed.
export function htmlToText(html) {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|template|noscript|svg|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|td|th|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(s);
}

// Lowercase, unify quotes, dashes and spaces, collapse whitespace.
export function normalize(s) {
  return s
    .normalize("NFKC")
    .replace(/[​-‍⁠﻿­]/g, "")
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ---------- quote matching ----------

// Returns { status: "found" | "absent", reason, context }.
// A quote may contain "..." to skip text; every fragment must then appear, in order, within 400 characters of the previous one.
// Normalized text plus, for each normalized character, the index of the original character it came from.
function normalizeWithMap(s) {
  let out = "";
  const map = [];
  let lastSpace = true;
  for (let i = 0; i < s.length; i++) {
    const piece = normalize(s[i] === " " || /\s/.test(s[i]) ? " " : s[i]) || (/\s/.test(s[i]) ? " " : "");
    if (piece === "" || piece === " ") {
      if (/\s/.test(s[i]) && !lastSpace) { out += " "; map.push(i); lastSpace = true; }
      continue;
    }
    for (const ch of piece) { out += ch; map.push(i); }
    lastSpace = false;
  }
  return { out: out.trimEnd(), map };
}

// Returns { status: "found" | "absent", reason, before, match, after }.
// before/match/after are the page's own words (original case, spaces collapsed) around the quote.
// A quote may contain "..." to skip text; every fragment must then appear, in order, within 400 characters of the previous one.
export function findQuote(pageText, quote) {
  const { out: page, map } = normalizeWithMap(pageText);
  const q = normalize(quote).replace(/^["']+|["']+$/g, "").trim();
  const words = q.split(" ").filter((w) => /[a-z0-9]/.test(w));
  if (words.length < LIMITS.minQuoteWords) {
    return { status: "absent", reason: "quote_too_short" };
  }
  const fragments = q.split(/\s*(?:\.\.\.|\[\.\.\.\])\s*/).map((f) => f.trim()).filter(Boolean);
  let from = 0;
  let first = -1;
  let end = 0;
  for (let i = 0; i < fragments.length; i++) {
    const f = fragments[i];
    const at = page.indexOf(f, from);
    if (at === -1 || (i > 0 && at - end > 400)) {
      return { status: "absent", reason: i === 0 ? "not_on_page" : "fragment_not_on_page" };
    }
    if (first === -1) first = at;
    end = at + f.length;
    from = end;
  }
  const o0 = map[first];
  const o1 = map[end - 1] + 1;
  const squash = (t) => t.replace(/\s+/g, " ");
  let before = squash(pageText.slice(Math.max(0, o0 - 400), o0));
  let after = squash(pageText.slice(o1, o1 + 400));
  before = before.length > 220 ? "..." + before.slice(before.length - 220).replace(/^\S*\s/, "") : before;
  after = after.length > 220 ? after.slice(0, 220).replace(/\s\S*$/, "") + "..." : after;
  return {
    status: "found",
    reason: fragments.length > 1 ? "found_with_ellipsis" : "exact",
    before: before.trimStart(),
    match: squash(pageText.slice(o0, o1)),
    after: after.trimEnd(),
  };
}

// ---------- dates ----------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function isoOf(y, m, d) {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

// Publication date declared in the page's own metadata (meta tags, JSON-LD, <time>), never guessed.
export function metadataDate(html) {
  const pats = [
    /<meta[^>]+(?:property|name|itemprop)=["'](?:article:published_time|og:published_time|datePublished|publish[-_]?date|pubdate|date|dc\.date|dcterms\.date|sailthru\.date|parsely-pub-date)["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["'](?:article:published_time|og:published_time|datePublished|publish[-_]?date|pubdate)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const p of pats) {
    const m = html.match(p);
    if (m) {
      const d = m[1].match(/(\d{4})-(\d{2})-(\d{2})/);
      if (d) return { date: `${d[1]}-${d[2]}-${d[3]}`, source: "page metadata" };
    }
  }
  return null;
}

// Is this ISO date printed in the visible text, in any usual US format?
export function dateOnPage(pageText, iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = normalize(pageText);
  const full = MONTHS[mo - 1], abbr = MON_ABBR[mo - 1];
  const variants = [
    `${full} ${d}, ${y}`, `${full} ${d} ${y}`, `${abbr} ${d}, ${y}`, `${abbr}. ${d}, ${y}`, `${abbr} ${d} ${y}`,
    `${d} ${full} ${y}`, `${d} ${abbr} ${y}`, `${mo}/${d}/${y}`, `${String(mo).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`,
    isoOf(y, mo, d),
  ];
  if (mo === 9) variants.push(`sept. ${d}, ${y}`, `sept ${d}, ${y}`);
  return variants.some((v) => t.includes(v));
}

// ---------- safe fetching ----------

export function blockedTarget(raw) {
  let u;
  try { u = new URL(raw); } catch { return "bad_url"; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "scheme_not_allowed";
  if (u.username || u.password) return "credentials_in_url";
  if (u.port && u.port !== "80" && u.port !== "443") return "port_not_allowed";
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h.includes(".") && !h.includes(":")) return "private_host";
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(h)) return "private_host";
  if (h.includes(":")) {
    // IPv6 literal: refuse loopback, unique-local, link-local, mapped v4, unspecified.
    if (h === "::1" || h === "::" || /^(fc|fd|fe8|fe9|fea|feb)/.test(h) || h.startsWith("::ffff:")) return "private_address";
    return null;
  }
  if (/^[0-9.]+$/.test(h) || /^0x/.test(h)) {
    const p = h.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return "private_address";
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return "private_address";
    if (a === 169 && b === 254) return "private_address";
    if (a === 172 && b >= 16 && b <= 31) return "private_address";
    if (a === 192 && b === 168) return "private_address";
    if (a === 100 && b >= 64 && b <= 127) return "private_address";
  }
  return null;
}

const CHALLENGE = [
  "just a moment...", "attention required! | cloudflare", "enable javascript and cookies to continue",
  "please enable javascript", "access denied", "are you a robot", "verify you are human", "request unsuccessful. incapsula",
  "pardon our interruption",
];

// Downloads a page with bounded size, time and redirects. Never throws.
// Returns { ok, status, finalUrl, html, text, reason }.
export async function fetchPage(url, { fetchImpl = fetch, timeoutMs = LIMITS.timeoutMs, maxBytes = LIMITS.maxBytes, allowedHosts = null } = {}) {
  let current = url;
  for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
    const block = blockedTarget(current);
    if (block) return { ok: false, status: 0, finalUrl: current, reason: block };
    if (!hostAllowed(current, allowedHosts)) return { ok: false, status: 0, finalUrl: current, reason: "redirect_to_domain_not_allowed" };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(current, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; evidence-check/1.0; +https://theaipipe.com/end-customer-check/)",
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-language": "en-US,en;q=0.8",
        },
      });
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, status: 0, finalUrl: current, reason: e && e.name === "AbortError" ? "timeout" : "network_error" };
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      clearTimeout(timer);
      try { current = new URL(res.headers.get("location"), current).toString(); } catch { return { ok: false, status: res.status, finalUrl: current, reason: "bad_redirect" }; }
      continue;
    }
    if (!res.ok) {
      clearTimeout(timer);
      return { ok: false, status: res.status, finalUrl: current, reason: `http_${res.status}` };
    }
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (type && !type.includes("html") && !type.includes("text/plain") && !type.includes("xml")) {
      clearTimeout(timer);
      return { ok: false, status: res.status, finalUrl: current, reason: "not_html" };
    }
    let html = "";
    try {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        html += dec.decode(value, { stream: true });
        if (total >= maxBytes) { html = html.slice(0, maxBytes); try { await reader.cancel(); } catch {} break; }
      }
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, status: res.status, finalUrl: current, reason: e && e.name === "AbortError" ? "timeout" : "read_error" };
    }
    clearTimeout(timer);
    const text = htmlToText(html);
    const norm = normalize(text);
    if (norm.length < 300 && CHALLENGE.some((c) => norm.includes(c))) {
      return { ok: false, status: res.status, finalUrl: current, reason: "bot_challenge" };
    }
    if (norm.length < 200) {
      return { ok: false, status: res.status, finalUrl: current, reason: "no_readable_text" };
    }
    return { ok: true, status: res.status, finalUrl: current, html, text };
  }
  return { ok: false, status: 0, finalUrl: current, reason: "too_many_redirects" };
}

// ---------- the check itself ----------

export const VERIFIER_VERSION = "2026-09-30.4";
export const METHOD = "substring match after NFKC, lowercase, unified quotes and dashes, collapsed whitespace; '...' splits fragments that must appear in order within 400 characters";

// Host allowed if it equals an allowed domain or is a subdomain of one. An empty list allows nothing.
export function hostAllowed(raw, allowed) {
  if (!allowed) return true; // local runs without a list
  let h;
  try { h = new URL(raw).hostname.toLowerCase(); } catch { return false; }
  return allowed.some((d) => h === d || h.endsWith("." + d));
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function titleOf(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim().slice(0, 200) : null;
}
function publisherOf(html, finalUrl) {
  const m = html.match(/<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i);
  if (m) return decodeEntities(m[1]).trim().slice(0, 120);
  try { return new URL(finalUrl).hostname.replace(/^www\./, ""); } catch { return null; }
}

// True when the host is the account's own domain or one of its subdomains ("www." ignored on both sides).
export function onOwnSite(rawUrl, domain) {
  if (!domain) return null;
  let h;
  try { h = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, ""); } catch { return false; }
  const d = String(domain).toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  return h === d || h.endsWith("." + d);
}

// Status is one of:
//   "found"      the page was read and the quote is on it
//   "absent"     the page was read and the quote is not on it
//   "unreadable" the page could not be read (blocked, challenge page, timeout, not HTML, too many redirects)
//   "rejected"   the input was refused before any download (trivial quote, bad URL, domain not on the list)
// quote_found is true only for "found". The model's proposal is echoed back unchanged.
export async function verifyEvidence(input, opts = {}) {
  // Table tools often append a newline or spaces to mapped values; a URL with a trailing "\n" would fetch another page.
  const trim = (v) => (typeof v === "string" ? v.trim() : v);
  const url = trim(input.url), quote = trim(input.quote), date = trim(input.date), entity = trim(input.entity), domain = trim(input.domain);
  const now = opts.now ? opts.now() : new Date();
  const base = {
    verifier_version: VERIFIER_VERSION, method: METHOD,
    proposal: { url: url ?? null, quote: quote ?? null, date: date || null, entity: entity || null, domain: domain || null },
    retrieved_at: now.toISOString(), original_url: typeof url === "string" ? url : null,
  };
  const out = (o) => ({ ...base, quote_found: o.status === "found", ok: o.status === "found" || o.status === "absent", ...o });
  if (typeof url !== "string" || !url || url.length > LIMITS.maxUrlChars) return out({ status: "rejected", reason: "bad_url" });
  if (typeof quote !== "string" || !quote.trim()) return out({ status: "rejected", reason: "no_quote" });
  if (quote.length > LIMITS.maxQuoteChars) return out({ status: "rejected", reason: "quote_too_long" });
  const qn = normalize(quote);
  if (qn.split(" ").filter((w) => /[a-z0-9]/.test(w)).length < LIMITS.minQuoteWords || qn.length < 40) {
    return out({ status: "rejected", reason: "quote_too_short" });
  }
  const block = blockedTarget(url);
  if (block) return out({ status: "rejected", reason: block });
  if (!hostAllowed(url, opts.allowedHosts)) return out({ status: "rejected", reason: "domain_not_allowed" });
  const page = await fetchPage(url, opts);
  if (!page.ok) return out({ status: "unreadable", reason: page.reason, http_status: page.status, final_url: page.finalUrl });
  const hit = findQuote(page.text, quote);
  const meta = metadataDate(page.html);
  const claimedOnPage = date ? dateOnPage(page.text, date) : null;
  return out({
    status: hit.status,
    reason: hit.reason,
    final_url: page.finalUrl,
    // Checked against the final URL, after redirects. null when no account domain was sent.
    on_own_site: onOwnSite(page.finalUrl, domain),
    http_status: page.status,
    content_sha256: await sha256(normalize(page.text)),
    page_title: titleOf(page.html),
    publisher: publisherOf(page.html, page.finalUrl),
    before: hit.before ?? null,
    match: hit.match ?? null,
    after: hit.after ?? null,
    dates: {
      published: meta ? meta.date : claimedOnPage ? date : null,
      published_source: meta ? "page metadata" : claimedOnPage ? "printed on page" : "none found",
      claimed: date || null,
      claimed_printed_on_page: claimedOnPage,
      retrieved: now.toISOString().slice(0, 10),
    },
  });
}
