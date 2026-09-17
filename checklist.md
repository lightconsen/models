# Provider review checklist

22 providers. Tick one when its data has been checked against what the vendor itself publishes — the prices, and the things a price depends on:

- every live model is listed, and no retired one is — where the vendor's own page
  enumerates its lineup, which is most of them. An aggregator routing hundreds
  does not, so the entry carries the ones it is known for and the notes say which
  rule picked them (`openrouter` uses the vendor's own usage ranking)
- `in` / `out` / `cache_read` match the vendor's own table, in the currency the vendor bills in
- any time-of-day *or length-dependent* pricing is recorded, not left in prose.
  `long_context` carries the rates that apply above an input size, and both
  MiniMax entries use it for M3 — a vendor that prices in bands is transcribed
  now, not selected. What still has no field is a subscription's monthly figure,
  so the entries that carry one carry it in `desc`, and any per-request multiplier
  (MiniMax's `service_tier: priority` is 1.5x standard). Those stay as the marker
  of the gaps
- one rate is **published nowhere**, which is a different kind of gap. Alibaba
  excepts `qwen3.8-max` and `qwen3.8-flash` from every cache percentage it states
  — 20% is the rule for its hosted models *except* these, and 10% is the
  explicit-cache hit rate and the rule for `deepseek-v4.1-flash` — and answers
  具体价格请参见百炼控制台. The entry records 1.5 against an input of 12 (12.5%),
  which is neither, and 12.5% may well be exactly what the console says. Left
  alone rather than corrected to a percentage that does not apply to it
- `billing` says what the vendor sells **at that address**. Where one host answers
  to both an API key and a subscription credential it is `both` — the Anthropic API
  and Pro/Max, Zhipu's `api` and its coding plan — and two entries are right only
  when the addresses differ, the way `kimi` and `kimi-for-coding` do
- a plan-billed entry says whether its usage can be read with the API key alone,
  and `plan_query` names the right template when it can
- `desc` introduces the vendor and nothing that expires — no model names, no
  capabilities, no user counts (see the README's "What `desc` is for")
- the endpoints still answer, and `website` is the vendor's own site. Probe the
  full path, not the base: a bare API base answers 404 for every entry here, which
  says nothing either way. `POST` to `/chat/completions` or `/v1/messages` and
  look for 401 — the route exists and wants a key — or 422, which means it read
  the body, or 404, which is the one that means the route is gone

Sixteen of the twenty-two entries can be read by script rather than by eye. **Run `node scripts/fetch-all.mjs` before reading anything** — it reads every source, prints what each would change, and decides whether a person is needed. `--write` applies, `--write --commit` applies and commits one entry per commit. The per-vendor `fetch-*.mjs` scripts still work and are the better place to read about any single vendor; `fetch-openrouter-rankings.mjs` is still the only one that decides *which* models OpenRouter carries, and with `fetch-aliyun-models.mjs` for the Alibaba model lists it is the only one needing a key.

Six entries are read by eye rather than by the runner, for two different reasons. Four publish no per-token rate at all — `kimi-for-coding` (a membership) and the `qianwenai-token-plan`, `tencent-token-plan` and `baidu-qianfan-token-plan` plans. Two have a rate and a page that will not answer: `google-gemini`, whose pricing page redirects a *browser* user-agent to an OAuth consent screen while serving a plain one — an adapter waits on nobody, so it is next — and `mistral`, whose API rates come off a page this run has not found a stable machine-readable form of. The runner names all six every run rather than letting their absence read as coverage.

| | provider | tag | priced | website | notes |
|---|---|---|---|---|---|
| [x] | `anthropic` | official | 4/4 | <https://anthropic.com/> | checked 2026-09-14 — the four models and their prices from the vendor's own pricing page; `billing` is `both` (the API and Pro/Max share a host) |
| [x] | `baidu-qianfan-token-plan` | official | 0/8 | <https://cloud.baidu.com/product-s/qianfan_home> | checked 2026-09-14 — the eight models and both routes as the vendor publishes them; the openai route answers 401 without a key and the anthropic one 422 |
| [x] | `deepseek` | official | 2/2 | <https://deepseek.com/> | checked 2026-09-14 — prices, peak/off-peak, CNY, endpoints (see the fetch script) |
| [x] | `volcesark` | official | 0/11 | <https://www.volcengine.com/> | checked 2026-09-14 — the eleven models the plan page names, and the two base URLs it requires are the two the entry carries. Both routes answer 401 without a key. The plan price (Lite 40 元/月, Pro 200 元/月) is published and has no field |
| [x] | `volcesark-agent-plan` | official | 0/11 | <https://www.volcengine.com/> | checked 2026-09-14 — eleven text models from the plan's own table, and the `/api/plan` base URL is confirmed by the Agent Plan's configuration doc, which also says its API key is separate from the Coding Plan's — which is why these are three entries rather than one with `billing: both`. Both routes answer 401. The tier matrix (which model each of Small/Medium/Large/Max gets) and the ladder itself (40/200/500/1000 元/月) have no field |
| [x] | `volcesark-payg` | official | 11/11 | <https://www.volcengine.com/> | checked 2026-09-14 — the eleven current-generation text models and their yuan rates from the vendor's own pricing page, which also confirmed the `doubao-seed-2.1-pro` rate removed from the Coding Plan entry. Both routes answer 401. **`long_context` cannot express four of these models** (three bands by input length); cache storage (0.017 元/百万/小时) has no field either — both recorded in place of a value |
| [x] | `kimi` | official | 4/4 | <https://moonshot.cn/> | checked 2026-09-14 — prices, currency, model list (see the fetch script) |
| [x] | `kimi-for-coding` | official | 0/4 | <https://kimi.com/> | checked 2026-09-14 — model list, CNY, no per-token price (a membership carries none); `plan_query` = `kimi` |
| [x] | `mistral` | official | 8/8 | <https://mistral.ai/> | checked 2026-09-16 — eight text models from the vendor's **API** pricing page, which is a different page from `mistral.ai/pricing`: that one carries only the subscription plans, and the API rates are at `/pricing/api/`. Ids are the published `-latest` aliases verbatim (`mistral-large-latest`), because that is what the page names and what the API accepts; the display names carry the version (`Mistral Large 3`). **`cache_read` is derived, not published**: the page states one platform-wide rule — `Cached input tokens −90% on input token` — and only the one third-party card prints a figure, `$0.14` against `$1.4`, which is exactly the 10% the rule implies. Every row here follows that rule rather than a per-model number. `GLM 5.2` is a third-party model Mistral hosts and prices, listed for the same reason `volcesark-payg` lists `glm` and `deepseek` rows. Both routes answer 401 without a key |
| [x] | `minimax` | official | 3/3 | <https://minimaxi.com/> | checked 2026-09-14 — the three current models against the vendor's own Pay-as-you-go table, CNY, cache write included, and M3's 512k band read in both directions (≤512k 2.10/8.40/0.42, above it 4.20/16.80/0.84, which `long_context` carries); both routes answer 401 without a key. Two gaps: the same page still prices five older models this entry does not list (M2.5, M2.1, M2 and their highspeed variants), and `service_tier: priority` bills 1.5x standard with no field to record it. `billing` is `both`: one address takes a pay-as-you-go key and a Token Plan key |
| [x] | `minimax-intl` | official | 3/3 | <https://minimax.io/> | checked 2026-09-14 — the overseas table as the vendor publishes it in USD, the same three models and the same 512k band (0.60/2.40/0.12 above it); both routes answer 401. Its figures are the vendor's own round numbers rather than a conversion of the domestic ones — the two tables are published side by side, and `global.json`'s rate is for display only. Same two gaps as the domestic entry |
| [x] | `google-gemini` | official | 7/7 | <https://ai.google.dev/> | checked 2026-09-16 — the seven current text models and their rates from the vendor's own pricing page. Unlike `openai`, the numbers here **are** the vendor's table: the page is OAuth-walled from this machine so a person relayed it, but it is AI Studio's page and not a third party's reading of it. The OpenAI-compatible route is the one the entry carries (`generativelanguage.googleapis.com/v1beta/openai` answers 400 "model is not specified", which is the route reading the body). **Two things the schema cannot express.** The page prices a change *in advance* — every Gemini 3.x Flash is `$0.75 through December 31, 2026, $1.50 starting January 1, 2027`, and the entry records the 2026 rate that is actually being billed today; the 2027 rate has no field. And context caching bills storage per hour ($0.50 / 1M tokens / hour) on top of the read rate, which is not a per-token rate at all. The set is the 3.x text generation, which is the rule that picked them: 3.6/3.7/3.8 Flash tie on price, so `flagship` is the hand choice it always is at a same-priced generation |
| [x] | `openai` | official | 4/4 | <https://openai.com/> | checked 2026-09-17 — the four flagship text models from **OpenAI's own price list**, `developers.openai.com/api/docs/pricing.md`, read by `scripts/sources/openai.mjs`. That page serves every docs page as markdown and its Standard table's header names all eight columns — short-context input, cached input, cache writes and output, then the same four again for long context, which is `long_context` exactly. The 272K boundary is not stated in the table but is named in the rows that need it (`gpt-5.5 (<272K context length)`), so the threshold comes from there. **The vendor's list replaced a third-party reading, and showed why that mattered**: the entry had been built from `models.dev/labs/openai` because `platform.openai.com` is blocked from here, and that source lists a model called `gpt-5.6` at the same four rates as `gpt-5.6-sol` — which OpenAI does not publish. A duplicate under a name the vendor does not use, carried as a fifth flagship. It is gone. Note `platform.openai.com` and `developers.openai.com` are different hosts with different answers: the first 301s away, the second serves. Both need the proxy from here, and neither should from a US runner |
| [x] | `openrouter` | aggregate | 20/20 | <https://openrouter.ai/> | checked 2026-09-14 — model list from the vendor's own usage ranking, prices and upstream ids from its models API (see the two fetch scripts) |
| [x] | `qianwenai` | official | 2/2 | <https://www.qianwenai.com/> | checked 2026-09-15 — the two models and their `in`/`out` from the vendor's own price list, read by `scripts/sources/qianwen.mjs`. **The cache rates are not published**: the context-cache page excepts `qwen3.8-max` / `qwen3.8-flash` from every percentage it gives (20% implicit, 10% explicit-hit) and says 具体价格请参见百炼控制台 — see the note below. Both routes answer without a key |
| [x] | `qianwenai-token-plan` | official | 0/9 | <https://www.qianwenai.com/> | checked 2026-09-14 — the nine models read off the plan's own `/compatible-mode/v1/models` (see the script); the anthropic route answers 401 without a key |
| [x] | `tencent-token-plan` | official | 0/15 | <https://www.tencent.com/> | checked 2026-09-14 — the fifteen models of both plans, which share one address and one API key; both routes answer 401 without a key |
| [x] | `xai` | official | 7/7 | <https://x.ai/> | checked 2026-09-14 — the seven models and both long-context bands read off the vendor's table; `desc` was the placeholder "Official pricing". **The endpoint is unprobed** — the local proxy was down, which is the one line of this row still outstanding |
| [x] | `xiaomi-mimo` | official | 2/2 | <https://mimo.mi.com/> | checked 2026-09-14 — the domestic rates from the vendor's own table (see the fetch script); one host serves both markets and bills by the account's region, so the yuan table is a choice |
| [x] | `xiaomi-mimo-token-plan` | official | 0/2 | <https://mimo.mi.com/> | checked 2026-09-14 — the two models it serves, unpriced: it deducts by quota conversion, and the metered entry carries the rates |
| [x] | `zhipu-glm` | official | 2/2 | <https://bigmodel.cn/> | checked 2026-09-14 — GLM-5.3 and -Flash with their rates from the vendor's page (CNY); `billing` is `both`, and the `zhipu` quota template reads the domestic host |
| [x] | `zhipu-glm-intl` | official | 2/2 | <https://z.ai/> | checked 2026-09-14 — the same two models as Z.AI lists them (USD); `billing` is `both`; the same `zhipu` template, which routes to api.z.ai off the entry's own host |

Priced counts are `priced/total` models. The list is a snapshot of `entries/` — a new provider needs a new line, and a removed one loses its own.
