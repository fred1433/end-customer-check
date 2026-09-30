// For each quote the checker marked "absent", says where the research step's words actually are:
// the whole quote in the page's metadata, the whole quote in the page source outside the extracted text, only its
// opening in the extracted text (words dropped or changed further on), or nowhere. Reads the private export.
import { readFileSync, writeFileSync } from "node:fs";
import { normalize, decodeEntities, fetchPage } from "../src/verify.js";
const root = new URL("..", import.meta.url).pathname;
const rows = JSON.parse(readFileSync(root + "private/clay_records.json", "utf8"));
const out = {};
for (const r of rows) {
  const q = r.quote_check;
  if (!q || q.status !== "absent") continue;
  const p = await fetchPage(q.proposal.url.trim());
  const quote = normalize(q.proposal.quote);
  const opening = quote.split(" ").slice(0, 8).join(" ");
  let where = "nowhere on the page";
  if (p.ok) {
    const metas = [...p.html.matchAll(/<meta[^>]+content=["']([^"']+)["']/gi)].map((m) => normalize(decodeEntities(m[1]))).join(" | ");
    const source = normalize(decodeEntities(p.html.replace(/<[^>]+>/g, " ")));
    const text = normalize(p.text);
    if (metas.includes(quote)) where = "page metadata only";
    else if (source.includes(quote)) where = "page source outside visible text";
    else if (text.includes(opening)) where = "opening on the page, words dropped or changed";
  }
  out[String(r.id)] = where;
  console.log(String(r.id).padStart(2), r.company.padEnd(30), where);
}
writeFileSync(root + "private/absent_where.json", JSON.stringify(out, null, 1));
writeFileSync(root + "data/absent_where.json", JSON.stringify(out, null, 1));
