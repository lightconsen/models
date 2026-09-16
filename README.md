# models — Kiwano Hub data

Source of truth for the Kiwano app's two remote data files — the provider
catalog and the price table. Hand-edit here, CI validates + builds + publishes to
Cloudflare R2 (with a manifest and a news feed beside them), and the app fetches
them at runtime and treats them as authoritative: it ships no compiled copy of
the catalog, so a machine that has never synced shows no providers rather than a
stale list.

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
global.json            exchange rates + the seeding version. Nothing else: a
                       price lives in the entry of the provider that serves it,
                       so a model has exactly one price
news/<id>.json         model news — one file per notice, each naming a
                       (provider, model) pair; the file name is the id.
                       Published whole as dist/news.json
scripts/
  generate.mjs         validate + build dist/ artifacts (zero dependencies)
  migrate-v2.mjs       one-shot: the old provider.json + price.json layout ->
                       provider.json + models.json (already run)
  test-validation.mjs  failure-path tests for the validation rules
  test-policy.mjs      the same for the trust policy's edges
  lib/fetch.mjs        the plumbing the adapters share: fetch with a timeout,
                       drift, price parsing, value equality
  lib/policy.mjs       what a machine may change unattended, and what has to
                       wait for a person
  sources/index.mjs    every price source this repo can read, one adapter each —
                       the machine-readable answer to "where did this number
                       come from"
  fetch-all.mjs        read every source, judge the changes, write, prove the
                       write settled, and (with --commit) commit per entry
  fetch-deepseek-pricing.mjs
  fetch-kimi-pricing.mjs
  fetch-openrouter-pricing.mjs
                       authoring aids: read a vendor's published price table and
                       print what it would change. Never run in the build — they
                       only save the author a transcription, and print a diff
                       rather than writing unless given --write
  fetch-openrouter-rankings.mjs
                       the same, but it picks *which* rows OpenRouter's entry
                       carries: its own published token-usage ranking. The one
                       script that needs a key (the rankings dataset is
                       authenticated); it reads OPENROUTER_API_KEY, or --key-file
  fetch-aliyun-models.mjs
                       reads an Alibaba Cloud platform's own model list rather
                       than a price (`/compatible-mode/v1/models` on the entry's
                       own host). Needs a key too, and takes it from
                       ALIYUN_API_KEY or --key-file
  fetch-mimo-pricing.mjs
                       reads MiMo's pricing markdown. The docs index every page
                       as a `.md` under `/llms.txt`, so this parses markdown
                       rather than a rendered page — and it has to choose between
                       the yuan table and the dollar one
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
4. Add a row to `checklist.md` — `| [ ] | \`<id>\` | <tag> | <priced>/<total> |
   <website> | checked <date> — where the numbers came from |`. It stays
   unchecked until somebody has read the vendor's own page against the entry.
5. **Decide whether it can be kept current by machine**, which is a separate
   question from whether it is correct. If the vendor publishes a price list a
   script can read, add `scripts/sources/<vendor>.mjs` and register it in
   `index.mjs` — see [Adding a source](#adding-a-source). If they do not, the
   entry is hand-maintained and the runner will say so on every run, which is
   the correct outcome rather than a gap.
6. Run `node scripts/fetch-all.mjs` — with an adapter it reports what the entry
   would change, and prints `no change` once the entry agrees with its source.
   That is the same check the whole pipeline rests on, and it is the fastest way
   to find a typo in a transcription.
7. Open a PR — `validate` checks the schema + builds a dry run.
8. Merge to `main` — `publish` uploads `catalog.json` / `models.json` /
   `news.json` / `manifest.json` and `logos/` to the R2 bucket root.

If the new entry prices anything, bump `version` in `global.json` in the same
change. It gates the published table, so an entry that arrives without it is an
entry the app never sees.

`website` is the vendor's **own** site and nothing else: the address a reader can
follow to see who they are dealing with. A referral link, an invite code or a
signup page with tracking parameters belongs in a **separate** optional field —
putting one here would mean the catalog's idea of "the vendor's site" depends on
who is reading it, and it would have to be swapped the day the deal changes.
Where a provider's API lives on a cloud platform rather than its own domain
(`dashscope.aliyuncs.com`, `ark.*.volces.com`, `generativelanguage.googleapis.com`),
name the vendor's site, not the platform's.

### Template

```jsonc
// entries/<id>/provider.json — stable: identity, protocols, billing
{
  "id": "example",              // must equal the directory name
  "name": "Example AI",
  "website": "https://example.com",  // the vendor's own site; http(s), reachable
  "tag": "third",               // official | third | aggregate | local | free
  "rating": 4,                  // number 0..5
  "billing": "payg",            // plan | payg | unl | both — see below
  "currency": "USD",            // what this provider bills in; default USD.
                                // Its model rows, and the spending limit the app
                                // offers, are both denominated in it
  "endpoints": [                // required, at least one. The FIRST is the
                                // primary protocol; each protocol may appear once
    { "protocol": "openai",    "endpoint": "https://api.example.com/v1" },
    { "protocol": "anthropic", "endpoint": "https://api.example.com" }
  ],

  // ── optional ─────────────────────────────────────────────────────────
  "desc": "Example AI's own API, serving its open-weight models"
                                // one sentence saying who this is. Shown on the
                                // provider's row and detail card
  "plan_query": { "template": "kimi" }
                                // only when the plan's usage can be read with
                                // nothing but this provider's own API key. The
                                // value is a template id — never credentials.
                                // See "Plan quota" below
}
```

Eight required fields, and that is deliberate: anything the app can work out for
itself is not stored here. The letter-avatar glyph comes from `name`, the avatar
colour and the category label from the app's own palette and translations, and the
primary endpoint from the first entry of `endpoints`.

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
  in most cases. Worth a human look wherever a model that is a small or coding
  variant ends up representing a vendor: pricing a bigger sibling would say more
  about it. The rule is a starting point rather than a verdict — `deepseek` shows
  its flash model, chosen by hand over the pricier pro the rule picked.
  **Its tie-break has a direction worth knowing**: when a vendor prices generations
  alike, equal output and equal input fall through to the id, and the older model's
  id usually sorts first. Three vendors hit it on 2026-09-14 — `grok-4.5` over
  `grok-4.6`, `gemini-3.6-flash` over `-3.7` and `-3.8`, `doubao-seed-2.1-pro` over
  `doubao-seed-evolving` — and each was set by hand to the newer model.

Changing a flagship does not move the price table (`version` in `global.json`
gates that, and nothing about it changed), so it needs no version bump — the
catalog's own sha carries the change to clients.

### What `desc` is for

`desc` says **who the vendor is**. It is not a place for capabilities, model
names, or numbers: the entry already carries the model list, the flagship, the
prices and the currency as data, so repeating any of them there gives one fact two
sources — and prose is the copy that goes stale, because it needs an edit every
time a model ships or a price moves. A line like "K3 flagship · 1M context" is
wrong the day K4 lands, while the `flagship` field already said it correctly.

Write something that survives their next release and reads as theirs and nobody
else's. Compare:

| | |
|---|---|
| ✗ | `OpenAI/Anthropic-compatible API · 1M context` — true of half the aggregators here, and the context window is a spec that changes |
| ✓ | `DeepSeek's own API, serving its open-weight models` — you know which vendor it is, and it does not need editing when they ship |
| ✓ | `Moonshot AI's Kimi assistant and API platform` |

### One address, two ways to be billed (`both`)

A vendor that sells both an API and a subscription usually sells them at
*different addresses*, and that is two entries: `kimi` is `api.moonshot.cn` and
`kimi-for-coding` is `api.kimi.com/coding`, so the billing mode is a property of
the address and there is nothing to reconcile.

`both` is for the case where there is only one address. Claude Pro and Max are
used against `api.anthropic.com` — the same base URL as the API — so the entry
describes one endpoint that accepts either a pay-as-you-go key or a subscription
credential, and which one applies is the reader's business, not the entry's.

It is not just a naming preference. A second entry on the same host would break
pricing for providers that are already installed: `catalog_id_for`
(`../crates/core/src/vm.rs`) links a local provider to a catalog entry by
endpoint and returns nothing when more than one entry matches, and an unlinked
provider is costed at *another* entry's rate. Two entries sharing a host is
therefore not a neutral choice — it makes every hand-added or pre-link Anthropic
provider ambiguous.

What `both` does **not** do is carry the subscription's price. The entry still
prices its models per token, because that is what the metered half charges, and
the monthly figure has no field yet.

An app that predates this value cannot write it: `billing_to_db` refuses a tag it
does not know rather than guessing, so an older build shows the raw tag on the
shelf and fails when the provider is added from it. The app has to resolve `both`
into one of the two modes with the user before saving, which is the right place
for that question anyway.

### Plan quota (`plan_query`)

A subscription's usage is not part of a vendor's API surface in any standard way:
some expose a quota endpoint answerable with nothing but the API key the entry
already carries, and most expose nothing at all. Which of the two a vendor is
**cannot be derived** — `billing: plan` says how a provider charges, not what its
API can answer. In this catalog 18 entries bill as a plan and 4 can be queried.

So it is curated, one entry at a time:

```jsonc
"plan_query": { "template": "kimi" }
```

The value names a **template** — a capability, not a provider: "the Kimi coding
plan usage API", "the Zhipu monitor API". Two entries can share one
(`zhipu-glm` and `zhipu-glm-intl` do, and the host is worked out from the entry's
own `endpoints`), and an entry may move vendor without the id moving. It is
deliberately **not** the entry's own `id`: keying the app's lookup on that would
put a list of catalog entries inside the app binary, and every newly queryable
provider would need an app release rather than a data change.

**Only the template id.** A few templates need extra credentials the user
supplies — an org id, an account access key. Those are the user's own and never
belong in a public repo, so the published projection writes the single `template`
key out rather than spreading the object: nothing else can ride along.

What it buys: the app offers per-plan quota limits — a percentage ceiling on the
vendor's rolling 5-hour and weekly windows, enforced by routing around a provider
that is over its own — **only** for entries that carry this field. Where it is
absent those inputs are hidden rather than shown and left inert, since a limit
the app cannot measure against is a number the user types for nothing.

Two authoring rules:

- **`fields` is not a key here.** Extra credentials have no place in this repo.
- **An id the app does not know is warned about, not rejected.** The app reports
  an unrecognised template as a readable error rather than crashing, and the list
  can only grow — blocking one is not this repo's job.

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
(`https://hub.kiwano.cc/logos/example.png`). When the image can't load it falls
back to a letter avatar: the first letter of `name`, on a colour the app picks
from the same palette it uses for locally-added providers.

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

### Time-of-day pricing

Some vendors charge less outside their business hours, and the listed rates are
the peak ones:

```jsonc
{
  "id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro",
  "in": "9.0", "out": "27.0", "cache_read": "0.30",   // peak — the listed rates
  "off_peak": { "in": "4.5", "out": "13.5", "cache_read": "0.15" },
  "peak_hours": {
    "tz_offset": 480,          // minutes east of UTC — the VENDOR's billing clock
    "windows": [
      { "days": ["mon","tue","wed","thu","fri"], "start": "09:00", "end": "12:00" },
      { "days": ["mon","tue","wed","thu","fri"], "start": "14:00", "end": "18:00" }
    ]
  }
}
```

Read it as: the row's own rates apply **during** `peak_hours`, `off_peak` outside
them. The two fields only appear together — a discount with no window is just a
different price — and only on a priced row.

- **`tz_offset` is required, and it is the provider's clock, not the reader's.**
  These windows are business hours somewhere; judging "is it peak now" against
  the user's own timezone would silently pick the wrong rate.
- **A window does not wrap midnight.** 22:00–02:00 is two windows.
- **`off_peak` carries its own rates rather than a discount factor**, so a vendor
  who discounts input but not output is expressible. The factor happens to be
  exactly a half for DeepSeek — that is a fact about DeepSeek, not a rule.
- Until a client reads `peak_hours`, it charges the listed (peak) rate — the
  higher of the two, so an un-updated client overstates a night's cost rather
  than understating it.

### Length-dependent pricing

Some vendors charge more once a request's input passes a size. MiniMax prices M3
in two bands, one exactly twice the other, and Alibaba prices most of its models
this way:

```jsonc
{
  "id": "minimax-m3", "name": "MiniMax M3",
  "in": "2.10", "out": "8.40", "cache_read": "0.42",        // ≤ 512k — the listed band
  "long_context": {
    "over": 512000,                                          // input tokens, above which…
    "in": "4.20", "out": "16.80", "cache_read": "0.84"        // …these rates apply
  }
}
```

Read it as: the row's own rates apply up to `over` input tokens, the block's above
it. `over` is required and so are `in` and `out`; the block appears only on a
priced row, and `long_context` is the one place a rate is not the whole row.

**The listed band is the cheaper one, and that is the opposite of the time-of-day
rule above — deliberately.** There, the vendor publishes a single rate and it is
the peak one, so erring upward was free. Here the vendor publishes both bands with
the cheap one first, so following the listing keeps the headline price right, and
the cost is that a client which does not read the field bills a long request at the
lower band — understating rather than overstating. That trade was made knowingly:
the alternative puts a rate on the Models list that almost nobody pays.

Rows carry **no currency**: the provider's `currency` applies, and `generate.mjs`
stamps it into every published row of `dist/models.json` (so the app-side table
keeps its per-row currency). Listing one fails validation — two places to
disagree is exactly what this layout removes.

### Where a price lives, and the one thing the app cannot express yet

A price belongs to the provider entry that serves the model, and nowhere else.
There is no vendor price table: a model the catalog does not carry is a model the
app cannot price, and it records the request with no cost rather than a guessed
one.

Aggregators resell the same vendor models, so one `id` appears in several
`models.json` files — and **each is free to price it differently**: a subsidy, a
markup, an off-peak rate. Those prices do *not* have to agree, and the validator's
objection to disagreement is a **temporary limitation, not a rule**.

The limitation: the app's price table is keyed by model alone, so it holds exactly
one price per model, and publishing two would leave the winner up to whichever row
the seeder wrote last. Until the app looks a price up by `(provider, model)` — which
needs the published rows to name the provider — a disagreement fails the build,
with a message saying exactly that.

### What gets published

`generate.mjs` writes the priced rows of every `models.json` into
`dist/models.json`, one row per `id`, sorted by id — the flat global `model_id ->
price` table the app seeds from.

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

- `name`: non-empty string
- `website`: the vendor's own site, required, and validated as an `http(s)` URL.
  It is the plain address — **not** a referral or signup link: that is a
  different, optional field (see the note under [Adding a provider](#adding-a-provider))
- `tag`: `official | third | aggregate | local | free`
- `rating`: number `0..5`
- `billing`: `plan | payg | unl | both` — one entry per billing mode, with `both`
  for an address that serves two of them at once (see below)
- `endpoints`: non-empty array of `{protocol, endpoint}`; `protocol` is
  `anthropic | openai` and may not repeat. **The first is the primary
  protocol** — it supplies the app's `endpoint` / `protocol` / `models`
- `currency`: an `exchange_rates` key; **omitted means USD**. It is what the
  provider's prices and its spending limit are denominated in, so an unknown
  code fails validation rather than leaving the limit unmeasurable
- `desc`: optional; one sentence introducing the vendor — see below for what
  belongs in it
- `plan_query`: optional `{template}` — the id of the template the app runs to
  read this plan's usage, and nothing else. An unknown key inside it fails; a
  template id the app does not know is **warned about, not rejected**, because
  the app answers one it does not recognise with a readable failure and the list
  can only grow. See [Plan quota](#plan-quota-plan_query)
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
- `off_peak` / `peak_hours`: optional, and only together — the discounted rates
  and the hours the row's own rates apply. See
  [Time-of-day pricing](#time-of-day-pricing)
- `long_context`: optional `{over, in, out}` — the rates that apply above `over`
  input tokens, on a row whose own rates are the band below it. See
  [Length-dependent pricing](#length-dependent-pricing)
- `serves`: optional `{protocol: upstream string}`; every protocol must exist in
  `endpoints`, the object must not be empty, and **omitting it means every
  endpoint serves the model under its own `id`**
- `flagship`: optional boolean, at most one per provider, and that model must be
  priced
- no `currency` on a record — the provider's applies. A model resold by several
  providers is priced by each of them independently, and they may disagree: a
  subsidy, a margin, a different billing clock. Every row in `dist/models.json`
  carries the `provider_id` it came from, and the app looks a price up by
  (provider, model). Copies that agree still produce one row each, deliberately —
  the price a provider is billed at should be its own row, not a neighbour's that
  happens to match today. A disagreement is published and **reported as a
  warning**: app builds whose price table is still keyed by model alone fold the
  rows into one and keep whichever was seeded last, so it is a thing to know
  before publishing rather than a thing to hide

**`global.json`**

- `exchange_rates`: units per 1 USD, `USD` pinned to `1`
- `version`: positive integer, **must increase** when pricing rows change (the
  app seeds version-gated and ignores older versions)
- nothing else: a price belongs to the provider entry that serves the model, so
  a `models` key here fails validation

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

Edit the model record in the entry of the provider that serves it —
`entries/<id>/models.json`. If the model is resold elsewhere, each copy is its
own price: change the ones whose price actually changed, and leave a reseller
that has not moved its own rate alone. The build reports any model priced
differently by different providers, which is now published rather than rejected.

Then bump `version` in `global.json` and, if the record introduced a new
currency, add it to `exchange_rates`. The version is the app's seed gate: an
unchanged version means the app keeps its existing table.

Several vendors publish a table a script can read, so `scripts/fetch-deepseek-pricing.mjs`,
`scripts/fetch-kimi-pricing.mjs`, `scripts/fetch-mimo-pricing.mjs` and
`scripts/fetch-openrouter-pricing.mjs` read theirs and print the difference — a
repricing becomes a review of a diff rather than a
transcription. All are authoring aids and nothing more: no cron runs them, and a
number they print is only as fresh as the last time somebody ran it.

DeepSeek's docs prerender the table as plain HTML, so a fetch is enough — but the
response carries a stray NUL byte, which is worth knowing because `grep` then
treats the file as binary and matches nothing at all. Kimi's docs go further and
serve every page as markdown (`/docs/llms.txt` is the index), with the price
table as a literal array inside a `<DocTable>` element; their script also reads
the model list, which is how two models we carried turned out to be retired.

OpenRouter is the easiest of the three and by far the largest: a plain JSON API
(`/api/v1/models`, no key) covering 430 text-out models, each with a name and
per-token USD prices. Two things about it are worth knowing before trusting a
diff. Prices are per token, so the script moves the decimal point six places
*in the string* — `0.00000003 * 1_000_000` is not `0.03` in binary floating
point, and a short fraction gains zeros rather than losing them (`0.00001` is
`10` per million, not `1`). And a few models are priced `-1`: the vendor's way of
saying the price varies with whichever model it routes to. Those become rows with
no price, which is exactly what "declared, unpriced" already means here.

Note also which models it returns: filtering on `modality === "text->text"` looks
like the obvious reading and is wrong — it drops every model that accepts an
image, which is 272 of the 430, including the ones a reader actually picks. The
script filters on output modality instead.

`fetch-openrouter-rankings.mjs` is a different kind of aid: the two above diff
prices for the rows an entry already carries, and this one chooses which rows
those should be, from OpenRouter's own token-usage ranking
(`/api/v1/datasets/rankings-daily`). It is the only script here that needs a key.
Three things about that data are worth knowing before reading its output as fact.

**It is one week, not a running total.** `openrouter.ai/rankings` shows the latest
week, and its numbers are how to check the script: the bucket starting 2026-09-07
gives GPT-5.6 Luna 18.18T tokens, which is the 18.2T the page prints. Summing
several weeks instead puts a model that has since gone quiet near the top of a
list it is not on — `stealth/ox-alpha` had 27T across the window and zero in its
last two weeks.

**Its ids are snapshots, and the models list dates them differently** — the
ranking writes `deepseek/deepseek-v4-flash-20260731` where the models list writes
`deepseek/deepseek-v4-flash-0731`, the same snapshot with the year dropped. That
translation is what keeps two ranked snapshots of one model apart, which matters:
the page ranks `-20260731` (11.6T) and `-20260423` (4.36T) as separate entries,
and so does the entry. Dropping the whole date instead collapses them into a row
that is neither.

**A ranked model may have no record at all** in the models list, and then there is
no name and no price to write. The script lists those and writes the rest rather
than dropping them quietly.

The dataset is CC BY 4.0: anything republished from it must carry "Source:
OpenRouter (openrouter.ai/rankings), as of {as_of}" — which is why the entry's
rows are not the only thing to read there.

The Alibaba Cloud entries needed a different question answered — not what a price
is, but which models are served at all. Their hosts answer
`/compatible-mode/v1/models` with the ids they will accept, so
`fetch-aliyun-models.mjs` reads that and diffs it against an entry. It decides
*which* entry from the key file's own base URL, because a key only answers for its
own plan. The payload carries bare ids and no modality, so anything whose name
looks like an image or an audio model is set aside and listed rather than dropped
quietly. And it refuses to write an entry whose rows carry prices: the list has
none, so replacing the file wholesale would delete them.

### All of them at once

`fetch-all.mjs` runs every source above, plus the ones that only ever had a page
to read, and prints the whole catalogue's differences in one pass:

```
node scripts/fetch-all.mjs                     show the diff for every entry
node scripts/fetch-all.mjs --entry xai         just one
node scripts/fetch-all.mjs --write             apply
node scripts/fetch-all.mjs --write --commit    apply and commit, one per entry
node scripts/fetch-all.mjs --force-write       apply even if the policy says no
```

That last pair is the whole thing unattended: read, judge, write, prove, commit.
Nothing is pushed, and `--commit` refuses to run on a tree with changes it did not
make, so it cannot sweep up someone else's work.

The per-vendor scripts still exist and are still the best place to read about any
one vendor. What the runner adds is the thing none of them could do alone: keep
going when one vendor's docs restructure, and report what it could not read
rather than leaving a stale number looking fresh.

### What has to hold before a machine may write here

Four things, and being able to read a page is only the first.

**The source is readable.** Fifteen of nineteen entries. The other four — the Kimi
membership, the Qianwen token plan, the Tencent and Baidu plans — publish no
per-token rate, and saying so out loud is the point: silence about an entry reads
as coverage.

**The source is *reliable*, which is not the same thing.** OpenRouter taught this
one. `GET /api/v1/models` gives each model a single `pricing` object, but OpenRouter
routes a model to many upstreams with a price each — 18 of them for
`deepseek/deepseek-v4.1-flash`, spanning 0.15 to 0.375 — and the aggregate it
reports moves. Two values read from it in one session were not *any* endpoint's
price across 17 and 6 upstreams. That adapter now reads `/models/{id}/endpoints`
and takes the **modal** price: real, and a function of the endpoint set rather than
of which upstream a router felt like reporting. Ties break toward the model
owner's own endpoint, then the cheaper. Every other source here publishes a price
list, so this is the only one that needed the distinction.

**Judgement is separated from fact.** Every adapter declares `owns` — the price
fields it is the authority for — and the runner refuses a row carrying anything
else. `flagship`, `serves`, `name` and all of `provider.json` belong to the entry.
`qianwen` owning only `in`/`out` is the case worth knowing: its cache rates are
excepted from every percentage Alibaba publishes, and the contract is what stops a
later edit from quietly adding them back.

**A run that finds nothing new writes nothing.** This is checked, not assumed.
After writing, every entry is merged a second time against what the source said and
must come out clean — because a source reporting a value it will not report again
passes every other check while failing this one, which is exactly what OpenRouter
did. Nested shapes compare through `sameValue`, which ignores key order; comparing
them with `JSON.stringify` would call an unchanged `long_context` a change and
break the same property.

### What a machine may decide, and what it may not

`lib/policy.mjs` states the rule the two original guards were special cases of: **a
price is a fact, and a model arriving or leaving is a decision.**

Price changes never stop a run. A vendor re-pricing something is the source
speaking about the one thing it is the authority on, and there is no reason to make
anyone read it. Membership is different — it changes what the catalogue claims a
vendor sells, it is where a source silently changing shape shows up, and both times
something went wrong in a single session it was here:

- an `intersect` adapter that had not been taught to intersect offered to add 410 rows;
- an aggregator about to be trusted with prices reported values no upstream charged.

So a run may create at most 10 models, delete at most 10, and churn at most 15 in
total; past that it refuses to write and says which models and why, unless
`--force-write`. `test-policy.mjs` asserts the edges, where an off-by-one is silent
data loss.

Version bumps are part of applying a change rather than a follow-up to remember:
the published table is version-gated, so a price that moved without one is a price
the app never sees.

### Adding a source

An adapter is how an entry stops being hand-maintained. Add one when the vendor
publishes a price list a script can read; **not** when they publish a number only
a console shows, which is a fact about the product and not something to work
around.

```js
// scripts/sources/<vendor>.mjs
import { getText, drift, MEMBERSHIP } from "../lib/fetch.mjs";

export default {
  ids: ["<entry-id>"],                 // one source may feed several entries
  source: "<the URL this reads>",      // printed on every run, and in commits
  membership: MEMBERSHIP.FOLLOW,       // see below
  owns: ["in", "out", "cache_read"],   // the fields this source is authoritative for
  async read() {
    const md = await getText("https://…");
    // throw `drift(...)` when the page is not the shape you know — never return
    // a partial or empty row set, which would read as "no change".
    return { rows: { "<entry-id>": [ /* { id, name?, in, out, … } */ ] } };
  },
};
```

Then register it in `scripts/sources/index.mjs` and run
`node scripts/fetch-all.mjs --entry <entry-id>`.

**`membership` is the decision to get right.** `follow` means the source is a
complete statement of what the vendor sells, so a model it adds joins the entry
and one it drops leaves — right for a vendor pricing its own catalogue.
`intersect` means the source only re-prices what something else already chose —
right for an aggregator, whose catalogue is other people's models, and for entries
that are a deliberate selection from a longer list. Getting this wrong is what the
churn limit exists to catch.

**Row ids are the entry's, not the vendor's.** An adapter translates: `MiniMax-M3`
becomes `minimax-m3`. When the vendor's string must still reach the API, the
entry's `serves` map carries it, and the adapter joins on that.

**The acceptance test is that a correct adapter has nothing to say.** Run it
against the committed entry: if the transcription was right, it reports no change.
A diff there means the parser is wrong, not that a price moved — which is the
opposite of what a diff usually means and takes getting used to.

Each source lives in `scripts/sources/` as an adapter, and the list in
`index.mjs` is now the machine-readable answer to a question that used to have
five different answers: where did this number come from. An entry with no adapter
is not an oversight — it is a plan that publishes no per-token rate, or a console
behind a login — and the runner names those on every run.

Two rules the merge follows, both of which cost something to learn. The source
wins on what it can know: the prices, and for a *follow* source the list of models
itself. The entry wins on judgement the source cannot express — `flagship` and
`serves` are carried across untouched, because a scraper that re-derives them
would rewrite a human's decision as a guess. The other rule is that membership is
a separate question from price. A *follow* source is a complete statement of what
a vendor sells; an *intersect* source only prices what something else already
chose. OpenRouter is the second kind, and treating it as the first would replace
twenty curated rows with four hundred.

Two things worth knowing before the first run. **Node's `fetch` ignores
`https_proxy`**, which `curl` honours, so a source that works from the shell can
fail here — and turning the proxy on for everything is worse than leaving it off,
because most sources work direct and routing them through one breaks them.
Measured from this machine, exactly one source needs a proxy and the rest need
excluding from it. Which is which is a property of the network you are on rather
than of this repo, so run `node scripts/probe-sources.mjs` and use what it says
instead of trusting any list written down here.

And an entry's own docs can be read where its login page cannot: the
Volcengine Ark docs answer `www.volcengine.com/api/doc/getDocDetail?DocumentID=…`
with the whole document as JSON to anyone, while the console they are embedded in
refuses every path unauthenticated — including paths that do not exist, which is
why probing that host proves nothing about whether a page is public.

A doc response often carries its own content more than once, and the first copy is
not always the readable one. Ark returns the page as a Quill-style delta *and* as
markdown; Alibaba returns it as HTML escaped inside a `window.__ICE_PAGE_PROPS__`
JSON string. Both are readable, and the second is far less work.

Four entries have no adapter, and the runner names them on every run: the Kimi
membership and the Qianwen token plan, which publish no per-token rate at all, and
the Tencent and Baidu plans, whose model lists have no keyless endpoint. That is a
fact about those products rather than a gap in the tooling, and saying it out loud
is the point — silence about an entry reads as coverage.

## Layout notes

- `dist/catalog.json` is assembled from all `entries/*/provider.json` +
  `models.json`, sorted by id for deterministic output (the Models page sorts
  rows itself). Field order is canonical, not per-file.
- **Each published entry has twelve fields** — `id`, `name`, `website`, `tag`,
  `rating`, `billing`, `currency`, `endpoints`, `logo`, `desc`, `plan_query`,
  `price_ref`. Three of them are conditional: `desc`, `plan_query` and `price_ref`
  appear only when the source carries them. Nothing the app can work out for
  itself is sent: no avatar glyph or colour, no category label, no primary
  endpoint beside the list it is the first entry of, no "added" flag.
  `../crates/core/src/vm.rs::normalize_catalog_entry` fills those on the way in,
  the same way it has always derived `added`.
- **`plan_query` must be declared on the app side to survive.** The app
  re-serializes the parsed catalog before caching it, so a field the Rust
  `CatalogEntryVm` does not name is dropped on the first sync and the frontend
  never sees it. Declaring it there is part of shipping this field, not an
  optional follow-up.
- **`price_ref` carries the flagship's schedule too.** When that model is priced
  by time of day, its `off_peak` and `peak_hours` are projected alongside the
  rates, so the Models page can say "these are the peak figures" — it reads the
  catalog and nothing else, and a tiered price it cannot see reads as a flat
  one. `long_context` travels the same way. The fields are the ones
  `Time-of-day pricing` and `Length-dependent pricing` describe, copied verbatim
  and only when published; `models.json` stays the place a client bills from.
- `dist/models.json` holds the priced models of every `entries/*/models.json`,
  one row per model id, sorted. A model resold by several providers is written
  once — and only if every copy agrees. A row carries its currency, and its
  `off_peak` / `peak_hours` / `long_context` when the provider has them, so the
  schedule and the band travel with the prices they modify.

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
  `catalog.sha256` skips the download when it matches the cached copy — and it
  is the app's only source: an install that has never synced shows an empty
  shelf with a "fetch it from the Hub" prompt, not a bundled list.
- Pricing: the app fetches models.json from the Hub alongside the catalog,
  gated by the manifest's `models.version` + `models.sha256`, and seeds the
  rows into its local store (`model_pricing.source = 'hub'`). Note what that
  means for edits: **the file is the whole table, not a patch** — a model the
  catalog stops pricing simply disappears from it, and a client that keeps a
  local copy has to drop what is no longer there rather than merge into it.
- Logos: each catalog entry's `logo` field is a relative path resolved
  against `hub_url` (e.g. `https://hub.kiwano.cc/logos/<id>.png`); the
  images are fetched from R2 at runtime, falling back to a letter avatar
  built from `name` and the app's own avatar palette.
- Currency: a catalog entry's `currency` is what the app labels that
  provider's spending limit with, read-only. Cost is recorded in the currency
  the price row was written in, which is the provider's own — but a model the
  provider does not price itself is billed from the general row, which may be
  denominated in another, so the app converts each currency into the limit's
  before adding them, using these `exchange_rates`. The dashboard converts too,
  rolling many providers into the user's display currency for comparison.
