// Every prompt the pipeline sends. The same text drives both modes: the server's own Claude calls (engine mode) and
// the writing tasks handed to the client's Claude (guided mode).
import { unitLabel, type Outline, type OutlineUnit, type Settings } from "./store.js";
import { fmt, unitBudget } from "./runtime.js";

export const SYSTEM = `You are the head writer of a professional screenwriting team. You develop original screen stories from a \
single idea into production-ready scripts.

Craft standards:
- Every scene changes something: a want meets an obstacle and the situation turns.
- Emotion is earned on screen, never asserted. Show the vulnerable beat before the payoff that depends on it.
- Characters act from established wants, fears and knowledge. No convenient coincidences, no idiot plots.
- Pressure escalates across the story; each unit raises the stakes or reverses the direction.
- Dialogue is specific to each character's voice, subtext over statement, never on-the-nose exposition.
- Respect the source and culture when the story draws on mythology, history or a real community: distinguish tradition \
from invention and never caricature.
- Match the target format exactly (length, density, hooks, endings) and write for the stated audience and platform.

Output only what each task asks for, in the exact format it specifies, with no preamble or closing remarks.`;

const FORMAT_RULES: Record<Settings["format"], string> = {
  microdrama:
    "Vertical microdrama: each episode is self-contained but serial. Hook in the first 3-10 seconds (open on action or a charged line, never on establishing exposition). One central emotional question per episode, a turn or reversal, and an unresolved consequence at the end that makes the viewer swipe to the next episode. Not every ending needs a cliffhanger; vary them (question, reveal, decision, threat, emotional gut-punch). Roughly one screenplay page per minute of screen time.",
  series:
    "Episodic series: each episode has an A plot and usually a B plot, act breaks with rising stakes, and an ending that resolves the episode's question while opening the next. Season arcs pay off across episodes. Roughly one screenplay page per minute.",
  feature:
    "Feature film told in sequences: each unit is a sequence of several scenes with its own mini-goal and turn. Classic setup and payoff, a midpoint that changes the game, a dark moment and a cathartic climax. Roughly one screenplay page per minute.",
  short:
    "Short film: one idea, economy above all, a clear turn and one image the audience keeps. Each unit is a movement of the short. Roughly one screenplay page per minute.",
};

export function brief(s: Settings): string {
  const label = unitLabel(s.format);
  return `# PROJECT BRIEF
Idea: ${s.idea}
${s.title ? `Working title: ${s.title}\n` : ""}Format: ${s.format} — ${s.units} ${label.toLowerCase()}s, each ${s.unitLength}
Dialogue language: ${s.language} (scene headings, action and parentheticals in English unless the notes say otherwise)
Audience: ${s.audience}
${s.platform ? `Platform: ${s.platform}\n` : ""}${s.genre ? `Genre: ${s.genre}\n` : ""}${s.tone ? `Tone: ${s.tone}\n` : ""}${
    s.source ? `Source / world: ${s.source}\n` : ""
  }${s.notes ? `Showrunner notes: ${s.notes}\n` : ""}${runtimeRule(s)}
Format rules: ${FORMAT_RULES[s.format]}`;
}

export function runtimeRule(s: Settings): string {
  const { cap, target } = unitBudget(s);
  if (cap === undefined && target === undefined) return "";
  const label = unitLabel(s.format).toLowerCase();
  const series = s.maxTotalMinutes
    ? s.minTotalMinutes
      ? `the whole series must run between ${s.minTotalMinutes} and ${s.maxTotalMinutes} minutes`
      : `the whole series must stay under ${s.maxTotalMinutes} minutes`
    : "";
  return `RUNTIME RULES: ${cap !== undefined ? `every ${label} must run under ${fmt(cap)} on screen (hard cap); ` : ""}aim for about ${fmt(target!)} per ${label}${
    series ? `; ${series}` : ""
  }. Dialogue in Indic languages plays slower than English: budget about 2 spoken words per second, plus time for action and silences.\n`;
}

export function outlineMd(o: Outline, s: Settings): string {
  const label = unitLabel(s.format);
  return [
    `# ${o.title}`,
    `**Logline:** ${o.logline}`,
    ...o.units.map(
      (u) =>
        `## ${label} ${u.number}: ${u.title}\n${u.summary}\n\n- Hook: ${u.hook}\n- Turn: ${u.turn}\n- Ending: ${u.ending}\n- Emotion: ${u.dominant_emotion} (${u.emotional_intensity}/10)\n- Characters: ${u.characters.join(", ")}`,
    ),
  ].join("\n\n");
}

// The shared context every later call starts with. Kept byte-identical across calls in a stage so it is cached.
export function context(s: Settings, parts: { concept?: string; bible?: string; outline?: string }): string {
  return [
    brief(s),
    parts.concept && `# APPROVED CONCEPT\n${parts.concept}`,
    parts.bible && `# STORY BIBLE\n${parts.bible}`,
    parts.outline && `# ${unitLabel(s.format).toUpperCase()} OUTLINE\n${parts.outline}`,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export const CONCEPT_TASK = (s: Settings, notes?: string) => `Develop the idea into a series concept${
  notes ? `, applying these notes: ${notes.trim().replace(/[.\s]+$/, "")}` : ""
}.

Write Markdown with exactly these sections:
## Title (the title, plus two alternatives)
## Logline (one or two sentences)
## Genre and tone
## Theme (what the story is really about)
## Central dramatic question
## Protagonist(s) and what they want vs need
## Antagonistic force
## The hook (why someone starts watching)
## Shape of the story (beginning, midpoint, ending, in a paragraph each)
## The ending and its emotional payoff
## Why it works for ${s.audience} on this format
## Risks to watch (cultural, logical, pacing)`;

export const BIBLE_SCHEMA = {
  type: "object",
  properties: {
    characters_md: { type: "string" },
    world_rules_md: { type: "string" },
  },
  required: ["characters_md", "world_rules_md"],
  additionalProperties: false,
};

export const BIBLE_TASK = (notes?: string) => `Write the story bible${notes ? `, applying these notes: ${notes.trim().replace(/[.\s]+$/, "")}` : ""}.

Return JSON with two Markdown documents:
- characters_md: "# Characters", then a "## Name" section per character (all leads and every recurring character). Each has \
bullet points for Role, Age/look, Want, Need, Fear / wound, Secret, Arc (start → turning points → end), Voice (how they talk, \
with one sample line in the dialogue language), Relationships.
- world_rules_md: "# World rules": setting and period, the rules of the world (powers, hierarchy, rituals, technology), the \
genre contract and tone, visual motifs, and a "## Source vs invention" section that marks each rule SOURCE (with the \
tradition or text it comes from) or INVENTION. For an original contemporary story, cover the social world and its rules instead.`;

export const OUTLINE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    logline: { type: "string" },
    units: {
      type: "array",
      items: {
        type: "object",
        properties: {
          number: { type: "integer" },
          title: { type: "string" },
          summary: { type: "string" },
          hook: { type: "string" },
          turn: { type: "string" },
          ending: { type: "string" },
          emotional_intensity: { type: "integer" },
          dominant_emotion: { type: "string" },
          characters: { type: "array", items: { type: "string" } },
        },
        required: [
          "number",
          "title",
          "summary",
          "hook",
          "turn",
          "ending",
          "emotional_intensity",
          "dominant_emotion",
          "characters",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "logline", "units"],
  additionalProperties: false,
};

export const OUTLINE_TASK = (s: Settings, notes?: string) => {
  const label = unitLabel(s.format).toLowerCase();
  return `Write the full ${label} outline: exactly ${s.units} ${label}s, numbered 1 to ${s.units}${
    notes ? `, applying these notes: ${notes.trim().replace(/[.\s]+$/, "")}` : ""
  }.

For each ${label}: a title; a 4-8 sentence summary of what happens and why (cause and effect, not just events); the hook (the \
first moment on screen); the turn (the reversal or escalation); the ending (the unresolved consequence that pulls into the \
next ${label}); emotional_intensity 0-10 and dominant_emotion; and the characters on screen. Plan the whole arc before \
writing: escalation across the story, vulnerability planted before the payoffs that need it, every setup paid off, and an \
intensity curve with valleys as well as peaks.`;
};

export const REVISED_OUTLINE_TASK = (s: Settings, review: string) =>
  `The writers' room has reviewed the outline above. Here is the review and the judge's verdict:

<review>
${review}
</review>

Rewrite the outline applying every REQUIRED CHANGE from the verdict, and the recommended ones where they do not conflict. \
Keep exactly ${s.units} ${unitLabel(s.format).toLowerCase()}s. Return the complete outline in the same JSON shape.`;

export const CRITICS = [
  {
    key: "emotional-architect",
    name: "Maya, Emotional Architect",
    lens: "emotional identification, vulnerability, relationship arcs and catharsis. Flag every payoff that has not been earned by an earlier vulnerable beat, and every stretch where we stop caring.",
  },
  {
    key: "dramaturg",
    name: "Arjun, Dramaturg",
    lens: "cause and effect, character motivation and agency, who knows what when, plot holes, coincidences, continuity and escalation. Ask what exactly prevents each character from acting sooner.",
  },
  {
    key: "retention-specialist",
    name: "Tara, Retention Specialist",
    lens: "hooks, pacing, repetition, dead air, episode endings and drop-off risk for this exact format and platform. Rate drop-off risk per unit LOW/MEDIUM/HIGH. Never trade coherence for cheap shock.",
  },
  {
    key: "world-guardian",
    name: "Veda, World & Character Guardian",
    lens: "fidelity to the source, mythology, history or culture; internal world logic; respectful representation; and character integrity and agency. Separate contradictions from deliberate inventions worth keeping.",
  },
  {
    key: "cold-audience",
    name: "Kiran, Cold Audience",
    lens: "a first-time viewer from the target audience who knows nothing beyond what is on screen. Flag confusion, unclear relationships, assumed knowledge and moments you were told to feel but did not. Ignore the bible: react only to what is on the page in front of you.",
  },
] as const;

export const CRITIC_TASK = (c: (typeof CRITICS)[number]) => `You are ${c.name} in a professional writers' room. Review the \
outline above through your lens: ${c.lens}

Be specific and cite units by number. No generic praise. Write Markdown:
## Verdict (3 sentences)
## Issues (numbered; each with severity HIGH/MEDIUM/LOW, the unit numbers, what is wrong, and a concrete fix)
## What must not be lost (strengths to protect)
Keep it under 700 words.`;

export const JUDGE_TASK = (critiques: string) => `You are Rudra, the independent Critic Judge of the writers' room. Five \
writers reviewed the outline above:

${critiques}

Judge the arguments, not the agents: check each claim against the outline, reject unsupported ones, and do not side with \
the majority by default. Write Markdown:
## Executive verdict (5 sentences)
## Scorecard (0-10 with one-line reason each: emotional identification, character motivation, dramatic causality, \
retention, relationship chemistry, conflict escalation, world/canon consistency, cold-viewer clarity)
## Rulings on disagreements
## Rejected claims
## REQUIRED CHANGES (numbered, concrete, with unit numbers — these will be applied to the outline)
## Recommended changes (optional improvements)`;

export const BEATS_TASK = (s: Settings, u: OutlineUnit, notes?: string) => {
  const label = unitLabel(s.format);
  return `Write the beat sheet for ${label} ${u.number}: "${u.title}" (${s.unitLength})${
    notes ? `, applying these notes: ${notes.trim().replace(/[.\s]+$/, "")}` : ""
  }.

Markdown, one numbered beat per line: the scene heading (INT./EXT. LOCATION — TIME), what happens, the character objective, \
and the emotional shift (e.g. "hope → dread"). Mark the hook beat, the turn and the ending beat. Fit the beats to the length: \
a 90-second episode has roughly 4-8 beats, a 45-minute episode 25-40.${runtimeTarget(s)} Continue seamlessly from the previous ${label.toLowerCase()} \
and set up the next one exactly as the outline says. End with a line "Continuity: …" listing facts this ${label.toLowerCase()} \
establishes (injuries, objects, who knows what).`;
};

export const DRAFT_TASK = (
  s: Settings,
  u: OutlineUnit,
  beats: string,
  prev?: string,
  next?: string,
  notes?: string,
) => {
  const label = unitLabel(s.format);
  return `Write the screenplay for ${label} ${u.number}: "${u.title}" (${s.unitLength})${
    notes ? `, applying these notes: ${notes.trim().replace(/[.\s]+$/, "")}` : ""
  }.

<beats>
${beats}
</beats>
${prev ? `\n<previous_${label.toLowerCase()}_beats>\n${prev}\n</previous_${label.toLowerCase()}_beats>\n` : ""}${
    next ? `\n<next_${label.toLowerCase()}_beats>\n${next}\n</next_${label.toLowerCase()}_beats>\n` : ""
  }
Write it in Fountain screenplay format. Start with a section line "# ${label} ${u.number}: ${u.title}", then scene headings \
(INT./EXT. LOCATION - TIME), action, CHARACTER cues in capitals, parentheticals and dialogue. ${dialogueStyle(s.language)} Scene headings, action and parentheticals in English. Follow the beats, match the target length (about one page per minute)${runtimeTarget(s)}, open on the \
hook and end on the ending beat. Give each character the voice the bible describes. No camera directions beyond the essential, \
no notes, no summary — only the script.`;
};

function runtimeTarget(s: Settings): string {
  const { cap, target } = unitBudget(s);
  if (target === undefined) return "";
  return `${cap !== undefined ? ` HARD CAP: under ${fmt(cap)} of screen time.` : ""} Aim for about ${fmt(target)}.`;
}

export const TRIM_NOTES = (seconds: number, cap: number, target: number) =>
  `This draft runs an estimated ${fmt(seconds)}, over the hard cap of ${fmt(cap)}. Cut it to about ${fmt(target)}: trim \
action, merge or drop the least essential lines and beats, keep the hook, the turn and the ending beat intact, and keep the \
dialogue natural.`;

export function dialogueStyle(language: string): string {
  const base = `Dialogue in natural, conversational spoken ${language}: the way people of this audience actually talk today, \
colloquial rather than literary, short lines, interruptions and silences, with everyday English words mixed in wherever real \
speakers would use them.`;
  if (/telugu/i.test(language)) {
    return `${base} Write it in Telugu script. Use spoken (vyavaharika) Telugu as urban Hyderabad and Vijayawada speakers use \
it — "ఏంటి", "చెప్పు", "అవును లే", "పర్లేదు" — never bookish (grandhika) forms. Common English words people say in English (hospital, \
sorry, okay, boyfriend, office, phone, ward) stay in English, written in Latin script inside the Telugu line.`;
  }
  return /english/i.test(language) ? base : `${base} Write it in ${language}'s native script.`;
}

export const UNIT_LABEL_LOWER = (s: Settings) => unitLabel(s.format).toLowerCase();

// ---------- full-script review loop ----------

export const SCRIPT_VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict_md: { type: "string" },
    approved: { type: "boolean" },
    corrections: {
      type: "array",
      items: {
        type: "object",
        properties: { unit: { type: "integer" }, notes: { type: "string" } },
        required: ["unit", "notes"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdict_md", "approved", "corrections"],
  additionalProperties: false,
};

export const SCRIPT_REVIEW_SCHEMA = {
  ...SCRIPT_VERDICT_SCHEMA,
  properties: { critiques_md: { type: "string" }, ...SCRIPT_VERDICT_SCHEMA.properties },
  required: ["critiques_md", ...SCRIPT_VERDICT_SCHEMA.required],
};

export const SCRIPT_CRITIC_TASK = (c: (typeof CRITICS)[number], round: number) => `You are ${c.name} in a professional \
writers' room. This is review round ${round} of the COMPLETE SCRIPT above (every episode is written). Review it through your \
lens: ${c.lens}

Judge the pages, not the outline: dialogue, scene construction, setups and payoffs across episodes, continuity, and whether \
each episode's hook, turn and ending actually land on the page. ${round > 1 ? "Earlier rounds' corrections have been applied; focus on what is still wrong, and do not re-litigate fixed issues. " : ""}\
Only raise issues worth a rewrite. Write Markdown:
## Verdict (3 sentences)
## Corrections (numbered; each with severity HIGH/MEDIUM/LOW, the episode number, the exact line or moment, what is wrong, and the concrete fix)
## Protect (what must not be touched)
Keep it under 600 words.`;

export const SCRIPT_JUDGE_TASK = (critiques: string, round: number, maxRounds: number) => `You are Rudra, the independent \
Critic Judge. This is review round ${round} of ${maxRounds} on the COMPLETE SCRIPT above. Five writers reviewed it:

${critiques}

Check every claimed problem against the pages and reject unsupported ones. Decide whether the script is ready to go to the \
showrunner. Approve it when no HIGH-severity problem remains and the MEDIUM ones would not be noticed by most viewers; do not \
hold it back for polish. ${round === maxRounds ? "This is the final round: list only corrections that are clearly worth one more rewrite. " : ""}\
Return JSON:
- verdict_md: Markdown with "## Executive verdict", "## Scorecard" (0-10 with one-line reasons: emotional identification, \
character motivation, dramatic causality, retention, dialogue, conflict escalation, world/canon consistency, cold-viewer clarity), \
"## Rulings" and "## Rejected claims".
- approved: true if the script is ready, false if it needs corrections.
- corrections: one entry per episode that must be rewritten — unit (episode number) and notes (every required change for that \
episode, concrete, citing lines). Empty when approved.`;
