// Sample project shown when the canvas is opened directly (on GitHub Pages) instead of inside Claude.
import type { Asset, Snapshot, Stage, Unit } from "./types";

const cast: [string, string, string[]][] = [
  ["VENNELA", "Vennela", ["EP01", "EP02", "EP03", "EP04", "EP05", "EP06", "EP07", "EP08", "EP09", "EP10", "EP11", "EP12"]],
  ["KARTHIK", "Karthik", ["EP01", "EP02", "EP03", "EP04", "EP05", "EP06", "EP07", "EP08", "EP09", "EP10", "EP11"]],
  ["RAGHAVA", "Raghava", ["EP09", "EP12"]],
  ["MADHAVI", "Madhavi", ["EP02", "EP06", "EP10"]],
  ["SRIDHAR", "Sridhar", ["EP04", "EP08"]],
  ["SURIBABU", "Suribabu", ["EP03", "EP07"]],
  ["SIRI", "Siri", ["EP01"]],
];

const asset = (id: string, name: string, units: string[], status = "ready"): Asset => ({
  id, name, units, status, image: null, description: null,
});

const episodes: [string, Stage, Record<string, number>, number][] = [
  ["The Music Stops", "review", { approved: 6, generated: 2, revise: 1 }, 72],
  ["She Will Not Bow Alone", "generating", { approved: 2, generating: 3, queued: 4 }, 68],
  ["Room for Two", "queue", { ready: 8 }, 61],
  ["The Bigger Half", "prompts", { ready: 3, pending: 5 }, 64],
  ["Fifteen Years Later", "shots", {}, 0],
  ["The Song She Keeps", "images", {}, 0],
  ["Her First Front Row", "assets", {}, 0],
  ["Only Enough for One", "assets", {}, 0],
  ["He Chooses Her", "assets", {}, 0],
  ["Before Morning", "assets", {}, 0],
  ["One Year, Whatever Happens", "script", {}, 0],
  ["His Empty Chair", "script", {}, 0],
];

const next = (code: string, stage: Stage): string => ({
  script: "Start the project: read and split the script",
  assets: `Prepare assets for ${code}`,
  images: `I've added the images for ${code}, please sync them`,
  shots: `Prepare ${code}`,
  prompts: `Prepare ${code}`,
  queue: `Queue ${code}`,
  generating: `How is ${code} generating?`,
  review: `Review ${code}`,
  export: `Export ${code}`,
})[stage];

const units: Unit[] = episodes.map(([title, stage, by_status, seconds], i) => {
  const code = `EP${String(i + 1).padStart(2, "0")}`;
  const shots = Object.values(by_status).reduce((a, b) => a + b, 0);
  return {
    code, number: i + 1, title, summary: null, has_script: stage !== "script",
    assets_needed: stage === "images" ? 4 : 0, shots, seconds, by_status, stage, next: next(code, stage),
  };
});

export const SAMPLE: Snapshot = {
  project: {
    name: "your-turn-then-mine", title: "Your Turn, Then Mine", type: "web series", unit_kind: "episode",
    ratio: "9:16", resolution: "720p",
    look: "Warm naturalistic drama: soft practical light, handheld intimacy, Hyderabad evenings in amber and teal.",
  },
  bible: ["look", "camera", "lighting", "performance", "dialogue"],
  assets: {
    characters: cast.map(([id, name, u]) => asset(id, name, u)),
    costumes: [
      { ...asset("VENNELA_HOME_01", "Vennela · home", ["EP01", "EP02"]), character_id: "VENNELA" },
      { ...asset("KARTHIK_STAGE_01", "Karthik · stage", ["EP01", "EP04"]), character_id: "KARTHIK" },
    ],
    locations: [
      asset("MUSIC_SCHOOL", "Music school", ["EP01", "EP05"]),
      asset("VENNELA_HOME", "Vennela's home", ["EP01", "EP02", "EP03", "EP06"]),
      asset("RECORDING_STUDIO", "Recording studio", ["EP04", "EP07", "EP09"]),
      asset("TANK_BUND", "Tank Bund at night", ["EP03", "EP08"]),
      asset("AUDITORIUM", "Auditorium", ["EP07"], "needed"),
    ],
    props: [
      asset("VEENA", "Grandmother's veena", ["EP01", "EP06"]),
      asset("CASSETTE", "Mixtape cassette", ["EP02", "EP12"]),
      asset("ALBUM_CHEQUE", "Album cheque", ["EP04"], "needed"),
    ],
  },
  units,
  generations: 31,
};

/** Initials avatar, so the sample needs no image files. */
export function avatar(name: string, i: number): string {
  const hues = [28, 200, 340, 150, 260, 12, 90];
  const h = hues[i % hues.length];
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},55%,62%)"/><stop offset="1" stop-color="hsl(${h + 30},50%,38%)"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/><text x="60" y="74" font-family="system-ui,sans-serif" font-size="44" font-weight="600" fill="white" text-anchor="middle">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
