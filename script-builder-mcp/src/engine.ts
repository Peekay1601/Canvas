// The pipeline: which part comes next, the prompt for it, saving results, and (engine mode) running it with Claude.
import Anthropic from "@anthropic-ai/sdk";
import {
  isDone,
  loadState,
  markDone,
  markDownstreamStale,
  partFiles,
  projectMd,
  readFile,
  readOutline,
  saveState,
  STAGES,
  unitLabel,
  writeFile,
  type Outline,
  type ProjectState,
  type Stage,
} from "./store.js";
import * as P from "./prompts.js";
import { exportAll } from "./export.js";
import { balancePlan, estimateSeconds, fmt, overCap, runtimeReport, unitBudget } from "./runtime.js";

export interface Task {
  part: string;
  stage: Stage;
  context: string;
  instruction: string;
  schema?: Record<string, unknown>;
  maxTokens: number;
}

const MODEL = process.env.SCRIPT_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.SCRIPT_EFFORT ?? "high") as "low" | "medium" | "high" | "xhigh" | "max";
const CONCURRENCY = Math.max(1, Number(process.env.SCRIPT_CONCURRENCY ?? 4));

export const hasEngine = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client: Anthropic | undefined;
const anthropic = () => (client ??= new Anthropic());

// ---------- reading what exists ----------

async function bibleText(slug: string): Promise<string | undefined> {
  const [chars, world] = await Promise.all([readFile(slug, "bible/characters.md"), readFile(slug, "bible/world_rules.md")]);
  return chars && world ? `${chars}\n\n${world}` : undefined;
}

export async function readPart(state: ProjectState, part: string): Promise<string | undefined> {
  if (part === "bible") return bibleText(state.slug);
  const files = partFiles(state.slug, part);
  // Outline parts are stored as JSON plus a readable Markdown copy; read the Markdown.
  return readFile(state.slug, files[files.length - 1]);
}

async function contextFor(state: ProjectState, stage: "bible" | "outline" | "units"): Promise<string> {
  const s = state.settings;
  const concept = await readFile(state.slug, "build/concept.md");
  if (stage === "bible") return P.context(s, { concept });
  const bible = await bibleText(state.slug);
  if (stage === "outline") return P.context(s, { concept, bible });
  const outline = await readFile(state.slug, "build/outline.md");
  return P.context(s, { concept, bible, outline });
}

function draftMaxTokens(state: ProjectState): number {
  return state.settings.format === "microdrama" || state.settings.format === "short" ? 16000 : 64000;
}

// ---------- what to do next ----------

export function stageOf(part: string): Stage {
  if (part === "concept" || part === "bible") return part;
  if (part.startsWith("beats:")) return "beats";
  if (part.startsWith("draft:") || part === "assembly" || part === "balance") return "script";
  if (part.startsWith("script_review:")) return "reviewed";
  return "outline";
}

// All parts that can be written right now (they are independent of each other), in order.
const MAX_BALANCE_ROUNDS = 3;
export const maxReviewRounds = (state: ProjectState) => state.settings.maxReviewRounds ?? 3;
const reviewSettled = (state: ProjectState) =>
  !state.settings.reviewScript || state.review?.approved || (state.review?.round ?? 0) >= maxReviewRounds(state);

function needsBalance(state: ProjectState, outline: Outline): boolean {
  const s = state.settings;
  if (!s.minTotalMinutes && !s.maxTotalMinutes) return false;
  if ((state.balanceRounds ?? 0) >= MAX_BALANCE_ROUNDS) return false;
  const total = outline.units.reduce((a, u) => a + (state.runtimes?.[`draft:${u.number}`] ?? 0), 0);
  return (!!s.minTotalMinutes && total < s.minTotalMinutes * 60) || (!!s.maxTotalMinutes && total >= s.maxTotalMinutes * 60);
}

// "balance" and "assembly" are done by code, not by a writer: advance() runs them and returns the next writing parts.
export async function advance(state: ProjectState, includeReview = true): Promise<{ parts: string[]; files: string[] }> {
  for (;;) {
    const parts = await pendingParts(state, includeReview);
    if (parts[0] === "balance") {
      await applyBalance(state);
      continue;
    }
    if (parts[0] === "assembly") return { parts: [], files: await assemble(state) };
    return { parts, files: [] };
  }
}

async function applyBalance(state: ProjectState): Promise<void> {
  const outline = (await readOutline(state.slug))!;
  const runtimes = outline.units.map((u) => ({ part: `draft:${u.number}`, seconds: state.runtimes?.[`draft:${u.number}`] ?? 0 }));
  state.balanceRounds = (state.balanceRounds ?? 0) + 1;
  for (const { part, notes } of balancePlan(state.settings, runtimes)) {
    state.parts[part] = { ...state.parts[part], status: "stale", pendingNotes: notes };
  }
}

export async function pendingParts(state: ProjectState, includeReview = true): Promise<string[]> {
  for (const p of ["concept", "bible", "outline"]) if (!isDone(state, p)) return [p];
  if (state.settings.reviewOutline) {
    if (!isDone(state, "review")) return ["review"];
    if (!isDone(state, "revised_outline")) return ["revised_outline"];
  }
  const outline = await readOutline(state.slug);
  if (!outline) return ["outline"];
  const nums = outline.units.map((u) => u.number);
  const beats = nums.map((n) => `beats:${n}`).filter((p) => !isDone(state, p));
  if (beats.length) return beats;
  const drafts = nums.map((n) => `draft:${n}`).filter((p) => !isDone(state, p));
  if (drafts.length) return drafts;
  if (needsBalance(state, outline)) return ["balance"];
  if (includeReview && !reviewSettled(state)) return [`script_review:${(state.review?.round ?? 0) + 1}`];
  return isDone(state, "assembly") ? [] : ["assembly"];
}

function unitOf(outline: Outline, part: string) {
  const n = Number(part.split(":")[1]);
  const idx = outline.units.findIndex((u) => u.number === n);
  if (idx < 0) throw new Error(`No ${part} in the outline`);
  return { unit: outline.units[idx], prev: outline.units[idx - 1], next: outline.units[idx + 1] };
}

async function fullScript(state: ProjectState): Promise<string> {
  const outline = (await readOutline(state.slug))!;
  const pages = await Promise.all(outline.units.map((u) => readFile(state.slug, partFiles(state.slug, `draft:${u.number}`)[0])));
  return pages.map((p) => (p ?? "").trim()).join("\n\n===\n\n");
}

export async function buildTask(state: ProjectState, part: string, notes?: string): Promise<Task> {
  const s = state.settings;
  notes ??= state.parts[part]?.pendingNotes;
  const stage = stageOf(part);
  let task: Task;
  if (part === "concept") {
    task = { part, stage, context: P.brief(s), instruction: P.CONCEPT_TASK(s, notes), maxTokens: 16000 };
  } else if (part === "bible") {
    task = {
      part,
      stage,
      context: await contextFor(state, "bible"),
      instruction: P.BIBLE_TASK(notes),
      schema: P.BIBLE_SCHEMA,
      maxTokens: 32000,
    };
  } else if (part === "outline" || part === "revised_outline") {
    const review = part === "revised_outline" ? await readFile(state.slug, "room/outline_review.md") : undefined;
    // A revision of an existing outline needs the outline itself in context.
    const ctx = await contextFor(state, part === "revised_outline" || (notes && isDone(state, part)) ? "units" : "outline");
    task = {
      part,
      stage,
      context: ctx,
      instruction: review ? P.REVISED_OUTLINE_TASK(s, review) : P.OUTLINE_TASK(s, notes),
      schema: P.OUTLINE_SCHEMA,
      maxTokens: 64000,
    };
  } else if (part === "review") {
    task = {
      part,
      stage,
      context: await contextFor(state, "units"),
      instruction: [
        "Run the writers' room on the outline above. Write each critique in turn under a heading with the critic's name, then the judge's verdict under \"# Verdict\".",
        ...P.CRITICS.map((c) => `# ${c.name}\n${P.CRITIC_TASK(c)}`),
        `# Verdict\n${P.JUDGE_TASK("(the five critiques above)")}`,
      ].join("\n\n"),
      maxTokens: 32000,
    };
  } else if (part.startsWith("beats:")) {
    const outline = (await readOutline(state.slug))!;
    const { unit } = unitOf(outline, part);
    task = {
      part,
      stage,
      context: await contextFor(state, "units"),
      instruction: P.BEATS_TASK(s, unit, notes),
      maxTokens: s.format === "microdrama" || s.format === "short" ? 8000 : 16000,
    };
  } else if (part.startsWith("draft:")) {
    const outline = (await readOutline(state.slug))!;
    const { unit, prev, next } = unitOf(outline, part);
    const beatsOf = (n?: number) => (n === undefined ? undefined : readFile(state.slug, partFiles(state.slug, `beats:${n}`)[0]));
    const [beats, prevBeats, nextBeats] = await Promise.all([beatsOf(unit.number), beatsOf(prev?.number), beatsOf(next?.number)]);
    if (!beats) throw new Error(`Write beats:${unit.number} before draft:${unit.number}`);
    task = {
      part,
      stage,
      context: await contextFor(state, "units"),
      instruction: P.DRAFT_TASK(s, unit, beats, prevBeats, nextBeats, notes),
      maxTokens: draftMaxTokens(state),
    };
  } else if (part.startsWith("script_review:")) {
    const round = Number(part.split(":")[1]);
    task = {
      part,
      stage,
      context: `${await contextFor(state, "units")}\n\n---\n\n# COMPLETE SCRIPT (current draft)\n${await fullScript(state)}`,
      instruction: [
        `Run the writers' room on the complete script above (review round ${round} of ${maxReviewRounds(state)}). Write each critique in turn, then the judge's verdict.`,
        ...P.CRITICS.map((c) => `# ${c.name}\n${P.SCRIPT_CRITIC_TASK(c, round)}`),
        `# Judge\n${P.SCRIPT_JUDGE_TASK("(the five critiques above)", round, maxReviewRounds(state))}`,
        `Return everything as one JSON object: critiques_md (the five critiques, each under "# <name>"), verdict_md, approved, corrections.`,
      ].join("\n\n"),
      schema: P.SCRIPT_REVIEW_SCHEMA,
      maxTokens: 32000,
    };
  } else {
    throw new Error(`"${part}" is done automatically; it has no writing task`);
  }
  // Revising an existing part: hand over the current version so the rewrite keeps what the notes don't touch.
  if (notes && state.parts[part] && part !== "revised_outline" && !part.startsWith("script_review:")) {
    const current = part === "outline" ? await readFile(state.slug, "build/outline.json") : await readPart(state, part);
    if (current) {
      task.instruction += `\n\n<current_version>\n${current}\n</current_version>\n\nRevise the current version applying the notes above. Keep everything the notes do not touch.`;
    }
  }
  return task;
}

// ---------- saving ----------

function parseJson<T>(raw: string, what: string): T {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`${what} must be valid JSON in the shape the task gave`);
  }
}

function validateOutline(o: Outline): void {
  if (!o || typeof o.title !== "string" || !Array.isArray(o.units) || o.units.length === 0) {
    throw new Error("Outline needs a title, a logline and a non-empty units array");
  }
  for (const u of o.units) {
    for (const k of ["number", "title", "summary", "hook", "turn", "ending"] as const) {
      if (u[k] === undefined || u[k] === "") throw new Error(`Outline unit ${u.number ?? "?"} is missing "${k}"`);
    }
    u.characters ??= [];
    u.dominant_emotion ??= "";
    u.emotional_intensity = Number(u.emotional_intensity ?? 0);
  }
}

export async function savePart(
  state: ProjectState,
  part: string,
  content: string,
  note?: string,
  allowOverCap = false,
): Promise<string[]> {
  const slug = state.slug;
  const warnings: string[] = [];
  if (!content.trim()) throw new Error("Content is empty");
  if (part === "bible") {
    const b = parseJson<{ characters_md: string; world_rules_md: string }>(content, "The bible");
    if (!b.characters_md || !b.world_rules_md) throw new Error('The bible needs "characters_md" and "world_rules_md"');
    await writeFile(slug, "bible/characters.md", b.characters_md.trim() + "\n");
    await writeFile(slug, "bible/world_rules.md", b.world_rules_md.trim() + "\n");
  } else if (part === "outline" || part === "revised_outline") {
    const o = parseJson<Outline>(content, "The outline");
    validateOutline(o);
    if (o.units.length !== state.settings.units) {
      warnings.push(`Outline has ${o.units.length} units (asked for ${state.settings.units}); using ${o.units.length}.`);
      state.settings.units = o.units.length;
    }
    if (part === "revised_outline") {
      const v1 = await readFile(slug, "build/outline.json");
      if (v1) await writeFile(slug, "build/outline.v1.json", v1);
    }
    await writeFile(slug, "build/outline.json", JSON.stringify(o, null, 2));
    await writeFile(slug, "build/outline.md", P.outlineMd(o, state.settings) + "\n");
    await writeFile(slug, "project.md", projectMd(state.settings, o));
  } else if (part.startsWith("script_review:")) {
    const round = Number(part.split(":")[1]);
    const r = parseJson<{ critiques_md?: string; verdict_md: string; approved: boolean; corrections: { unit: number; notes: string }[] }>(
      content,
      "The script review",
    );
    if (typeof r.verdict_md !== "string" || !Array.isArray(r.corrections)) {
      throw new Error('The script review needs "verdict_md", "approved" and "corrections"');
    }
    const outline = (await readOutline(slug))!;
    const valid = r.corrections.filter((c) => outline.units.some((u) => u.number === c.unit) && c.notes?.trim());
    const approved = r.approved || valid.length === 0;
    const label = unitLabel(state.settings.format);
    await writeFile(
      slug,
      partFiles(slug, part)[0],
      [
        `# Script review — round ${round} — ${approved ? "APPROVED" : "CORRECTIONS REQUIRED"}`,
        r.critiques_md ?? "",
        `# Verdict — Rudra, Critic Judge\n\n${r.verdict_md}`,
        valid.length ? `# Corrections\n\n${valid.map((c) => `- **${label} ${c.unit}:** ${c.notes}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n") + "\n",
    );
    state.review = { round, approved };
    // Corrections reopen the drafts they name; the next round reviews the rewritten script.
    for (const c of approved ? [] : valid) {
      const p = `draft:${c.unit}`;
      const prev = state.parts[p]?.pendingNotes;
      state.parts[p] = { ...state.parts[p], status: "stale", pendingNotes: prev ? `${prev}\n${c.notes}` : c.notes };
    }
    if (!approved && round >= maxReviewRounds(state)) {
      const open = (await readFile(slug, "room/open_questions.md")) ?? "# Open questions\n";
      await writeFile(slug, "room/open_questions.md", `${open}\n## After review round ${round} (applied, not re-reviewed)\n${valid.map((c) => `- ${label} ${c.unit}: ${c.notes}`).join("\n")}\n`);
    }
    markDone(state, part);
    if (state.parts.assembly) state.parts.assembly.status = "stale";
    return [approved ? `Round ${round}: APPROVED by the judge.` : `Round ${round}: ${valid.length} ${label.toLowerCase()}(s) to correct: ${valid.map((c) => c.unit).join(", ")}.`];
  } else if (part === "assembly") {
    throw new Error("The full script is assembled automatically once every draft is written");
  } else {
    let text = content.trim() + "\n";
    if (part.startsWith("draft:")) {
      text = text.replace(/^```\w*\s*/, "").replace(/```\s*$/, "");
      const seconds = estimateSeconds(text);
      const over = overCap(state.settings, seconds);
      if (over && !allowOverCap) {
        const { cap, target } = unitBudget(state.settings);
        throw new Error(
          `Not saved: ${part} is ${over}. ${P.TRIM_NOTES(seconds, cap!, target!)} Submit the shorter version to the same part.`,
        );
      }
      if (over) warnings.push(`${part} is ${over}.`);
      (state.runtimes ??= {})[part] = seconds;
      warnings.push(`${part} estimated runtime ${fmt(seconds)}.`);
    }
    await writeFile(slug, partFiles(slug, part)[0], text);
  }
  note ??= state.parts[part]?.pendingNotes;
  const wasDone = isDone(state, part);
  markDone(state, part, note);
  if (wasDone || note) markDownstreamStale(state, part);
  // An outline revised by hand after the room's revision replaces the room's version too.
  if (part === "outline" && isDone(state, "revised_outline") && note) markDone(state, "revised_outline", note);
  return warnings;
}

export async function assemble(state: ProjectState): Promise<string[]> {
  const outline = (await readOutline(state.slug))!;
  const drafts: string[] = [];
  for (const u of outline.units) {
    const d = await readFile(state.slug, partFiles(state.slug, `draft:${u.number}`)[0]);
    if (!d) throw new Error(`draft:${u.number} is missing`);
    drafts.push(d.trim());
  }
  const runtimes = outline.units.map((u, i) => ({ number: u.number, title: u.title, seconds: estimateSeconds(drafts[i]) }));
  state.runtimes = Object.fromEntries(runtimes.map((r) => [`draft:${r.number}`, r.seconds]));
  const total = runtimes.reduce((a, r) => a + r.seconds, 0);
  await writeFile(state.slug, "build/runtime.md", runtimeReport(state.settings, runtimes));
  const files = await exportAll(state, outline, drafts, total);
  // Emotional graph for the writers' room.
  const csv = [
    "unit,intensity,dominant_emotion,pov_character,note",
    ...outline.units.map(
      (u) => `${u.number},${u.emotional_intensity},"${u.dominant_emotion.replace(/"/g, "'")}","${u.characters[0] ?? ""}","${u.title.replace(/"/g, "'")}"`,
    ),
  ].join("\n");
  await writeFile(state.slug, "build/emotional_graph.csv", csv + "\n");
  await writeFile(state.slug, "project.md", projectMd(state.settings, outline));
  markDone(state, "assembly");
  return [...files, "build/runtime.md"];
}

// ---------- engine mode ----------

async function generate(state: ProjectState, task: Task, instruction = task.instruction): Promise<string> {
  const stream = anthropic().beta.messages.stream({
    model: MODEL,
    max_tokens: task.maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: EFFORT, ...(task.schema ? { format: { type: "json_schema", schema: task.schema } } : {}) },
    system: [{ type: "text", text: P.SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: task.context, cache_control: { type: "ephemeral" } },
          { type: "text", text: instruction },
        ],
      },
    ],
  });
  const msg = await stream.finalMessage();
  const u = msg.usage;
  state.usage.calls += 1;
  state.usage.inputTokens += u.input_tokens;
  state.usage.outputTokens += u.output_tokens;
  state.usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
  state.usage.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
  if (msg.stop_reason === "refusal") {
    throw new Error(`Claude declined ${task.part} (${msg.stop_details?.category ?? "no category"})`);
  }
  if (msg.stop_reason === "max_tokens") throw new Error(`${task.part} was cut off at ${task.maxTokens} tokens`);
  return msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

async function writeWithEngine(state: ProjectState, part: string, notes?: string): Promise<void> {
  const task = await buildTask(state, part, notes);
  let content: string;
  if (part === "review") {
    // Five critics in parallel on the same cached context, then the judge.
    const critiques = await Promise.all(
      P.CRITICS.map(async (c) => `# ${c.name}\n\n${await generate(state, { ...task, maxTokens: 16000 }, P.CRITIC_TASK(c))}`),
    );
    const verdict = await generate(state, task, P.JUDGE_TASK(critiques.join("\n\n")));
    content = `${critiques.join("\n\n")}\n\n# Verdict — Rudra, Critic Judge\n\n${verdict}`;
  } else if (part.startsWith("script_review:")) {
    const round = Number(part.split(":")[1]);
    const critiques = await Promise.all(
      P.CRITICS.map(async (c) => `# ${c.name}\n\n${await generate(state, { ...task, schema: undefined, maxTokens: 16000 }, P.SCRIPT_CRITIC_TASK(c, round))}`),
    );
    const verdict = await generate(
      state,
      { ...task, schema: P.SCRIPT_VERDICT_SCHEMA },
      P.SCRIPT_JUDGE_TASK(critiques.join("\n\n"), round, maxReviewRounds(state)),
    );
    content = JSON.stringify({ critiques_md: critiques.join("\n\n"), ...JSON.parse(verdict) });
  } else {
    content = await generate(state, task);
    // Hard runtime cap: ask for a tighter cut (up to twice) before accepting an over-length draft.
    for (let attempt = 0; part.startsWith("draft:") && attempt < 2; attempt++) {
      const seconds = estimateSeconds(content);
      const { cap, target } = unitBudget(state.settings);
      if (!overCap(state.settings, seconds)) break;
      const trim = `${P.TRIM_NOTES(seconds, cap!, target!)}\n\n<current_version>\n${content}\n</current_version>\n\nReturn only the shortened Fountain script.`;
      content = await generate(state, task, `${task.instruction}\n\n${trim}`);
    }
  }
  await savePart(state, part, content, notes, true);
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  });
  await Promise.all(workers);
}

const running = new Map<string, Promise<void>>();
export const isRunning = (slug: string) => running.has(slug);

// Runs in the background; progress is persisted after every part, so a restart can resume with continue_build.
export function startBuild(slug: string, stopAfter: Stage = "reviewed", revise?: { part: string; notes: string }): void {
  if (!hasEngine()) throw new Error("Engine mode needs ANTHROPIC_API_KEY on the server. Use get_writing_task / submit_writing instead.");
  if (running.has(slug)) throw new Error(`A build is already running for "${slug}"`);
  const job = (async () => {
    const state = await loadState(slug);
    let saving = Promise.resolve();
    const save = () => (saving = saving.then(() => saveState(state)));
    state.job = { status: "running", stopAfter, startedAt: new Date().toISOString() };
    await save();
    try {
      if (revise) {
        state.job.activity = `Revising ${revise.part}`;
        await save();
        await writeWithEngine(state, revise.part, revise.notes);
        await save();
      }
      const limit = STAGES.indexOf(stopAfter);
      for (;;) {
        const { parts } = await advance(state, stopAfter === "reviewed");
        await save();
        if (!parts.length || STAGES.indexOf(stageOf(parts[0])) > limit) break;
        const label = (p: string) =>
          p.startsWith("script_review:")
            ? `writers' room review of the full script, round ${p.split(":")[1]}`
            : p.replace(/^(beats|draft):/, (_, k) => `${k} for ${unitLabel(state.settings.format)} `);
        const done: string[] = [];
        const one = async (p: string) => {
          await writeWithEngine(state, p);
          done.push(p);
          state.job.activity = parts.length > 1 ? `${parts[0].split(":")[0]}: ${done.length}/${parts.length} written` : `Wrote ${label(p)}`;
          await save();
        };
        state.job.activity = parts.length > 1 ? `Writing ${parts.length} ${parts[0].split(":")[0]}` : `Writing ${label(parts[0])}`;
        await save();
        // The first call writes the shared context to the prompt cache; the rest of the batch then reads it.
        await one(parts[0]);
        await pool(parts.slice(1), CONCURRENCY, one);
      }
      state.job = { ...state.job, status: "done", activity: undefined, finishedAt: new Date().toISOString() };
    } catch (err) {
      state.job = { ...state.job, status: "failed", error: (err as Error).message, finishedAt: new Date().toISOString() };
    }
    await save();
    await saving;
  })().finally(() => running.delete(slug));
  running.set(slug, job);
}

export async function waitForBuild(slug: string): Promise<void> {
  await running.get(slug);
}
