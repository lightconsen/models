#!/usr/bin/env node
/**
 * Read an Alibaba Cloud model platform's own model list and show what it would
 * change.
 *
 * The other fetch scripts read a published price table. This one reads a model
 * *list*, and it exists because these entries' lists were written by hand from
 * whatever a page happened to show: `bailian-token-plan` carried four of the
 * thirteen its endpoint serves. Every host in this family answers
 * `/compatible-mode/v1/models` with the ids it will accept, which is the
 * authority, so there is no reason to guess.
 *
 * Which entry it checks is decided by the key, not by an argument. A key file
 * carries the base URL it is meant for, so the script matches that host against
 * the entries and checks the one it belongs to — a key only answers for its own
 * plan. `--entry` overrides that when the host matches nothing.
 *
 * A key is required and never printed or written, for the same reason
 * `plan_query` never carries credentials: it is the user's, not the catalogue's.
 *
 * Two things to know before trusting the output. The endpoint returns bare ids
 * with no modality, so deciding which are text models is a name heuristic —
 * `-image`, `-audio`, `-tts`, `-realtime` are read as something else and listed
 * separately rather than dropped quietly. And `--write` refuses an entry whose
 * rows carry prices: the API list has none, so replacing the file wholesale would
 * delete them. Those entries get the diff only, to be edited by hand.
 *
 * Usage:
 *   node scripts/fetch-aliyun-models.mjs --key-file ~/.claude/settings.token.json
 *   node scripts/fetch-aliyun-models.mjs --key-file … --entry qwencloud-token-plan
 *   node scripts/fetch-aliyun-models.mjs --key-file … --write
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRITE = process.argv.includes("--write");
const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const KEY_FILE = argOf("--key-file");
const ENTRY = argOf("--entry");

const stop = (msg) => {
  console.error(`✗ ${msg}`);
  console.error("  Nothing was written.");
  process.exit(1);
};

// ── the key, and the entry it belongs to ──
const settings = KEY_FILE
  ? (() => {
      try {
        return JSON.parse(readFileSync(KEY_FILE.replace(/^~(?=\/)/, process.env.HOME ?? "~"), "utf8"));
      } catch (err) {
        stop(`could not read ${KEY_FILE}: ${err.message}`);
      }
    })()
  : null;
const env = settings?.env ?? {};
const apiKey = (process.env.ALIYUN_API_KEY ?? env.ANTHROPIC_AUTH_TOKEN ?? env.OPENAI_API_KEY ?? "").trim();
if (!apiKey) stop("no key — set ALIYUN_API_KEY, or pass --key-file with .env.ANTHROPIC_AUTH_TOKEN");

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

const entriesDir = path.join(repo, "entries");
const entries = readdirSync(entriesDir)
  .filter((d) => statSync(path.join(entriesDir, d)).isDirectory())
  .map((id) => ({ id, provider: JSON.parse(readFileSync(path.join(entriesDir, id, "provider.json"), "utf8")) }));

let target = ENTRY ? entries.find((e) => e.id === ENTRY) : null;
if (ENTRY && !target) stop(`no entry "${ENTRY}"`);

if (!target) {
  const keyHost = hostOf(env.ANTHROPIC_BASE_URL ?? env.OPENAI_BASE_URL ?? "");
  if (!keyHost) stop("the key file carries no base URL, so the entry cannot be guessed — pass --entry");
  target = entries.find((e) => e.provider.endpoints.some((x) => hostOf(x.endpoint) === keyHost));
  if (!target) stop(`no entry has an endpoint on ${keyHost} — pass --entry`);
  console.log(`the key's base URL names ${keyHost}, which is ${target.id}\n`);
}

// ── the list, from the host that serves it ──
const host = hostOf(target.provider.endpoints[0].endpoint);
if (!host) stop(`${target.id}: first endpoint is not a URL`);
const url = `https://${host}/compatible-mode/v1/models`;
const res = await fetch(url, { headers: { accept: "application/json", authorization: `Bearer ${apiKey}` } });
if (res.status === 401 || res.status === 403) stop(`${url}: HTTP ${res.status} — the key is not accepted there`);
if (res.status === 404) stop(`${url}: HTTP 404 — this host has no compatible-mode model list`);
if (!res.ok) stop(`${url}: HTTP ${res.status}`);
const body = await res.json();
const all = (Array.isArray(body) ? body : body?.data ?? []).map((m) => String(m?.id ?? "")).filter(Boolean);
if (all.length === 0) stop("the response listed no models");

// No modality in the payload, so this is a guess and is shown as one.
const NOT_TEXT = /-image|-audio|-tts|-realtime|-video/i;
const served = all.filter((id) => !NOT_TEXT.test(id));
const skipped = all.filter((id) => NOT_TEXT.test(id));

console.log(`${url}\n  ${all.length} models: ${served.length} text, ${skipped.length} not`);
if (skipped.length) console.log(`  set aside by name: ${skipped.join(", ")}\n`);

// ── what the entry says ──
const modelsPath = path.join(repo, `entries/${target.id}/models.json`);
const current = JSON.parse(readFileSync(modelsPath, "utf8"));
const upstreams = (r) => [r.id, ...Object.values(r.serves ?? {})];
const rowFor = (id) => current.find((r) => upstreams(r).includes(id));

const missing = served.filter((id) => !rowFor(id));
const stale = current.filter((r) => !upstreams(r).some((u) => served.includes(u)));

console.log(`${target.id}: ${current.length} rows`);
for (const id of missing) console.log(`  + ${id} is served but not listed`);
for (const r of stale) console.log(`  - ${r.id} is listed but not served (${upstreams(r).join(", ")})`);
if (missing.length + stale.length === 0) console.log("  ✓ the same models, both ways");

const priced = current.filter((r) => r.in !== undefined);
if (!WRITE) process.exit(0);

if (priced.length) {
  stop(`${target.id} prices ${priced.length} row(s); the API list carries no prices, so writing it would drop them. Add the ids by hand.`);
}

// A row the entry already has keeps its own keys and order, so a hand-written
// name survives. A new one gets an id and nothing else: `name` is optional while
// a row is unpriced, and inventing one here would spell brands wrong
// (`deepseek-v4.1-flash` is not "Deepseek V4.1 Flash").
const rows = served.map((id) => {
  const now = rowFor(id);
  return now ? { ...now } : { id };
});
writeFileSync(modelsPath, JSON.stringify(rows, null, 2) + "\n");
console.log(`\n✓ wrote entries/${target.id}/models.json — ${current.length} rows -> ${rows.length}`);
if (missing.length) console.log(`  ${missing.length} added without a name — optional while a row is unpriced`);
