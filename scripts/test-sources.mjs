#!/usr/bin/env node
/**
 * The parsing helpers that have bitten, asserted with the text that bit them.
 *
 * `test-policy.mjs` covers the runner's judgement and `test-validation.mjs` the
 * build's rules. This covers the seam between a source and the numbers that come
 * out of it, which is where failures are quietest: a parser that reads half a
 * cell returns a plausible row, the merge compares only the fields the proposal
 * carries, and the run reports `no change`. Every case below did exactly that
 * before it was fixed, and none of them announced itself.
 *
 * The fixtures are copied from the live page, character for character — the
 * trailing spaces and the awkward line breaks included, because they are what the
 * parser actually has to survive.
 *
 * Usage: node scripts/test-sources.mjs
 */
import { ratesIn } from "./sources/google-gemini.mjs";
import { slug } from "./sources/cohere.mjs";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`,
  );
};

const at = (day) => new Date(`${day}T00:00:00Z`);
const now = at("2026-09-17");

console.log("a rate that changes on a stated date");
// Verbatim from the page, trailing spaces and all: two dates in one cell, and
// the schema has nowhere to put the second. Reading the one in force is the whole
// reason this adapter exists.
const dated = "$0.75 through December 31, 2026.    $1.50 starting January 1, 2027.";
check("in force before the change", ratesIn(dated, at("2026-09-17")), { now: "0.75" });
check("still in force on the last day", ratesIn(dated, at("2026-12-31")), { now: "0.75" });
check("switched on the first day", ratesIn(dated, at("2027-01-01")), { now: "1.50" });

console.log("a rate that changes with the request length");
// Price first, band second — `$2.00, prompts <= 200k tokens` then
// `$4.00, prompts > 200k tokens`. A pattern looking for a price *after* the band
// finds nothing, falls through to the first number, and returns a plausible
// `{now}` with no band at all. The entry's `long_context` is then never compared,
// so the run says `no change` while reading half the row.
const banded = "$2.00, prompts <= 200k tokens    $4.00, prompts > 200k tokens";
check("reads both bands", ratesIn(banded, now), { now: "2.00", over: 200000, above: "4.00" });
check("and when a storage price follows the second", ratesIn(
  "$0.20, prompts <= 200k tokens    $0.40, prompts > 200k $4.50 / 1,000,000 tokens per hour (storage price)",
  now,
), { now: "0.20", over: 200000, above: "0.40" });
check("a megabyte band sizes the same way", ratesIn(
  "$1.00, prompts <= 1M tokens    $2.00, prompts > 1M tokens",
  now,
), { now: "1.00", over: 1000000, above: "2.00" });
// The second band is written without the unit in places; the first always has it.
check("reads it when the upper band drops the unit", ratesIn(
  "$12.00, prompts <= 200k tokens    $18.00, prompts > 200k",
  now,
), { now: "12.00", over: 200000, above: "18.00" });

console.log("the shapes that carry no qualifier");
check("a plain rate", ratesIn("$1.50", now), { now: "1.50" });
check("a rate naming its modalities", ratesIn("$0.30 (text / image / video / audio)", now), { now: "0.30" });
check("free of charge has no rate", ratesIn("Free of charge", now), undefined);
check("so does a missing row", ratesIn("", now), undefined);

console.log("cohere: a display name is the only id the payload carries");
// The CMS data holds `Command R7B` and no API id, so the entry's id is derived.
// `+` is the case that matters: `Command A+` slugged naively is `command-a`,
// which is a *different* model in the same family.
check("a plain name", slug("Command R"), "command-r");
check("digits run together", slug("Command R7B"), "command-r7b");
check("a plus becomes a word", slug("Command A+"), "command-a-plus");
check("and is not confused with its sibling", slug("Command A+") === slug("Command A"), false);
check("punctuation collapses", slug("Embed  4.0"), "embed-4-0");

console.log(`\n${failed === 0 ? "all source-parsing cases pass" : `${failed} case(s) failed`}`);
process.exit(failed > 0 ? 1 : 0);
