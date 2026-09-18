/**
 * Every price source this repo knows how to read, one adapter each.
 *
 * An adapter is the machine-readable form of what `checklist.md` records in
 * prose: which page a number came from and how to get it back out. Keeping them
 * in one list is the point — before this, "where does this price come from" had
 * five different answers depending on which script you happened to read.
 *
 * An entry with no adapter here is not an oversight. It is an entry whose price
 * source is a console behind a login, or a plan that publishes no per-token rate
 * at all. Those stay hand-maintained, and `fetch-all.mjs` says so on every run
 * rather than leaving the gap to be rediscovered.
 */
import anthropic from "./anthropic.mjs";
import deepseek from "./deepseek.mjs";
import googleGemini from "./google-gemini.mjs";
import kimi from "./kimi.mjs";
import minimax from "./minimax.mjs";
import togetherai from "./togetherai.mjs";
import modelsdev from "./modelsdev.mjs";
import openai from "./openai.mjs";
import openrouter from "./openrouter.mjs";
import qianwen from "./qianwen.mjs";
import volcesark from "./volcesark.mjs";
import xai from "./xai.mjs";
import xiaomiMimo from "./xiaomi-mimo.mjs";
import zhipu from "./zhipu.mjs";

export default [
  anthropic,
  deepseek,
  googleGemini,
  kimi,
  minimax,
  ...modelsdev,
  togetherai,
  openai,
  openrouter,
  qianwen,
  volcesark,
  xai,
  xiaomiMimo,
  zhipu,

  // No adapter, and why:
  //   (cohere was removed 2026-09-18: priced only previous-generation models, its
  //    current flagship free — out of scope by the owner's call, not by failure)
  //   kimi-for-coding          a membership: one price for the service, no per-token rate
  //   tencent-token-plan       a prepaid plan; the model list is published, the rates are not
  //   baidu-qianfan-token-plan a prepaid plan, same shape
  //   qianwenai-token-plan     a plan; its model list needs an API key (fetch-aliyun-models.mjs)
];
