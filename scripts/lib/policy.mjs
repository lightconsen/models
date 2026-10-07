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
 *
 * **Judged per entry, not per run.** The first version summed every entry's
 * churn and refused the whole run when the total went over — which meant one
 * talkative reseller held the entire catalogue's prices still: from 2026-09-25
 * to 2026-10-07 every daily run refused, 25 models created and 22 gone across
 * five entries, while anthropic's own `claude-sonnet-5 -> claude-sonnet-5-5`
 * rename sat in the same refused list. A source that changes shape does so
 * inside one entry; the entries beside it have nothing to do with it. So an
 * entry over the limit is *held back* — nothing written for it, including its
 * prices, because a source that just showed us a shape change is exactly the
 * source whose numbers we are least sure of — and every other entry is written
 * as usual.
 *
 * The run-level ceiling stays, at limits an individual entry cannot reach on
 * its own: it fires when the *whole run* looks wrong (a shared helper broken,
 * every adapter misreading), and there refusing everything is the point. It is
 * the one case where one entry's problem is genuinely evidence about the rest.
 */

export const LIMITS = {
  /** New models one entry may bring into the catalogue in one run. */
  created: 10,
  /** Models one entry may drop. Deleting is how a shape change destroys data. */
  deleted: 10,
  /** created + deleted, per entry. Catches the churn that neither count alone
      sees: ten in and ten out is twenty changes to read even though each limit
      passes. */
  churn: 15,
};

/** The run-level ceiling. Set where no honest day reaches it — an entry may
    propose at most `LIMITS.created` + `LIMITS.deleted`, so passing these means
    a great many entries changed shape at once, which is what a run-wide misread
    looks like. When it fires, nothing is written. */
export const RUN_LIMITS = {
  created: 40,
  deleted: 40,
  churn: 60,
};

/**
 * Judge one entry's changes against the per-entry limits.
 *
 * Returns the verdict plus the flat lists a commit message or a refusal message
 * needs: `created` / `deleted` carry `{entry, id}`, `updated` carries the field
 * change the diff shows.
 */
export function judgeEntry(entry, limits = LIMITS) {
  const created = entry.changes.created.map((id) => ({ entry: entry.id, id }));
  const deleted = entry.changes.deleted.map((id) => ({ entry: entry.id, id }));
  const updated = entry.changes.updated.map((c) => ({ entry: entry.id, ...c }));

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

  return { entry: entry.id, safe: reasons.length === 0, created, deleted, updated, reasons };
}

/**
 * Judge a whole run, one entry at a time.
 *
 * `held` is what a person has to look at; `written` is what the run may apply.
 * The top-level `created` / `deleted` / `updated` stay the totals the run
 * *proposed*, because that is what the run's own summary line reports — what it
 * will actually write is `written`, and the two differ exactly by `held`.
 */
export function judge(entries, limits = LIMITS, runLimits = RUN_LIMITS) {
  const judged = entries.map((e) => judgeEntry(e, limits));
  const passed = judged.filter((j) => j.safe);
  const held = judged.filter((j) => !j.safe);

  const flat = (list, field) => list.flatMap((j) => j[field]);
  const totals = (list) => ({
    created: flat(list, "created"),
    deleted: flat(list, "deleted"),
    updated: flat(list, "updated"),
  });

  const proposed = totals(judged);
  const writable = totals(passed);

  // The run-level ceiling, applied to what would be written rather than to what
  // was proposed: the entries already held back are a person's problem, not
  // evidence about the run.
  const runReasons = [];
  if (writable.created.length > runLimits.created) {
    runReasons.push(`${writable.created.length} models created across the run, over the run limit of ${runLimits.created}`);
  }
  if (writable.deleted.length > runLimits.deleted) {
    runReasons.push(`${writable.deleted.length} models deleted across the run, over the run limit of ${runLimits.deleted}`);
  }
  if (writable.created.length + writable.deleted.length > runLimits.churn) {
    runReasons.push(
      `${writable.created.length + writable.deleted.length} models created or deleted across the run, over the run churn limit of ${runLimits.churn}`,
    );
  }

  // A run-level trip writes nothing at all: every entry is held, including the
  // ones that passed on their own. `held` stays the per-entry list, because it
  // is what the refusal block prints per entry — under a trip the reason is the
  // run's, and it is printed once.
  const systemic = runReasons.length > 0;
  const none = { entries: [], created: [], deleted: [], updated: [] };

  return {
    judged,
    passed,
    held,
    safe: held.length === 0 && !systemic,
    systemic,
    runReasons,
    ...proposed,
    written: systemic ? none : { entries: passed.map((j) => j.entry), ...writable },
    reasons: [...runReasons, ...held.flatMap((j) => j.reasons)],
  };
}

/** A one-line summary of what a set of changes does, for a commit subject. */
export function summarise(verdict) {
  const bits = [];
  if (verdict.updated.length) bits.push(`${verdict.updated.length} price(s)`);
  if (verdict.created.length) bits.push(`${verdict.created.length} new`);
  if (verdict.deleted.length) bits.push(`${verdict.deleted.length} gone`);
  return bits.length ? bits.join(", ") : "nothing";
}

/** The fields a source may emit: the price fields, and — since the 2026-09-23
    API-backed adapters — the capability fields a vendor's own models API can
    publish (length limits and feature flags). The merge still enforces `owns`,
    so nothing travels unless the adapter claims it. */
export const isPriceField = (f) =>
  [
    "in", "out", "cache_read", "cache_creation", "long_context", "off_peak", "peak_hours", "batch", "service_tier",
    "context", "max_output", "reasoning", "tool_call", "structured_output", "temperature",
  ].includes(f);
