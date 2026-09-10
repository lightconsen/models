# models — Kiwano Hub data

Source of truth for the Kiwano app's two remote data files. Hand-edit here,
CI validates + builds + publishes to Cloudflare R2; the app fetches at runtime
(fully offline-fallbackable to its bundled snapshots).

## Layout

```
entries/
  <id>/provider.json   one directory per model provider; adding a provider
                       = creating one new directory (id must match the
                       directory name)
  <id>/logo.<ext>      provider logo (required; png|svg|jpg|jpeg|webp),
                       published to R2 under logos/<id>.<ext>
  <id>/price.json      this provider's model prices (required; [] when none
                       of its declared models is priced), merged into the
                       published dist/models.json
global.json            exchange rates + the vendor pricing no entry owns
                       (version-gated)
scripts/
  generate.mjs         validate + build dist/ artifacts (zero dependencies)
.github/workflows/
  validate.yml         PR gate: validation + dry-run build
  publish.yml          main push: build + upload to R2
```

## Adding a provider

A provider is **one directory + one `provider.json` + one logo file**. The
directory name is the `id`, and the `id` field inside must equal it exactly.

1. Create `entries/<id>/provider.json` from the template below.
2. Add a logo file `entries/<id>/logo.<ext>` (`png` | `svg` | `jpg` | `jpeg` |
   `webp`). It is **required** and published to R2 as `logos/<id>.<ext>` —
   see [Logo](#logo).
3. Add `entries/<id>/price.json` pricing the models you declared — `[]` when
   none of them is priced yet. It is **required** — see [Pricing](#pricing).
4. Open a PR — `validate` checks the schema + builds a dry run.
5. Merge to `main` — `publish` uploads `catalog.json` / `models.json` /
   `manifest.json` and `logos/` to the R2 bucket root.

### Template

```jsonc
{
  // ── required ─────────────────────────────────────────────────────────
  "id": "example",              // must equal the directory name
  "name": "Example AI",
  "logo_char": "E",             // 1-char fallback letter avatar
  "logo_color": "#3B82F6",      // fallback avatar background (hex)
  "tag": "third",               // official | third | aggregate | local | free
  "tag_label": "Third-party",   // human-readable tag
  "rating": 4,                  // number 0..5
  "endpoint": "https://api.example.com/v1",
  "price_line": "Pay-as-you-go",
  "billing": "payg",            // plan | payg | unl
  "users": "One line describing the audience",
  "blurb": "",                  // may be empty
  "added": false,               // "recently added" flag for the UI
  "models": [                   // may be empty when models are live-fetched
    "example-1",
    "example-2"
  ],

  // ── optional ─────────────────────────────────────────────────────────
  "protocol": "openai",         // anthropic | openai | gemini (default openai)
  "icon": "example",            // legacy app-side icon-registry key (see Logo)
  "logo_border": true,          // add a border to the fallback avatar
  "price_note": "+5.5%",        // e.g. markup over upstream
  "free_offer": "Free tier: ...",
  "endpoints": [                // extra protocol endpoints for the same provider
    {
      "protocol": "anthropic",
      "endpoint": "https://api.example.com",
      "models": ["example-1"]
    }
  ]
}
```

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
(`https://hub.kiwano.cc/logos/example.png`). `logo_char` + `logo_color`
remain required fields and are the app's fallback when the image can't load.

### Relationship to `icon`

`provider.json` also has an optional `icon` field — a legacy key into the
app's bundled icon registry (`../src/components/icons/`). It predates the
R2-hosted `logo` and is kept for backward compatibility. New providers should
add a `logo` file; `icon` is optional and app-side only.

## Pricing

`entries/<id>/price.json` prices the models this provider serves — one row per
model, in the same shape as `global.json`:

```jsonc
[
  {
    "model_id": "claude-opus-5",
    "display_name": "Claude Opus 5",
    "input": "5",            // currency per million tokens, TEXT decimal
    "output": "25",
    "cache_read": "0.50",
    "cache_creation": "6.25",
    "currency": "USD"        // must be an exchange_rates key
  }
]
```

`[]` is valid and means "none of this provider's models is priced" — the app
then shows no cost rather than a wrong one. A model listed in `provider.json`
`models` that has no row here is simply unpriced.

### One row, several providers

Aggregators resell the same vendor models, so a `model_id` may legitimately
appear in several `price.json` files. The copies must be **identical**: the
validator fails on drift, because the published table keeps one row per
`model_id` and which copy won would otherwise depend on merge order.

Vendor pricing that no entry owns (the OpenAI/Anthropic/Google list prices for
models no directory declares) stays in `global.json`.

### What gets published

`generate.mjs` merges every `price.json` with the rows still in
`global.json` into `dist/models.json` — the same flat global
`model_id -> price` table as before. The app's `PricingTable` has no provider
dimension (it looks prices up by model id alone), so this split is a
source-layout change and nothing more.

## Data domains (enforced by generate.mjs)

- `billing`: `plan | payg | unl` — one entry per billing mode
- `protocol`: `anthropic | openai | gemini` (default `openai`)
- `tag`: `official | third | aggregate | local | free`
- `rating`: number `0..5`
- `models`: array of `model_id` strings (may be empty when live-fetched)
- `logo`: derived, not authored — `entries/<id>/logo.<ext>` must exist and is
  published as `logos/<id>.<ext>`
- `price.json`: array of price rows (may be `[]`), each needing the same seven
  fields as a `global.json` row; prices are non-negative decimals and
  `currency` must be an `exchange_rates` key. No repeated `model_id` within a
  file, and no drift between files for a shared `model_id`
- `exchange_rates`: units per 1 USD, `USD` pinned to `1`
- `version` (`global.json`): positive integer, **must increase** when pricing
  rows change (the app seeds version-gated and ignores older versions)

## Updating pricing

Edit the price row where it lives — `entries/<id>/price.json` for a provider's
models, `global.json` for vendor pricing no entry owns. If the model is
resold elsewhere, update every copy or the validator fails on drift.

Then bump `version` in `global.json` and, if the row introduced a new
currency, add it to `exchange_rates`. The version is the app's seed gate: an
unchanged version means the app keeps its existing table.

## Layout notes

- `dist/catalog.json` is assembled from all `entries/*/provider.json`,
  sorted by id for deterministic output (the Models page sorts rows itself).
- `dist/models.json` merges all `entries/*/price.json` with the rows left in
  `global.json`, sorted by model id. A model resold by several providers
  is written once.

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
