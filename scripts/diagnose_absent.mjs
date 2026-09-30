// For each quote the verifier marked "absent": is it in the page's metadata (not visible text), or nowhere?
import { readFileSync, writeFileSync } from "node:fs";
import { normalize, decodeEntities, fetchPage } from "../src/verify.js";
const d = JSON.parse(readFileSync(new URL("../private/clay_records_full.json", import.meta.url)));
const Q = "f_0tm6kiib4kYYB57rXED", C = "f_0tm6hh0tjZmS37xV9fv";
const out = {};
for (const r of d) {
  const fv = r.cells[Q]?.externalContent?.fullValue;
  if (!fv || fv.status !== "absent") continue;
  const p = await fetchPage(fv.proposal.url.trim());
  const raw = p.ok ? normalize(decodeEntities(p.html.replace(/<[^>]+>/g, " "))) : "";
  const metas = p.ok ? [...p.html.matchAll(/<meta[^>]+content=["']([^"']+)["']/gi)].map((m) => normalize(decodeEntities(m[1]))).join(" | ") : "";
  const q = normalize(fv.proposal.quote).slice(0, 80);
  const where = metas.includes(q) ? "page metadata only" : raw.includes(q) ? "page source outside visible text" : "nowhere on the page";
  out[r.cells[C].value] = where;
  console.log(r.cells[C].value.padEnd(26), where);
}
writeFileSync(new URL("../private/absent_diagnosis.json", import.meta.url), JSON.stringify(out, null, 1));
