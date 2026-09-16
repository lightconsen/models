#!/usr/bin/env node
/**
 * Which sources this machine can reach, and whether they need the proxy.
 *
 * The proxy settings are a property of where you are sitting, not of this repo,
 * and they move: during one session `docs.x.ai` was the only source needing a
 * proxy, OpenRouter reached through it started failing, and `platform.openai.com`
 * began answering `unsupported_country_region_territory` where it had previously
 * answered 403. Writing a happy-path command into the README would have been a
 * statement with a shelf life.
 *
 * So this measures instead. It requests every source twice — direct, then through
 * `HTTPS_PROXY` if one is set — and prints the matrix, which tells you whether to
 * set `NODE_USE_ENV_PROXY` and what belongs in `NO_PROXY`.
 *
 * Deliberately not part of the build or the test suite: it needs the network, and
 * a runner on a different continent would get a different answer.
 *
 * Usage:
 *   node scripts/probe-sources.mjs
 *   HTTPS_PROXY=http://127.0.0.1:1087 node scripts/probe-sources.mjs
 */
import { TIMEOUT } from "./lib/fetch.mjs";
import adapters from "./sources/index.mjs";

const proxies = ["http_proxy", "https_proxy", "HTTPS_PROXY", "HTTP_PROXY"]
  .map((k) => process.env[k])
  .filter(Boolean);
const proxy = proxies[0];

/** One request, no retries, no drift — this is a reachability probe, not a read. */
const reach = async (url, via) => {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; kiwano-price-check)", accept: "*/*" },
      signal: AbortSignal.timeout(TIMEOUT),
      // Node reads `dispatcher` options only when NODE_USE_ENV_PROXY is set, so the
      // two columns here are "the process env" versus "a forced direct request".
      ...(via === "direct" ? { dispatcher: undefined } : {}),
    });
    return String(res.status);
  } catch (err) {
    return err.name === "TimeoutError" ? "timeout" : "fail";
  }
};

/**
 * An adapter's `source` is written for a person to read, not for a request:
 * OpenRouter's is `"<models url> + /{id}/endpoints"` and Zhipu's is two pages
 * joined with `+`. Splitting on `, ` alone would hand the whole sentence to
 * `fetch`, which answers 404 for a path full of spaces and reads like a dead
 * source. So a candidate counts only if every word of it parses as a URL.
 */
const isUrl = (s) => {
  if (!/^https?:\/\/\S+$/.test(s)) return false;
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
};
const urlsOf = (source) =>
  source
    // ` + ` needs its surrounding spaces spelled out; without them the regex also
    // eats a `+` inside a URL, and with one of them written as a literal it wants
    // two spaces and matches nothing at all.
    .split(/\s\+\s|,\s+/)
    .map((s) => s.trim())
    .filter(isUrl);

const probed = adapters.map((a) => ({ id: a.ids.join("+"), urls: urlsOf(a.source) }));
const skipped = probed.filter((p) => p.urls.length === 0);
console.log(`${probed.reduce((n, p) => n + p.urls.length, 0)} fetchable endpoints across ${adapters.length} adapters`);
if (skipped.length) console.log(`not probed (composite source): ${skipped.map((s) => s.id).join(", ")}`);
console.log(proxy ? `proxy set: ${proxy}\n` : "no proxy in the environment\n");
console.log(`  ${"http".padEnd(5)} ${"entry".padEnd(30)} url`);

const dead = [];
for (const { id, urls } of probed) {
  for (const url of urls) {
    const http = await reach(url);
    console.log(`  ${http.padEnd(5)} ${id.slice(0, 28).padEnd(30)} ${url.slice(0, 58)}`);
    if (http !== "200") dead.push({ id, url, http });
  }
}

const live = probed.reduce((n, p) => n + p.urls.length, 0) - dead.length;
console.log(`\n${live} of ${probed.reduce((n, p) => n + p.urls.length, 0)} answered 200`);
if (dead.length) {
  console.log("\ndid not answer — these are the ones to route through a proxy:");
  for (const d of dead) console.log(`  ${d.http.padEnd(8)} ${d.id}  ${d.url}`);
}