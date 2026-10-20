// Screen-time estimate for a Fountain draft. Page counts are useless for Indic scripts (Telugu lines wrap differently),
// so time is estimated from what is performed: spoken words, action beats, silences and scene changes.
import { parseFountain } from "./export.js";
import type { Settings } from "./store.js";

// Spoken words per second. Telugu words are long and agglutinative, so they are spoken slower than English ones.
const WPS_INDIC = Number(process.env.SCRIPT_WPS_INDIC ?? 1.9);
const WPS_LATIN = Number(process.env.SCRIPT_WPS ?? 2.5);
const INDIC = /[ऀ-෿]/;

const words = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

export function estimateSeconds(fountain: string): number {
  let s = 0;
  for (const el of parseFountain(fountain)) {
    if (el.type === "scene") s += 2;
    else if (el.type === "dialogue") {
      const ws = words(el.text);
      const indic = ws.filter((w) => INDIC.test(w)).length;
      s += indic / WPS_INDIC + (ws.length - indic) / WPS_LATIN + 0.6; // + a breath between lines
    } else if (el.type === "paren") {
      if (/beat|pause|silence|తర్వాత/i.test(el.text)) s += 1.5;
    } else if (el.type === "action") {
      const sentences = el.text.split(/(?<=[.!?…])\s+/).filter((x) => x.trim()).length;
      s += sentences * 2.2;
      if (/long silence|long pause|a long moment|silence\.|waits|holds (her|his) gaze/i.test(el.text)) s += 3;
    } else if (el.type === "transition") s += 1;
  }
  return Math.round(s);
}

export const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

// The per-unit target the prompts ask for: under the hard cap, and small enough that the total cap holds.
export function unitBudget(s: Settings): { cap?: number; target?: number } {
  // The per-unit cap is only the hard episode cap; the series band is enforced afterwards by balancing.
  const cap = s.maxUnitSeconds;
  const band = s.maxTotalMinutes ? (((s.minTotalMinutes ?? s.maxTotalMinutes * 0.9) + s.maxTotalMinutes) / 2) * 60 / s.units : undefined;
  if (cap === undefined) return band === undefined ? {} : { target: Math.floor(band) };
  const target = Math.min(cap - 5, band ?? cap * 0.85);
  return { cap: Math.floor(cap), target: Math.floor(target) };
}

// Units needed so the series lands mid-band without any unit going over its cap.
export function unitsForBand(minTotal: number, maxTotal: number, unitCapSeconds: number): number {
  const perUnit = Math.min(unitCapSeconds * 0.9, unitCapSeconds - 10);
  return Math.max(1, Math.round((((minTotal + maxTotal) / 2) * 60) / perUnit));
}

// When the drafts as a whole fall outside the series band: which units to lengthen or cut, and to what.
export function balancePlan(s: Settings, runtimes: { part: string; seconds: number }[]): { part: string; notes: string }[] {
  const total = runtimes.reduce((a, r) => a + r.seconds, 0);
  const { cap } = unitBudget(s);
  const plan: { part: string; notes: string }[] = [];
  if (s.minTotalMinutes && total < s.minTotalMinutes * 60) {
    let deficit = s.minTotalMinutes * 60 + 30 - total;
    const room = (r: { seconds: number }) => (cap ?? r.seconds * 1.5) - 8 - r.seconds;
    for (const r of [...runtimes].sort((a, b) => a.seconds - b.seconds)) {
      if (deficit <= 0) break;
      const add = Math.min(Math.max(0, room(r)), Math.max(10, Math.ceil(deficit / 3)));
      if (add < 5) continue;
      deficit -= add;
      plan.push({
        part: r.part,
        notes: `The series is ${fmt(total)}, under its ${s.minTotalMinutes}-minute minimum. Lengthen this episode from about ${fmt(r.seconds)} to about ${fmt(r.seconds + add)} by deepening moments already in it (a reaction, a silence, a line of subtext, a beat of behaviour). Do not add plot, characters or scenes that change the story${cap ? `, and stay under the ${fmt(cap)} cap` : ""}.`,
      });
    }
  } else if (s.maxTotalMinutes && total >= s.maxTotalMinutes * 60) {
    let surplus = total - (s.maxTotalMinutes * 60 - 30);
    for (const r of [...runtimes].sort((a, b) => b.seconds - a.seconds)) {
      if (surplus <= 0) break;
      const cut = Math.min(Math.floor(r.seconds * 0.2), Math.max(10, Math.ceil(surplus / 3)));
      surplus -= cut;
      plan.push({
        part: r.part,
        notes: `The series is ${fmt(total)}, over its ${s.maxTotalMinutes}-minute maximum. Cut this episode from about ${fmt(r.seconds)} to about ${fmt(r.seconds - cut)}: trim action and the least essential lines; keep the hook, the turn and the ending beat.`,
      });
    }
  }
  return plan;
}

export function overCap(s: Settings, seconds: number): string | undefined {
  const { cap } = unitBudget(s);
  if (cap !== undefined && seconds >= cap) return `estimated ${fmt(seconds)}, over the ${fmt(cap)} cap`;
}

export function runtimeReport(s: Settings, entries: { number: number; title: string; seconds: number }[]): string {
  const total = entries.reduce((a, e) => a + e.seconds, 0);
  const { cap } = unitBudget(s);
  const label = s.format === "feature" ? "Sequence" : s.format === "short" ? "Part" : "Episode";
  return [
    `# Runtime estimate`,
    ``,
    `Estimated from spoken words (${WPS_INDIC} words/s for Indic scripts, ${WPS_LATIN} for English), action beats, silences and scene changes. A table read is the real test.`,
    ``,
    `| ${label} | Title | Est. runtime | Cap |`,
    `|---|---|---|---|`,
    ...entries.map((e) => `| ${e.number} | ${e.title} | ${fmt(e.seconds)} | ${cap ? (e.seconds >= cap ? `**OVER ${fmt(cap)}**` : `under ${fmt(cap)}`) : "—"} |`),
    `| **Total** | | **${fmt(total)}** | ${
      s.minTotalMinutes && total < s.minTotalMinutes * 60
        ? `**UNDER ${s.minTotalMinutes}:00**`
        : s.maxTotalMinutes
          ? total >= s.maxTotalMinutes * 60
            ? `**OVER ${s.maxTotalMinutes}:00**`
            : `${s.minTotalMinutes ? `${s.minTotalMinutes}:00–` : "under "}${s.maxTotalMinutes}:00 ✓`
          : "—"
    } |`,
    ``,
  ].join("\n");
}
