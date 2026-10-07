#!/usr/bin/env node
/**
 * Say what a sync run actually did, from the outcome file `fetch-all.mjs
 * --outcome` wrote.
 *
 * Why a file and not the exit code: the two workflows used to read `code != 0`
 * and *guess* the cause, and the guess was wrong for three weeks. From
 * 2026-09-25 to 2026-10-07 every daily run exited 1 because the trust policy
 * refused a 25-model churn — and the report told the reader "at least one source
 * could not be read", printed an empty list where the failing sources should
 * have been, and never mentioned the policy once. Nobody looked, because the
 * message described a different problem. The pipeline knows why it stopped; it
 * should say so rather than leave it to be inferred.
 *
 * Usage:
 *   node scripts/report-run.mjs <outcome.json>          the run's report
 *   node scripts/report-run.mjs <outcome.json> --pr     the section for a PR body
 *
 * Under GitHub Actions (GITHUB_ACTIONS=true) the report also emits annotations,
 * so a held-back entry shows as a warning on the run rather than only inside a
 * summary nobody opened.
 */
import { readFileSync } from "node:fs";

const [file, ...flags] = process.argv.slice(2);
const PR = flags.includes("--pr");
const CI = process.env.GITHUB_ACTIONS === "true";

if (!file) {
  console.error("usage: node scripts/report-run.mjs <outcome.json> [--pr]");
  process.exit(2);
}

let run;
try {
  run = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  // A missing outcome file means the run died before it could report — the log
  // above still carries everything, so this is a pointer, not a failure. The
  // report is never a reason to fail a run that otherwise worked.
  console.log(`no outcome file (${file}): ${err.message}`);
  console.log("The log above is the record; the run did not reach the end of the pipeline.");
  process.exit(0);
}

const held = run.held ?? [];
const failed = run.failed ?? [];
const unreachable = run.unreachable ?? [];

if (PR) {
  // Only the sections a PR needs: what waits for a person. Commits and the log
  // are the caller's, and the price changes are the diff itself.
  const out = [];
  if (run.systemic) {
    out.push("### The whole run was refused", "", "Every entry's proposed change was withheld — the run as a whole", "looked like a misread rather than vendors' news:", "");
    for (const reason of run.runReasons) out.push(`- ${reason}`);
    out.push("");
  } else if (held.length) {
    out.push(
      "### Held back for review",
      "",
      "The trust policy holds an entry back when its source proposes more membership",
      "change than a machine may apply on its own. Nothing is written for these —",
      "prices included, because a source that just changed shape is the one whose",
      "numbers we are least sure of. The next run proposes the same list again until",
      "someone looks, so this does not expire.",
      "",
      "| entry | why | would add | would drop |",
      "|---|---|---|---|",
    );
    for (const h of held) {
      const add = h.created.map((id) => `\`${id}\``).join(", ") || "—";
      const drop = h.deleted.map((id) => `\`${id}\``).join(", ") || "—";
      out.push(`| \`${h.entry}\` | ${h.reasons.join("; ")} | ${add} | ${drop} |`);
    }
    out.push("");
  }
  if (failed.length) {
    out.push(
      "### Sources this runner could not read",
      "",
      "Nothing here says anything about the vendor's prices — these entries were compared",
      "against nothing, so a change in them would not have shown up:",
      "",
    );
    for (const f of failed) out.push(`- \`${f.entry}\` — ${f.error}`);
    out.push("");
  }
  if (unreachable.length) {
    out.push(
      "### Not reachable from this network",
      "",
      "A host refusing this network is an environment fact, not a broken page — the",
      "other observation point reads these:",
      "",
    );
    for (const u of unreachable) out.push(`- \`${u.entry}\` — ${u.error}`);
    out.push("");
  }
  process.stdout.write(out.join("\n"));
  process.exit(0);
}

// ── the run's report ──
const out = [];

if (run.systemic) {
  out.push("The whole run was refused — every entry's change was withheld:");
  for (const reason of run.runReasons) out.push(`  ! ${reason}`);
  out.push("  That is the shape of a run-wide misread, not a vendor's news. Nothing was written.");
} else if (held.length) {
  out.push(`${held.length} entr(ies) held back by the trust policy — nothing written for them, prices included:`);
  for (const h of held) {
    out.push(`  ${h.entry}`);
    for (const reason of h.reasons) out.push(`    ! ${reason}`);
    for (const id of h.created) out.push(`      + ${id}`);
    for (const id of h.deleted) out.push(`      - ${id}`);
  }
  out.push("  Review the list, then re-run with --force-write if it is right; the next run");
  out.push("  proposes the same list again either way.");
  if (CI) {
    for (const h of held) {
      console.log(`::warning::${h.entry} held back by the trust policy — ${h.reasons.join("; ")}`);
    }
  }
}

if (failed.length) {
  out.push(`${failed.length} entr(ies) could not be read — their entries are unchanged, and this says`);
  out.push("nothing about their prices:");
  for (const f of failed) out.push(`  ✗ ${f.entry} — ${f.error}`);
  if (CI) console.log(`::error::${failed.length} entr(ies) could not be read: ${failed.map((f) => f.entry).join(", ")}`);
}

if (unreachable.length) {
  out.push(`${unreachable.length} entr(ies) unreachable from this network — the other observation point`);
  out.push("reads these, so nothing is wrong with their pages:");
  for (const u of unreachable) out.push(`  ↯ ${u.entry}`);
}

if ((run.changed ?? []).length === 0) {
  out.push("No vendor changed a price since the last run.");
}

console.log(out.join("\n"));
