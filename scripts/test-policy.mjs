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
 * Usage: node scripts/test-policy.mjs
 */
import { LIMITS, isPriceField, judge, summarise } from "./lib/policy.mjs";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

/** A change list of n created and m deleted, on one entry. */
const churn = (created, deleted, updated = 0) => [
  {
    id: "some-entry",
    changes: {
      created: Array.from({ length: created }, (_, i) => `new-${i}`),
      deleted: Array.from({ length: deleted }, (_, i) => `old-${i}`),
      updated: Array.from({ length: updated }, (_, i) => ({ id: `m-${i}`, field: "in", from: "1", to: "2" })),
    },
  },
];

console.log("limits");
check("ten created is allowed", judge(churn(LIMITS.created, 0)).safe, true);
check("eleven created is not", judge(churn(LIMITS.created + 1, 0)).safe, false);
check("ten deleted is allowed", judge(churn(0, LIMITS.deleted)).safe, true);
check("eleven deleted is not", judge(churn(0, LIMITS.deleted + 1)).safe, false);

console.log("churn");
// Ten and ten passes both individual limits and is still twenty changes to read.
check("under both limits but over churn", judge(churn(10, 10)).safe, false);
check("exactly the churn limit is allowed", judge(churn(8, 7)).safe, true);
check("one over the churn limit is not", judge(churn(8, 8)).safe, false);

console.log("prices are never a reason to stop");
check("fifty price updates", judge(churn(0, 0, 50)).safe, true);
check("no changes at all", judge([]).safe, true);

console.log("the reason is stated, not just the verdict");
check("a refusal names the number", judge(churn(20, 0)).reasons.length > 0, true);
check("and the count it saw", /20 models created/.test(judge(churn(20, 0)).reasons.join(" ")), true);

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
