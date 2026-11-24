/**
 * OpenCode Go's catalogue, from the plan's own models endpoint.
 *
 * Go is the subscription arm of OpenCode Console: monthly plans (Go at $10,
 * Go Plus at $40, Go Teams at $20/member) that include usage across a smaller,
 * coding-focused model list. It has its own base URL —
 * `https://opencode.ai/inference/go/…` — which is why it is a separate entry
 * from the pay-as-you-go `opencode`, and why the two do not collide in the
 * app's endpoint-based `catalog_id_for`.
 *
 * The plan publishes no per-token rate of its own: usage is drawn from the
 * plan's included allowance, and the page's own table is a request-count
 * estimate, not a price. So this entry carries the membership the app needs to
 * show the plan's models and no prices — the same shape as `kimi-for-coding`
 * and the other `billing: plan` entries.
 *
 * The membership used to come from a "Model / Model ID" table on the Go docs
 * page. On 2026-11 that table was gone — the page keeps five tables, none of
 * them the model list — and the docs now say to read
 * `https://opencode.ai/inference/go/v1/models`, which answers 200 without a
 * key. That endpoint is the better source anyway: it is the list the API
 * actually accepts, so an id it carries is the id a client may send, and the
 * old table's `longcat-2.5-free` (the model before it left the free tier) is
 * exactly the kind of spelling a doc table can drift into.
 *
 * `type` splits the response: `chat` rows are the coding models this entry
 * lists; `embedding` and `decision` rows are other products on the same
 * endpoint and are reported, not carried.
 *
 * The app already ships the `opencode_go` plan-quota template (it is in
 * `PLAN_QUERY_TEMPLATES`), so the entry declares it.
 */
import { getJson, drift, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://opencode.ai/inference/go/v1/models";

export default {
  ids: ["opencode-go"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: [],

  async read() {
    const body = await getJson(URL);
    const models = body?.data;
    if (!Array.isArray(models) || models.length === 0) {
      drift("the models endpoint returned no data — the response shape has changed");
    }
    // The id is the model's own string; it is not derived from the display
    // name (`gpt-6-luna` is "GPT-6 Luna", `longcat-2.5` is "LongCat-2.5").
    for (const m of models) {
      if (typeof m?.id !== "string" || m.id === "") drift("a model in the response carries no id");
    }
    const chat = models.filter((m) => m.type === "chat");
    if (chat.length === 0) drift("the endpoint lists no chat models — the plan may have been restructured");
    const rows = chat.map((m) => ({ id: m.id, name: m.name ?? m.id }));

    const other = {};
    for (const m of models) if (m.type !== "chat") other[m.type ?? "untyped"] = (other[m.type ?? "untyped"] ?? 0) + 1;
    return {
      rows: { "opencode-go": rows },
      notes: {
        "opencode-go": [
          `${rows.length} chat models from the plan's own models endpoint; the plan publishes no per-token rate`,
          ...Object.entries(other).map(([t, n]) => `${n} non-chat ${t} model(s) on the same endpoint, not part of this entry`),
        ],
      },
    };
  },
};
