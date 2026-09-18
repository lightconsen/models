/**
 * One adapter per entry, for the providers whose own pages this machine cannot
 * read.
 *
 * Seven of the catalogue's inference hosts publish prices on JavaScript
 * applications or unreachable docs — groq.com/pricing ships a 10 KB shell with
 * no numbers in it, docs.tinker.thinkingmachines.ai drops TLS from this network
 * entirely. Hand-transcribing from what a *rendering* of the page shows is the
 * exact failure this fetch layer exists to prevent.
 *
 * So these read models.dev's public `api.json` instead — 221 providers and every
 * model's four rates in one request. Same posture `openai` took when its docs
 * were geoblocked, same caveat stated as loudly: **a third party's reading is a
 * weaker claim than the vendor's own page.** models.dev syncs from the vendor
 * APIs hourly; it is the best available transcription, not the primary source.
 *
 * One adapter *object per entry*, not one for all seven: a single adapter's
 * failure skips everything it feeds, and when the first run of this file tripped
 * on one mismatched id it reported six innocent entries as skipped. An id that
 * joins for Groq and not for Thinking Machines is the latter's problem alone.
 *
 * The join goes by the vendor's own string — models.dev keys by exactly that,
 * which is what `serves` carries — then by leaf and case-insensitively, because
 * `inkling` names `thinkingmachines/Inkling`. A row that still fails to join is
 * **reported and left alone**, never removed: `intersect` membership means a
 * model this source dropped says nothing about whether the vendor sells it.
 *
 * `openrouter` is deliberately not one of these — its models.dev data is
 * models.dev reading the same API this repo reads directly, and a copy of your
 * own numbers verifies nothing.
 */
import { getJson, drift, decimal, MEMBERSHIP, readEntry } from "../lib/fetch.mjs";

const URL = "https://models.dev/api.json";

/** entry id -> the provider key in models.dev's catalogue */
const PROVIDERS = {
  groq: "groq",
  cerebras: "cerebras",
  togetherai: "togetherai",
  "fireworks-ai": "fireworks-ai",
  upstage: "upstage",
  stepfun: "stepfun",
  // thinkingmachines is deliberately absent. Its models.dev rates (1.87/4.68)
  // contradict the same vendor's own numbers as reported by *three other
  // providers in that same file* — openrouter, fireworks and together all say
  // 1/4.05/0.17, which is what this entry carries. Whatever models.dev's
  // thinkingmachines key is measuring, it is not the API price, and reading it
  // back each run would just reopen a question this settles by consensus. The
  // runner names it every run as hand-maintained.
};

/** Strip a trailing release date: the catalogue sells `glm-5.2`, the snapshot
    lists spell `glm-5.2-04-2026`. Dates only — or `command-r` would eat
    `command-r-plus`. */
const undated = (id) => String(id).replace(/(?:-\d{2})?-\d{4}$/, "").replace(/-\d{8}$/, "");

const key = (id) => String(id).toLowerCase().replace(/[^a-z0-9]/g, "");
const leaf = (id) => String(id).split("/").pop();

/** models.dev's catalogue, fetched once no matter how many entries ask. */
let cache = null;
const catalogue = async () => {
  if (!cache) {
    const body = await getJson(URL);
    if (typeof body !== "object" || body === null) drift(`${URL}: not an object`);
    cache = Object.fromEntries(
      Object.entries(body).map(([provider, data]) => {
        const index = new Map();
        for (const [vendorId, model] of Object.entries(data?.models ?? {})) {
          for (const k of new Set([key(vendorId), key(leaf(vendorId)), key(undated(vendorId)), key(leaf(undated(vendorId)))])) {
            if (!index.has(k)) index.set(k, model);
          }
        }
        return [provider, index];
      }),
    );
  }
  return cache;
};

const price = (v) => (v === undefined || v === null ? undefined : decimal(String(v), "price"));

/** One entry's adapter: same shape for all seven, one provider key apart. */
const forEntry = (entry, providerKey) => ({
  ids: [entry],
  source: `${URL} (${providerKey})`,
  membership: MEMBERSHIP.INTERSECT,
  owns: ["in", "out", "cache_read", "cache_creation"],

  async read() {
    const index = (await catalogue())[providerKey];
    if (!index) drift(`models.dev has no provider "${providerKey}" (entry ${entry})`);
    const current = readEntry(entry).models;

    const lookup = (row) => {
      const claims = [
        ...Object.values(row.serves ?? {}),
        row.id,
        undated(row.id),
        ...Object.values(row.serves ?? {}).map(undated),
      ];
      for (const c of claims) {
        const hit = index.get(key(c)) ?? index.get(key(leaf(c))) ?? index.get(key(undated(leaf(c))));
        if (hit) return hit;
      }
      return undefined;
    };

    const rows = [];
    const missed = [];
    for (const row of current) {
      const hit = lookup(row);
      if (!hit) {
        missed.push(row.id);
        continue;
      }
      const c = hit.cost ?? {};
      const out = { id: row.id };
      for (const [field, value] of [
        ["in", c.input],
        ["out", c.output],
        ["cache_read", c.cache_read],
        ["cache_creation", c.cache_write],
      ]) {
        const v = price(value);
        if (v !== undefined) out[field] = v;
      }
      rows.push(out);
    }
    if (rows.length === 0) drift(`none of ${entry}'s ${current.length} rows join models.dev's "${providerKey}"`);

    const note = `${rows.length}/${current.length} rows priced by models.dev — a third-party reading, not the vendor's page`;
    return {
      rows: { [entry]: rows },
      notes: { [entry]: missed.length ? [`${note}; not found there: ${missed.join(", ")} (left as they are)`] : [note] },
    };
  },
});

export default Object.entries(PROVIDERS).map(([entry, key]) => forEntry(entry, key));
