# Provider review checklist

19 providers. Tick one when its data has been checked against what the vendor itself publishes — the prices, and the things a price depends on:

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

Five vendors can be read by script rather than by eye, and when one applies, run it before reading anything: `fetch-deepseek-pricing.mjs`, `fetch-kimi-pricing.mjs` and `fetch-mimo-pricing.mjs` for prices, `fetch-openrouter-pricing.mjs` for prices and `fetch-openrouter-rankings.mjs` for which models OpenRouter carries at all, `fetch-aliyun-models.mjs` for the Alibaba entries' model lists. The rest is reading their docs page and the entry side by side. It is worth knowing which of these need a key: the OpenRouter ranking and the Alibaba lists do, and neither script will write without one.

| | provider | tag | priced | website | notes |
|---|---|---|---|---|---|
| [x] | `anthropic` | official | 4/4 | <https://anthropic.com/> | checked 2026-09-14 — the four models and their prices from the vendor's own pricing page; `billing` is `both` (the API and Pro/Max share a host) |
| [x] | `baidu-qianfan-token-plan` | official | 0/8 | <https://cloud.baidu.com/product-s/qianfan_home> | checked 2026-09-14 — the eight models and both routes as the vendor publishes them; the openai route answers 401 without a key and the anthropic one 422 |
| [x] | `deepseek` | official | 2/2 | <https://deepseek.com/> | checked 2026-09-14 — prices, peak/off-peak, CNY, endpoints (see the fetch script) |
| [ ] | `doubaoseed` | official | 1/3 | <https://www.volcengine.com/> |  |
| [ ] | `google-ai-studio` | official | 1/2 | <https://aistudio.google.com/> |  |
| [ ] | `groq` | official | 0/1 | <https://groq.com/> |  |
| [x] | `kimi` | official | 4/4 | <https://moonshot.cn/> | checked 2026-09-14 — prices, currency, model list (see the fetch script) |
| [x] | `kimi-for-coding` | official | 0/4 | <https://kimi.com/> | checked 2026-09-14 — model list, CNY, no per-token price (a membership carries none); `plan_query` = `kimi` |
| [x] | `minimax` | official | 3/3 | <https://minimaxi.com/> | checked 2026-09-14 — the three current models against the vendor's own Pay-as-you-go table, CNY, cache write included, and M3's 512k band read in both directions (≤512k 2.10/8.40/0.42, above it 4.20/16.80/0.84, which `long_context` carries); both routes answer 401 without a key. Two gaps: the same page still prices five older models this entry does not list (M2.5, M2.1, M2 and their highspeed variants), and `service_tier: priority` bills 1.5x standard with no field to record it. `billing` is `both`: one address takes a pay-as-you-go key and a Token Plan key |
| [x] | `minimax-intl` | official | 3/3 | <https://minimax.io/> | checked 2026-09-14 — the overseas table as the vendor publishes it in USD, the same three models and the same 512k band (0.60/2.40/0.12 above it); both routes answer 401. Its figures are the vendor's own round numbers rather than a conversion of the domestic ones — the two tables are published side by side, and `global.json`'s rate is for display only. Same two gaps as the domestic entry |
| [x] | `openrouter` | aggregate | 20/20 | <https://openrouter.ai/> | checked 2026-09-14 — model list from the vendor's own usage ranking, prices and upstream ids from its models API (see the two fetch scripts) |
| [x] | `qianwenai` | official | 2/2 | <https://www.qianwenai.com/> | checked 2026-09-14 — the two models and their rates from the vendor's page; both routes answer without a key |
| [x] | `qianwenai-token-plan` | official | 0/9 | <https://www.qianwenai.com/> | checked 2026-09-14 — the nine models read off the plan's own `/compatible-mode/v1/models` (see the script); the anthropic route answers 401 without a key |
| [x] | `tencent-token-plan` | official | 0/15 | <https://www.tencent.com/> | checked 2026-09-14 — the fifteen models of both plans, which share one address and one API key; both routes answer 401 without a key |
| [ ] | `xai` | official | 7/7 | <https://x.ai/> |  |
| [x] | `xiaomi-mimo` | official | 2/2 | <https://mimo.mi.com/> | checked 2026-09-14 — the domestic rates from the vendor's own table (see the fetch script); one host serves both markets and bills by the account's region, so the yuan table is a choice |
| [x] | `xiaomi-mimo-token-plan` | official | 0/2 | <https://mimo.mi.com/> | checked 2026-09-14 — the two models it serves, unpriced: it deducts by quota conversion, and the metered entry carries the rates |
| [x] | `zhipu-glm` | official | 2/2 | <https://bigmodel.cn/> | checked 2026-09-14 — GLM-5.3 and -Flash with their rates from the vendor's page (CNY); `billing` is `both`, and the `zhipu` quota template reads the domestic host |
| [x] | `zhipu-glm-intl` | official | 2/2 | <https://z.ai/> | checked 2026-09-14 — the same two models as Z.AI lists them (USD); `billing` is `both`; the same `zhipu` template, which routes to api.z.ai off the entry's own host |

Priced counts are `priced/total` models. The list is a snapshot of `entries/` — a new provider needs a new line, and a removed one loses its own.
