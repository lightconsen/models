/**
 * OpenDesign's CoRouter rates, from the catalogue page the vendor serves.
 *
 * OpenDesign (open-design.ai) sells a design agent and, behind it, CoRouter — a
 * team subscription (Go / Plus / Pro / Max, $10–$200 a month) whose usage is
 * metered at the per-token rates this adapter reads. That is why the entry's
 * `billing` is `both` rather than `plan`: the same address takes either a plan's
 * credit pool or a pay-as-you-go top-up, and both are drawn at the same token
 * rates, so the plan has no separate price to carry. The Design Plan credits a
 * subscription buys are converted by a per-model multiplier (0.5× to 4× of the
 * dollar value of usage) — a property of the subscription, not of a token, so
 * it has no field and lives here rather than in the entry.
 *
 * `https://corouter.open-design.ai/models/` is the vendor's own catalogue: one
 * panel per model, each with the vendor's API id, its display name and one or
 * two rate tiers. It is server-rendered, needs no key, and is the only complete
 * machine-readable list — the API's own `/v1/models` answers 401, and 23 of the
 * 33 per-model pages fall back to this same catalogue page instead of
 * rendering, so a walk of the detail pages would silently lose two thirds of
 * the line-up. The endpoint the entry points at is documented beside it
 * (`amr-link.open-design.ai`, Chat Completions and Responses under `/v1`,
 * Messages at the bare host), and all three answer 401 without a key.
 *
 * Three shapes the page carries:
 *
 * - **Tiers.** `Up to 272,000 tokens` / `Over 272,000 tokens` (100,000 for
 *   Claude Haiku 5.5), or the single `No input-length tiers`. The first is the
 *   row; the second is its `long_context`, whose `over` is the threshold the
 *   heading states. The page's own note says the threshold is the *total* input
 *   length including cached tokens, and that output follows the same tier —
 *   which is what `long_context` means here.
 * - **cache write `—`.** Sixteen models show an em dash with the label "No
 *   separate price listed in the workspace". The schema reads an absent
 *   `cache_creation` as zero, which is the same statement, so it is left out
 *   rather than written as a price the page never states.
 * - **ids.** The vendor spells its own ids (`claude-fable-5.1`,
 *   `glm-5.3-flashx`, `hy4-preview`); the entry's `id` is the canonical key the
 *   rest of this catalogue uses. Only the Claude rows differ — this catalogue
 *   spells them `claude-fable-5-1` — so the dots become hyphens there and the
 *   vendor's spelling rides in `serves`, which is the entry's job and not this
 *   reader's.
 *
 * Membership follows the page, which is a complete statement of what CoRouter
 * prices — the same basis `opencode.mjs` and `commandcode.mjs` use for their
 * gateways. The page states its own count in the `<h1>` ("33 models. One entry
 * point."), and that number is checked against the panels parsed: a page that
 * renders a panel this reader cannot see is a row that would look retired.
 */
import { getText, drift, decimal, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://corouter.open-design.ai/models/";

const strip = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The metric name → the field it fills. The unit is "1M tokens" on every one
    of them, and a page that starts quoting per-token figures would be a
    thousandfold error, so the unit is part of the match rather than assumed. */
const COLUMNS = [
  [/^input \/ 1M tokens$/i, "in"],
  [/^output \/ 1M tokens$/i, "out"],
  [/^cache read \/ 1M tokens$/i, "cache_read"],
  [/^cache write \/ 1M tokens$/i, "cache_creation"],
];

/** `$2` → `2`; the em dash with its "not listed" label → undefined. */
const money = (cell, what) => {
  const m = /\$([\d.]+)/.exec(cell);
  if (!m) {
    if (/—|&mdash;/.test(cell)) return undefined;
    drift(`${what}: "${cell}" holds neither a price nor a dash`);
  }
  return decimal(m[1], what);
};

/** `Up to 272,000 tokens` / `Over 272,000 tokens` / `No input-length tiers`.
    The threshold is comma-grouped on the page and a whole number in the entry.
    Exported for `test-sources.mjs`, which pins the three shapes. */
export const tierOf = (heading, what) => {
  if (/^no input-length tiers$/i.test(heading)) return { base: true };
  if (/^up to\s+[\d,]+\s+tokens$/i.test(heading)) return { base: true };
  const over = /^over\s+([\d,]+)\s+tokens$/i.exec(heading);
  if (over) return { over: Number(over[1].replace(/,/g, "")) };
  drift(`${what}: the tier heading "${heading}" is not one this reader knows`);
};

/** The vendor's id → this catalogue's canonical key. Anthropic is the only
    family spelled differently: `claude-opus-4.8` here, `claude-opus-4-8`
    everywhere else in the repo. Exported for the same reason. */
export const idOf = (vendor, what) => {
  const id = vendor.startsWith("claude-") ? vendor.replace(/\./g, "-") : vendor;
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) drift(`${what}: "${vendor}" does not make a usable id`);
  return id;
};

/** One panel → `{ id, name, tiers }`, or a drift. The body is cut at the
    panel's own "See details" link so the next panel's rails cannot leak in. */
const panelsOf = (html) => {
  const panels = [
    ...html.matchAll(
      /<div class="model-explorer-panel"[^>]*data-model-panel="([^"]+)"[^>]*>([\s\S]*?)<a class="model-explorer-detail-link"/g,
    ),
  ].map((m) => ({ vendor: m[1], body: m[2] }));

  const declared = /<h1>\s*(\d+)\s+models?\./i.exec(html);
  if (!declared) drift("no model count in the page heading — the catalogue restructured");
  const count = Number(declared[1]);
  if (panels.length !== count) {
    drift(`the page says ${count} models and this reader found ${panels.length} panels`);
  }
  if (panels.length === 0) drift("no model panels");
  return panels;
};

const parse = (html) => {
  const rows = [];
  const seen = new Set();

  for (const { vendor, body } of panelsOf(html)) {
    const what = vendor;
    const h3 = /<h3>([\s\S]*?)<\/h3>/.exec(body);
    if (!h3) drift(`${what}: no display name`);

    const tiers = [];
    for (const chunk of body.split('<div class="model-explorer-tier">').slice(1)) {
      const h4 = /<h4>([\s\S]*?)<\/h4>/.exec(chunk);
      if (!h4) drift(`${what}: a price tier with no heading`);
      const heading = strip(h4[1]);
      const tier = tierOf(heading, what);

      const rates = {};
      const metrics = chunk.split("<dt>").slice(1);
      if (metrics.length === 0) drift(`${what}: the "${heading}" tier carries no metrics`);
      for (const metric of metrics) {
        const name = strip(/^([\s\S]*?)<\/dt>/.exec(metric)?.[1] ?? "");
        const cell = strip(/<dd[^>]*>([\s\S]*?)<\/dd>/.exec(metric)?.[1] ?? "");
        const col = COLUMNS.find(([re]) => re.test(name));
        if (!col) drift(`${what}: the metric "${name}" is not one this reader knows`);
        const rate = money(cell, `${what} ${col[1]}`);
        if (rate !== undefined && rate !== "0") rates[col[1]] = rate;
      }
      tiers.push({ ...tier, rates });
    }
    if (tiers.length === 0) drift(`${what}: no price tiers`);

    const base = tiers.filter((t) => !t.over);
    const over = tiers.filter((t) => t.over);
    if (base.length !== 1) drift(`${what}: ${base.length} base tiers, expected one`);
    if (over.length > 1) drift(`${what}: ${over.length} tiers above the base and the field holds one`);
    if (base[0].rates.in === undefined || base[0].rates.out === undefined) {
      drift(`${what}: the base tier has no input/output pair`);
    }

    const id = idOf(vendor, what);
    if (seen.has(id)) drift(`${what}: "${id}" is priced twice on the page`);
    seen.add(id);

    const row = { id, name: strip(h3[1]), in: base[0].rates.in, out: base[0].rates.out };
    if (base[0].rates.cache_read !== undefined) row.cache_read = base[0].rates.cache_read;
    if (base[0].rates.cache_creation !== undefined) row.cache_creation = base[0].rates.cache_creation;
    if (over.length === 1) {
      const lc = over[0];
      if (lc.rates.in === undefined || lc.rates.out === undefined) {
        drift(`${what}: the "over ${lc.over}" tier has no input/output pair`);
      }
      row.long_context = { over: lc.over, in: lc.rates.in, out: lc.rates.out };
      if (lc.rates.cache_read !== undefined) row.long_context.cache_read = lc.rates.cache_read;
      if (lc.rates.cache_creation !== undefined) row.long_context.cache_creation = lc.rates.cache_creation;
    }
    rows.push(row);
  }

  if (rows.length === 0) drift("the catalogue yielded no priced rows");
  return rows;
};

export default {
  ids: ["open-design"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "cache_creation", "long_context"],

  async read() {
    const html = await getText(URL, { headers: { accept: "text/html" } });
    const rows = parse(html);
    return {
      rows: { "open-design": rows },
      notes: {
        "open-design": [
          `${rows.length} priced models; ${rows.filter((r) => r.long_context).length} carry a long-input tier`,
          "the plan's own credit multipliers (0.5×–4×) are a subscription property and have no field",
        ],
      },
    };
  },
};
