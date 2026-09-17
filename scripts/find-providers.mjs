#!/usr/bin/env node
/**
 * What exists out there, and how much of it this catalogue carries.
 *
 * "Find every LLM" has no complete answer, and the reason is worth stating before
 * the tool: **every list is a list of what its author routes.** OpenRouter returns
 * 444 models and Vercel's gateway 374, and the two are not subsets of each other —
 * each sees only its own upstreams. So the practical move is to union several
 * enumerations and then do the part that is actually hard, which is not finding
 * names but sorting them: a lab that trains its own models, a cloud that hosts
 * other people's, and a gateway that resells both are three different things, and
 * only the first belongs in this catalogue by its own scope rule.
 *
 * The classification leans on a signal models.dev publishes and most lists do not:
 * a `labs/` directory separate from `providers/`. Twenty-three labs against 221
 * providers — the first is the answer to "who trains models", the second to "who
 * sells inference", and conflating them is how a provider count ends up looking
 * like a lab count. Three of the labs have no plain provider key at all, Tencent
 * among them, because its entries are all plans.
 *
 * **Coverage is the hard part and no signal for it is clean**, which is worth
 * knowing before reading the output as a to-do list:
 *
 *   - by model id it is worse than useless — an id appears under every provider
 *     that resells it, so NVIDIA looked carried because its catalogue includes
 *     `deepseek-v4-pro` and `minimax-m3`, and Meta looked carried because
 *     `openrouter` resells Muse Spark;
 *   - by domain it misses the vendors that spell themselves differently in two
 *     places — `moonshot.cn` here against `moonshot.ai` there — so the first
 *     label is tried as well;
 *   - and it still misses what does not correspond at all, which is itself worth
 *     seeing: `alibaba` stays on the list because this catalogue files it as
 *     `qianwenai` at `qianwenai.com`, a name and a site the vendor does not use.
 *
 * So the output is a set of **candidates with their evidence** — site, model
 * count, whether models.dev calls it a lab — for a person to judge. It errs toward
 * showing a provider we already carry rather than hiding one we do not: a name in
 * a report costs a glance, a missing one is never noticed.
 *
 * Usage:
 *   node scripts/find-providers.mjs
 *   node scripts/find-providers.mjs --all      list every uncovered provider, not the top 20
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { argOf, getJson, has, repo } from "./lib/fetch.mjs";

const MD = "https://models.dev/api.json";
const GATEWAYS = {
  openrouter: "https://openrouter.ai/api/v1/models",
  vercel: "https://ai-gateway.vercel.sh/v1/models",
};

/** Everything but the letters and digits, so `MiniMax-M3` and `minimax-m3` meet. */
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/** The last path segment of an id, for `minimax/minimax-m3` -> `minimax-m3`. */
const leaf = (id) => String(id).split("/").pop();

/**
 * An id with its release date shorn off.
 *
 * The two sides spell the same model differently and neither is wrong: this
 * catalogue carries the alias a vendor documents (`command-a-plus`) while
 * models.dev carries the dated snapshot (`command-a-plus-05-2026`), which is why
 * Cohere first came back as a lab we do not carry after we had just added it.
 *
 * Trailing dates only, and that matters — a loose prefix rule would equate
 * `command-r` with `command-r-plus-08-2024`, which is a different model.
 */
const undated = (id) => String(id).replace(/(?:-\d{2})?-\d{4}$/, "").replace(/-\d{8}$/, "");

/** The registrable domain of a URL, so `platform.openai.com` meets `openai.com`. */
const domainOf = (url) => {
  try {
    const host = new URL(url).hostname.replace(/^(www|docs|platform|api|console|portal)\./, "");
    return host.split(".").slice(-2).join(".");
  } catch {
    return null;
  }
};

/** The label before the TLD, which survives a `.cn`/`.ai` mismatch. */
const labelOf = (d) => (d ? d.split(".")[0] : null);

/**
 * The vendors this catalogue carries, by identity.
 *
 * **Not by model id, which was the first attempt and does not work.** Overlap
 * looked like the strong signal — if a provider serves a model we carry, surely we
 * know about it — and it is the weakest one: an id appears under every provider
 * that resells it, so `nvidia` came back covered because NVIDIA's catalogue
 * includes `deepseek-v4-pro`, `glm-5.2` and `minimax-m3` alongside its own
 * hardware, and `meta` looked covered before that because `openrouter` resells
 * Muse Spark. A signal that a reseller satisfies is not a signal about the vendor.
 *
 * So identity it is: the registrable domain of the site we list against the one
 * models.dev documents, with the entry's own id as a fallback for a vendor whose
 * docs live somewhere else. It is a heuristic and it errs toward listing a
 * provider we already carry rather than hiding one we do not, which is the right
 * direction — a name in a report is cheap to dismiss, a missing one is not
 * noticed.
 */
const catalogue = () => {
  const byDomain = new Map();
  const byId = new Map();
  // Model ids are kept for the gateway section only, which asks a different
  // question — "do we price this model" rather than "do we carry this vendor" —
  // and for which overlap is the right signal, since a model id is the same
  // string everywhere it is served.
  const modelIds = new Set();
  for (const entry of readdirSync(path.join(repo, "entries"))) {
    let provider;
    try {
      provider = JSON.parse(readFileSync(path.join(repo, "entries", entry, "provider.json"), "utf8"));
    } catch {
      continue;
    }
    try {
      for (const m of JSON.parse(readFileSync(path.join(repo, "entries", entry, "models.json"), "utf8"))) {
        if (m?.id) {
          modelIds.add(norm(m.id));
          modelIds.add(norm(undated(m.id)));
        }
      }
    } catch {
      /* an entry with no readable models.json still counts by identity */
    }
    const d = domainOf(provider?.website ?? "");
    if (d) {
      byDomain.set(d, entry);
      // And the first label on its own, because the same company lists as
      // `moonshot.cn` here and `moonshot.ai` there.
      byDomain.set(d.split(".")[0], entry);
    }
    byId.set(norm(entry), entry);
  }
  return { byDomain, byId, modelIds };
};

/** The labs, which are the providers that train rather than resell. */
const labs = async () => {
  try {
    const res = await getJson(
      "https://api.github.com/repos/anomalyco/models.dev/contents/labs?ref=dev",
      { headers: { accept: "application/vnd.github+json" } },
    );
    return new Set((Array.isArray(res) ? res : []).filter((e) => e.type === "dir").map((e) => e.name));
  } catch {
    // Without it the run still works; it just cannot tell a lab from a reseller,
    // which is the one thing here worth having. Said out loud rather than hidden.
    console.log("  ! could not read models.dev/labs — labs will not be distinguished\n");
    return new Set();
  }
};

const md = await getJson(MD);
if (typeof md !== "object" || md === null) throw new Error(`${MD} did not return an object`);

const known = catalogue();
const labSet = await labs();

const rows = [];
for (const [key, provider] of Object.entries(md)) {
  const d = domainOf(provider?.doc ?? "");
  const covered =
    (d ? known.byDomain.get(d) : null) ??
    (d ? known.byDomain.get(labelOf(d)) : null) ??
    known.byId.get(norm(key)) ??
    // Some vendors key their provider by product rather than company — `zhipuai`
    // for Zhipu, `moonshotai` for Moonshot — so a substring either way counts.
    [...known.byId.entries()].find(([id]) => id.length > 4 && (key.includes(id) || id.includes(key)))?.[1] ??
    null;
  rows.push({
    key,
    name: provider?.name ?? key,
    site: d ?? "",
    models: Object.keys(provider?.models ?? {}).length,
    kind: labSet.has(key) ? "lab" : "provider",
    covered,
  });
}

console.log(`${Object.keys(md).length} providers in models.dev — ${rows.filter((r) => r.kind === "lab").length} labs, ${rows.filter((r) => r.kind === "provider").length} others`);
console.log(`matched ${rows.filter((r) => r.covered).length} of them to an entry, by domain or by name\n`);

const show = (title, list) => {
  if (list.length === 0) return;
  console.log(`═══ ${title} (${list.length})`);
  const shown = has("--all") ? list : list.slice(0, 20);
  for (const r of shown) {
    console.log(`  ${r.key.padEnd(26)} ${String(r.models).padStart(4)} models  ${(r.site || "—").padEnd(22)} ${r.name.slice(0, 24)}`);
  }
  if (shown.length < list.length) console.log(`  … ${list.length - shown.length} more (--all)`);
  console.log();
};

const uncovered = rows.filter((r) => !r.covered);
show("Labs we do not carry", uncovered.filter((r) => r.kind === "lab").sort((a, b) => b.models - a.models));
show("Other providers we do not carry", uncovered.filter((r) => r.kind === "provider").sort((a, b) => b.models - a.models));

// The second axis: what the gateways route that models.dev does not list at all.
// They see upstreams models.dev never enumerated, so a model here is not
// necessarily a provider we are missing — it is one nobody's list has.
for (const [name, url] of Object.entries(GATEWAYS)) {
  let list;
  try {
    const body = await getJson(url);
    list = (Array.isArray(body) ? body : body?.data ?? []).map((m) => m.id ?? m.name).filter(Boolean);
  } catch (err) {
    console.log(`═══ ${name}: unreadable (${err.message})\n`);
    continue;
  }
  const unseen = list.filter((id) => !known.modelIds.has(norm(leaf(id))) && !known.modelIds.has(norm(undated(leaf(id)))));
  console.log(`═══ ${name}: ${list.length} models, ${list.length - unseen.length} of them in this catalogue, ${unseen.length} not`);
  const shown = has("--all") ? unseen : unseen.slice(0, 8);
  for (const id of shown) console.log(`  ${id}`);
  if (shown.length < unseen.length) console.log(`  … ${unseen.length - shown.length} more (--all)`);
  console.log();
}
