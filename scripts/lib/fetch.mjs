/**
 * The plumbing every `fetch-*` script had been copying.
 *
 * Six scripts each carried their own `stop()`, their own `argOf()`, their own
 * repo-root line, and two of them carried byte-identical copies of `perMillion`
 * with a comment asking that they be kept in step. This is that code, once.
 *
 * The one thing genuinely new here is the error type. The old scripts called
 * `stop()`, which exits the process — fine when a script reads one source, wrong
 * now that one program reads a dozen. A source that has changed shape should take
 * its own entry down and leave the rest alone, so drift is thrown, not exited on,
 * and the caller decides what a failure costs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The vendors vary in what they serve a bot; this string keeps them consistent. */
export const UA = "Mozilla/5.0 (compatible; kiwano-price-check)";

/** Long enough for a slow docs host, short enough that a dead one cannot hang the run. */
export const TIMEOUT = 20_000;

/** A source that no longer looks like the shape its adapter knows. */
export class Drift extends Error {}

export const drift = (msg) => {
  throw new Drift(msg);
};

/** `--flag value`, or the fallback. */
export const argOf = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

export const has = (name) => process.argv.includes(name);

/**
 * Fetch, or drift. Node's fetch has no timeout of its own and the vendor docs
 * hosts do go quiet, so every request is bounded.
 *
 * Note for whoever runs this on a machine behind one: Node's fetch ignores
 * `http_proxy`/`https_proxy` unless the process is started with
 * `NODE_USE_ENV_PROXY=1`. `curl` honours them by default, so a source that works
 * from the shell can still fail here — that difference is worth knowing before
 * concluding a vendor has started blocking us.
 */
export const get = async (url, { headers = {}, timeout = TIMEOUT } = {}) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": UA, ...headers } });
    if (!res.ok) drift(`${url}: HTTP ${res.status}`);
    return res;
  } catch (err) {
    if (err instanceof Drift) throw err;
    if (err.name === "AbortError") drift(`${url}: no response in ${timeout / 1000}s`);
    drift(`${url}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
};

export const getText = async (url, opts) => (await get(url, opts)).text();

export const getJson = async (url, opts) => {
  const res = await get(url, { headers: { accept: "application/json", ...opts?.headers }, ...opts });
  try {
    return await res.json();
  } catch (err) {
    drift(`${url}: the response is not JSON (${err.message})`);
  }
};

/** A plain decimal, however the vendor spelled the currency around it. */
export const decimal = (s, what = "price") => {
  const v = String(s).trim().replace(/^[¥$]\s*/, "");
  if (!/^\d+(\.\d+)?$/.test(v)) drift(`"${s}" is not a plain decimal ${what}`);
  return v;
};

/** Per-token USD decimal -> per-million, moving the point in the string.
    Arithmetic would carry float noise: 0.00000003 * 1_000_000 is not 0.03.
    The digits are the integer `whole+frac`, and the point moves `frac.length - 6`
    places from its right — which is why a short fraction gains zeros (`0.00001`
    becomes `10`, not `1`). */
export const perMillion = (s) => {
  const v = decimal(s, "per-token price");
  const [whole, frac = ""] = v.split(".");
  const digits = (whole + frac).replace(/^0+/, "");
  if (digits === "") return "0";
  const k = frac.length - 6;
  const out = k <= 0
    ? digits + "0".repeat(-k)
    : digits.length > k
      ? `${digits.slice(0, digits.length - k)}.${digits.slice(digits.length - k)}`
      : `0.${"0".repeat(k - digits.length)}${digits}`;
  return out.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

/**
 * The two ways a source can decide which models an entry holds.
 *
 * `follow` — the source is the list. A model it drops leaves the entry, a model
 * it adds joins it. Right for a vendor pricing its own catalogue: the page is a
 * complete statement of what they sell.
 *
 * `intersect` — the source only prices what something else already chose. An
 * entry can be a deliberate selection from a much larger catalogue, and letting
 * the price list decide membership would replace twenty curated rows with four
 * hundred. Right for an aggregator, whose catalogue is other people's models.
 */
export const MEMBERSHIP = { FOLLOW: "follow", INTERSECT: "intersect" };

export const readEntry = (id) => {
  const modelsPath = path.join(repo, `entries/${id}/models.json`);
  return {
    modelsPath,
    prov: JSON.parse(readFileSync(path.join(repo, `entries/${id}/provider.json`), "utf8")),
    models: JSON.parse(readFileSync(modelsPath, "utf8")),
  };
};
