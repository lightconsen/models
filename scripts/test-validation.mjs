#!/usr/bin/env node
/**
 * Failure-path tests for the structural rules (spec.local.md §10.1).
 *
 * Each case plants one deliberately broken entry under entries/, runs
 * `generate.mjs --check`, and asserts it fails with a message about that rule —
 * then removes the entry. A validator that only ever passes is untested, and
 * these rules exist to catch real authoring mistakes rather than to decorate the
 * build log.
 *
 * Run: node scripts/test-validation.mjs
 */
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
];

const created = [];
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  process.exitCode = 1;
};

try {
  for (const c of CASES) {
    const dir = path.join(repo, "entries", c.provider.id);
    mkdirSync(dir, { recursive: true });
    created.push(dir);
    writeFileSync(path.join(dir, "provider.json"), JSON.stringify(c.provider, null, 2) + "\n");
    writeFileSync(path.join(dir, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
    if (c.models !== null) writeFileSync(path.join(dir, "models.json"), JSON.stringify(c.models, null, 2) + "\n");
    if (c.priceFile !== undefined) writeFileSync(path.join(dir, "price.json"), JSON.stringify(c.priceFile, null, 2) + "\n");

    let out = "";
    let code = 0;
    try {
      out = execFileSync(process.execPath, [path.join(repo, "scripts", "generate.mjs"), "--check"], {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      code = err.status ?? 1;
      out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    const matched = c.expect.test(out);
    if (code !== 1) fail(`${c.rule}: expected exit 1, got ${code}`);
    else if (!matched) fail(`${c.rule}: failed as expected but the message did not match ${c.expect}\n${out.trim()}`);
    else console.log(`  ✓ ${c.rule}`);
  }
} finally {
  for (const dir of created) if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  console.log(`\ncleaned up ${created.length} test entr(ies)`);
}

if (process.exitCode) console.error("\nFAIL — at least one rule is not enforced as documented");
else console.log("PASS — every rule rejects its bad input with exit code 1");
