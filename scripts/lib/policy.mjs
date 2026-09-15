/**
 * What a machine may change on its own, and what has to wait for a person.
 *
 * The two rules this replaces were ad hoc — never empty an entry, never remove
 * the row a `flagship` sits on — and both were written after the fact, each
 * discovered by nearly shipping the bug. They are right, and they are two
 * specific cases of one general rule that was never stated: **a price is a fact
 * and a membership change is a decision.**
 *
 * A vendor re-pricing a model is the source telling us something it is the
 * authority on, and there is no reason to make anyone look at it. A model
 * arriving or leaving is different: it changes what the catalogue says a vendor
 * offers, it is exactly where a source silently changing shape shows up, and it
 * is what went wrong twice in one session — an `intersect` adapter that had not
 * been taught to intersect offered to add 410 rows, and an aggregator about to
 * be trusted with prices reported values no upstream endpoint charged.
 *
 * So the limits below are not about fear of the vendors. They are the boundary
 * between "the source told us a number" and "the source told us what to be".
 */

export const LIMITS = {
  /** New models one run may bring into the catalogue, per entry and in total. */
  created: 10,
  /** Models one run may drop. Deleting is how a shape change destroys data. */
  deleted: 10,
  /** created + deleted. Catches the churn that neither count alone sees: ten in
      and ten out is twenty changes to read even though each limit passes. */
  churn: 15,
};

/**
 * Decide whether a set of entry changes may be applied unattended.
 *
 * Takes the merged results — each with its `changes` — and returns the verdict
 * plus the flat lists a commit message or a refusal message needs.
 */
export function judge(entries, limits = LIMITS) {
  const created = entries.flatMap((e) => e.changes.created.map((id) => ({ entry: e.id, id })));
  const deleted = entries.flatMap((e) => e.changes.deleted.map((id) => ({ entry: e.id, id })));
  const updated = entries.flatMap((e) => e.changes.updated.map((c) => ({ entry: e.id, ...c })));

  const reasons = [];
  if (created.length > limits.created) {
    reasons.push(`${created.length} models created, over the limit of ${limits.created}`);
  }
  if (deleted.length > limits.deleted) {
    reasons.push(`${deleted.length} models deleted, over the limit of ${limits.deleted}`);
  }
  if (created.length + deleted.length > limits.churn) {
    reasons.push(
      `${created.length + deleted.length} models created or deleted, over the churn limit of ${limits.churn}`,
    );
  }

  return { safe: reasons.length === 0, created, deleted, updated, reasons };
}

/** A one-line summary of what a run would do, for a commit subject. */
export function summarise(verdict) {
  const bits = [];
  if (verdict.updated.length) bits.push(`${verdict.updated.length} price(s)`);
  if (verdict.created.length) bits.push(`${verdict.created.length} new`);
  if (verdict.deleted.length) bits.push(`${verdict.deleted.length} gone`);
  return bits.length ? bits.join(", ") : "nothing";
}

export const isPriceField = (f) =>
  ["in", "out", "cache_read", "cache_creation", "long_context", "off_peak", "peak_hours"].includes(f);
