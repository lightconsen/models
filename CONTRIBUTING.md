# Contributing to the Kiwano Hub data

The catalogue prices every model from the **vendor's own pages** — that is the
whole discipline here, and it is what a contribution is judged against. The
README documents the full schema and the seven-step recipe for a new provider;
this file is the shorter version for the three kinds of contribution that make
a difference, and the review standard each one meets.

## What the repo is

`entries/<id>/{provider.json, models.json}` is the source of truth for one
provider; `scripts/generate.mjs` validates and publishes `dist/`; adapters in
`scripts/sources/*.mjs` re-read each vendor's own price page daily
(`node scripts/fetch-all.mjs` prints what would change, `--write` applies it).
`checklist.md` is the ledger: one row per provider, ticked only when checked
against the vendor itself.

## The three contributions that help

**1. Verify a seeded entry (the most valuable one).** 18 entries are marked
`seeded` — their prices came from a third-party database, not the vendor, and
each waits for someone to read the vendor's own pages. The bar is low and the
value is high:

- Open the vendor's price page (not models.dev, not OpenRouter — the vendor).
- Compare every seeded row: model id, input, output, cache rates.
- If they match: tick the checklist row, date it, state what you checked. Keep
  the `seeded` flag off the entry only if **every** row verified.
- If they differ: correct the rows to the vendor's figures and say what moved.

**2. Add a missing provider.** The README's "Adding a provider" section walks
it: `provider.json` + `models.json` + a logo + a checklist row. Cite the page
each price came from — a number with no source in the PR description is the
one thing review will bounce. If the vendor publishes a machine-readable
price page, say so: the next step after merge is an adapter (see any file in
`scripts/sources/` — `deepinfra.mjs` is the smallest complete example), and a
PR that includes one is very welcome.

**3. Fix a drift you spotted.** A vendor changed a price and the daily run has
not caught it, or the run is failing on a reshaped page. Run
`node scripts/fetch-all.mjs --entry <id>` and paste its diff into the PR —
the pipeline, not a hand edit, is what applies it.

## What will not merge

- Prices from an aggregator. models.dev and OpenRouter are useful for *finding*
  a vendor and for cross-checking, never for a committed number. (OpenRouter's
  own entry prices from its upstream endpoints' modal price — its aggregate is
  no source either.)
- A capability flag written `false` because a capability list omitted it.
  Absent means the vendor does not say; `false` claims the vendor published a
  no, and only an explicit negation earns one.
- A model id invented from a model name. The id is the string the API
  accepts — if you cannot show it from the vendor's docs, leave the row out.
- Numbers pasted without a citation. Every checklist row names its source
  pages; a PR description that names none reads as unverified.

## PR mechanics

- `validate` runs on every PR: schema validation plus a dry-run build. It must
  pass; the output is the first thing review reads.
- One logical change per PR: a new provider, one entry's verification, one
  adapter. The daily pipeline commits one entry per commit — a PR that mixes
  a new entry with an unrelated reprice is two PRs.
- Bump `global.json`'s `version` only if a price moved (the gate exists so
  clients can skip unchanged tables); the pipeline bumps it automatically when
  run with `--write`.
- Do not edit `dist/` — it is generated and gitignored; CI rebuilds it.
