#!/usr/bin/env node
/**
 * The parsing helpers that have bitten, asserted with the markup that bit them.
 *
 * `test-policy.mjs` covers the runner's judgement and `test-validation.mjs` the
 * build's rules. This covers the seam between a source's markup and the numbers
 * that come out of it, which is where the failures are quietest: a parser that
 * reads half a cell returns a plausible row, the merge compares only the fields
 * the proposal carries, and the run reports `no change`. Both cases below did
 * exactly that before they were fixed, and neither announced itself.
 *
 * The fixtures are copied from the live pages, markup and all, because the
 * markup *is* the bug in both of them.
 *
 * Usage: node scripts/test-sources.mjs
 */
import { ratesIn } from "./sources/google-gemini.mjs";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`,
  );
};

const at = (day) => new Date(`${day}T00:00:00Z`);

console.log("google-gemini: a rate that changes on a stated date");
const dated =
  "<td>$0.75 through December 31, 2026.<br>$1.50 starting January 1, 2027.</td>";
check("in force before the change", ratesIn(dated, at("2026-09-17")), { now: "0.75" });
check("still in force on the last day", ratesIn(dated, at("2026-12-31")), { now: "0.75" });
check("switched on the first day", ratesIn(dated, at("2027-01-01")), { now: "1.50" });

console.log("google-gemini: a rate that changes with the request length");
// The whole point: `<=` here is a literal less-than, and `<br>` is a tag. A
// tag pattern of `<[^>]*>` matches from the `<` of `<=` to the `>` of `<br>` and
// eats the first band, price and all — leaving `$2.00, prompts $4.00, prompts >
// 200k tokens`, which still yields a plain rate and so still looks like success.
const banded = "<td>$2.00, prompts <= 200k tokens<br>$4.00, prompts > 200k tokens</td>";
check("reads both bands", ratesIn(banded, at("2026-09-17")), {
  now: "2.00",
  over: 200000,
  above: "4.00",
});
check("and the same shape with a storage price after it", ratesIn(
  "<td>$0.20, prompts <= 200k tokens<br>$0.40, prompts > 200k $4.50 / 1,000,000 tokens per hour</td>",
  at("2026-09-17"),
), { now: "0.20", over: 200000, above: "0.40" });

console.log("google-gemini: the shapes that carry no qualifier");
check("a plain rate", ratesIn("<td>$1.50</td>", at("2026-09-17")), { now: "1.50" });
check("a rate naming its modalities", ratesIn("<td>$0.30 (text / image / video / audio)</td>", at("2026-09-17")), {
  now: "0.30",
});
check("free of charge has no rate", ratesIn("<td>Free of charge</td>", at("2026-09-17")), undefined);

console.log(`\n${failed === 0 ? "all source-parsing cases pass" : `${failed} case(s) failed`}`);
process.exit(failed > 0 ? 1 : 0);
