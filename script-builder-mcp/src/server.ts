// MCP tools. Two ways to write: the server's own Claude engine (needs ANTHROPIC_API_KEY, runs in the background), or
// guided mode, where the connected Claude writes each part from get_writing_task and hands it back with submit_writing.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  FORMATS,
  STAGES,
  isDone,
  listProjects,
  loadState,
  makeSlug,
  markDone,
  partFiles,
  projectMd,
  readFile,
  readOutline,
  saveState,
  unitLabel,
  writeFile,
  type ProjectState,
  type Settings,
} from "./store.js";
import { advance, assemble, buildTask, hasEngine, isRunning, maxReviewRounds, pendingParts, readPart, savePart, startBuild } from "./engine.js";
import { SYSTEM, TRIM_NOTES } from "./prompts.js";
import { estimateSeconds, fmt, overCap, unitBudget, unitsForBand } from "./runtime.js";

const DEFAULT_UNITS: Record<Settings["format"], number> = { microdrama: 20, series: 6, feature: 10, short: 3 };
// House rules for microdrama series: every episode under 2:30, the whole series 55-60 minutes.
const MICRODRAMA_DEFAULTS = { maxEpisodeMinutes: 2.5, minSeriesMinutes: 55, maxSeriesMinutes: 60 };

const DEFAULT_LENGTH: Record<Settings["format"], string> = {
  microdrama: "about 2:15 (hard cap 2:30)",
  series: "30 minutes",
  feature: "10-12 minutes",
  short: "3-5 minutes",
};

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });

function guard<A>(fn: (args: A) => Promise<ReturnType<typeof text>>) {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      return fail((err as Error).message);
    }
  };
}

function downloadLinks(slug: string, files: string[]): string[] {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  const token = process.env.MCP_AUTH_TOKEN;
  if (!base) return [];
  return files
    .filter((f) => !f.startsWith("("))
    .map((f) => `${base}/files/${slug}/${f}${token ? `?token=${encodeURIComponent(token)}` : ""}`);
}

function capConflict(s: Settings): string {
  const { cap } = unitBudget(s);
  if (s.minTotalMinutes && cap !== undefined && s.units * cap < s.minTotalMinutes * 60) {
    return `Warning: ${s.units} units × ${fmt(cap)} max can't reach the ${s.minTotalMinutes}-minute minimum; use at least ${Math.ceil((s.minTotalMinutes * 60) / cap)} units.\n`;
  }
  if (s.maxTotalMinutes && cap !== undefined && s.units * 30 > s.maxTotalMinutes * 60) {
    return `Warning: ${s.units} units can't fit in ${s.maxTotalMinutes} minutes at any sensible length; use fewer units.\n`;
  }
  return "";
}

async function statusReport(state: ProjectState): Promise<string> {
  const outline = await readOutline(state.slug);
  const label = unitLabel(state.settings.format).toLowerCase();
  const n = outline?.units.length ?? state.settings.units;
  const count = (kind: string) => Object.entries(state.parts).filter(([k, v]) => k.startsWith(`${kind}:`) && v.status === "done").length;
  const mark = (p: string) => (isDone(state, p) ? "✓" : state.parts[p] ? "stale" : "—");
  const pending = await pendingParts(state);
  let job = state.job.status;
  if (job === "running" && !isRunning(state.slug)) job = "stopped"; // the server restarted mid-build
  const u = state.usage;
  const lines = [
    `# ${outline?.title ?? state.settings.title ?? state.slug} (${state.slug})`,
    `Mode: ${hasEngine() ? "engine (server writes with Claude)" : "guided (you write each part)"}`,
    `Build: ${job}${state.job.activity ? ` — ${state.job.activity}` : ""}${state.job.error ? `\nError: ${state.job.error}` : ""}`,
    "",
    `- Concept: ${mark("concept")}`,
    `- Bible: ${mark("bible")}`,
    `- Outline: ${mark("outline")}${state.settings.reviewOutline ? ` · Room review: ${mark("review")} · Revised outline: ${mark("revised_outline")}` : ""}`,
    `- Beat sheets: ${count("beats")}/${n} ${label}s`,
    `- Script pages: ${count("draft")}/${n} ${label}s`,
    ...(state.settings.reviewScript
      ? [
          `- Full-script review: ${
            state.review
              ? `round ${state.review.round}/${maxReviewRounds(state)} — ${state.review.approved ? "APPROVED" : "corrections in progress"}`
              : "not started"
          }`,
        ]
      : []),
    `- Full script: ${mark("assembly")}`,
    "",
    pending.length ? `Next: ${pending.slice(0, 6).join(", ")}${pending.length > 6 ? ` … (${pending.length} parts)` : ""}` : "Complete.",
  ];
  const rt = Object.entries(state.runtimes ?? {}).sort(([a], [b]) => Number(a.split(":")[1]) - Number(b.split(":")[1]));
  if (rt.length) {
    const { cap } = unitBudget(state.settings);
    const total = rt.reduce((a, [, v]) => a + v, 0);
    lines.push(
      `Runtime (est.): ${rt.map(([k, v]) => `${k.split(":")[1]}=${fmt(v)}${cap !== undefined && v >= cap ? "!" : ""}`).join(" ")} · total ${fmt(total)}` +
        (cap !== undefined ? ` · cap ${fmt(cap)}/${label}` : "") +
        (state.settings.maxTotalMinutes ? ` · series ${state.settings.minTotalMinutes ? `${state.settings.minTotalMinutes}:00–` : "under "}${state.settings.maxTotalMinutes}:00` : ""),
    );
  }
  if (u.calls) {
    lines.push(
      `Claude usage: ${u.calls} calls, ${u.inputTokens.toLocaleString()} input + ${u.cacheReadTokens.toLocaleString()} cached + ${u.cacheWriteTokens.toLocaleString()} cache-write, ${u.outputTokens.toLocaleString()} output tokens`,
    );
  }
  if (isDone(state, "assembly")) {
    const files = ["fountain", "fdx", "pdf"].map((e) => `script/${state.slug}_v1.${e}`);
    lines.push("", "Files:", ...files.map((f) => `- ${f}`), ...downloadLinks(state.slug, files).map((l) => `- ${l}`));
  }
  return lines.join("\n");
}

const partParam = z
  .string()
  .regex(/^(concept|bible|outline|review|revised_outline|beats:\d+|draft:\d+|script_review:\d+)$/)
  .describe('A part: "concept", "bible", "outline", "review", "revised_outline", "beats:N", "draft:N" (N = episode number) or "script_review:R" (R = review round)');

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "script-builder", version: "0.2.0" },
    {
      instructions: `Script Builder develops a complete screenplay from a single idea: concept → story bible → outline → \
writers'-room review of the outline (five critics and a judge) → revised outline → beat sheets → screenplay pages → \
runtime balancing → writers'-room review of the COMPLETE script, with every correction rewritten and re-reviewed until the \
judge approves (up to max_review_rounds) → full script exported as Fountain, Final Draft (.fdx) and PDF.

House rules for microdrama (defaults, overridable): every episode under 2:30 of screen time (hard cap — over-length pages are \
rejected or automatically re-cut), and the whole series between 55 and 60 minutes (about 26 episodes). Runtime is estimated \
from spoken words, action beats and silences, not page count.

Start with start_script. Then check build_status. In engine mode the server writes everything in the background; poll \
build_status every minute or so. In guided mode, loop: get_writing_task → write exactly what it asks → submit_writing, \
until build_status says Complete. Show the user the concept and outline before writing the pages if they want to approve them.`,
    },
  );

  server.registerTool(
    "start_script",
    {
      title: "Start a script from an idea",
      description:
        "Create a new script project from a single idea and (in engine mode) start writing it in the background. Only the idea is required; everything else has sensible defaults per format.",
      inputSchema: {
        idea: z.string().min(10).describe("The idea, premise, hook, characters, anything the user gave — pass it verbatim"),
        title: z.string().optional(),
        author: z.string().optional().describe("Name for the title page"),
        format: z.enum(FORMATS).default("microdrama"),
        units: z.number().int().min(1).max(120).optional().describe("Number of episodes (or sequences for a feature)"),
        unit_length: z.string().optional().describe('Length of each episode, e.g. "90 seconds" or "45 minutes"'),
        language: z.string().default("English").describe("Dialogue language, e.g. Telugu, Hindi, English"),
        audience: z.string().default("general audience, 18-40, mobile-first"),
        platform: z.string().optional(),
        genre: z.string().optional(),
        tone: z.string().optional(),
        source: z.string().optional().describe("Mythology, history, novel or other source the story draws on"),
        notes: z.string().optional().describe("Anything else the script must do"),
        review_outline: z.boolean().default(true).describe("Run the writers' room review on the outline before writing pages"),
        max_episode_minutes: z.number().positive().optional().describe("Hard cap per episode in minutes. Microdrama default: 2.5"),
        min_series_minutes: z.number().positive().optional().describe("Minimum total runtime of the series. Microdrama default: 55"),
        max_series_minutes: z.number().positive().optional().describe("Maximum total runtime of the series. Microdrama default: 60"),
        review_script: z.boolean().default(true).describe("After the full script is written, run the writers' room on it and rewrite until the judge approves"),
        max_review_rounds: z.number().int().min(1).max(6).default(3),
        stop_after: z.enum(STAGES).default("reviewed").describe('Engine mode: stop after this stage (e.g. "outline" to approve it first; "reviewed" runs everything including the full-script review loop)'),
      },
    },
    guard(async (a) => {
      const house = a.format === "microdrama" ? MICRODRAMA_DEFAULTS : undefined;
      const maxEp = a.max_episode_minutes ?? house?.maxEpisodeMinutes;
      const minSeries = a.min_series_minutes ?? house?.minSeriesMinutes;
      const maxSeries = a.max_series_minutes ?? house?.maxSeriesMinutes;
      const units =
        a.units ?? (minSeries && maxSeries && maxEp ? unitsForBand(minSeries, maxSeries, maxEp * 60) : DEFAULT_UNITS[a.format]);
      const settings: Settings = {
        idea: a.idea,
        title: a.title,
        author: a.author,
        format: a.format,
        units,
        unitLength: a.unit_length ?? DEFAULT_LENGTH[a.format],
        language: a.language,
        audience: a.audience,
        platform: a.platform,
        genre: a.genre,
        tone: a.tone,
        source: a.source,
        notes: a.notes,
        reviewOutline: a.review_outline,
        maxUnitSeconds: maxEp ? Math.round(maxEp * 60) : undefined,
        minTotalMinutes: minSeries,
        maxTotalMinutes: maxSeries,
        reviewScript: a.review_script,
        maxReviewRounds: a.max_review_rounds,
      };
      if (!a.unit_length) {
        const { cap, target } = unitBudget(settings);
        if (target !== undefined) settings.unitLength = `about ${fmt(target)}${cap !== undefined ? ` (hard cap ${fmt(cap)})` : ""}`;
      }
      const capWarning = capConflict(settings);
      const now = new Date().toISOString();
      const state: ProjectState = {
        slug: makeSlug(a.title ?? a.idea),
        createdAt: now,
        updatedAt: now,
        settings,
        parts: {},
        job: { status: "idle" },
        usage: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      };
      await saveState(state);
      await writeFile(state.slug, "project.md", projectMd(settings));
      for (const f of ["room/decision_log.md", "room/open_questions.md", "bible/continuity.md"]) {
        await writeFile(state.slug, f, `# ${f.split("/")[1].replace(".md", "").replace("_", " ")}\n`);
      }
      if (hasEngine()) {
        startBuild(state.slug, a.stop_after);
        return text(
          capWarning +
          `Started "${state.slug}" in engine mode (${settings.units} ${unitLabel(settings.format).toLowerCase()}s, ${settings.language}). ` +
            `Writing runs in the background; call build_status with slug "${state.slug}" to follow it.`,
        );
      }
      return text(
        capWarning +
        `Created "${state.slug}" in guided mode (no ANTHROPIC_API_KEY on the server). ` +
          `Call get_writing_task with slug "${state.slug}", write what it asks, and send it back with submit_writing. Repeat until done.`,
      );
    }),
  );

  server.registerTool(
    "build_status",
    {
      title: "Build status",
      description: "Progress of a script project: which parts are written, what the background build is doing, token usage, and output files.",
      inputSchema: { slug: z.string() },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ slug }) => text(await statusReport(await loadState(slug)))),
  );

  server.registerTool(
    "continue_build",
    {
      title: "Continue or resume the build",
      description:
        "Engine mode: write every missing or stale part up to stop_after, in the background. Use after approving the outline, after revisions, or to resume a failed or interrupted build.",
      inputSchema: { slug: z.string(), stop_after: z.enum(STAGES).default("reviewed") },
    },
    guard(async ({ slug, stop_after }) => {
      await loadState(slug);
      startBuild(slug, stop_after);
      return text(`Building "${slug}" up to ${stop_after}. Follow it with build_status.`);
    }),
  );

  server.registerTool(
    "get_writing_task",
    {
      title: "Get the next writing task (guided mode)",
      description:
        "Guided mode: returns the next part to write with full instructions and context. Write exactly what it asks, then call submit_writing with the same part. Optionally name a part, and give notes to revise it.",
      inputSchema: { slug: z.string(), part: partParam.optional(), notes: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ slug, part, notes }) => {
      const state = await loadState(slug);
      if (isRunning(slug)) return fail("A background build is running for this project; wait for it or use build_status.");
      let target = part;
      if (!target) {
        notes = undefined; // notes only apply to a named part
        const { parts: pending, files } = await advance(state);
        await saveState(state);
        if (files.length) return text(`All parts are written and reviewed; assembled the full script:\n${files.map((f) => `- ${f}`).join("\n")}`);
        if (!pending.length) return text("Nothing left to write. The script is complete; see build_status for the files.");
        target = pending[0];
      }
      const task = await buildTask(state, target, notes);
      const outputSpec = task.schema
        ? `Return ONLY a JSON object matching this schema (no Markdown fences):\n${JSON.stringify(task.schema)}`
        : target.startsWith("draft:")
          ? "Return ONLY the Fountain screenplay text."
          : "Return ONLY the Markdown document.";
      return text(
        [
          `PART: ${target}`,
          `When done, call submit_writing with slug "${slug}", part "${target}"${notes ? " and the same notes" : ""}, and your text as content.`,
          "",
          "## Role",
          SYSTEM,
          "",
          "## Context",
          task.context,
          "",
          "## Task",
          task.instruction,
          "",
          "## Output",
          outputSpec,
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "submit_writing",
    {
      title: "Submit a written part (guided mode)",
      description:
        "Save a part written from get_writing_task. JSON parts (bible, outline, revised_outline) are validated. When the last script part arrives, the full script is assembled and exported to Fountain, FDX and PDF.",
      inputSchema: {
        slug: z.string(),
        part: partParam,
        content: z.string().describe("The complete text for the part, exactly in the format the task asked for"),
        notes: z.string().optional().describe("The revision notes, if this was a revision"),
      },
    },
    guard(async ({ slug, part, content, notes }) => {
      const state = await loadState(slug);
      if (isRunning(slug)) return fail("A background build is running for this project.");
      const warnings = await savePart(state, part, content, notes);
      const { parts: next, files: assembled } = await advance(state);
      await saveState(state);
      return text(
        [
          `Saved ${part}.`,
          ...warnings,
          assembled.length ? `Full script assembled:\n${assembled.map((f) => `- ${f}`).join("\n")}` : "",
          ...downloadLinks(slug, assembled),
          next.length ? `Next: ${next[0]}${next.length > 1 ? ` (+${next.length - 1} more)` : ""}. Call get_writing_task.` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }),
  );

  server.registerTool(
    "revise_part",
    {
      title: "Revise a part with notes",
      description:
        "Rewrite one part with the showrunner's notes. Everything built on it is marked stale. Engine mode revises in the background and, with rebuild=true, rewrites the stale parts too; guided mode returns the revision task to write and submit.",
      inputSchema: {
        slug: z.string(),
        part: partParam,
        notes: z.string().min(3),
        rebuild: z.boolean().default(true).describe("Engine mode: also rewrite everything downstream that became stale"),
      },
    },
    guard(async ({ slug, part, notes, rebuild }) => {
      const state = await loadState(slug);
      if (!isDone(state, part) && !state.parts[part]) return fail(`${part} has not been written yet.`);
      if (hasEngine()) {
        // stop_after the part's own stage when not rebuilding, so only the revision runs.
        const stage = part.startsWith("draft:") ? "script" : part.startsWith("beats:") ? "beats" : part === "concept" || part === "bible" ? part : "outline";
        startBuild(slug, rebuild ? "script" : (stage as (typeof STAGES)[number]), { part, notes });
        return text(`Revising ${part} in the background${rebuild ? " and rebuilding what depends on it" : ""}. Follow it with build_status.`);
      }
      return text(`Guided mode: call get_writing_task with slug "${slug}", part "${part}" and these notes, then submit_writing with the same notes.`);
    }),
  );

  server.registerTool(
    "read_script",
    {
      title: "Read part of a script",
      description:
        'Read a written part: "concept", "bible", "outline", "review", "beats:N", "draft:N", "script_review:R", "runtime" (runtime table), or "full" for the assembled Fountain script. Long text is paged with offset/max_chars.',
      inputSchema: {
        slug: z.string(),
        part: z.string().regex(/^(concept|bible|outline|review|beats:\d+|draft:\d+|script_review:\d+|runtime|full)$/),
        offset: z.number().int().min(0).default(0),
        max_chars: z.number().int().min(1000).max(100000).default(40000),
      },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ slug, part, offset, max_chars }) => {
      const state = await loadState(slug);
      const body =
        part === "full"
          ? await readFile(slug, partFiles(slug, "assembly")[0])
          : part === "outline"
            ? await readFile(slug, "build/outline.md")
            : part === "runtime"
              ? await readFile(slug, "build/runtime.md")
              : await readPart(state, part);
      if (!body) return fail(`${part} has not been written yet.`);
      const chunk = body.slice(offset, offset + max_chars);
      const more = offset + max_chars < body.length;
      return text(
        `${chunk}${more ? `\n\n[… ${body.length - offset - max_chars} more characters; call again with offset ${offset + max_chars}]` : ""}`,
      );
    }),
  );

  server.registerTool(
    "export_script",
    {
      title: "Export the script",
      description: "Re-assemble the full script from the current pages and export Fountain, Final Draft (.fdx), HTML and PDF. Returns file paths and download links.",
      inputSchema: { slug: z.string() },
    },
    guard(async ({ slug }) => {
      const state = await loadState(slug);
      const outline = await readOutline(slug);
      const missing = outline?.units.filter((u) => !isDone(state, `draft:${u.number}`)).map((u) => u.number) ?? [];
      if (!outline || missing.length) return fail(`Not every page is written yet (missing: ${missing.join(", ") || "outline"}).`);
      const files = await assemble(state);
      markDone(state, "assembly");
      await saveState(state);
      return text([...files.map((f) => `- ${f}`), ...downloadLinks(slug, files)].join("\n"));
    }),
  );

  server.registerTool(
    "update_settings",
    {
      title: "Update runtime caps and review settings",
      description:
        "Change runtime caps (per episode, series minimum and maximum) or the full-script review loop on an existing project. Pages already written that break a new per-episode cap are marked for a shorter rewrite; the series band is balanced once all pages exist.",
      inputSchema: {
        slug: z.string(),
        max_episode_minutes: z.number().positive().optional(),
        min_series_minutes: z.number().positive().optional(),
        max_series_minutes: z.number().positive().optional(),
        review_script: z.boolean().optional(),
        max_review_rounds: z.number().int().min(1).max(6).optional(),
      },
    },
    guard(async ({ slug, max_episode_minutes, min_series_minutes, max_series_minutes, review_script, max_review_rounds }) => {
      const state = await loadState(slug);
      if (isRunning(slug)) return fail("A background build is running for this project.");
      if (max_episode_minutes !== undefined) state.settings.maxUnitSeconds = Math.round(max_episode_minutes * 60);
      if (min_series_minutes !== undefined) state.settings.minTotalMinutes = min_series_minutes;
      if (max_series_minutes !== undefined) state.settings.maxTotalMinutes = max_series_minutes;
      if (review_script !== undefined) state.settings.reviewScript = review_script;
      if (max_review_rounds !== undefined) state.settings.maxReviewRounds = max_review_rounds;
      state.balanceRounds = 0;
      if (review_script && !state.review?.approved && state.parts.assembly) state.parts.assembly.status = "stale";
      const over: string[] = [];
      for (const [part, info] of Object.entries(state.parts)) {
        if (!part.startsWith("draft:") || info.status !== "done") continue;
        const body = await readFile(slug, partFiles(slug, part)[0]);
        const seconds = body ? estimateSeconds(body) : 0;
        (state.runtimes ??= {})[part] = seconds;
        const msg = overCap(state.settings, seconds);
        if (msg) {
          const { cap, target } = unitBudget(state.settings);
          info.status = "stale";
          info.pendingNotes = TRIM_NOTES(seconds, cap!, target!);
          if (state.parts.assembly) state.parts.assembly.status = "stale";
          over.push(`${part}: ${msg}`);
        }
      }
      await saveState(state);
      const { cap } = unitBudget(state.settings);
      return text(
        [
          capConflict(state.settings).trim(),
          `Settings saved. Caps: ${cap !== undefined ? `${fmt(cap)} per ${unitLabel(state.settings.format).toLowerCase()}` : "none per unit"}${state.settings.maxTotalMinutes ? `, series ${state.settings.minTotalMinutes ?? 0}–${state.settings.maxTotalMinutes} min` : ""}. Full-script review: ${state.settings.reviewScript ? `on, up to ${maxReviewRounds(state)} rounds` : "off"}.`,
          over.length
            ? `Over the cap and marked for a shorter rewrite:\n${over.map((o) => `- ${o}`).join("\n")}\n${hasEngine() ? "Run continue_build." : "Call get_writing_task to rewrite them."}`
            : "Every written page is under the cap.",
          `Next: ${(await pendingParts(state))[0] ?? "nothing"}.`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }),
  );

  server.registerTool(
    "list_scripts",
    {
      title: "List script projects",
      description: "All script projects on this server, newest first.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(async () => {
      const all = await listProjects();
      if (!all.length) return text("No script projects yet. Start one with start_script.");
      return text(
        all
          .map((s) => `- ${s.slug}: ${s.settings.title ?? s.settings.idea.slice(0, 60)} — ${s.settings.format}, ${s.settings.language}, ${isDone(s, "assembly") ? "complete" : s.job.status}`)
          .join("\n"),
      );
    }),
  );

  return server;
}
