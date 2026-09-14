# Provider review checklist

25 providers. Tick one when its data has been checked against what the vendor itself publishes — the prices, and the things a price depends on:

- every live model is listed, and no retired one is — where the vendor's own page
  enumerates its lineup, which is most of them. An aggregator routing hundreds
  does not, so the entry carries the ones it is known for and the notes say which
  rule picked them (`openrouter` uses the vendor's own usage ranking)
- `in` / `out` / `cache_read` match the vendor's own table, in the currency the vendor bills in
- any time-of-day pricing is recorded, not left in prose. Two kinds cannot be, and
  no entry should be held for either. A subscription's monthly figure has no field,
  so the ten entries that carry one carry it in `desc`. And a rate that varies by
  context length has no field either — Alibaba prices most of its models in tiers
  by input length, and those entries could only record the ones that are not
  tiered, which is a selection, not a transcription. This bullet stays as the
  marker of both gaps; do not go looking for the fields
- `billing` says what the vendor sells **at that address**. Where one host answers
  to both an API key and a subscription credential it is `both` — the Anthropic API
  and Pro/Max, Zhipu's `api` and its coding plan — and two entries are right only
  when the addresses differ, the way `kimi` and `kimi-for-coding` do
- a plan-billed entry says whether its usage can be read with the API key alone,
  and `plan_query` names the right template when it can
- `desc` introduces the vendor and nothing that expires — no model names, no
  capabilities, no user counts (see the README's "What `desc` is for")
- the endpoints still answer, and `website` is the vendor's own site

Four vendors can be read by script rather than by eye, and when one applies, run it before reading anything: `fetch-deepseek-pricing.mjs` and `fetch-kimi-pricing.mjs` for prices, `fetch-openrouter-pricing.mjs` for prices and `fetch-openrouter-rankings.mjs` for which models OpenRouter carries at all, `fetch-aliyun-models.mjs` for the Alibaba entries' model lists. The rest is reading their docs page and the entry side by side. It is worth knowing which of these need a key: the OpenRouter ranking and the Alibaba lists do, and neither script will write without one.

| | provider | tag | priced | website | notes |
|---|---|---|---|---|---|
| [x] | `anthropic` | official | 4/4 | <https://anthropic.com/> | checked 2026-09-14 — the four models and their prices from the vendor's own pricing page; `billing` is `both` (the API and Pro/Max share a host) |
| [ ] | `baidu-qianfan-token-plan` | official | 0/8 | <https://cloud.baidu.com/product-s/qianfan_home> |  |
| [ ] | `bailing` | official | 0/1 | <https://www.tbox.cn/> |  |
| [ ] | `byteplus` | official | 0/1 | <https://www.byteplus.com/en> |  |
| [x] | `deepseek` | official | 2/2 | <https://deepseek.com/> | checked 2026-09-14 — prices, peak/off-peak, CNY, endpoints (see the fetch script) |
| [ ] | `doubaoseed` | official | 1/3 | <https://www.volcengine.com/> |  |
| [ ] | `google-ai-studio` | official | 1/2 | <https://aistudio.google.com/> |  |
| [ ] | `groq` | official | 0/1 | <https://groq.com/> |  |
| [x] | `kimi` | official | 4/4 | <https://moonshot.cn/> | checked 2026-09-14 — prices, currency, model list (see the fetch script) |
| [x] | `kimi-for-coding` | official | 0/4 | <https://kimi.com/> | checked 2026-09-14 — model list, CNY, no per-token price (a membership carries none); `plan_query` = `kimi` |
| [ ] | `longcat` | official | 0/1 | <https://longcat.chat/> |  |
| [ ] | `minimax` | official | 1/1 | <https://minimaxi.com/> |  |
| [ ] | `minimax-intl` | official | 1/1 | <https://minimax.io/> |  |
| [ ] | `nous-research` | official | 0/2 | <https://nousresearch.com/> |  |
| [x] | `openrouter` | aggregate | 20/20 | <https://openrouter.ai/> | checked 2026-09-14 — model list from the vendor's own usage ranking, prices and upstream ids from its models API (see the two fetch scripts) |
| [ ] | `qianwenai` | official | 2/2 | <https://www.qianwenai.com/> |  |
| [ ] | `qianwenai-token-plan` | official | 0/9 | <https://www.qianwenai.com/> |  |
| [ ] | `stepfun` | official | 2/2 | <https://stepfun.com/> |  |
| [ ] | `stepfun-intl` | official | 2/2 | <https://stepfun.ai/> |  |
| [ ] | `tencent-token-plan` | official | 0/15 | <https://www.tencent.com/> |  |
| [ ] | `xai` | official | 1/1 | <https://x.ai/> |  |
| [ ] | `xiaomi-mimo` | official | 2/2 | <https://mimo.xiaomi.com/> |  |
| [ ] | `xiaomi-mimo-token-plan-china` | official | 2/2 | <https://mimo.xiaomi.com/> |  |
| [x] | `zhipu-glm` | official | 2/2 | <https://bigmodel.cn/> | checked 2026-09-14 — GLM-5.3 and -Flash with their rates from the vendor's page (CNY); `billing` is `both`, and the `zhipu` quota template reads the domestic host |
| [x] | `zhipu-glm-intl` | official | 2/2 | <https://z.ai/> | checked 2026-09-14 — the same two models as Z.AI lists them (USD); `billing` is `both`; the same `zhipu` template, which routes to api.z.ai off the entry's own host |

Priced counts are `priced/total` models. The list is a snapshot of `entries/` — a new provider needs a new line, and a removed one loses its own.
