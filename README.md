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
data/
  models.json          model pricing + exchange rates (version-gated)
scripts/
  generate.mjs         validate + build dist/ artifacts (zero dependencies)
.github/workflows/
  validate.yml         PR gate: validation + dry-run build
  publish.yml          main push: build + upload to R2
```

## Data domains (enforced by generate.mjs)

- `billing`: `plan | payg | unl` — one entry per billing mode
- `protocol`: `anthropic | openai | gemini` (default `openai`)
- `tag`: `official | third | aggregate | local | free`
- `exchange_rates`: units per 1 USD, `USD` pinned to `1`
- `models.json` `version`: positive integer, **must increase** when pricing
  rows change (the app seeds version-gated and ignores older versions)

## Layout notes

- `dist/catalog.json` is assembled from all `entries/*/provider.json`,
  sorted by id for deterministic output (the Models page sorts rows itself).
- Keep `data/models.json` as one file for now; per-provider pricing can move
  under `entries/<id>/` later if overrides are ever needed.

1. **Add a provider**: create `entries/<id>/provider.json` (one file; `id`
   must equal the directory name — copy an existing entry as a template).
   **Modify a provider**: edit its `provider.json`.
   **Update pricing**: edit `data/models.json` (add the price row, bump
   `version`, add the currency to `exchange_rates` if new).
2. Open a PR — the `validate` workflow checks schema + builds.
3. Merge to `main` — the `publish` workflow uploads `catalog.json`,
   `models.json`, `manifest.json` to the R2 bucket root.

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
