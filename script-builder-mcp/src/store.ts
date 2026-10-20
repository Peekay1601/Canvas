// Project state and files on disk. Each project is a folder that matches the writers' room layout
// (project.md, bible/, script/, room/), so a finished script can go straight into /room-session.
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const FORMATS = ["microdrama", "series", "feature", "short"] as const;
export type Format = (typeof FORMATS)[number];

export interface Settings {
  idea: string;
  title?: string;
  author?: string;
  format: Format;
  units: number;
  unitLength: string;
  language: string;
  audience: string;
  platform?: string;
  genre?: string;
  tone?: string;
  source?: string;
  notes?: string;
  reviewOutline: boolean;
  maxUnitSeconds?: number;
  minTotalMinutes?: number;
  maxTotalMinutes?: number;
  reviewScript?: boolean;
  maxReviewRounds?: number;
}

export type PartStatus = "done" | "stale";
export interface PartInfo {
  status: PartStatus;
  updatedAt: string;
  revisions: number;
  notes?: string[];
  pendingNotes?: string;
}

export type JobStatus = "idle" | "running" | "done" | "failed" | "stopped";
export interface JobInfo {
  status: JobStatus;
  stopAfter?: Stage;
  activity?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ProjectState {
  slug: string;
  createdAt: string;
  updatedAt: string;
  settings: Settings;
  parts: Record<string, PartInfo>;
  job: JobInfo;
  usage: Usage;
  runtimes?: Record<string, number>;
  review?: { round: number; approved: boolean };
  balanceRounds?: number;
}

export const STAGES = ["concept", "bible", "outline", "beats", "script", "reviewed"] as const;
export type Stage = (typeof STAGES)[number];

export interface OutlineUnit {
  number: number;
  title: string;
  summary: string;
  hook: string;
  turn: string;
  ending: string;
  emotional_intensity: number;
  dominant_emotion: string;
  characters: string[];
}
export interface Outline {
  title: string;
  logline: string;
  units: OutlineUnit[];
}

export const DATA_DIR = path.resolve(process.env.SCRIPT_BUILDER_DATA ?? "projects");

export function unitLabel(format: Format): string {
  return format === "feature" ? "Sequence" : format === "short" ? "Part" : "Episode";
}

const pad = (n: number) => String(n).padStart(2, "0");

// Where each part lives inside the project folder.
export function partFiles(slug: string, part: string): string[] {
  const [kind, num] = part.split(":");
  const n = Number(num);
  switch (kind) {
    case "concept":
      return ["build/concept.md"];
    case "bible":
      return ["bible/characters.md", "bible/world_rules.md"];
    case "outline":
    case "revised_outline":
      return ["build/outline.json", "build/outline.md"];
    case "review":
      return ["room/outline_review.md"];
    case "beats":
      return [`build/beats/unit-${pad(n)}.md`];
    case "draft":
      return [`build/drafts/unit-${pad(n)}.fountain`];
    case "script_review":
      return [`room/script_review_${n}.md`];
    case "assembly":
      return [`script/${slug}_v1.fountain`];
    default:
      throw new Error(`Unknown part "${part}"`);
  }
}

export function projectDir(slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) throw new Error(`Invalid project slug "${slug}"`);
  return path.join(DATA_DIR, slug);
}

export function makeSlug(text: string): string {
  const base = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 5)
    .join("-")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${base || "script"}-${randomBytes(2).toString("hex")}`;
}

async function writeAtomic(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, file);
}

export async function writeFile(slug: string, rel: string, content: string): Promise<void> {
  await writeAtomic(path.join(projectDir(slug), rel), content);
}

export async function readFile(slug: string, rel: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path.join(projectDir(slug), rel), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function loadState(slug: string): Promise<ProjectState> {
  const raw = await readFile(slug, "build/state.json");
  if (!raw) throw new Error(`No project "${slug}". Use list_scripts to see existing projects.`);
  return JSON.parse(raw) as ProjectState;
}

export async function saveState(state: ProjectState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await writeFile(state.slug, "build/state.json", JSON.stringify(state, null, 2));
}

export async function listProjects(): Promise<ProjectState[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(DATA_DIR);
  } catch {
    return [];
  }
  const states: ProjectState[] = [];
  for (const name of entries) {
    try {
      states.push(await loadState(name));
    } catch {
      // Not a script-builder project (e.g. a hand-made writers' room project or the template).
    }
  }
  return states.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readOutline(slug: string): Promise<Outline | undefined> {
  const raw = await readFile(slug, "build/outline.json");
  return raw ? (JSON.parse(raw) as Outline) : undefined;
}

export function isDone(state: ProjectState, part: string): boolean {
  return state.parts[part]?.status === "done";
}

export function markDone(state: ProjectState, part: string, note?: string): void {
  const prev = state.parts[part];
  state.parts[part] = {
    status: "done",
    updatedAt: new Date().toISOString(),
    revisions: (prev?.revisions ?? 0) + 1,
    notes: note ? [...(prev?.notes ?? []), note] : prev?.notes,
  };
}

// Revising a part makes everything built on top of it stale.
export function markDownstreamStale(state: ProjectState, part: string): void {
  const [kind, num] = part.split(":");
  const stale = (p: string) => {
    if (state.parts[p]) state.parts[p].status = "stale";
  };
  const all = Object.keys(state.parts);
  const order = ["concept", "bible", "outline", "review", "revised_outline"];
  if (order.includes(kind)) {
    const idx = order.indexOf(kind);
    for (const p of order.slice(idx + 1)) {
      // A hand revision of the outline keeps the room's review; it only invalidates beats and drafts.
      if (kind === "outline" || kind === "revised_outline") break;
      stale(p);
    }
    for (const p of all) if (/^(beats|draft):/.test(p) || p === "assembly") stale(p);
  } else if (kind === "beats") {
    stale(`draft:${num}`);
    stale("assembly");
  } else if (kind === "draft" || kind === "script_review") {
    stale("assembly");
  }
}

export function projectMd(s: Settings, outline?: Outline): string {
  const title = outline?.title ?? s.title ?? "Untitled";
  return `# Project: ${title}

| Field | Value |
|---|---|
| Format | ${s.format} |
| Units | ${outline?.units.length ?? s.units} × ${s.unitLength} |
| Runtime caps | ${s.maxUnitSeconds ? `${s.maxUnitSeconds}s per unit` : "—"}${s.minTotalMinutes || s.maxTotalMinutes ? `, series ${s.minTotalMinutes ?? 0}–${s.maxTotalMinutes ?? "∞"} min` : ""} |
| Platform | ${s.platform ?? "—"} |
| Language | ${s.language} |
| Target audience | ${s.audience} |
| Source / world | ${s.source ?? "original"} |
| Current draft | V1 — \`script/\` (generated by script-builder-mcp) |

## Logline
${outline?.logline ?? s.idea}

## Original idea
${s.idea}

## What this draft must achieve
${s.notes ?? "- "}

## Known worries
- First machine-generated draft: check emotional causality, canon and dialogue voice before anything else.
`;
}
