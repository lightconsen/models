# models — Kiwano Hub data

Source of truth for the Kiwano app's two remote data files. Hand-edit here,
CI validates + builds + publishes to Cloudflare R2; the app fetches at runtime
(fully offline-fallbackable to its bundled snapshots).

## Layout

```
entries/
  <id>/provider.json   the stable half: one directory per model provider;
                       adding a provider = creating one new directory (id must
                       match the directory name). Identity, protocols, billing.
                       Its `currency` is the one the provider bills in
                       (default USD when omitted)
  <id>/models.json     the volatile half: every model this provider serves,
                       prices inline. Repricing, new models and retirements
                       touch only this file. Rows carry no currency: the
                       provider's applies
  <id>/logo.<ext>      provider logo (required; png|svg|jpg|jpeg|webp),
                       published to R2 under logos/<id>.<ext>
global.json            exchange rates + the vendor pricing no entry owns
                       (version-gated). These rows keep their own `currency`,
                       being shared across providers
news/<id>.json         model news — one file per notice, each naming a
                       (provider, model) pair; the file name is the id.
                       Published whole as dist/news.json
scripts/
  generate.mjs         validate + build dist/ artifacts (zero dependencies)
  migrate-v2.mjs       one-shot: the old provider.json + price.json layout ->
                       provider.json + models.json (already run)
  verify-migration.mjs acceptance gate: dist/ against a pre-migration snapshot
  test-validation.mjs  failure-path tests for the validation rules
.github/workflows/
  validate.yml         PR gate: validation + dry-run build
  publish.yml          main push: build + upload to R2
```

The split is by how often each half changes: a vendor's endpoint, protocols and
billing are near-static, while prices move constantly. Keeping them apart means a
repricing PR touches no identity data, and vice versa.

## Adding a provider

A provider is **one directory + one `provider.json` + one `models.json` + one
logo file**. The directory name is the `id`, and the `id` field inside must equal
it exactly.

1. Create `entries/<id>/provider.json` from the first template below.
2. Add a logo file `entries/<id>/logo.<ext>` (`png` | `svg` | `jpg` | `jpeg` |
   `webp`). It is **required** and published to R2 as `logos/<id>.<ext>` —
   see [Logo](#logo).
3. Add `entries/<id>/models.json` listing every model this provider serves,
   prices inline — `[]` when it serves none yet. It is **required** —
   see [Models and pricing](#models-and-pricing).
4. Open a PR — `validate` checks the schema + builds a dry run.
5. Merge to `main` — `publish` uploads `catalog.json` / `models.json` /
   `news.json` / `manifest.json` and `logos/` to the R2 bucket root.

### Template

```jsonc
// entries/<id>/provider.json — stable: identity, protocols, billing
{
  "id": "example",              // must equal the directory name
  "name": "Example AI",
  "logo_color": "#3B82F6",      // fallback avatar background (hex). Hand-picked
                                // on purpose — brand colours are the point, so
                                // it is NOT derived. `logo_char` is derived
                                // from `name` at build time and not stored
  "tag": "third",               // official | third | aggregate | local | free
  "rating": 4,                  // number 0..5
  "billing": "payg",            // plan | payg | unl
  "currency": "USD",            // what this provider bills in; default USD.
                                // Its model rows, and the spending limit the app
                                // offers, are both denominated in it
  "endpoints": [                // required, at least one. The FIRST is the
                                // primary protocol; each protocol may appear once
    { "protocol": "openai",    "endpoint": "https://api.example.com/v1" },
    { "protocol": "anthropic", "endpoint": "https://api.example.com" }
  ],

  // ── optional ─────────────────────────────────────────────────────────
  "desc": "Upstream price · 12.4k users"   // one line of prose, shown on the
                                           // provider's row and detail card
}
```

```jsonc
// entries/<id>/models.json — volatile: one record per model, prices inline
[
  // Priced: `in` + `out` together mean "this model is priced".
  { "id": "example-1", "name": "Example One",
    "in": "3", "out": "15", "cache_read": "0.30" },

  // Unpriced: no `in`/`out`. It still shows in the app's model list.
  { "id": "claude-opus-5", "name": "Claude Opus 5",
    "serves": { "anthropic": "anthropic/claude-opus-5" } },

  // Served by every endpoint, under its own id — `serves` is omitted.
  { "id": "example-2", "name": "Example Two", "in": "1", "out": "5",
    "flagship": true }
]
```

Three things about `models.json` that are easy to get wrong:

- **`id` is the canonical pricing key**, not necessarily the string the API
  accepts. `dist/models.json` is keyed by it, so the same model resold by several
  providers must use the same id — that is what makes price drift detectable.
- **`serves` carries the upstream string**, per protocol, when it differs from
  `id` (OpenRouter wants `openai/gpt-5.2` where the canonical key is `gpt-5.2`).
  Omit it entirely to mean "every endpoint serves this, under its own id".
- **`cache_creation` is optional and means `0` when absent** — most providers
  charge nothing for cache writes. Write it only when it is non-zero.
- **`flagship: true`** marks the one model whose price represents this provider
  on the Models list (at most one per provider, and it must be priced). It is a
  curation decision, not a derived value: the first pass flagged, for each of the
  71 providers with priced models, the one with the **highest output price**
  (ties by input price, then id) — which lands on the model a vendor is known for
  in most cases. Worth a human look wherever it is the *only* priced model and
  that model is a small or coding variant (`google-ai-studio` → `gemini-3.6-flash`,
  `kimi` → `kimi-k2.7-code`): pricing a bigger sibling would represent the
  provider better.

## Logo

Each provider ships a logo **file** at `entries/<id>/logo.<ext>` — one of
`png`, `svg`, `jpg`, `jpeg`, or `webp` (case-insensitive base name, extension
decides the R2 content type). It is **required**: `generate.mjs` fails if a
provider has no logo file, or more than one.

On publish, the logo is uploaded to R2 at `logos/<id>.<ext>`, and the catalog
entry exposes a relative `logo` field:

```json
{ "id": "example", "logo": "logos/example.png" }
```

The app builds the full URL from its `hub_url` setting
(`https://hub.kiwano.cc/logos/example.png`). When the image can't load — or the
app has never synced and is showing its bundled snapshot — it falls back to a
letter avatar: `logo_char` (derived from `name` at build time) on `logo_color`
(authored, so brand colours survive).

### Legibility on dark backgrounds

The app renders the logo as a plain `<img>` on both the light and the dark
theme, so artwork that is black on a transparent background simply disappears
in dark mode. Two cases account for nearly all of it:

- An SVG painted with `currentColor`. Inline that resolves to the surrounding
  text colour, but a standalone file loaded through `<img>` has no CSS context
  and resolves to black.
- An SVG whose elements carry no `fill` at all, which also defaults to black.

The fix is a white rounded rectangle as the **first** child of `<svg>`, so
everything else paints on top of it:

```xml
<rect data-kw-bg="1" x="0" y="0" width="24" height="24" rx="5.28" fill="#FFFFFF"/>
```

Size it from the `viewBox`, with `rx` at roughly 22% of the shorter side
(24 → 5.28, 512 → 112.64). The `data-kw-bg` marker is only there so the edit is
idempotent.

Check before adding one — two kinds of logo need nothing:

- those that **already ship their own background** (a full-canvas dark rect, so
  the white one would be covered and dead), and
- those whose mark is **light or coloured** rather than black, which are
  perfectly legible as-is.

The reliable test is to render the file on a `#141414` page through `<img>` —
static analysis of `fill` attributes misjudges both of those cases (it counts a
background rect as artwork, and misses colours that come from `<style>` blocks
or gradients).

### Formerly `icon`

`provider.json` used to carry an optional `icon` — a legacy key into the app's
bundled icon registry (`../app/src/components/icons/`). It was a second icon
system running alongside the logo files and has been **removed**: the logo file
covers it. The registry's dark-theme variants are the one thing it carried that
a logo file does not — those belong inside the logo artwork, the same way the
white tiles were added for black marks.

## Models and pricing

`entries/<id>/models.json` is both the model list and the price list — one
record per model:

```jsonc
[
  {
    "id": "claude-opus-5",     // canonical key; also what dist/models.json is keyed by
    "name": "Claude Opus 5",   // optional; required when priced (it becomes display_name)
    "in": "5",                 // provider currency per million tokens, TEXT decimal
    "out": "25",
    "cache_read": "0.50",      // optional, 0 when absent
    "cache_creation": "6.25",  // optional, 0 when absent (most providers charge nothing)
    "flagship": true           // optional: the model whose price represents this provider
  }
]
```

**Presence of `in`/`out` is the price flag.** A model without them is declared but
unpriced — the app lists it and shows no cost rather than a wrong one. `[]` is
valid and means the provider serves no models yet.

Rows carry **no currency**: the provider's `currency` applies, and `generate.mjs`
stamps it into every published row of `dist/models.json` (so the app-side table
keeps its per-row currency). Listing one fails validation — two places to
disagree is exactly what this layout removes. `global.json` rows are the
exception: they are shared across providers, so each keeps its own `currency`.

### One model, several providers

Aggregators resell the same vendor models, so an `id` may legitimately appear in
several `models.json` files. The copies must be **identical**: the validator
fails on drift, because the published table keeps one row per `id` and which copy
won would otherwise depend on merge order.

Vendor pricing that no entry owns (the OpenAI/Anthropic/Google list prices for
models no directory declares) stays in `global.json`.

### What gets published

`generate.mjs` merges the priced rows of every `models.json` with the rows still
in `global.json` into `dist/models.json` — the same flat global `model_id ->
price` table as before. The app's `PricingTable` has no provider dimension (it
looks prices up by model id alone), so this split is a source-layout change and
nothing more.

## Model news (`news/`)

A notice that the app can surface as an in-app feed item: "provider X has model
Y". Every notice names **both** — `provider_id` and `model_id` — because the
pair is what makes it actionable: the app shows the model on that provider's
row and routes the call to action from that entry.

**One file per notice**, `news/<id>.json`. Two people adding news touch
different files, so they never conflict on a shared array — the same reason a
provider is a directory rather than a row.

```jsonc
// news/anthropic-claude-opus-5.json
{
  // No "id" field: the file name IS the id, and it is what the app stores
  // "dismissed" under. Repeating it here would be a second place to disagree —
  // the same reason price rows carry no currency. Renaming the file re-shows
  // the item to everyone who closed it, so treat the name as permanent.
  "kind": "new_model",          // new_model | free | discount | announce
  "provider_id": "anthropic",   // must be a directory in entries/
  "model_id": "claude-opus-5",  // must be a model that provider serves
  "released": "2026-09-08",     // YYYY-MM-DD, the day the model became usable
  "title": "Claude Opus 5 is live on Anthropic",   // ≤ 80 chars
  "body": "…",                                     // ≤ 300 chars
  "badge": "NEW",               // optional, ≤ 8 chars
  "priority": 90,               // optional integer; higher shows first
  "expires_at": "2026-10-08",   // optional; after `released`, not before
  "url": "https://…"            // optional; announcement page, not a signup
}
```

The file name must be lowercase `[a-z0-9.-]`, 3–64 chars, so it is a legal id
everywhere. An empty `news/` is valid and means "no news". Non-JSON files are
reported and skipped; dotfiles (macOS `.DS_Store`) are skipped silently.

To retire a notice, **delete its file**. `dist/news.json` is rebuilt from what
is in `news/`, so deletion is the only pruning mechanism — see below for why
there is deliberately no age filter.

### What "that provider serves it" means

`generate.mjs` fails unless `model_id` is one the entry actually serves, matched
**case-insensitively** against the union of every model's `id` and every upstream
string in its `serves`. Either spelling works, because you may think of the model
by either name.

This check is what stops "OpenAI 的 claude-opus-5" from ever publishing. To
announce a model the entry does not carry yet, add it to `models.json` in the
same PR.

### Ordering

`dist/news.json` is written by `priority` descending, then `released`
descending, then `id` — so several live notices have a deterministic display
order, and the newest release wins a tie. Each published item carries its `id`
folded in from the file name, which the source file does not have.

### Why nothing expires at build time

A notice's age is **not** a build-time filter, and cannot be. `publish.yml`
runs on push to `main` only — there is no schedule. So "keep the last 3 days"
would mean "the last 3 days *as of whenever someone last pushed*": merge on the
1st and nothing rebuilds, so on the 5th clients still receive the 1st's news.
An item would disappear based on when the next commit landed, not on the
calendar.

It would also break the artifact's determinism. Age-filtered output makes the
same commit build differently tomorrow, so the manifest's `news.sha256` would
move with nothing changed and every PR's `--check` would depend on the day.

Age is the client's call: the app knows what "today" is, and the build does
not. `generate.mjs` publishes **everything in `news/`**, and the app hides what
it has already shown or what `expires_at` has passed. Nothing consumes the feed
yet — that is a separate app-side change.

For the same reason the file carries **no `generated_at`** (unlike
`dist/models.json`): a date stamp would move the hash daily and make every
client re-download an unchanged feed. The manifest keeps the timestamp.

## Data domains (enforced by generate.mjs)

**`provider.json`**

- `name`: non-empty string. `logo_char` is derived from it; `logo_color` is
  hand-picked and must be `#RRGGBB`
- `tag`: `official | third | aggregate | local | free`. `tag_label` is derived
  from it — do not look for it in the source
- `rating`: number `0..5`
- `billing`: `plan | payg | unl` — one entry per billing mode
- `endpoints`: non-empty array of `{protocol, endpoint}`; `protocol` is
  `anthropic | openai | gemini` and may not repeat. **The first is the primary
  protocol** — it supplies the app's `endpoint` / `protocol` / `models`
- `currency`: an `exchange_rates` key; **omitted means USD**. It is what the
  provider's prices and its spending limit are denominated in, so an unknown
  code fails validation rather than leaving the limit unmeasurable
- `desc`: optional; one line of prose
- `logo`: derived, not authored — `entries/<id>/logo.<ext>` must exist and is
  published as `logos/<id>.<ext>`

**`models.json`**

- array of model records (may be `[]`). `id` is required and unique within the
  file; `name` is required whenever the model is priced (it becomes
  `display_name` in `dist/models.json`, which the app requires)
- `in` / `out`: non-negative decimals, and they come **together** — their
  presence is the price flag
- `cache_read` / `cache_creation`: optional non-negative decimals, `0` when
  absent
- `serves`: optional `{protocol: upstream string}`; every protocol must exist in
  `endpoints`, the object must not be empty, and **omitting it means every
  endpoint serves the model under its own `id`**
- `flagship`: optional boolean, at most one per provider, and that model must be
  priced
- no `currency` on a record — the provider's applies. No drift between files for
  a shared `id`, currency included, so the same model priced in USD by one
  provider and CNY by another is a conflict

**`global.json`**

- `exchange_rates`: units per 1 USD, `USD` pinned to `1`
- rows: same shape as a published price row, but each **must** carry its own
  `currency`
- `version`: positive integer, **must increase** when pricing rows change (the
  app seeds version-gated and ignores older versions)

**`news/<id>.json`**

- one notice per file, the file name being the id (lowercase `[a-z0-9.-]`,
  3–64 chars). Each requires a `kind`, a `provider_id` that exists in
  `entries/`, a `model_id` that provider actually serves, a real `released`
  date, and `title`/`body` within length; `expires_at` must be after `released`
  and `url` must be http(s). An `id` field inside the file is rejected, and
  unknown keys are reported as warnings

Unknown keys anywhere are reported as warnings by the build — that is how a
leftover field from an older schema gets caught before it silently does nothing.

## Updating pricing

Edit the model record where it lives — `entries/<id>/models.json` for a
provider's models, `global.json` for vendor pricing no entry owns. If the model
is resold elsewhere, update every copy or the validator fails on drift.

Then bump `version` in `global.json` and, if the record introduced a new
currency, add it to `exchange_rates`. The version is the app's seed gate: an
unchanged version means the app keeps its existing table.

## Layout notes

- `dist/catalog.json` is assembled from all `entries/*/provider.json` +
  `models.json`, sorted by id for deterministic output (the Models page sorts
  rows itself). Field order is canonical, not per-file.
- The published entry still carries `price_line`, `users`, `blurb` (all `""`)
  and `added` (`false`). They are **placeholders**, not source fields: the app's
  catalog type declares them as required, and it parses the whole payload before
  caching it, so dropping them would fail the app's Hub sync outright. They go
  away once the app makes them optional.
- `dist/models.json` merges the priced models of every `entries/*/models.json`
  with the rows left in `global.json`, sorted by model id. A model resold by
  several providers is written once.

## CI

- `validate.yml` — runs on every PR: `node scripts/generate.mjs --check`
  (schema validation + dry-run build, no writes).
- `publish.yml` — runs on push to `main` (or manual dispatch): builds `dist/`
  and uploads the JSON artifacts plus `dist/logos/*` to R2 with
  `wrangler r2 object put --remote`.

## R2 setup (one-time)

1. Create the bucket (e.g. `kiwano-hub`) and enable public access via a
   custom domain — `hub.kiwano.cc` is the default `hub_url` baked into the app
   (`https://hub.kiwano.cc/catalog.json`).
2. Add the three repo secrets: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`
   (R2 edit on this bucket), `R2_BUCKET`.
3. Run the `publish` workflow once (or push to main) and verify:
   `curl https://hub.kiwano.cc/manifest.json`

## App wiring

- Catalog: the app's `hub_url` setting points at the public URL
  (`.../catalog.json`); payload shape is Hub protocol v0:
  `{"total": N, "entries": [...]}`. Sync is conditional — the manifest's
  `catalog.sha256` skips the download when it matches the cached copy — and
  the bundled copy is the offline fallback.
- Pricing: the app fetches models.json from the Hub alongside the catalog,
  gated by the manifest's `models.version` + `models.sha256`, and seeds the
  rows into its local store (`model_pricing.source = 'hub'`); the bundled
  snapshot remains the offline fallback.
- Logos: each catalog entry's `logo` field is a relative path resolved
  against `hub_url` (e.g. `https://hub.kiwano.cc/logos/<id>.png`); the
  images are fetched from R2 at runtime, with `logo_char` / `logo_color` as
  the offline fallback.
- Currency: a catalog entry's `currency` is what the app labels that
  provider's spending limit with, read-only — the limit is compared against
  cost as recorded, with no conversion. Only the dashboard converts, rolling
  many providers into the user's display currency for comparison.
