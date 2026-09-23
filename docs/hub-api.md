# Kiwano Hub API — public data, protocol v1

The catalogue is served as plain static JSON from
`https://models.kiwano.cc/data/` (mirrored to `hub.kiwano.cc`). No key, no
auth, `cache: no-store` recommended — the four files are regenerated on every
push to `main` and versioned so a client can skip downloads that change
nothing.

```
GET /data/manifest.json   the gate: sha256 of each file + the price-table version
GET /data/catalog.json    providers: identity, endpoints, flagship price_ref
GET /data/models.json     the flat price table — one row per (provider, model)
GET /data/news.json       dated notices per (provider, model)
GET /logos/<id>.<ext>     provider logos
```

## The sync pattern (what the app does)

1. Fetch `manifest.json` (400 bytes). If the cached `catalog.sha256` matches,
   stop — nothing changed.
2. Otherwise fetch `catalog.json` + `models.json`, and re-seed the price table.
3. `models.version` is the price-table version: an unchanged version means the
   app keeps the table it already has.

The manifest is an optimisation only — missing or malformed, the sync
degrades to unconditional full fetch, never to an error.

## `catalog.json` — `{"total": N, "entries": [...]}`

Each entry:

| field | shape | notes |
|---|---|---|
| `id` | string | canonical provider id; also the logos filename |
| `name` | string | display name |
| `website` | URL | the vendor's own site |
| `tag` | `official` \| `aggregate` | vendor vs reseller |
| `rating` | 0–5 | editorial |
| `billing` | `payg` \| `plan` \| `both` \| `unl` | what the vendor sells at that address |
| `currency` | ISO-4217 | the provider bills in this |
| `endpoints` | `[{protocol, endpoint, models[]}]` | protocol: `openai` \| `anthropic` \| `gemini`; `models[]` carries the upstream strings per protocol |
| `logo` | relative path | resolve against the data root |
| `desc` | string | who the vendor is; no model names, no numbers |
| `price_ref` | object | the flagship's `{model_id, display_name, input, output, currency, off_peak?, peak_hours?, long_context?}` — enough to show "from ¥X" without the second file |
| `prices_as_of` | YYYY-MM-DD | when a fetcher last wrote this entry's price rows |
| `seeded` | boolean | Tier C: prices from a third party, pending verification |
| `endpoint_template` | URL pattern | resource-pinned API bases (`{region}`, `{resource}`) — documentation, not a callable address |

`price_ref` is projected only for the flagship, so the list page needs no
second request. Absent means the provider prices no model itself (plan-billed
entries).

## `models.json` — `{version, exchange_rates, generated_at, models: [...]}`

One row per (provider, model):

| field | shape | notes |
|---|---|---|
| `provider_id` | string | the catalog entry it belongs to |
| `model_id` | string | **canonical key** — the same id across providers is the same model, comparable |
| `display_name` | string | the vendor's spelling |
| `input` / `output` | decimal string | per 1M tokens; **strings, not numbers** — parse, never compare lexically |
| `cache_read` / `cache_creation` | decimal string | per 1M; `0` when the vendor charges nothing |
| `currency` | ISO-4217 | the provider's own |
| `off_peak` / `peak_hours` | object | time-of-day pricing; both appear together or not at all. `peak_hours.tz_offset` is the **vendor's** clock (minutes east of UTC), `windows[]` each with `days[]` + `start`/`end` HH:MM. The row's own rates are the **peak** ones |
| `long_context` | object | `{over, in, out, cache_read?}` — the row's rates apply up to `over` input tokens, the block's above it. The row's rates are the **cheaper** band |
| `context` / `max_output` | integer | capability facts from the vendor's docs; absent = the vendor does not say |
| `reasoning` / `tool_call` / `structured_output` / `temperature` | boolean | same rule: absent ≠ false. `false` is only ever the vendor's explicit no |

## `news.json` — `{"news": [...]}`

Dated notices keyed `(provider_id, model_id)` with `kind`: `new_model`,
`free`, `discount`, `announce`. Carries `released` (the client decides what
is still fresh), optional `expires_at`, `badge`, `url`.

## Errors and edge cases

- A `price_ref.currency` may differ from a row's `currency` only by the
  provider's own choice — the app converts each currency into the limit's
  before adding them.
- A provider may price a model differently from another provider pricing the
  same model: that is legitimate data (subsidy, markup, off-peak), and the
  rows are keyed (provider, model) precisely so both survive.
- The price table is **the whole table, not a patch** — a model the catalogue
  stops pricing disappears from it, and a client that caches must drop what
  is no longer there.

## Tool access — the MCP server

The catalogue is also served in the tool loop:
`scripts/hub-mcp.mjs` is a zero-dependency MCP server (stdio) reading `dist/`
directly, so a build refreshes everything it serves. Three tools:
`list_providers`, `search_models` (name substring, min context, tool/reasoning
filters), `get_model_price`.

One-time wiring for any MCP client:

```
claude mcp add kiwano-hub -- node /path/to/models/scripts/hub-mcp.mjs
```

Failures degrade to empty results with the reason — the server never guesses
half-matched prices, and nothing here needs a key: the data is public, the
server is read-only.
