/**
 * OpenCode Go's catalogue, from the plan's own docs page.
 *
 * Go is the subscription arm of OpenCode Console: two monthly plans (Go at
 * $10, Go Plus at $40) that include usage across a smaller, coding-focused
 * model list. It has its own base URL — `https://opencode.ai/inference/go/…` —
 * which is why it is a separate entry from the pay-as-you-go `opencode`, and
 * why the two do not collide in the app's endpoint-based `catalog_id_for`.
 *
 * The plan publishes no per-token rate of its own: usage is drawn from the
 * plan's included allowance, and the page's own table is a request-count
 * estimate, not a price. So this entry carries the membership the app needs to
 * show the plan's models and no prices — the same shape as `kimi-for-coding`
 * and the other `billing: plan` entries.
 *
 * The app already ships the `opencode_go` plan-quota template (it is in
 * `PLAN_QUERY_TEMPLATES`), so the entry declares it.
 */
import { getText, drift, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://opencode.ai/v2/docs/console/go/";

const strip = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export default {
  ids: ["opencode-go"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: [],

  async read() {
    const html = await getText(URL, { headers: { accept: "text/html" } });
    const tables = (html.match(/<table[\s\S]*?<\/table>/g) ?? []).map((t) =>
      (t.match(/<tr[\s\S]*?<\/tr>/g) ?? []).map((r) =>
        (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? []).map(strip),
      ),
    );
    const table = tables.find(
      (t) => /^model$/i.test(t[0]?.[0] ?? "") && /^model id$/i.test(t[0]?.[1] ?? ""),
    );
    if (!table) drift("no Model / Model ID table — the Go docs restructured");

    const rows = [];
    for (const cells of table.slice(1)) {
      const [name, id] = cells;
      if (!name || !id) continue;
      rows.push({ id, name });
    }
    if (rows.length === 0) drift("the Go model table is empty");

    return {
      rows: { "opencode-go": rows },
      notes: { "opencode-go": [`${rows.length} models in the Go plan's list; the plan publishes no per-token rate`] },
    };
  },
};
