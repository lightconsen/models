/**
 * FriendliAI's prices, from its own public pricing feed — the JSON the
 * docs' pricing page itself renders from (`friendli.ai/api/public/model-apis`,
 * no key).
 *
 * One wrinkle the page makes visible and this file copies exactly: every rate
 * carries a `discountRate`, and the page displays the **adjusted** figure —
 * `amount * (1 - discountRate)`, rounded to six decimals — as the price. So a
 * listed input of 1.4 at a 10% discount is billed 1.26, and 1.26 is what this
 * records: the number the vendor charges, in the number of decimals the
 * vendor's own rounding produces. The discount itself has no field here; if it
 * is ever a billed fact the row needs a schedule for it, not a silent fold-in.
 *
 * Each model's `pricing.entries` is a tier matrix (context-length tiers by
 * service tier). The short-context standard row is the one this catalogue
 * prices, the same direction as everywhere else: the listed band is the one a
 * client that reads nothing else would charge.
 *
 * `rates.cachedInputPrice` is the cache-read rate; models without one are
 * carried without a cache_read. Audio-minute prices sit beside the token ones
 * on some models and have no field here — the token rates still carry them.
 */
import { drift, MEMBERSHIP } from "../lib/fetch.mjs";

const API = "https://friendli.ai/api/public/model-apis";

/** The page's own adjustment, reproduced to its rounding. */
const adjusted = (amount, discountRate) =>
  Math.round(Math.max(0, amount * (1 - (discountRate ?? 0))) * 1_000_000) / 1_000_000;

export default {
  ids: ["friendli"],
  source: API,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "context"],

  async read() {
    const res = await fetch(API, { headers: { "user-agent": "Mozilla/5.0 (compatible; kiwano-price-check)" } });
    if (!res.ok) drift(`${API}: HTTP ${res.status}`);
    const body = await res.json();
    const models = body?.modelApis;
    if (!Array.isArray(models) || models.length === 0) drift("the pricing feed returned no modelApis array");

    const rows = [];
    let skipped = 0;
    for (const m of models) {
      if (!(m?.outputModals ?? []).includes("TEXT")) { skipped++; continue; }
      const p = m.pricing ?? {};
      if (p.priceUnitType !== "TOKEN") { skipped++; continue; }
      // The short-context standard tier — the row whose rates a client that
      // reads nothing else would bill at.
      const entry = (p.entries ?? []).find((e) => (e?.dimensions?.contextLengthTier?.minInputTokens ?? 0) === 0);
      const r = entry?.rates ?? {};
      if (r.inputPrice == null || r.outputPrice == null) { skipped++; continue; }
      const row = {
        id: m.id,
        name: m.id,
        in: String(adjusted(r.inputPrice, p.discountRate)),
        out: String(adjusted(r.outputPrice, p.discountRate)),
        ...(r.cachedInputPrice != null ? { cache_read: String(adjusted(r.cachedInputPrice, p.discountRate)) } : {}),
        ...(Number.isInteger(m.contextLength) && m.contextLength > 0 ? { context: m.contextLength } : {}),
      };
      rows.push(row);
    }
    if (rows.length === 0) drift("no token-priced text rows in the pricing feed");
    return {
      rows: { friendli: rows },
      notes: { friendli: skipped ? [`${skipped} row(s) skipped — non-text output or not token-billed`] : [] },
    };
  },
};
