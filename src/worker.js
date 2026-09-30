// theaipipe.com/end-customer-check/            the page (static files)
// theaipipe.com/end-customer-check/api/verify  re-reads a page and looks for a quote. No model is called here.
//
// Restrictions: a key in the x-check-key header (CHECK_KEY secret), source domains on a list (ALLOWED_HOSTS secret,
// comma separated), 30 requests a minute per IP and 60 a minute per Cloudflare location (per-location limiters, not a hard global cap), bounded redirects (each hop re-checked),
// time and size caps from src/verify.js.
import { verifyEvidence } from "./verify.js";

const BASE = "/end-customer-check";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS });
}

function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === `${BASE}/api/verify`) {
      if (request.method !== "POST") return json({ error: "use POST with a JSON body" }, 405);
      if (!sameSecret(request.headers.get("x-check-key") || "", env.CHECK_KEY)) return json({ error: "missing or wrong x-check-key header" }, 401);
      if (env.LIMITER) {
        const ip = request.headers.get("cf-connecting-ip") || "unknown";
        if (!(await env.LIMITER.limit({ key: ip })).success) return json({ error: "rate_limited", detail: "30 checks a minute per IP" }, 429);
      }
      if (env.GLOBAL_LIMITER && !(await env.GLOBAL_LIMITER.limit({ key: "all" })).success) return json({ error: "rate_limited", detail: "60 checks a minute per Cloudflare location" }, 429);
      const raw = await request.text();
      if (raw.length > 8192) return json({ error: "body_too_large" }, 400);
      let b;
      try { b = JSON.parse(raw || "{}"); } catch { return json({ error: "invalid_json" }, 400); }
      if (typeof b !== "object" || b === null) return json({ error: "invalid_json" }, 400);
      for (const k of ["url", "quote", "date", "entity", "domain"]) {
        if (b[k] !== undefined && b[k] !== null && typeof b[k] !== "string") return json({ error: `${k} must be a string` }, 400);
      }
      const allowedHosts = String(env.ALLOWED_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      return json(await verifyEvidence({ url: b.url, quote: b.quote, date: b.date, entity: b.entity, domain: b.domain }, { allowedHosts }));
    }
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set("x-robots-tag", "noindex, nofollow");
    return out;
  },
};
