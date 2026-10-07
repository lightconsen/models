#!/usr/bin/env node
/**
 * The trust policy's boundaries, asserted rather than described.
 *
 * `test-validation.mjs` does this for the build validator by planting broken
 * entries and running it. The policy needs no fixtures — it is a pure function of
 * a change list — so this calls it directly and checks the edges, which are the
 * only part worth testing: the limits are what decide whether a run writes
 * unattended, and an off-by-one there is a silent loss of data.
 *
 * Since 2026-10-07 the limits are judged per entry, so half of these cases are
 * about what a *neighbour* does: one entry over the limit must not cost the
 * entry beside it its update.
 *
 * Usage: node scripts/test-policy.mjs
 */
import { LIMITS, RUN_LIMITS, isPriceField, judge, summarise } from "./lib/policy.mjs";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

/** One entry's change list, with n created, m deleted and k repriced rows. */
const entry = (id, created, deleted, updated = 0) => ({
  id,
  changes: {
    created: Array.from({ length: created }, (_, i) => `${id}-new-${i}`),
    deleted: Array.from({ length: deleted }, (_, i) => `${id}-old-${i}`),
    updated: Array.from({ length: updated }, (_, i) => ({ id: `${id}-m-${i}`, field: "in", from: "1", to: "2" })),
  },
});

/** The single-entry shape the limit cases read in. */
const churn = (created, deleted, updated = 0) => [entry("some-entry", created, deleted, updated)];

console.log("limits, per entry");
check("ten created is allowed", judge(churn(LIMITS.created, 0)).held.length, 0);
check("eleven created is not", judge(churn(LIMITS.created + 1, 0)).held.length, 1);
check("ten deleted is allowed", judge(churn(0, LIMITS.deleted)).held.length, 0);
check("eleven deleted is not", judge(churn(0, LIMITS.deleted + 1)).held.length, 1);

console.log("churn, per entry");
// Ten and ten passes both individual limits and is still twenty changes to read.
check("under both limits but over churn", judge(churn(10, 10)).held.length, 1);
check("exactly the churn limit is allowed", judge(churn(8, 7)).held.length, 0);
check("one over the churn limit is not", judge(churn(8, 8)).held.length, 1);

console.log("prices are never a reason to stop");
check("fifty price updates", judge(churn(0, 0, 50)).safe, true);
check("no changes at all", judge([]).safe, true);

console.log("one entry's churn is not another entry's problem");
// The three days this rule was written for: a reseller proposing 14 new models
// held every other entry's prices still.
const loud = judge([entry("openrouter", 14, 3), entry("anthropic", 1, 1), entry("deepinfra", 0, 0, 30)]);
check("the loud entry is held", loud.held.map((h) => h.entry), ["openrouter"]);
check("the quiet entries are written", loud.written.entries, ["anthropic", "deepinfra"]);
check("including the ones with prices only", loud.written.updated.length, 30);
check("the run still reports what it proposed", loud.created.length, 15);
check("and is not called safe", loud.safe, false);
check("a held entry writes nothing of its own", loud.written.created.map((c) => c.entry), ["anthropic"]);
check("two loud entries are both held", judge([entry("a", 11, 0), entry("b", 0, 11)]).held.map((h) => h.entry), ["a", "b"]);
check("and a run with nothing held is safe", judge([entry("a", 1, 1), entry("b", 0, 0, 5)]).safe, true);

console.log("the run-level ceiling");
// Nine in and three out clears every per-entry limit; five of those at once is
// a run-wide misread rather than five vendors' news.
const wide = (n) => Array.from({ length: n }, (_, i) => entry(`e${i}`, 9, 3));
check("one such entry passes", judge(wide(1)).systemic, false);
check("four of them still pass", judge(wide(4)).systemic, false);
check(`${Math.floor(RUN_LIMITS.created / 9) + 1} of them trip the run ceiling`, judge(wide(Math.floor(RUN_LIMITS.created / 9) + 1)).systemic, true);
check("and trip it above the per-entry limits", judge(wide(6)).held.length, 0);
check("a trip holds back everything", judge(wide(6)).written.entries, []);
check("nothing is written under a trip", judge(wide(6)).written.created.length, 0);

console.log("the reason is stated, not just the verdict");
check("a held entry names the number", /11 models created/.test(judge(churn(11, 0)).held[0].reasons.join(" ")), true);
check("a run ceiling names the run", /over the run limit/.test(judge(wide(6)).runReasons.join(" ")), true);

console.log("field classification");
check("in is a price", isPriceField("in"), true);
check("long_context is a price", isPriceField("long_context"), true);
check("serves is not", isPriceField("serves"), false);
check("flagship is not", isPriceField("flagship"), false);
check("name is not", isPriceField("name"), false);

console.log("summary");
check("counts what moved", summarise({ created: [1], deleted: [], updated: [1, 2, 3] }), "3 price(s), 1 new");
check("and says so when nothing did", summarise({ created: [], deleted: [], updated: [] }), "nothing");

console.log(`\n${failed === 0 ? "all policy cases pass" : `${failed} case(s) failed`}`);
process.exit(failed > 0 ? 1 : 0);
