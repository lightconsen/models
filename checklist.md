# Provider review checklist

78 providers. Tick one when its data has been checked against what the vendor itself publishes — the prices, and the things a price depends on:

- every live model is listed, and no retired one is — where the vendor's own page
  enumerates its lineup, which is most of them. An aggregator routing hundreds
  does not, so the entry carries the ones it is known for and the notes say which
  rule picked them (`openrouter` uses the vendor's own usage ranking)
- `in` / `out` / `cache_read` match the vendor's own table, in the currency the vendor bills in
- any time-of-day pricing is recorded, not left in prose. Plan pricing cannot be,
  and no entry should be held for it: a subscription's monthly figure has no field,
  so the twelve entries that carry one carry it in `desc`. This bullet stays as the
  marker of that gap; do not go looking for the field
- a plan-billed entry says whether its usage can be read with the API key alone,
  and `plan_query` names the right template when it can
- `desc` introduces the vendor and nothing that expires — no model names, no
  capabilities, no user counts (see the README's "What `desc` is for")
- the endpoints still answer, and `website` is the vendor's own site

Four vendors can be read by script rather than by eye, and when one applies, run it before reading anything: `fetch-deepseek-pricing.mjs` and `fetch-kimi-pricing.mjs` for prices, `fetch-openrouter-pricing.mjs` for prices and `fetch-openrouter-rankings.mjs` for which models OpenRouter carries at all, `fetch-aliyun-models.mjs` for the Alibaba entries' model lists. The rest is reading their docs page and the entry side by side. It is worth knowing which of these need a key: the OpenRouter ranking and the Alibaba lists do, and neither script will write without one.

| | provider | tag | priced | website | notes |
|---|---|---|---|---|---|
| [ ] | `9527code` | aggregate | 3/5 | <https://9527.codes/> |  |
| [ ] | `a6api` | aggregate | 2/2 | <https://a6api.com/> |  |
| [ ] | `aicodemirror` | third | 4/4 | <https://aicodemirror.ai/> |  |
| [ ] | `aicodewith` | aggregate | 4/4 | <https://aicodewith.ai/> |  |
| [ ] | `aicoding` | third | 4/4 | <https://aicoding.inc/> |  |
| [ ] | `aigocode` | third | 4/4 | <https://aigocode.app/> |  |
| [ ] | `aihubmix` | aggregate | 3/3 | <https://aihubmix.com/> |  |
| [ ] | `amux` | aggregate | 1/1 | <https://amux.ai/> |  |
| [x] | `anthropic` | official | 4/4 | <https://anthropic.com/> | checked 2026-09-14 — the four models and their prices from the vendor's own pricing page; `billing` is `both` (the API and Pro/Max share a host) |
| [ ] | `apikey-fun` | third | 4/5 | <https://apikey.fun/> |  |
| [ ] | `apinebula` | third | 2/2 | <https://apinebula.ai/> |  |
| [ ] | `atlascloud` | aggregate | 1/1 | <https://atlascloud.ai/> |  |
| [ ] | `baidu-qianfan-token-plan` | official | 3/8 | <https://cloud.baidu.com/product-s/qianfan_home> |  |
| [ ] | `bailing` | official | 0/1 | <https://www.tbox.cn/> |  |
| [ ] | `byteplus` | official | 0/1 | <https://www.byteplus.com/en> |  |
| [ ] | `ccsub` | aggregate | 1/1 | <https://ccsub.net/> |  |
| [ ] | `cherryin` | aggregate | 3/3 | <https://cherryin.net/> |  |
| [ ] | `claudeapi` | aggregate | 0/0 | <https://apito.ai/> |  |
| [ ] | `claudecn` | third | 2/4 | <https://claudecn.top/> |  |
| [ ] | `code0` | aggregate | 2/2 | <https://code0.ai/> |  |
| [ ] | `compshare` | aggregate | 2/2 | <https://compshare.cn/> |  |
| [ ] | `compshare-coding-plan` | aggregate | 2/2 | <https://compshare.cn/> |  |
| [ ] | `crazyrouter` | third | 4/4 | <https://crazyrouter.com/> |  |
| [ ] | `cubence` | third | 4/4 | <https://cubence.com/> |  |
| [x] | `deepseek` | official | 2/2 | <https://deepseek.com/> | checked 2026-09-14 — prices, peak/off-peak, CNY, endpoints (see the fetch script) |
| [ ] | `dmxapi` | aggregate | 3/3 | <https://dmxapi.cn/> |  |
| [ ] | `doubaoseed` | official | 1/3 | <https://www.volcengine.com/> |  |
| [ ] | `e-flowcode` | third | 5/5 | <https://e-flowcode.cc/> |  |
| [ ] | `etok-ai` | third | 4/4 | <https://etok.ai/> |  |
| [ ] | `fennoai` | aggregate | 1/1 | <https://fenno.ai/> |  |
| [ ] | `google-ai-studio` | official | 1/2 | <https://aistudio.google.com/> |  |
| [ ] | `groq` | official | 0/1 | <https://groq.com/> |  |
| [ ] | `jiekou-ai` | aggregate | 1/1 | <https://jiekou.ai/> |  |
| [x] | `kimi` | official | 4/4 | <https://moonshot.cn/> | checked 2026-09-14 — prices, currency, model list (see the fetch script) |
| [x] | `kimi-for-coding` | official | 0/4 | <https://kimi.com/> | checked 2026-09-14 — model list, CNY, no per-token price (a membership carries none); `plan_query` = `kimi` |
| [ ] | `longcat` | official | 0/1 | <https://longcat.chat/> |  |
| [ ] | `micu` | third | 3/3 | <https://micuapi.ai/> |  |
| [ ] | `minimax` | official | 1/1 | <https://minimaxi.com/> |  |
| [ ] | `minimax-intl` | official | 1/1 | <https://minimax.io/> |  |
| [ ] | `modelscope` | free | 1/1 | <https://modelscope.cn/> |  |
| [ ] | `nous-research` | official | 0/2 | <https://nousresearch.com/> |  |
| [ ] | `novita-ai` | aggregate | 1/1 | <https://novita.ai/> |  |
| [ ] | `nvidia` | aggregate | 1/1 | <https://nvidia.com/> |  |
| [ ] | `ollama` | local | 0/2 | <https://ollama.com/> |  |
| [ ] | `opencode-go` | third | 2/4 | <https://opencode.ai/> |  |
| [x] | `openrouter` | aggregate | 20/20 | <https://openrouter.ai/> | checked 2026-09-14 — model list from the vendor's own usage ranking, prices and upstream ids from its models API (see the two fetch scripts) |
| [ ] | `packycode` | third | 4/4 | <https://packyapi.ai/> |  |
| [ ] | `patewayai` | third | 0/0 | <https://pateway.ai/> |  |
| [ ] | `pipellm` | aggregate | 4/4 | <https://pipellm.ai/> |  |
| [ ] | `ppio` | aggregate | 2/2 | <https://ppio.com/> |  |
| [ ] | `qianwenai` | official | 2/2 | <https://www.qianwenai.com/> |  |
| [ ] | `qianwenai-token-plan` | official | 0/9 | <https://www.qianwenai.com/> |  |
| [ ] | `qiniu` | aggregate | 2/2 | <https://qnaigc.com/> |  |
| [ ] | `relaxycode` | third | 0/0 | <https://www.relaxycode.com/> |  |
| [ ] | `rightcode` | third | 4/4 | <https://rightapi.ai/> |  |
| [ ] | `runapi` | aggregate | 2/4 | <https://runapi.host/> |  |
| [ ] | `shengsuanyun` | aggregate | 4/4 | <https://shengsuanyun.com/> |  |
| [ ] | `siliconflow` | aggregate | 1/1 | <https://siliconflow.cn/> |  |
| [ ] | `siliconflow-intl` | aggregate | 1/1 | <https://siliconflow.com/> |  |
| [ ] | `sssaicode` | third | 4/4 | <https://sssaicodeapi.com/> |  |
| [ ] | `stepfun` | official | 2/2 | <https://stepfun.com/> |  |
| [ ] | `stepfun-intl` | official | 2/2 | <https://stepfun.ai/> |  |
| [ ] | `subrouter` | aggregate | 2/2 | <https://subrouter.ai/> |  |
| [ ] | `sudocode-chat` | third | 1/1 | <https://sudocode.chat/> |  |
| [ ] | `sudocode-us` | third | 2/2 | <https://sudocode.us/> |  |
| [ ] | `teamorouter` | aggregate | 1/1 | <https://teamorouter.cn/> |  |
| [ ] | `tencent-token-plan` | official | 1/4 | <https://www.tencent.com/> |  |
| [ ] | `tencent-token-plan-enterprise-pro` | official | 3/5 | <https://cloud.tencent.com/> |  |
| [ ] | `tencent-token-plan-intl` | official | 1/5 | <https://www.tencentcloud.com/> |  |
| [ ] | `therouter` | aggregate | 4/4 | <https://therouter.ai/> |  |
| [ ] | `together-ai` | aggregate | 2/3 | <https://together.xyz/> |  |
| [ ] | `xai` | official | 1/1 | <https://x.ai/> |  |
| [ ] | `xiaomi-mimo` | official | 2/2 | <https://mimo.xiaomi.com/> |  |
| [ ] | `xiaomi-mimo-token-plan-china` | official | 2/2 | <https://mimo.xiaomi.com/> |  |
| [ ] | `xycai` | aggregate | 2/2 | <https://xycai.us/> |  |
| [ ] | `zetaapi` | aggregate | 1/1 | <https://zetaapi.ai/> |  |
| [x] | `zhipu-glm` | official | 2/2 | <https://bigmodel.cn/> | checked 2026-09-14 — GLM-5.3 and -Flash with their rates from the vendor's page (CNY); `billing` is `both`, and the `zhipu` quota template reads the domestic host |
| [x] | `zhipu-glm-intl` | official | 2/2 | <https://z.ai/> | checked 2026-09-14 — the same two models as Z.AI lists them (USD); `billing` is `both`; the same `zhipu` template, which routes to api.z.ai off the entry's own host |

Priced counts are `priced/total` models. The list is a snapshot of `entries/` — a new provider needs a new line, and a removed one loses its own.
