#!/usr/bin/env node
/**
 * Prerender the pages a crawler can read, after the SPA build.
 *
 * The site is a hash-routed SPA: every URL serves the same empty `<div id="app">`
 * until React runs, so a search engine indexing models.kiwano.cc sees one title
 * and no content — 1500 price rows that nobody can search for. The app keeps the
 * hash router (GitHub Pages cannot rewrite arbitrary paths), so the fix is not
 * path routing; it is static HTML at paths the crawler already visits:
 *
 *   /provider/<id>/index.html — one prerendered page per provider, carrying its
 *                               name, prices and capability columns as real
 *                               HTML. A human landing here gets the same app as
 *                               anywhere else (the hash router ignores the
 *                               path); a crawler gets the full table.
 *   /sitemap.xml              — every prerendered page, lastmod from the data.
 *   /robots.txt               — allow all, point at the sitemap.
 *
 * Generated from public/data (staged by `prebuild`), never hand-written — a
 * provider that exists only as a stale sitemap entry would be a lie about
 * coverage. Regenerated on every build.
 *
 * Run automatically by the `postbuild` hook. Run alone:
 *   node scripts/prerender.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(web, "public", "data");
const outDir = path.join(web, "dist");
const SITE = "https://models.kiwano.cc";

if (!existsSync(path.join(dataDir, "catalog.json"))) {
  console.error("✗ web/public/data/catalog.json is missing — run `node scripts/generate.mjs` in the data repo first.");
  process.exit(1);
}
const catalog = JSON.parse(readFileSync(path.join(dataDir, "catalog.json"), "utf8"));
const models = JSON.parse(readFileSync(path.join(dataDir, "models.json"), "utf8"));
const byProvider = new Map();
for (const r of models.models) {
  if (!byProvider.has(r.provider_id)) byProvider.set(r.provider_id, []);
  byProvider.get(r.provider_id).push(r);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n) => (Number.isFinite(Number(n)) ? String(Math.round(Number(n) * 100) / 100) : String(n));

const page = (title, desc, body, canonical) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${SITE}/${canonical}" />
<style>
:root { --bg:#fff; --border:#ddd; --fg:#333; --muted:#666; --accent:#fd9527; }
@media (prefers-color-scheme: dark) { :root { --bg:#1e1e1e; --border:#333; --fg:#fff; --muted:#aaa; } }
body { margin:0; font:15px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; background:var(--bg); color:var(--fg); }
main { max-width: 1180px; margin: 0 auto; padding: 24px 20px 64px; }
h1 { font-size: 26px; letter-spacing: -0.02em; margin: 0 0 4px; }
.muted { color: var(--muted); }
.mono { font-family: "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
table { width: 100%; border-collapse: collapse; margin-top: 16px; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); font-size: 14px; }
th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
th.num, td.num { text-align: right; }
td.cap { text-align: center; }
code { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12px; background: var(--border); border-radius: 4px; padding: 2px 6px; }
p.back { margin: 18px 0 0; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;

const yes = (v) => (v === true ? "✓" : v === false ? "✗" : "—");

const providerBody = (entry, rows) => {
  const priced = rows.filter((r) => r.input !== undefined && r.output !== undefined);
  const ref = entry.price_ref ?? (priced.find((r) => r.flagship) ?? priced[0] ?? null);
  const cur = ref && ref.currency === "CNY" ? "¥" : "$";
  const trs = priced
    .map((r) => `<tr>
  <td class="mono">${esc(r.model_id)}</td>
  <td class="num">${r.context ? money(r.context) : "—"}</td>
  <td class="num">${r.max_output ? money(r.max_output) : "—"}</td>
  <td class="cap">${yes(r.reasoning)}</td>
  <td class="cap">${yes(r.tool_call)}</td>
  <td class="cap">${yes(r.structured_output)}</td>
  <td class="num">${cur}${money(r.input)}</td>
  <td class="num">${cur}${money(r.output)}</td>
  <td class="num">${r.cache_read && Number(r.cache_read) > 0 ? `${cur}${money(r.cache_read)}` : "—"}</td>
</tr>`)
    .join("\n");
  return `<h1>${esc(entry.name)}</h1>
<p class="muted mono">${esc(entry.id)} · ${entry.billing === "plan" ? "plan-billed" : entry.billing === "both" ? "pay-as-you-go and plan" : "pay-as-you-go"}${entry.seeded ? " · seeded, pending verification" : ""}</p>
${ref ? `<p class="muted">${esc(ref.display_name ?? ref.model_id)} — ${cur}${money(ref.input)} in / ${cur}${money(ref.output)} out per 1M tokens${entry.prices_as_of ? ` · prices as of ${esc(entry.prices_as_of)}` : ""}</p>` : `<p class="muted">Plan-billed: no per-token rate is published for this provider.</p>`}
${entry.endpoints.length === 0 && entry.endpoint_template ? `<p class="muted">No public endpoint — the vendor provisions a private API base per account: <code>${esc(entry.endpoint_template)}</code></p>` : ""}
${entry.desc ? `<p>${esc(entry.desc)}</p>` : ""}
${priced.length ? `<table>
<thead><tr><th>Model</th><th class="num">Context</th><th class="num">Max out</th><th>Reasoning</th><th>Tool call</th><th>JSON</th><th class="num">In /1M</th><th class="num">Out /1M</th><th class="num">Cache read /1M</th></tr></thead>
<tbody>
${trs}
</tbody>
</table>` : ""}
<p class="back muted">All prices per 1M tokens · <a href="${SITE}/#/">Kiwano Hub</a></p>`;
};

const today = new Date().toISOString().slice(0, 10);
const made = [];
for (const entry of catalog.entries) {
  const rows = byProvider.get(entry.id) ?? [];
  const ref = entry.price_ref;
  const desc = ref
    ? `${entry.name} — model prices and capabilities. ${ref.display_name}: ${money(ref.input)} in / ${money(ref.output)} out per 1M tokens.`
    : `${entry.name} — the models this provider serves, on the Kiwano Hub catalogue.`;
  const dir = path.join(outDir, "provider", entry.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.html"), page(`${entry.name} — models and prices | Kiwano Hub`, desc, providerBody(entry, rows), `provider/${entry.id}/`));
  made.push(entry.id);
}

const urls = [
  `  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod></url>`,
  ...made.map((id) => `  <url><loc>${SITE}/provider/${esc(id)}/</loc><lastmod>${today}</lastmod></url>`),
];
writeFileSync(
  path.join(outDir, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
);
writeFileSync(path.join(outDir, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`✓ prerendered ${made.length} provider pages + sitemap.xml + robots.txt`);
