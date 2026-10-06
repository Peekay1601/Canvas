import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { STAGE_LABEL, STAGE_STEP, STEPS, type Asset, type AssetKind, type Snapshot, type Unit } from "./types";

// Shared by every node through node.data, so the nodes stay plain and the App owns the state.
export interface Ctx {
  focus: Focus | null;
  setFocus: (f: Focus | null) => void;
  act: (message: string) => void;
  thumbs: Record<string, string>;
  castByUnit: Record<string, string[]>;
}
export type Focus = { kind: AssetKind; id: string } | { unit: string };

const hidden = { opacity: 0, pointerEvents: "none" as const };
const Out = () => <Handle type="source" position={Position.Bottom} style={hidden} isConnectable={false} />;
const In = () => <Handle type="target" position={Position.Top} style={hidden} isConnectable={false} />;

const isFocused = (f: Focus | null, kind: AssetKind, id: string) =>
  !!f && "kind" in f && f.kind === kind && f.id === id;

export type SectionNode = Node<{ title: string; subtitle?: string; width: number; height: number }, "section">;
export const SectionCard = memo(({ data }: NodeProps<SectionNode>) => (
  <div className="section" style={{ width: data.width, height: data.height }}>
    <div className="section-title">{data.title}</div>
    {data.subtitle && <div className="section-sub">{data.subtitle}</div>}
  </div>
));

export type LookNode = Node<{ snap: Snapshot; width: number }, "look">;
export const LookCard = memo(({ data }: NodeProps<LookNode>) => {
  const p = data.snap.project;
  return (
    <div className="card look" style={{ width: data.width }}>
      <div className="card-head">
        <span className="card-title">The look</span>
        <span className="eyebrow">{[p.ratio, p.resolution].filter(Boolean).join(" · ")}</span>
      </div>
      <p className="look-text">{p.look || "No look chosen yet. Pick one when you start the project."}</p>
      <div className="chips">
        {data.snap.bible.length
          ? data.snap.bible.map((s) => <span key={s} className="chip">{s}</span>)
          : <span className="muted">Bible not written yet</span>}
      </div>
    </div>
  );
});

export type PersonNode = Node<{ asset: Asset; ctx: Ctx; fallback: string }, "person">;
export const PersonCard = memo(({ data }: NodeProps<PersonNode>) => {
  const { asset: a, ctx } = data;
  const focused = isFocused(ctx.focus, "characters", a.id);
  const img = (a.image && ctx.thumbs[a.image]) || data.fallback;
  return (
    <button
      className={`card person${focused ? " focused" : ""}${a.status === "needed" ? " needed" : ""}`}
      onClick={() => ctx.setFocus(focused ? null : { kind: "characters", id: a.id })}
      title={a.description || a.name}
    >
      <img src={img} alt="" draggable={false} />
      <div className="person-name">{a.name}</div>
      <div className="person-meta">
        {a.status === "needed" ? "needs image" : `in ${a.units.length} ${a.units.length === 1 ? "unit" : "units"}`}
      </div>
      <Out />
    </button>
  );
});

export type ListNode = Node<{ kind: AssetKind; title: string; items: Asset[]; ctx: Ctx; width: number; empty: string }, "list">;
export const ListCard = memo(({ data }: NodeProps<ListNode>) => {
  const { ctx, kind } = data;
  return (
    <div className="card list" style={{ width: data.width }}>
      <div className="card-head">
        <span className="card-title">{data.title}</span>
        <span className="eyebrow">{data.items.length}</span>
      </div>
      {data.items.length ? (
        <div className="chips">
          {data.items.map((a) => {
            const focused = isFocused(ctx.focus, kind, a.id);
            return (
              <button
                key={a.id}
                className={`chip pick${focused ? " focused" : ""}${a.status === "needed" ? " needed" : ""}`}
                onClick={() => ctx.setFocus(focused ? null : { kind, id: a.id })}
                title={a.description || undefined}
              >
                {a.name}
                <span className="chip-count">{a.units.length}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted">{data.empty}</p>
      )}
      <Out />
    </div>
  );
});

export type UnitNode = Node<{ unit: Unit; ctx: Ctx; width: number; height: number }, "unit">;
export const UnitCard = memo(({ data }: NodeProps<UnitNode>) => {
  const { unit: u, ctx } = data;
  const step = STAGE_STEP[u.stage];
  const focused = !!ctx.focus && "unit" in ctx.focus && ctx.focus.unit === u.code;
  const approved = u.by_status.approved ?? 0;
  const cast = ctx.castByUnit[u.code] ?? [];
  return (
    <div
      className={`card unit stage-${u.stage}${focused ? " focused" : ""}`}
      style={{ width: data.width, height: data.height }}
      onClick={() => ctx.setFocus(focused ? null : { unit: u.code })}
    >
      <In />
      <div className="card-head">
        <span className="card-title"><span className="code">{u.code}</span>{u.title || "Untitled"}</span>
        <span className={`stage-pill stage-${u.stage}`}>{STAGE_LABEL[u.stage]}</span>
      </div>
      <div className="steps">
        {STEPS.map((s, i) => (
          <span key={s} className={`step${i < step ? " done" : i === step ? " current" : ""}`}>{s}</span>
        ))}
      </div>
      <div className="unit-meta">
        {u.shots
          ? `${u.shots} shots · ${u.seconds}s · ${approved} approved`
          : u.assets_needed ? `${u.assets_needed} images to add` : u.has_script ? "Script ready" : "No script yet"}
      </div>
      <div className="unit-cast">{cast.length ? cast.join(" · ") : " "}</div>
      {u.next && (
        <button className="next-btn nodrag" onClick={(e) => { e.stopPropagation(); ctx.act(u.next!); }}>
          {u.next} →
        </button>
      )}
    </div>
  );
});

export const nodeTypes = { section: SectionCard, look: LookCard, person: PersonCard, list: ListCard, unit: UnitCard };
