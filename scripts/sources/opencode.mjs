/**
 * OpenCode Console's pay-as-you-go rates, from the vendor's own docs.
 *
 * OpenCode is the agent, Console (formerly Zen) is the model gateway behind
 * it: a curated catalogue resold at the upstream rates with no markup. The
 * docs page server-renders two tables that join on the display name —
 *
 *   Model | Model ID | Endpoint | AI SDK Package
 *   Model | Input  | Output | Cached Read | Cached Write
 *
 * — so the id a client sends is the vendor's own, not a normalisation of the
 * display name.
 *
 * Three shapes the pricing table carries, each undone here:
 *
 * - **Free models** (`Big Pickle`, `Beam Free`, …) are a free-tier surface and
 *   are left out, the catalogue's standing rule. The row's input cell says
 *   `Free`, which is how they are told apart.
 * - **Length bands** ride in the display name: `Claude Sonnet 4.5 (≤ 200K
 *   tokens)` and `(> 200K tokens)`. The cheaper band is the row and the dearer
 *   one becomes `long_context`, its threshold read from the label.
 * - **Deals** ride the same way — `Mistral Large 4 (50% off)`, `Gemini 4 Argon
 *   (50% off)` — and their cells carry the old and the new figure
 *   (`$1.36 $0.68`, the first struck through in the page's markup). The last
 *   figure is what is billed and is the one recorded.
 *
 * Decision models (`Jev`, served on `/inference/systemone`) return typed
 * probabilities rather than text and are not this catalogue's kind of model;
 * they are skipped by their endpoint rather than by their name.
 *
 * The OpenCode Go subscription is a separate address and a separate entry
 * (`opencode-go`), read by `opencode-go.mjs`.
 */
import { getText, drift, decimal, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://opencode.ai/v2/docs/console/models/";

const strip = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** `$0.30` -> `0.3`; the last figure in a deal cell is the price in force. */
const money = (cell, what) => {
  const figures = [...String(cell).matchAll(/\$([0-9]+(?:\.[0-9]+)?)/g)].map((m) => m[1]);
  if (figures.length === 0) return undefined;
  return decimal(figures.at(-1), what).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

/** `(≤ 200K tokens)` / `(> 200K tokens)` — the band, or null. */
const bandOf = (name) => {
  const m = /\((≤|>)\s*([\d.]+)\s*K tokens\)/i.exec(name);
  return m ? { above: m[1] === ">", over: Math.round(Number(m[2]) * 1000) } : null;
};

/** The display name without its band or deal suffix. */
const baseOf = (name) => strip(name.replace(/\s*\([^)]*\)\s*$/, ""));

/** Every `<table>` as rows of stripped cells. */
const tables = (html) =>
  (html.match(/<table[\s\S]*?<\/table>/g) ?? []).map((t) =>
    (t.match(/<tr[\s\S]*?<\/tr>/g) ?? []).map((r) =>
      (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? []).map(strip),
    ),
  );

export default {
  ids: ["opencode"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "cache_creation", "long_context"],

  async read() {
    const html = await getText(URL, { headers: { accept: "text/html" } });
    const all = tables(html);
    const idTable = all.find((t) => /^model$/i.test(t[0]?.[0] ?? "") && /^model id$/i.test(t[0]?.[1] ?? ""));
    const priceTable = all.find((t) => /^model$/i.test(t[0]?.[0] ?? "") && /^input$/i.test(t[0]?.[1] ?? ""));
    if (!idTable) drift("no Model / Model ID table — the Console docs restructured");
    if (!priceTable) drift("no Model / Input / Output pricing table — the Console docs restructured");

    const ids = new Map();
    const decision = new Set();
    for (const cells of idTable.slice(1)) {
      const [name, id, endpoint] = cells;
      if (!name || !id) continue;
      ids.set(name, id);
      if (/\/systemone(\/|$)/.test(endpoint ?? "")) decision.add(name);
    }

    const rows = [];
    const skipped = { free: 0, decision: 0 };
    const unmapped = [];
    const deals = [];
    for (const cells of priceTable.slice(1)) {
      const [name, input, out, cacheRead, cacheWrite] = cells;
      if (!name) continue;
      const base = baseOf(name);
      if (decision.has(base)) {
        skipped.decision++;
        continue;
      }
      if (/^free$/i.test(input ?? "")) {
        skipped.free++;
        continue;
      }
      const id = ids.get(base);
      if (!id) {
        unmapped.push(name);
        continue;
      }
      const inRate = money(input, `${name} input`);
      const outRate = money(out, `${name} output`);
      if (inRate === undefined || outRate === undefined) drift(`${name} has no input/output pair`);

      const band = bandOf(name);
      if (band?.above) {
        const row = rows.find((r) => r.id === id);
        if (!row) drift(`${name} has a long band but no base row`);
        const cache = money(cacheRead, `${name} cached read`);
        const write = money(cacheWrite, `${name} cached write`);
        row.long_context = {
          over: band.over,
          in: inRate,
          out: outRate,
          ...(cache !== undefined && cache !== "0" ? { cache_read: cache } : {}),
          ...(write !== undefined && write !== "0" ? { cache_creation: write } : {}),
        };
        continue;
      }
      if (rows.some((r) => r.id === id)) drift(`${name} is priced twice without a band`);
      const row = { id, name: base, in: inRate, out: outRate };
      const cache = money(cacheRead, `${name} cached read`);
      const write = money(cacheWrite, `${name} cached write`);
      if (cache !== undefined && cache !== "0") row.cache_read = cache;
      if (write !== undefined && write !== "0") row.cache_creation = write;
      rows.push(row);
      if (/%\s*off/i.test(name)) deals.push(`${base} at ${inRate}/${outRate}`);
    }

    if (rows.length === 0) drift("the pricing table yielded no priced rows");

    const notes = [
      `${rows.length} priced models; ${skipped.free} free models and ${skipped.decision} decision model(s) left out`,
      "the join is the page's own Model ID table, so ids are the vendor's spelling",
    ];
    if (deals.length) notes.push(`deal prices recorded as billed: ${deals.join(", ")}`);
    if (unmapped.length) notes.push(`no Model ID for: ${unmapped.join(", ")}`);
    return { rows: { opencode: rows }, notes: { opencode: notes } };
  },
};
