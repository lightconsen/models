/**
 * IBM watsonx.ai's inference prices, from the vendor's own pricing page
 * (`ibm.com/products/watsonx-ai/pricing`), which server-renders one block per
 * model: `<model-id> <vendor> USD <p> per 1M tokens input USD <p> ... output`.
 *
 * The page lists every foundation model watsonx hosts; most carry "Not
 * available" where a rate would be — the vendor prices only the current
 * generation and leaves the retired ones nameable but unpriced. A row the
 * entry carries that the page now marks "Not available" is the vendor
 * unpricing it: FOLLOW membership drops it, and the checklist records that
 * the rate is no longer stated (the honest direction — unpricing a live
 * model would hide a real cost).
 *
 * The page's model ids miss the org prefix the API uses (`granite-4h-small`
 * vs `ibm/granite-4-h-small`), so the join runs through the hand table below,
 * one line per priced model.
 */
import { drift, getText, MEMBERSHIP, decimal } from "../lib/fetch.mjs";

const URL = "https://www.ibm.com/products/watsonx-ai/pricing";

/** Page id → entry id. The page's "Open AI" spacing is its own typo; the ids
    it prints are the watsonx API's, minus the org prefix. */
const MODEL_IDS = {
  "granite-4h-small": "ibm/granite-4-h-small",
  "llama-4-maverick-17b-128e-instruct-fp8": "meta-llama/llama-4-maverick-17b-128e-instruct-fp8",
  "mistral-large-2512": "mistralai/mistral-large-2512",
  "mistral-small-3-1-24b-instruct-2503": "mistralai/mistral-small-3-1-24b-instruct-2503",
  "gpt-oss-120b": "openai/gpt-oss-120b",
};

const PAIR = /USD ([\d.]+) per 1M tokens input<\/p>\s*<p>USD ([\d.]+) per 1M tokens output/g;
/** A priced cell's model name: the id in the table-header cell nearest before
    it. The ids are page-spelled (no org prefix); the id table maps them. */
const NAME =
  /data-dynamic-inner-content="description">\s*<p>([a-z0-9.-]{3,60})<\/p>/g;

export default {
  ids: ["watsonx"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out"],

  async read() {
    const html = await getText(URL, { headers: { accept: "text/html" } });
    /** Each pricing pair belongs to the nearest model-name cell before it —
        the page is a `<c4d-pricing-table>` web component, header cells and
        price cells alternating in document order. */
    const names = [...html.matchAll(NAME)].map((m) => ({ at: m.index, id: m[1] }));
    const rows = [];
    for (const m of html.matchAll(PAIR)) {
      const prior = names.filter((n) => n.at < m.index).at(-1);
      if (!prior) continue;
      const id = MODEL_IDS[prior.id];
      if (!id) drift(`a priced model the id table lacks: "${prior.id}"`);
      rows.push({ id, in: decimal(m[1]), out: decimal(m[2]) });
    }
    if (rows.length === 0) drift("no per-1M price pairs matched — the pricing page has been restructured");
    return { rows: { watsonx: rows } };
  },
};
