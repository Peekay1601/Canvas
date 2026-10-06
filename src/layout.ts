import type { Edge, Node } from "@xyflow/react";
import type { Ctx, Focus } from "./nodes";
import { avatar } from "./sample";
import type { AssetKind, Snapshot } from "./types";

// Fixed grid, like a storyboard wall: the show on top, then every unit in rows of COLS.
const COLS = 5;
const CARD_W = 300;
const CARD_H = 196;
const GAP = 24;
const PAD = 24;
const HEAD = 64;
const INNER_W = COLS * CARD_W + (COLS - 1) * GAP;
const PERSON_W = 140;
const PERSON_H = 188;
const LOOK_W = 340;
const LIST_H = 112;

const UNIT_WORD: Record<string, string> = { episode: "Episodes", scene: "Scenes", shot: "Shots" };

export function buildNodes(snap: Snapshot, ctx: Ctx): { nodes: Node[]; topIds: string[] } {
  const nodes: Node[] = [];
  const cast = snap.assets.characters;

  // --- the show: look + cast, then locations / props / costumes
  const castX = PAD + LOOK_W + GAP;
  const perRow = Math.max(1, Math.floor((INNER_W - LOOK_W - GAP + GAP) / (PERSON_W + GAP)));
  const castRows = Math.max(1, Math.ceil(cast.length / perRow));
  const row1H = Math.max(castRows * (PERSON_H + GAP) - GAP, 200);
  const listY = HEAD + row1H + GAP;
  const showH = listY + LIST_H + PAD;

  nodes.push({
    id: "show", type: "section", position: { x: 0, y: 0 }, draggable: false, selectable: false, zIndex: -1,
    data: {
      title: snap.project.title,
      subtitle: [snap.project.type, "made once, used by every unit"].filter(Boolean).join(" · "),
      width: INNER_W + 2 * PAD, height: showH,
    },
  });
  nodes.push({ id: "look", type: "look", position: { x: PAD, y: HEAD }, draggable: false, data: { snap, width: LOOK_W } });

  cast.forEach((a, i) => {
    nodes.push({
      id: `characters:${a.id}`, type: "person", draggable: false,
      position: { x: castX + (i % perRow) * (PERSON_W + GAP), y: HEAD + Math.floor(i / perRow) * (PERSON_H + GAP) },
      data: { asset: a, ctx, fallback: avatar(a.name, i) },
    });
  });
  if (!cast.length) {
    nodes.push({
      id: "list:characters", type: "list", position: { x: castX, y: HEAD }, draggable: false,
      data: { kind: "characters", title: "Cast", items: [], ctx, width: INNER_W - LOOK_W - GAP,
              empty: "No characters yet. They're added when you prepare assets for a unit." },
    });
  }

  const lists: [AssetKind, string, string][] = [
    ["locations", "Locations", "No locations yet."],
    ["props", "Props", "No props yet."],
    ["costumes", "Costumes", "No costumes yet."],
  ];
  const listW = (INNER_W - 2 * GAP) / 3;
  lists.forEach(([kind, title, empty], i) => {
    nodes.push({
      id: `list:${kind}`, type: "list", draggable: false,
      position: { x: PAD + i * (listW + GAP), y: listY },
      data: { kind, title, items: snap.assets[kind], ctx, width: listW, empty },
    });
  });

  // --- units
  const unitsY = showH + 48;
  const rows = Math.max(1, Math.ceil(snap.units.length / COLS));
  const word = UNIT_WORD[snap.project.unit_kind ?? ""] ?? "Units";
  nodes.push({
    id: "units", type: "section", position: { x: 0, y: unitsY }, draggable: false, selectable: false, zIndex: -1,
    data: {
      title: `${word} · ${snap.units.length}`,
      subtitle: snap.units.length ? "Script → assets → shots → prompts → generate → review → export"
                                  : "No units yet. Start the project to split the script.",
      width: INNER_W + 2 * PAD, height: HEAD + rows * (CARD_H + GAP) - GAP + PAD,
    },
  });
  snap.units.forEach((u, i) => {
    nodes.push({
      id: `unit:${u.code}`, type: "unit", draggable: false,
      position: { x: PAD + (i % COLS) * (CARD_W + GAP), y: unitsY + HEAD + Math.floor(i / COLS) * (CARD_H + GAP) },
      data: { unit: u, ctx, width: CARD_W, height: CARD_H },
    });
  });

  const topIds = ["show", ...snap.units.slice(0, COLS * 2).map((u) => `unit:${u.code}`)];
  return { nodes, topIds };
}

/** Lines only for what's in focus: an asset to the units it's in, or a unit back to its cast, places and props. */
export function buildEdges(snap: Snapshot, focus: Focus | null): Edge[] {
  if (!focus) return [];
  const sourceOf = (kind: AssetKind, id: string) => (kind === "characters" ? `characters:${id}` : `list:${kind}`);
  const edge = (source: string, code: string): Edge => ({
    id: `${source}->${code}`, source, target: `unit:${code}`, type: "default", animated: true,
    className: "focus-edge",
  });
  if ("kind" in focus) {
    const a = snap.assets[focus.kind].find((x) => x.id === focus.id);
    return a ? a.units.map((code) => edge(sourceOf(focus.kind, a.id), code)) : [];
  }
  const seen = new Set<string>();
  const out: Edge[] = [];
  (Object.keys(snap.assets) as AssetKind[]).forEach((kind) => {
    snap.assets[kind].forEach((a) => {
      const src = sourceOf(kind, a.id);
      if (a.units.includes(focus.unit) && !seen.has(src)) {
        seen.add(src);
        out.push(edge(src, focus.unit));
      }
    });
  });
  return out;
}

export function castByUnit(snap: Snapshot): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  snap.assets.characters.forEach((c) => c.units.forEach((u) => (out[u] ??= []).push(c.name)));
  return out;
}
