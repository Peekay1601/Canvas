import { App as McpApp, type McpUiHostContext } from "@modelcontextprotocol/ext-apps/app-with-deps";
import { Background, Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildEdges, buildNodes, castByUnit } from "./layout";
import { nodeTypes, type Ctx, type Focus } from "./nodes";
import { SAMPLE } from "./sample";
import { STAGE_LABEL, type Asset, type Snapshot } from "./types";

// Inside Claude the page runs in an iframe and talks to the connector; opened directly (GitHub Pages) it shows a sample.
const EMBEDDED = window.parent !== window;

function readStructured(result: { structuredContent?: unknown; content?: unknown[] }): Record<string, any> | null {
  const sc = result.structuredContent as Record<string, any> | undefined;
  if (sc) return sc.result && typeof sc.result === "object" ? sc.result : sc;
  const text = (result.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === "text")?.text;
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

export function App() {
  const appRef = useRef<McpApp | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(EMBEDDED ? null : SAMPLE);
  const [host, setHost] = useState<McpUiHostContext | undefined>();
  const [focus, setFocus] = useState<Focus | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- connect to the host (Claude)
  useEffect(() => {
    if (!EMBEDDED) return;
    const app = new McpApp({ name: "Seedance Production canvas", version: "0.1.0" }, {}, { autoResize: true });
    app.ontoolresult = (r) => {
      const s = readStructured(r);
      if (s?.units) setSnap(s as Snapshot);
      else if (r.isError) setError("The connector couldn't read the project.");
    };
    app.onhostcontextchanged = (c) => setHost((h) => ({ ...h, ...c }));
    app.connect().then(() => setHost(app.getHostContext())).catch((e) => setError(String(e)));
    appRef.current = app;
    return () => { appRef.current = null; };
  }, []);

  // --- theme
  useEffect(() => {
    const theme = host?.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
  }, [host?.theme]);

  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(null), 4000); };

  const act = useCallback((message: string) => {
    const app = appRef.current;
    if (!app) return flash(`Inside Claude this asks: “${message}”`);
    app.sendMessage({ role: "user", content: [{ type: "text", text: message }] })
      .then(() => flash(`Sent to Claude: “${message}”`))
      .catch(() => flash("Couldn't send that to Claude."));
  }, []);

  const refresh = useCallback(async () => {
    const app = appRef.current;
    if (!app) return flash("Sample data: open the canvas from Claude to see your project.");
    setBusy(true);
    try {
      const s = readStructured(await app.callServerTool({ name: "production_canvas", arguments: {} }));
      if (s?.units) setSnap(s as Snapshot);
    } catch { flash("Couldn't refresh."); }
    setBusy(false);
  }, []);

  // --- tell Claude what the user is looking at, so "this one" means something
  useEffect(() => {
    const app = appRef.current;
    if (!app || !snap) return;
    const text = !focus ? "The user is looking at the whole production canvas."
      : "unit" in focus ? `The user has ${focus.unit} selected on the canvas.`
      : `The user has ${focus.kind.slice(0, -1)} ${focus.id} selected on the canvas.`;
    app.updateModelContext({ content: [{ type: "text", text }] }).catch(() => {});
  }, [focus, snap]);

  // --- thumbnails of asset images (the sandbox can't read local files, so the connector sends small JPEGs)
  useEffect(() => {
    const app = appRef.current;
    if (!app || !snap) return;
    const all: Asset[] = Object.values(snap.assets).flat();
    const wanted = [...new Set(all.map((a) => a.image).filter((p): p is string => !!p && !thumbs[p]))];
    let cancelled = false;
    (async () => {
      for (let i = 0; i < wanted.length && !cancelled; i += 4) {
        const got = await Promise.all(wanted.slice(i, i + 4).map(async (path) => {
          try {
            const r = readStructured(await app.callServerTool({ name: "canvas_thumbnail", arguments: { path } }));
            return r?.data ? ([path, r.data as string] as const) : null;
          } catch { return null; }
        }));
        if (!cancelled) setThumbs((t) => ({ ...t, ...Object.fromEntries(got.filter((g) => !!g)) }));
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);

  const ctx: Ctx = useMemo(
    () => ({ focus, setFocus, act, thumbs, castByUnit: snap ? castByUnit(snap) : {} }),
    [focus, act, thumbs, snap],
  );
  const layout = useMemo(() => (snap ? buildNodes(snap, ctx) : null), [snap, ctx]);
  const edges = useMemo(() => (snap ? buildEdges(snap, focus) : []), [snap, focus]);

  const fullscreen = host?.displayMode === "fullscreen";
  const canFullscreen = !!host?.availableDisplayModes?.includes("fullscreen");
  const toggleFullscreen = () =>
    appRef.current?.requestDisplayMode({ mode: fullscreen ? "inline" : "fullscreen" })
      .then((r) => setHost((h) => ({ ...h, displayMode: r.mode })))
      .catch(() => {});

  const nextUnit = snap?.units.find((u) => u.stage !== "export") ?? snap?.units[0];
  const waiting = snap?.units.filter((u) => u.stage === "review" || u.stage === "images").length ?? 0;
  const generating = snap?.units.filter((u) => u.stage === "generating").length ?? 0;

  return (
    <div className={`shell${fullscreen || !EMBEDDED ? " full" : ""}`}>
      <header className="bar">
        <div className="crumbs">
          <span className="logo">S</span>
          <strong>{snap?.project.title ?? "Production"}</strong>
          {snap && <span className="muted">/ {snap.units.length} units · {snap.generations} generations</span>}
          {!EMBEDDED && <span className="sample-tag">sample</span>}
        </div>
        <div className="next">
          <span className="eyebrow accent">Next for you</span>
          {snap && !snap.units.length && (
            <>
              <span className="next-text">Start the project</span>
              <button className="primary" onClick={() => act("Start the project: read and split the script")}>Open</button>
            </>
          )}
          {nextUnit && (
            <>
              <span className="next-text">{nextUnit.next ?? STAGE_LABEL[nextUnit.stage]}</span>
              {nextUnit.next && <button className="primary" onClick={() => act(nextUnit.next!)}>Open</button>}
            </>
          )}
          {!!waiting && <span className="pill">Waiting · {waiting}</span>}
          {!!generating && <span className="pill">Generating · {generating}</span>}
        </div>
        <div className="actions">
          <button onClick={refresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</button>
          {canFullscreen && <button onClick={toggleFullscreen}>{fullscreen ? "Exit full screen" : "Full screen"}</button>}
        </div>
      </header>

      <main className="flow">
        {error && <div className="empty">{error}</div>}
        {!error && !layout && <div className="empty">Loading the production…</div>}
        {layout && (
          <ReactFlowProvider>
            <ReactFlow
              nodes={layout.nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ nodes: layout.topIds.map((id) => ({ id })), padding: 0.04 }}
              minZoom={0.15}
              maxZoom={1.6}
              nodesConnectable={false}
              nodesDraggable={false}
              elementsSelectable={false}
              onPaneClick={() => setFocus(null)}
            >
              <Background gap={24} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        )}
        {toast && <div className="toast">{toast}</div>}
      </main>
    </div>
  );
}
