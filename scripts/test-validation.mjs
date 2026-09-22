#!/usr/bin/env node
/**
 * Tests for the structural rules (spec.local.md §10.1).
 *
 * Each case plants one deliberately broken entry under entries/, runs
 * `generate.mjs --check`, and asserts it fails with a message about that rule —
 * then removes the entry. A validator that only ever passes is untested, and
 * these rules exist to catch real authoring mistakes rather than to decorate the
 * build log.
 *
 * One case is not a failure. Two providers pricing one model differently used to
 * be a build error and is now published with a warning, so that case asserts
 * success plus the warning. It is here because it is the rule that changed, and
 * a warning nobody asserts is a warning that quietly disappears.
 *
 * Run: node scripts/test-validation.mjs
 */
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prefix = "zz-validation-test";

const provider = (id, over = {}) => ({
  id,
  name: `Test ${id}`,
  // Shape only — the validator checks that a website parses as http(s), not that
  // it answers, so a reserved TLD keeps these tests off the network.
  website: "https://example.invalid",
  tag: "third",
  rating: 4,
  billing: "payg",
  currency: "USD",
  endpoints: [{ protocol: "openai", endpoint: "https://example.invalid" }],
  ...over,
});

const CASES = [
  {
    rule: "1 — serves names a protocol this provider has no endpoint for",
    provider: provider(`${prefix}-serves-proto`),
    models: [{ id: "m1", in: "1", out: "1", name: "M1", serves: { gemini: "m1" } }],
    expect: /serves names protocol "gemini"/,
  },
  {
    rule: "2 — serves must not be empty (a model nothing serves)",
    provider: provider(`${prefix}-empty-serves`),
    models: [{ id: "m1", in: "1", out: "1", name: "M1", serves: {} }],
    expect: /serves must not be empty/,
  },
  {
    rule: "3 — one endpoint per protocol",
    provider: provider(`${prefix}-dup-proto`, {
      endpoints: [
        { protocol: "openai", endpoint: "https://example.invalid" },
        { protocol: "openai", endpoint: "https://example.invalid/v2" },
      ],
    }),
    models: [],
    expect: /duplicate protocol "openai"/,
  },
  {
    rule: "extra — an endpoint protocol outside the allowed set",
    provider: provider(`${prefix}-vertex-protocol`, {
      endpoints: [{ protocol: "vertex", endpoint: "https://example.invalid" }],
    }),
    models: [],
    expect: /endpoint protocol "vertex" not one of anthropic\|openai\|gemini/,
  },
  {
    rule: "4 — at most one flagship per provider",
    provider: provider(`${prefix}-two-flagship`),
    models: [
      { id: "m1", in: "1", out: "1", name: "M1", flagship: true },
      { id: "m2", in: "2", out: "2", name: "M2", flagship: true },
    ],
    expect: /models are flagged flagship/,
  },
  {
    rule: "5a — flagship must be a priced model",
    provider: provider(`${prefix}-unpriced-flagship`),
    models: [
      { id: "m1", in: "1", out: "1", name: "M1" },
      { id: "m2", name: "M2", flagship: true },
    ],
    expect: /flagship "m2" must be a priced model/,
  },
  {
    rule: "5b — a priced model needs a name (it becomes display_name)",
    provider: provider(`${prefix}-priced-no-name`),
    models: [{ id: "m1", in: "1", out: "1" }],
    expect: /a priced model needs a name/,
  },
  {
    rule: "extra — in/out come together",
    provider: provider(`${prefix}-half-priced`),
    models: [{ id: "m1", in: "1", name: "M1" }],
    expect: /in and out come together/,
  },
  {
    rule: "extra — a price row may not carry a currency",
    provider: provider(`${prefix}-row-currency`),
    models: [{ id: "m1", in: "1", out: "1", name: "M1", currency: "USD" }],
    expect: /must not carry a currency/,
  },
  {
    rule: "extra — a time-of-day discount needs the hours it applies to",
    provider: provider(`${prefix}-offpeak-alone`),
    models: [{ id: "m1", in: "2", out: "8", name: "M1", off_peak: { in: "1", out: "4" } }],
    expect: /off_peak and peak_hours come together/,
  },
  {
    rule: "extra — peak_hours needs the provider's billing clock",
    provider: provider(`${prefix}-no-tz`),
    models: [
      {
        id: "m1",
        in: "2",
        out: "8",
        name: "M1",
        off_peak: { in: "1", out: "4" },
        peak_hours: { windows: [{ days: ["mon"], start: "09:00", end: "12:00" }] },
      },
    ],
    expect: /peak_hours\.tz_offset must be an integer/,
  },
  {
    rule: "extra — a peak window does not wrap midnight",
    provider: provider(`${prefix}-wrapping-window`),
    models: [
      {
        id: "m1",
        in: "2",
        out: "8",
        name: "M1",
        off_peak: { in: "1", out: "4" },
        peak_hours: { tz_offset: 480, windows: [{ days: ["mon"], start: "22:00", end: "02:00" }] },
      },
    ],
    expect: /must end after it starts/,
  },
  {
    rule: "extra — website must be an http(s) URL",
    provider: provider(`${prefix}-bad-website`, { website: "example.com" }),
    models: [],
    expect: /website "example\.com" must be an http\(s\) URL/,
  },
  {
    rule: "extra — website is required",
    provider: provider(`${prefix}-no-website`, { website: undefined }),
    models: [],
    expect: /missing\/empty website/,
  },
  {
    rule: "extra — a leftover price.json means the directory was never migrated",
    provider: provider(`${prefix}-leftover-price`),
    models: [],
    priceFile: [],
    expect: /price\.json: this file was replaced by models\.json/,
  },
  {
    rule: "extra — models.json is required",
    provider: provider(`${prefix}-no-models`),
    models: null,
    expect: /models\.json: missing/,
  },
  {
    rule: "extra — an unknown billing tag is rejected, and the message names them all",
    provider: provider(`${prefix}-bad-billing`, { billing: "per-token" }),
    models: [],
    expect: /billing "per-token" not one of plan\|payg\|unl\|both/,
  },
  {
    rule: "extra — plan_query must be an object",
    provider: provider(`${prefix}-plan-query-shape`, { plan_query: "kimi" }),
    models: [],
    expect: /plan_query must be an object/,
  },
  {
    rule: "extra — plan_query.template must be a non-empty string",
    provider: provider(`${prefix}-plan-query-empty`, { plan_query: { template: "" } }),
    models: [],
    expect: /plan_query\.template must be a non-empty string/,
  },
  {
    rule: "extra — plan_query carries the template id and nothing else",
    provider: provider(`${prefix}-plan-query-extra`, { plan_query: { template: "kimi", api_key: "sk-x" } }),
    models: [],
    expect: /plan_query has unknown key "api_key"/,
  },
  {
    rule: "extra — long_context must be an object of price fields",
    provider: provider(`${prefix}-lc-shape`),
    models: [{ id: "m1", name: "M1", in: "1", out: "2", long_context: "4.20" }],
    expect: /long_context must be an object of price fields/,
  },
  {
    rule: "extra — long_context.over must be a positive whole number of tokens",
    provider: provider(`${prefix}-lc-over`),
    models: [{ id: "m1", name: "M1", in: "1", out: "2", long_context: { over: "512k", in: "2", out: "4" } }],
    expect: /long_context\.over must be a positive whole number/,
  },
  {
    rule: "extra — long_context needs in and out, like the row itself",
    provider: provider(`${prefix}-lc-rates`),
    models: [{ id: "m1", name: "M1", in: "1", out: "2", long_context: { over: 512000, in: "2" } }],
    expect: /long_context needs in and out/,
  },
  {
    rule: "extra — long_context needs the row's own price first",
    provider: provider(`${prefix}-lc-unpriced`),
    models: [{ id: "m1", long_context: { over: 512000, in: "2", out: "4" } }],
    expect: /long_context needs the row's own price first/,
  },
  {
    rule: "extra — long_context carries rates and the threshold, nothing else",
    provider: provider(`${prefix}-lc-extra`),
    models: [{ id: "m1", name: "M1", in: "1", out: "2", long_context: { over: 512000, in: "2", out: "4", note: "x" } }],
    expect: /long_context has unknown field "note"/,
  },
  {
    rule: "changed — two providers may price one model differently (published, warned)",
    provider: provider(`${prefix}-divergent-a`),
    // Named to sort first. The detail list is capped at ten and sorted by model
    // id, so a planted model that sorts late is not named once the real catalogue
    // has ten divergences of its own — which it has since the 2026-09-22 seed
    // batch, whose duplicates start with uppercase (`ByteDance-Seed/…`) and sort
    // before any lowercase name. The digit prefix beats them all. The id is
    // deliberately silly; please leave it that way.
    models: [{ id: "0-shared-model", name: "Shared", in: "1", out: "2" }],
    extra: {
      provider: provider(`${prefix}-divergent-b`),
      models: [{ id: "0-shared-model", name: "Shared", in: "3", out: "4" }],
    },
    expectCode: 0,
    // The summary line, then the detail naming the model — both on stderr.
    expectWarn: /priced differently by different providers[\s\S]*0-shared-model/,
  },
  {
    rule: "extra — `both` is a billing mode (one address, two arrangements)",
    provider: provider(`${prefix}-billing-both`, { billing: "both" }),
    models: [],
    expectCode: 0,
  },
  {
    rule: "changed — a template this build does not know is warned about, not rejected",
    provider: provider(`${prefix}-plan-query-unknown`, { plan_query: { template: "nosuchvendor" } }),
    models: [],
    expectCode: 0,
    expectWarn: /plan_query template "nosuchvendor" is not one the app knows/,
  },
  {
    rule: "extra — context/max_output must be a positive whole number of tokens",
    provider: provider(`${prefix}-context-frac`),
    models: [{ id: "m1", in: "1", out: "1", name: "M1", context: 1.5 }],
    expect: /context must be a positive whole number of tokens/,
  },
  {
    rule: "extra — context/max_output reject zero and negatives",
    provider: provider(`${prefix}-context-zero`),
    models: [{ id: "m1", in: "1", out: "1", name: "M1", max_output: 0 }],
    expect: /max_output must be a positive whole number of tokens/,
  },
  {
    rule: "extra — a capability flag must be boolean",
    provider: provider(`${prefix}-reasoning-str`),
    models: [{ id: "m1", in: "1", out: "1", name: "M1", reasoning: "yes" }],
    expect: /reasoning must be boolean/,
  },
  {
    rule: "extra — capability fields publish only on a priced row (warned, not rejected)",
    provider: provider(`${prefix}-caps-unpriced`),
    models: [{ id: "m1", name: "M1", reasoning: true }],
    expectCode: 0,
    expectWarn: /capability fields on an unpriced row/,
  },
  {
    rule: "extra — a seeded entry may ship with no endpoints (Tier C relaxation)",
    provider: provider(`${prefix}-seeded-no-endpoints`, { seeded: true, endpoints: [] }),
    models: [{ id: "m1", in: "1", out: "1", name: "M1" }],
    expectCode: 0,
  },
  {
    rule: "extra — seeded must be boolean",
    provider: provider(`${prefix}-seeded-str`, { seeded: "yes" }),
    models: [],
    expect: /seeded must be boolean/,
  },
];

/// Entries planted by the case in flight, removed before the next one starts.
/// Cases are isolated rather than accumulated: a case that expects the build to
/// *succeed* cannot do so while the previous case's broken entry is still on
/// disk, and a case's output reads better when it is the only thing planted.
let created = [];
/// Every entry this run planted, for the summary — `created` is emptied as it
/// is cleaned up.
let planted = 0;
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  process.exitCode = 1;
};
const cleanUp = () => {
  for (const dir of created) if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  created = [];
};

try {
  for (const c of CASES) {
    // Most cases are one planted entry; a divergence needs two, since the rule
    // is about what two entries say together.
    const entries = [{ provider: c.provider, models: c.models, priceFile: c.priceFile }];
    if (c.extra) entries.push(c.extra);
    try {
      for (const p of entries) {
        const dir = path.join(repo, "entries", p.provider.id);
        mkdirSync(dir, { recursive: true });
        created.push(dir);
        planted += 1;
        writeFileSync(path.join(dir, "provider.json"), JSON.stringify(p.provider, null, 2) + "\n");
        writeFileSync(path.join(dir, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
        if (p.models !== null) writeFileSync(path.join(dir, "models.json"), JSON.stringify(p.models, null, 2) + "\n");
        if (p.priceFile !== undefined) writeFileSync(path.join(dir, "price.json"), JSON.stringify(p.priceFile, null, 2) + "\n");
      }

      // spawnSync rather than execFileSync: a case that is expected to succeed
      // still has to be read for its warning, and a warning goes to stderr,
      // which execFileSync drops on the happy path.
      const res = spawnSync(process.execPath, [path.join(repo, "scripts", "generate.mjs"), "--check"], {
        cwd: repo,
        encoding: "utf8",
      });
      const code = res.status ?? 1;
      const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;

      const wantCode = c.expectCode ?? 1;
      const matched = c.expect === undefined || c.expect.test(out);
      const warned = c.expectWarn === undefined || c.expectWarn.test(out);
      if (code !== wantCode) fail(`${c.rule}: expected exit ${wantCode}, got ${code}\n${out.trim()}`);
      else if (!matched) fail(`${c.rule}: failed as expected but the message did not match ${c.expect}\n${out.trim()}`);
      else if (!warned) fail(`${c.rule}: succeeded but the warning did not match ${c.expectWarn}\n${out.trim()}`);
      else console.log(`  ✓ ${c.rule}`);
    } finally {
      cleanUp();
    }
  }
} finally {
  // Safety net for a case that threw before its own cleanup ran.
  cleanUp();
  console.log(`\ncleaned up ${planted} test entr(ies)`);
}

if (process.exitCode) console.error("\nFAIL — at least one rule does not behave as documented");
else console.log("PASS — every rule rejects its bad input, and the changed one warns");
