/**
 * Command Code's Provider API rates, from the vendor's own catalogue.
 *
 * Command Code is a coding agent that also sells model access: the CLI and the
 * Provider API share one key and one address, and the Provider API bills at the
 * underlying model's rate with no markup ("at cost"). Two keyless sources
 * together state the catalogue:
 *
 *   https://api.commandcode.ai/provider/v1/models
 *     id, display name, context length and the routes that serve each model —
 *     the membership and the ids the API accepts.
 *
 *   https://commandcode.ai/docs/resources/pricing-limits
 *     a server-rendered `Model | Context | Input /M | Output /M | Cache Read |
 *     Cache Write | Caps` grid. The prices in it are the current ones; a deal
 *     row shows the old figure struck through beside the new one
 *     (`$0.60 $0.30`), and the last figure is what is billed.
 *
 * The join is a display name across the two, with the few exceptions written
 * down: the pricing grid lists `Claude Opus 4.6` and `Claude Sonnet 4.5` while
 * the models endpoint does not (their ids follow the pattern of every other
 * Claude row: `claude-opus-4-6`, `claude-sonnet-4-5`).
 *
 * Left out, following the catalogue's rules:
 *   - **Free models** (`Laguna S 2.1`, `Glyph Cluster`, `Beam 1.0`): a
 *     free-tier surface, not a price.
 *   - **Decision models** (`Jev`, `Jev 1.14.0`): they answer typed questions
 *     with probabilities, never text, and run on `/provider/v1/systemone`.
 *
 * The subscription plans (Go, GOAT, Pro, Max, Team) are prepaid credit pools
 * metered at these same per-token rates, so they have no separate price to
 * carry; the entry's `billing: both` records that one address serves both.
 */
import { getJson, getText, drift, decimal, MEMBERSHIP } from "../lib/fetch.mjs";

const MODELS_URL = "https://api.commandcode.ai/provider/v1/models";
const PRICING_URL = "https://commandcode.ai/docs/resources/pricing-limits";

/** Pricing-grid display name -> id, only where the models endpoint is silent. */
const ID_ALIASES = {
  "claude opus 4.6": "claude-opus-4-6",
  "claude sonnet 4.5": "claude-sonnet-4-5",
};

const strip = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Normalised display name: no parenthetical suffix, collapsed case/space. */
const normOf = (name) =>
  strip(name)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** The direct child `<div>`s of a row, by tag depth. */
const childrenOf = (html) => {
  const out = [];
  let depth = 0;
  let start = null;
  for (const t of html.matchAll(/<div\b[^>]*>|<\/div>/g)) {
    if (t[0].startsWith("<div")) {
      if (depth === 0) start = t.index + t[0].length;
      depth++;
    } else {
      depth--;
      if (depth === 0 && start !== null) {
        out.push(html.slice(start, t.index));
        start = null;
      }
    }
  }
  return out;
};

/** Every pricing row's cells, in document order. */
const pricingRows = (html) => {
  const rows = [];
  for (const m of html.matchAll(
    /<div class="grid grid-cols-\[[^\]]*\] items-center" role="row">/g,
  )) {
    let depth = 1;
    let end = null;
    for (const t of html.slice(m.index + m[0].length).matchAll(/<div\b|<\/div>/g)) {
      if (t[0] === "<div") depth++;
      else if (--depth === 0) {
        end = m.index + m[0].length + t.index;
        break;
      }
    }
    if (end === null) continue;
    const cells = childrenOf(html.slice(m.index + m[0].length, end)).map(strip);
    if (cells.length >= 2) rows.push(cells);
  }
  return rows;
};

/** A price cell: `$0.30`, `$0.60 $0.30` (deal), `Free`, or `—`. */
const rate = (cell, what) => {
  const v = strip(cell ?? "");
  if (v === "" || v === "—" || v === "-") return undefined;
  if (/^free$/i.test(v)) return "0";
  const figures = [...v.matchAll(/\$([0-9]+(?:\.[0-9]+)?)/g)].map((m) => m[1]);
  if (figures.length === 0) drift(`${what}: "${cell}" holds no price`);
  return decimal(figures.at(-1), what).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

export default {
  ids: ["commandcode"],
  source: `${MODELS_URL} + ${PRICING_URL}`,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "cache_creation", "context"],

  async read() {
    const [catalogue, html] = await Promise.all([
      getJson(MODELS_URL),
      getText(PRICING_URL, { headers: { accept: "text/html" } }),
    ]);
    const models = catalogue?.data;
    if (!Array.isArray(models) || models.length === 0) drift("the models endpoint returned no models");

    const byName = new Map();
    for (const m of models) {
      if (m?.id) byName.set(normOf(m.name ?? m.id), m);
    }

    const rows = [];
    const skipped = { free: 0, decision: 0 };
    const unmapped = [];
    const deals = [];
    for (const cells of pricingRows(html)) {
      const [rawName, , inputCell, outCell, cacheReadCell, cacheWriteCell] = cells;
      if (!rawName) continue;
      if (/^free$/i.test(inputCell ?? "")) {
        skipped.free++;
        continue;
      }
      // A deal row is `MiniMax M3 -50%`; the model is the name in front of it.
      const name = rawName.replace(/\s+FREE$/i, "").replace(/\s+-\d+%$/, "").trim();
      if (/^jev\b/i.test(name)) {
        skipped.decision++;
        continue;
      }
      const key = normOf(name);
      const model = byName.get(key);
      const id = model?.id ?? ID_ALIASES[key];
      if (!id) {
        unmapped.push(name);
        continue;
      }
      const inRate = rate(inputCell, `${name} input`);
      const outRate = rate(outCell, `${name} output`);
      if (inRate === undefined || outRate === undefined) {
        unmapped.push(`${name} (no input/output pair)`);
        continue;
      }
      const row = { id, name, in: inRate, out: outRate };
      const cache = rate(cacheReadCell, `${name} cached read`);
      const write = rate(cacheWriteCell, `${name} cached write`);
      if (cache !== undefined && cache !== "0") row.cache_read = cache;
      if (write !== undefined && write !== "0") row.cache_creation = write;
      if (Number.isInteger(model?.context_length) && model.context_length > 0) {
        row.context = model.context_length;
      }
      rows.push(row);
      if (/\s-\d+%$/.test(rawName)) deals.push(`${name} at ${inRate}/${outRate}`);
    }

    if (rows.length === 0) drift("the pricing grid yielded no priced rows");

    const notes = [
      `${rows.length} priced models joined from ${models.length} in the models endpoint`,
      `${skipped.free} free model(s) and ${skipped.decision} decision model(s) left out`,
      "rates are the vendor's pass-through prices (no markup); the subscription plans meter credits at the same rates",
    ];
    if (deals.length) notes.push(`deal prices recorded as billed: ${deals.join(", ")}`);
    if (unmapped.length) notes.push(`no model id for: ${unmapped.join(", ")}`);
    return { rows: { commandcode: rows }, notes: { commandcode: notes } };
  },
};
