/**
 * DeepInfra's prices, from the catalogue API behind their own models page.
 *
 * `GET /api/deepinfra.com/models/list` is public, unauthenticated, and returns
 * every model they host with its pricing attached — 377 of them, of which 107 are
 * current text-generation. That is far more than this entry carries, so
 * `membership` is `intersect`: the entry decides which models it wants and this
 * only re-prices them.
 *
 * **The units are the whole difficulty.** The API reports
 * `cents_per_input_token`, a fraction of a cent, so a price of $0.10 per million
 * arrives as `1e-05` — the conversion is a factor of 10,000 and getting it wrong
 * by 100 is easy and invisible. Their own `full` field is the check when the
 * shape is unfamiliar: it spells the same price out as prose, and the two agreeing
 * is what makes the arithmetic trustworthy rather than merely consistent.
 *
 * Cache pricing arrives in a different shape again — as a *rate* against the input
 * price (`rate_per_input_token_cached`), not as a price. Those rates are long
 * decimals (0.12484848) because they were derived from round numbers, so
 * multiplying back and rounding lands on the price the page shows (1.65 ×
 * 0.12484848 = 0.206) rather than on the noise in between.
 */
import { getJson, decimal, drift, MEMBERSHIP, readEntry } from "../lib/fetch.mjs";

const URL = "https://api.deepinfra.com/models/list";

/** A fraction of a cent per token -> dollars per million, float noise removed.
    10,000 is 1e6 tokens ÷ 100 cents, and it is the step worth double-checking. */
const usdPerMillion = (cents) => {
  const s = (cents * 1e4).toFixed(6).replace(/\.?0+$/, "");
  return decimal(s === "" ? "0" : s, "price");
};

export default {
  ids: ["deepinfra"],
  source: URL,
  membership: MEMBERSHIP.INTERSECT,
  owns: ["in", "out", "cache_read"],

  async read() {
    const body = await getJson(URL);
    if (!Array.isArray(body) || body.length === 0) drift("no model array in the response");

    const text = body.filter(
      (m) => m?.type === "text-generation" && m.deprecated !== true && m.private !== true,
    );
    if (text.length === 0) drift("no current text-generation models in the response");

    // The entry's ids are canonical ("gpt-oss-120b"); the API's are the lab's own
    // ("openai/gpt-oss-120b"). `serves` is the only thing connecting them.
    const current = readEntry("deepinfra").models;
    const rowFor = (vendorName) =>
      current.find((r) => [r.id, ...Object.values(r.serves ?? {})].includes(vendorName));

    const rows = [];
    const skipped = [];
    for (const m of text) {
      const now = rowFor(m.model_name);
      if (!now) continue;
      const p = m.pricing ?? {};
      const inRate = p.cents_per_input_token;
      const outRate = p.cents_per_output_token;
      if (inRate === undefined || outRate === undefined) {
        skipped.push(`${m.model_name} (no token pricing)`);
        continue;
      }
      const row = { id: now.id, in: usdPerMillion(inRate), out: usdPerMillion(outRate) };
      const cached = p.rate_per_input_token_cached;
      if (cached !== undefined && cached !== null) {
        row.cache_read = usdPerMillion(inRate * cached);
      }
      rows.push(row);
    }
    if (rows.length === 0) drift("none of the entry's models are in the API — the join is broken");

    const missing = current.filter((r) => !rows.some((x) => x.id === r.id));
    const notes = [`${text.length} current text models in the API, ${rows.length} of them in the entry`];
    if (missing.length) notes.push(`not found: ${missing.map((r) => r.id).join(", ")}`);
    if (skipped.length) notes.push(`no token pricing, skipped: ${skipped.join(", ")}`);

    return { rows: { deepinfra: rows }, notes: { deepinfra: notes } };
  },
};
