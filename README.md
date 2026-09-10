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
data/
  models.json          model pricing + exchange rates (version-gated)
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
3. Open a PR — `validate` checks the schema + builds a dry run.
4. Merge to `main` — `publish` uploads `catalog.json` / `models.json` /
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
(`https://hub.kiwano.app/logos/example.png`). `logo_char` + `logo_color`
remain required fields and are the app's fallback when the image can't load.

### Relationship to `icon`

`provider.json` also has an optional `icon` field — a legacy key into the
app's bundled icon registry (`../src/components/icons/`). It predates the
R2-hosted `logo` and is kept for backward compatibility. New providers should
add a `logo` file; `icon` is optional and app-side only.

## Data domains (enforced by generate.mjs)

- `billing`: `plan | payg | unl` — one entry per billing mode
- `protocol`: `anthropic | openai | gemini` (default `openai`)
- `tag`: `official | third | aggregate | local | free`
- `rating`: number `0..5`
- `models`: array of `model_id` strings (may be empty when live-fetched)
- `logo`: derived, not authored — `entries/<id>/logo.<ext>` must exist and is
  published as `logos/<id>.<ext>`
- `exchange_rates`: units per 1 USD, `USD` pinned to `1`
- `models.json` `version`: positive integer, **must increase** when pricing
  rows change (the app seeds version-gated and ignores older versions)

## Updating pricing

Edit `data/models.json`: add the price row, bump `version`, and add the
currency to `exchange_rates` if it's new. A model row needs `model_id`,
`display_name`, `input`, `output`, `cache_read`, `cache_creation`, and
`currency` (must have an `exchange_rates` entry).

## Layout notes

- `dist/catalog.json` is assembled from all `entries/*/provider.json`,
  sorted by id for deterministic output (the Models page sorts rows itself).
- Keep `data/models.json` as one file for now; per-provider pricing can move
  under `entries/<id>/` later if overrides are ever needed.

## CI

- `validate.yml` — runs on every PR: `node scripts/generate.mjs --check`
  (schema validation + dry-run build, no writes).
- `publish.yml` — runs on push to `main` (or manual dispatch): builds `dist/`
  and uploads the JSON artifacts plus `dist/logos/*` to R2 with
  `wrangler r2 object put --remote`.

## R2 setup (one-time)

1. Create the bucket (e.g. `kiwano-hub`) and enable public access via a
   custom domain — `hub.kiwano.app` is the URL baked into the app
   (`https://hub.kiwano.app/catalog.json`).
2. Add the three repo secrets: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`
   (R2 edit on this bucket), `R2_BUCKET`.
3. Run the `publish` workflow once (or push to main) and verify:
   `curl https://hub.kiwano.app/manifest.json`

## App wiring

- Catalog: the app's `hub_url` setting points at the public URL
  (`.../catalog.json`); payload shape is Hub protocol v0:
  `{"total": N, "entries": [...]}`. Sync results are cached app-side and the
  bundled copy is the offline fallback.
- Pricing: the app currently reads its bundled models.json snapshot; remote
  version-gated fetch of models.json is the pending app-side follow-up
  (seed logic and the `version` gate already exist there).
- Logos: each catalog entry's `logo` field is a relative path resolved
  against `hub_url` (e.g. `https://hub.kiwano.app/logos/<id>.png`); the
  images are fetched from R2 at runtime, with `logo_char` / `logo_color` as
  the offline fallback.
