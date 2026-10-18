/*
 * The Script tab: upload a script → Analyse → episodes (or scenes / ad shots), each with its
 * image prompts and video prompts → make them one at a time or as a batch.
 * Uses the shared helpers from app.js through Studio.kit (available by the time anything renders).
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const PR = () => Studio.production;
  const K = () => Studio.kit;

  const ui = {
    options: Object.assign({ unitKind: "auto", lookId: "auto", ratio: "16:9", maxShots: 12, mode: "now" }, Studio.platform.getPref("scriptOptions", {})),
    pasteMode: false,
    pasteText: "",
    loadingFile: false,
    analysing: false,
    unit: null,
    pane: "images",
    open: {},
    batch: { images: true, autoLock: true, prompts: true, frames: true, videos: false, scope: "all", redo: false },
    batchOpen: false,
    sel: {},
    notes: {},
    bibleOpen: false,
    projectsOpen: false,
  };

  function saveOptions() {
    Studio.platform.setPref("scriptOptions", ui.options);
  }

  function chip(active, action, attrs, label) {
    return '<button class="chip' + (active ? " active" : "") + '" data-action="' + action + '" ' + attrs + ">" + label + "</button>";
  }

  function fmtSize(n) {
    return n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB";
  }

  // ---------- upload screen ----------

  function renderUpload() {
    const { esc, I } = K();
    const p = PR().pending;
    const o = ui.options;
    let html = "";

    const saved = PR().listProjects();
    if (saved.length && !ui.analysing) {
      html +=
        '<section class="card projects"><div class="row" style="margin-bottom:6px"><b>Continue a project</b></div>' +
        saved
          .slice(0, 4)
          .map((x) => '<div class="proj-row"><button class="proj-open" data-action="sc-open-project" data-id="' + x.id + '"><b>' + esc(x.title || "Untitled") + "</b><small>" + esc(x.type || "") + " · " + K().timeAgo(x.updatedAt) + "</small></button></div>")
          .join("") +
        "</section>";
    }
    html += '<section class="card"><div class="step"><span class="step-num">1</span>Your script</div>';
    if (p) {
      html +=
        '<div class="dropzone filled"><div class="dz-icon">' + I.doc + '</div><div class="dz-text"><b>' + esc(p.name) + "</b><small>" +
        (p.kind === "pdf" ? "PDF · " : "Text · ") + fmtSize(p.bytes) + " · ready to analyse</small>" +
        '<div class="dz-actions"><button class="btn small" data-action="sc-pick">Choose another</button><button class="btn small ghost" data-action="sc-clear">Remove</button></div></div></div>';
    } else if (ui.pasteMode) {
      html +=
        '<textarea class="tall" data-bind="sc-paste" placeholder="Paste your script here — a series, a film, a short or an ad. Any language.">' + esc(ui.pasteText) + "</textarea>" +
        '<div class="row" style="margin-top:8px"><button class="link-btn" data-action="sc-paste-off">Upload a file instead</button></div>';
    } else {
      html +=
        '<div class="upload" data-action="sc-pick"><div class="upload-icon">' + I.upload + "</div>" +
        "<b>" + (ui.loadingFile ? "Reading your script…" : "Upload your script") + "</b>" +
        "<small>PDF, Word (.docx) or text · Telugu, Hindi, Tamil and English all work</small>" +
        '<span class="btn primary small" style="margin-top:10px">Choose file</span></div>' +
        '<div class="row" style="margin-top:8px;justify-content:center"><button class="link-btn" data-action="sc-paste-on">or paste the text</button></div>';
    }
    html += "</section>";

    html +=
      '<section class="card"><div class="step"><span class="step-num">2</span>How should we break it down?</div>' +
      '<label class="field-label">Split into</label><div class="chips">' +
      [
        ["auto", "Let Claude decide"],
        ["episode", "Episodes"],
        ["scene", "Scenes"],
        ["shot", "Ad shots"],
      ]
        .map((x) => chip(o.unitKind === x[0], "sc-opt", 'data-k="unitKind" data-v="' + x[0] + '"', x[1]))
        .join("") +
      '</div><div class="help">Series → episodes · films → scenes · ads and music videos → shots</div>' +
      '<label class="field-label">Look</label><div class="chips">' +
      chip(o.lookId === "auto", "sc-opt", 'data-k="lookId" data-v="auto"', "Suggest one") +
      PR()
        .LOOKS.map((l) => chip(o.lookId === l.id, "sc-opt", 'data-k="lookId" data-v="' + l.id + '" title="' + esc(l.goodFor) + '"', esc(l.name)))
        .join("") +
      "</div>" +
      '<label class="field-label">Frame shape</label><div class="chips">' +
      K()
        .RATIOS.map((r) => chip(o.ratio === r.id, "sc-opt", 'data-k="ratio" data-v="' + r.id + '"', K().shape(r) + r.label))
        .join("") +
      "</div>" +
      '<label class="field-label">Shots per episode (at most)</label><div class="stepper"><button data-action="sc-shots" data-d="-2">−</button><span>' + o.maxShots + '</span><button data-action="sc-shots" data-d="2">+</button></div>' +
      '<label class="field-label">Speed</label><div class="chips">' +
      chip(o.mode === "now", "sc-opt", 'data-k="mode" data-v="now"', "Now, one by one") +
      chip(o.mode === "batch", "sc-opt", 'data-k="mode" data-v="batch"', "Batch · half price") +
      '</div><div class="help">' +
      (o.mode === "batch"
        ? "All episodes go to Claude together through its batch service: half the cost, usually done within the hour. You can close the panel; it picks up the results when you come back."
        : "Episodes are prepared one after another and appear as soon as each is ready.") +
      "</div></section>";

    html +=
      '<button class="btn primary big" data-action="sc-analyse"' + (ui.analysing ? " disabled" : "") + ">" +
      (ui.analysing ? '<span class="spinner" style="width:15px;height:15px;margin-right:8px;border-top-color:#fff"></span>Analysing…' : K().I.spark + "Analyse script") +
      '</button><div class="eta">Claude reads the whole script, splits it, then writes the image prompts and video prompts for each part.</div>';
    return html;
  }

  // ---------- project screen ----------

  function unitDot(u) {
    if (u.status === "done") return '<span class="u-dot done"></span>';
    if (u.status === "working" || u.status === "batched") return '<span class="u-dot working"></span>';
    if (u.status === "error") return '<span class="u-dot error"></span>';
    return '<span class="u-dot"></span>';
  }

  function progressCard(p) {
    const { esc } = K();
    const done = p.units.filter((u) => u.status === "done").length;
    const failed = p.units.filter((u) => u.status === "error").length;
    const word = (PR().UNIT_KINDS[p.unitKind] || PR().UNIT_KINDS.episode).plural.toLowerCase();
    let body = "";
    if (p.batch) {
      const c = p.batch.counts || {};
      const finished = (c.succeeded || 0) + (c.errored || 0) + (c.canceled || 0) + (c.expired || 0);
      body =
        '<div class="job-status">Sent ' + p.batch.codes.length + " " + word + " to Claude's batch service (half price). " +
        (finished ? finished + " of " + p.batch.codes.length + " finished. " : "") + "Checked " + K().timeAgo(p.batch.checkedAt) + ".</div>" +
        '<div class="progress"><span></span></div><div class="job-actions"><button class="btn small" data-action="sc-batch-check">Check now</button><button class="btn small ghost" data-action="sc-batch-cancel">Cancel batch</button></div>';
    } else if (p.running) {
      const current = p.units.find((u) => u.status === "working");
      body =
        '<div class="job-status">' + (current ? "Writing prompts for " + esc(current.code) + " · " + esc(current.title) + "…" : "Working…") + " (" + done + " of " + p.units.length + " ready)</div>" +
        '<div class="progress determinate"><i style="width:' + Math.round((done / Math.max(1, p.units.length)) * 100) + '%"></i></div>' +
        '<div class="job-actions"><button class="btn small ghost" data-action="sc-stop">Stop after this one</button></div>';
    } else if (done < p.units.length) {
      body =
        '<div class="job-status">' + done + " of " + p.units.length + " " + word + " ready" + (failed ? " · " + failed + " had a problem" : "") + ".</div>" +
        '<div class="job-actions"><button class="btn small primary" data-action="sc-continue">' + K().I.spark + "Prepare the rest</button>" +
        '<button class="btn small" data-action="sc-continue-batch">Batch · half price</button></div>';
    } else return "";
    return '<section class="card progress-card">' + body + "</section>";
  }

  // ---------- references (image prompts) ----------

  function refBadge(a) {
    const { esc, I } = K();
    const st = a.ref ? a.ref.status : "none";
    if (!a.lockedId) return a.candidates.length ? '<div class="ref-line">Pick the best image and lock it.</div>' : "";
    const face = Studio.references.isFace(a);
    const map = {
      uploading: ['<span class="spinner"></span>', "Uploading to BytePlus…", "busy"],
      processing: ['<span class="spinner"></span>', "BytePlus is checking the face (about a minute)…", "busy"],
      active: [I.lock, face ? "Locked · face approved by BytePlus" : "Locked", "ok"],
      ready: [I.lock, "Locked · " + esc(a.ref.note || "sent with each shot"), face && !Studio.portraits.enabled() ? "warn" : "ok"],
      failed: ["!", "Refused: " + esc(a.ref.error || "no reason given") + " — change the image.", "bad"],
    }[st] || [I.lock, "Locked", "ok"];
    return '<div class="ref-line ' + map[2] + '">' + map[0] + "<span>" + map[1] + "</span></div>";
  }

  function assetCard(a, unit) {
    const { esc, I } = K();
    const kit = K();
    Studio.references.migrate(a);
    const cands = a.candidates.map((id) => PR().libItem(id)).filter(Boolean);
    const sel = ui.sel[a.id] && cands.find((c) => c.id === ui.sel[a.id]) ? ui.sel[a.id] : a.lockedId || (cands[0] && cands[0].id);
    const main = PR().libItem(sel);
    const reused = a.unit && a.unit !== unit.code;
    const task = Studio.queue.statusOf("asset:" + a.id) || Studio.queue.statusOf("lock:" + a.id);
    const job = kit.activeJob((j) => j.source && j.source.asset === a.id);
    const busy = !!job || (task && (task.status === "running" || task.status === "waiting"));
    const open = ui.open["a:" + a.id];
    const locked = !!a.lockedId;
    const uploading = a.ref && (a.ref.status === "uploading" || a.ref.status === "processing");
    let actions = "";
    if (locked) {
      actions = '<button class="btn small" data-action="sc-unlock" data-id="' + a.id + '"' + (uploading ? " disabled" : "") + ">" + I.refresh + "Change</button>";
    } else {
      actions =
        (main ? '<button class="btn small primary" data-action="sc-lock" data-id="' + a.id + '" data-item="' + main.id + '"' + (busy ? " disabled" : "") + ">" + I.lock + "Lock</button>" : "") +
        '<button class="btn small' + (main ? "" : " primary") + '" data-action="sc-make-asset" data-id="' + a.id + '"' + (busy ? " disabled" : "") + ">" + I.image + (cands.length ? "Another" : "Make image") + "</button>" +
        '<button class="btn small ghost" data-action="sc-own" data-id="' + a.id + '" title="Use an image from your computer or the Library">' + I.upload14 + "Mine</button>";
    }
    return (
      '<div class="asset' + (locked ? " locked" : "") + '" id="asset-' + a.id + '"><div class="asset-main">' +
      '<div class="asset-thumb ' + a.kind + '">' + (main ? kit.mediaTag(main) : busy ? '<span class="spinner"></span>' : I[a.kind] || I.image) + (locked && main && main.id === a.lockedId ? '<span class="lock-pin">' + I.lock + "</span>" : "") + "</div>" +
      '<div class="asset-body"><div class="asset-title">' + esc(a.name) + '<span class="asset-id">' + esc(a.id) + "</span>" +
      (reused ? '<span class="tag reuse">From ' + esc(a.unit) + "</span>" : "") + "</div>" +
      '<div class="asset-desc">' + esc(a.description) + "</div>" +
      (a.kind === "character" || a.kind === "costume"
        ? '<div class="face-row"><button class="switch tiny' + (Studio.references.isFace(a) ? " on" : "") + '" data-action="sc-face" data-id="' + a.id + '"' + (locked ? " disabled" : "") + '><span></span></button>' + (a.kind === "character" ? "Human face (registered with BytePlus)" : "Shown worn, with a face") + "</div>"
        : "") +
      "</div></div>" +
      (cands.length > 1 && !locked
        ? '<div class="cands">' + cands.map((c) => '<button class="cand' + (c.id === sel ? " sel" : "") + '" data-action="sc-sel" data-id="' + a.id + '" data-item="' + c.id + '">' + kit.mediaTag(c) + "</button>").join("") + "</div>"
        : "") +
      refBadge(a) +
      (open
        ? '<textarea class="small" data-asset="' + a.id + '">' + esc(a.prompt) + "</textarea>"
        : '<div class="asset-prompt" data-action="sc-toggle" data-id="a:' + a.id + '">' + esc(a.prompt || "No prompt yet — the description and look are used.") + "</div>") +
      (job ? '<div class="shot-status"><span class="spinner"></span>' + esc(kit.phaseText(job)) + "</div>" : task && task.status === "waiting" ? '<div class="shot-status">Waiting in the batch…</div>' : task && task.status === "error" ? '<div class="shot-status error">' + esc(task.error) + "</div>" : "") +
      '<div class="asset-actions">' + actions +
      (main ? '<button class="btn small icon" data-action="ch-open" data-id="' + main.id + '" title="Change this image with Claude">' + I.spark + "</button>" : "") +
      '<span class="spacer"></span><button class="btn small icon ghost" data-action="cc-open" data-assetid="' + a.id + '" title="Ask Claude about ' + esc(a.name) + '">?</button>' +
      '<button class="btn small icon ghost" data-action="sc-toggle" data-id="a:' + a.id + '" title="Edit prompt">' + I.edit + "</button>" +
      '<button class="btn small icon ghost" data-action="sc-copy" data-text="asset:' + a.id + '" title="Copy prompt">' + I.copy + "</button>" +
      '<span class="aspect">' + PR().ASSET_KINDS[a.kind].aspect + "</span></div></div>"
    );
  }

  // ---------- shots (video prompts) ----------

  const STATUS_LABEL = {
    draft: ["Draft", ""],
    ready: ["Prompt ready", "info"],
    generating: ["Generating", "busy"],
    review: ["Needs review", "warn"],
    fixing: ["Claude is fixing the prompt", "busy"],
    approved: ["Approved", "ok"],
    failed: ["Failed", "bad"],
  };

  function highlightHandles(text) {
    return K()
      .esc(text)
      .replace(/@image\d+/g, (m) => '<span class="handle">' + m + "</span>");
  }

  function refChips(s) {
    const p = PR().project;
    const handles = s.handles && s.handles.length ? s.handles : Studio.shots.handlesFor(s);
    return (
      '<div class="asset-chips">' +
      handles
        .map((h) => {
          const st = Studio.references.refState(p.assets[h.assetId]);
          return '<span class="mini-chip ref-' + st + '" title="' + K().esc(st === "ready" ? "Locked" : st === "waiting" ? "Being checked" : st === "failed" ? "Refused" : "Not locked yet") + '">' + h.handle + " " + K().esc((p.assets[h.assetId] || { name: h.assetId }).name) + "</span>";
        })
        .join("") +
      "</div>"
    );
  }

  function takesStrip(s) {
    const kit = K();
    const takes = s.attempts.filter((a) => a.id && PR().libItem(a.id));
    if (!takes.length) return "";
    return (
      '<div class="takes">' +
      takes
        .map((t, i) => {
          const item = PR().libItem(t.id);
          return '<button class="take ' + t.status + (s.videoId === t.id ? " current" : "") + '" data-action="sc-take" data-id="' + s.id + '" data-item="' + t.id + '" title="Take ' + (i + 1) + (t.note ? ": " + kit.esc(t.note) : "") + '">' + kit.mediaTag(item) + "<span>" + (t.status === "approved" ? "✓" : t.status === "rejected" ? "✕" : i + 1) + "</span></button>";
        })
        .join("") +
      "</div>"
    );
  }

  /** Connector shot dropdowns: transition and length. */
  function shotOptions(s) {
    const sel = Studio.panels.select;
    const durations = [];
    for (let d = 4; d <= 15; d++) durations.push({ id: d, label: d + " seconds" });
    return (
      '<div class="picker-row"><div class="picker"><label class="field-label">Transition</label>' +
      sel("sc-shot-set", Studio.uploads.TRANSITIONS.map((t) => ({ id: t, label: t.replace("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) })), s.transition || (s.continues ? "CONTINUATION" : "CUT"), 'data-id="' + s.id + '" data-k="transition"') +
      '</div><div class="picker"><label class="field-label">Length</label>' + sel("sc-shot-set", durations, s.duration, 'data-id="' + s.id + '" data-k="duration"') + "</div></div>"
    );
  }

  /** Reference videos tagged to this shot in Uploads (sent to Seedance as @video1…). */
  function videoRefChips(s) {
    if (!s.videoRefs || !s.videoRefs.length) return "";
    const { esc } = K();
    return '<div class="asset-chips">' + s.videoRefs.map((r, i) => '<span class="mini-chip video-ref" title="' + esc(r.note || "") + '">@video' + (i + 1) + " " + esc(r.label) + "</span>").join("") + "</div>";
  }

  function shotCard(s, i) {
    const { esc, I } = K();
    const kit = K();
    Studio.shots.migrate(s);
    const p = PR().project;
    const refsMode = p.shotMode !== "frame";
    const frame = PR().libItem(s.frameId);
    const video = PR().libItem(s.videoId);
    const job = kit.activeJob((j) => j.source && j.source.shot === s.id);
    const tasks = ["prompt", "frame", "video"].map((k) => Studio.queue.statusOf(k + ":" + s.id)).filter(Boolean);
    const waiting = tasks.some((t) => t.status === "waiting");
    const failed = tasks.find((t) => t.status === "error");
    const busy = !!job || waiting || s.writing || s.status === "fixing" || tasks.some((t) => t.status === "running");
    const open = ui.open["s:" + s.id];
    const label = STATUS_LABEL[s.status] || STATUS_LABEL.draft;
    const blockers = refsMode && s.status !== "approved" ? Studio.shots.blockers(s) : [];
    const spent = s.attempts.filter((a) => a.id || a.status === "failed").length;
    const budget = Studio.shots.budget();
    const PRC = Studio.pricing;
    const est = PRC.videoPrice(refsMode ? "byteplus" : Studio.ui.video.engine, refsMode ? "" : Studio.ui.video.engine === "higgsfield" ? Studio.ui.video.model : "", s.duration, Studio.ui.video.resolution, p.ratio);

    let media;
    if (refsMode) {
      media = '<div class="shot-media single"><div class="frame wide' + (video ? " filled" : "") + '">' + (video ? kit.mediaTag(video) + '<span class="frame-label">Take ' + (s.attempts.findIndex((a) => a.id === s.videoId) + 1) + "</span>" : I.video + "<span>&nbsp;Video</span>") + "</div></div>";
    } else {
      media =
        '<div class="shot-media"><div class="frame' + (frame ? " filled" : "") + '">' + (frame ? kit.mediaTag(frame) + '<span class="frame-label">Frame</span>' : "1 · Frame") + "</div>" +
        '<div class="frame' + (video ? " filled" : "") + '">' + (video ? kit.mediaTag(video) + '<span class="frame-label">Video</span>' : "2 · Video") + "</div></div>";
    }

    let status = "";
    if (job) status = '<div class="shot-status"><span class="spinner"></span>' + esc(kit.phaseText(job)) + "</div>";
    else if (s.writing) status = '<div class="shot-status"><span class="spinner"></span>Claude is writing the final prompt…</div>';
    else if (s.status === "fixing") status = '<div class="shot-status"><span class="spinner"></span>Claude is fixing the prompt from your note…</div>';
    else if (s.waitingFor) status = '<div class="shot-status"><span class="spinner"></span>Waiting: ' + esc(s.waitingFor) + "</div>";
    else if (waiting) status = '<div class="shot-status">Waiting in the batch…</div>';
    else if (failed) status = '<div class="shot-status error">' + esc(failed.error) + "</div>";
    else if (blockers.length && refsMode) status = '<div class="shot-status warn">' + esc(blockers.map((b) => b.text).join(" · ")) + "</div>";

    let prompts;
    if (refsMode) {
      const warn = Studio.shots.promptWarnings(s);
      prompts =
        '<div class="shot-prompts">' +
        (s.finalPrompt
          ? open
            ? '<label class="field-label">Final prompt (Seedance)</label><textarea class="small" data-shot-field="finalPrompt" data-id="' + s.id + '">' + esc(s.finalPrompt) + "</textarea>"
            : '<div class="asset-prompt final" data-action="sc-toggle" data-id="s:' + s.id + '">' + highlightHandles(s.finalPrompt) + "</div>"
          : '<div class="asset-prompt" data-action="sc-toggle" data-id="s:' + s.id + '"><b>Draft:</b> ' + esc(s.videoPrompt) + "</div>") +
        (warn.length ? '<div class="shot-status warn" style="padding:4px 0 0">' + esc(warn.join(" ")) + "</div>" : "") +
        (open
          ? '<label class="field-label">Draft motion</label><textarea class="small" data-shot-field="videoPrompt" data-id="' + s.id + '">' + esc(s.videoPrompt) + "</textarea>" + shotOptions(s)
          : "") +
        "</div>";
    } else {
      prompts = open
        ? '<div class="shot-prompts"><label class="field-label">Frame prompt (picture)</label><textarea class="small" data-shot-field="framePrompt" data-id="' + s.id + '">' + esc(s.framePrompt) + "</textarea>" +
          '<label class="field-label">Video prompt (motion)</label><textarea class="small" data-shot-field="videoPrompt" data-id="' + s.id + '">' + esc(s.videoPrompt) + "</textarea></div>"
        : '<div class="shot-prompts"><div class="asset-prompt" data-action="sc-toggle" data-id="s:' + s.id + '"><b>Motion:</b> ' + esc(s.videoPrompt) + "</div></div>";
    }

    let review = "";
    if (refsMode && s.status === "review" && video) {
      review =
        '<div class="review"><div class="review-title">How is take ' + (s.attempts.findIndex((a) => a.id === s.videoId) + 1) + "?</div>" +
        '<textarea class="small" rows="2" data-note="' + s.id + '" placeholder="If it\'s not right, say what to fix: e.g. “she should look at him, not the camera”, “camera too shaky”">' + esc(ui.notes[s.id] || "") + "</textarea>" +
        '<div class="row" style="margin-top:6px"><button class="btn small primary" data-action="sc-approve" data-id="' + s.id + '">' + I.check + "&nbsp;Approve</button>" +
        '<button class="btn small" data-action="sc-reject" data-id="' + s.id + '">Fix &amp; redo</button></div></div>';
    }

    let buttons;
    if (refsMode) {
      const overBudget = spent >= budget;
      buttons =
        (!s.finalPrompt || open
          ? '<button class="btn small' + (s.finalPrompt ? "" : " primary") + '" data-action="sc-write" data-id="' + s.id + '"' + (busy ? " disabled" : "") + ">" + I.spark + (s.finalPrompt ? "Rewrite" : "Write final prompt") + "</button>"
          : "") +
        (s.status !== "approved"
          ? '<button class="btn small' + (s.finalPrompt && !video ? " primary" : "") + '" data-action="' + (overBudget ? "sc-extra" : "sc-generate") + '" data-id="' + s.id + '"' + (busy || blockers.some((b) => b.type === "lock") ? " disabled" : "") + ">" + I.video + (overBudget ? "One more take" : video ? "New take" : "Generate") + '<span class="btn-cost">' + PRC.money(est.usd) + "</span></button>"
          : "") +
        '<span class="spacer"></span><span class="budget" title="Takes used of the retry budget">' + spent + "/" + budget + "</span>";
    } else {
      buttons =
        '<button class="btn small' + (frame ? "" : " primary") + '" data-action="sc-make-frame" data-id="' + s.id + '"' + (busy ? " disabled" : "") + ">" + I.image + (frame ? "Redo frame" : "Make frame") + "</button>" +
        '<button class="btn small' + (frame && !video ? " primary" : "") + '" data-action="sc-make-video" data-id="' + s.id + '"' + (busy || !frame ? " disabled" : "") + ">" + I.video + (video ? "Redo video" : "Animate") + "</button>" +
        '<span class="spacer"></span>';
    }
    buttons +=
      (video ? '<button class="btn small icon" data-action="ch-open" data-id="' + video.id + '" title="Change this take with Claude">' + I.spark + "</button>" : "") +
      '<button class="btn small icon ghost" data-action="cc-open" data-shotid="' + s.id + '" data-unit="' + s.id.split("_")[0] + '" title="Ask Claude about this shot">?</button>' +
      '<button class="btn small icon ghost" data-action="sc-copy" data-text="shot:' + s.id + '" title="Copy prompts">' + I.copy + "</button>" +
      (frame || video ? '<button class="btn small icon ghost" data-action="sc-import-shot" data-id="' + s.id + '" title="Add to Premiere">' + I.premiere + "</button>" : "");

    return (
      '<div class="shot' + (s.status === "approved" ? " approved" : "") + '" id="shot-' + s.id + '"><div class="shot-head"><div class="shot-num">' + (i + 1) + '</div><div class="shot-title"><b>' + esc(s.title) + "</b><small>" + esc(s.id) + " · " + s.duration + " s" + (s.continues ? " · continues" : "") + "</small></div>" +
      (refsMode ? '<span class="status-tag ' + label[1] + '">' + label[0] + "</span>" : "") +
      '<button class="btn icon ghost" data-action="sc-toggle" data-id="s:' + s.id + '" title="See / edit the prompts">' + (open ? I.chevronUp : I.chevronDown) + "</button></div>" +
      refChips(s) + videoRefChips(s) + media + (refsMode ? takesStrip(s) : "") + status + prompts + review +
      '<div class="shot-actions">' + buttons + "</div></div>"
    );
  }

  // ---------- batch ----------

  function batchCard(p) {
    const { I } = K();
    const b = ui.batch;
    const refsMode = p.shotMode !== "frame";
    const codes = b.scope === "unit" && ui.unit ? [ui.unit] : [];
    const n = PR().countBatch(b, codes, b.redo);
    const total = n.images + n.prompts + n.frames + n.videos + (b.autoLock ? n.locks : 0);
    const head = '<button class="collapser" data-action="sc-batch-open">' + I.layers + '<span style="margin-left:8px">Batch: make everything at once</span><span class="spacer"></span>' + (ui.batchOpen ? I.chevronUp : I.chevronDown) + "</button>";
    if (!ui.batchOpen) return '<section class="card batch-card collapsed">' + head + "</section>";
    const check = (k, label, hint) =>
      '<button class="check' + (b[k] ? " on" : "") + '" data-action="sc-batch-toggle" data-k="' + k + '"><span class="box">' + (b[k] ? I.check : "") + "</span><span><b>" + label + "</b><small>" + hint + "</small></span></button>";
    const parts = [
      n.images && n.images + " images",
      b.autoLock && n.locks && n.locks + " locks",
      n.prompts && n.prompts + " final prompts",
      n.frames && n.frames + " frames",
      n.videos && n.videos + " videos (" + n.seconds + " s)",
    ].filter(Boolean);
    const costText = total ? " — ≈ " + Studio.pricing.money(n.usd) + (n.credits ? " · " + Math.round(n.credits) + " Higgsfield credits" : "") : "";
    return (
      '<section class="card batch-card">' + head +
      '<div class="help" style="margin-bottom:8px">Runs in the background, a few at a time, in the right order. ' +
      (refsMode ? "Images → lock & upload → final prompts → videos. Videos wait until their faces are approved." : "Images → shot frames → videos.") + "</div>" +
      check("images", "Character, costume, location & prop images", "Made from the image prompts") +
      check("autoLock", "Lock & upload them automatically", "Locks each new image as the reference (you can Change it later)") +
      (refsMode
        ? check("prompts", "Final shot prompts", "Claude writes each Seedance prompt with @image handles") + check("videos", "Shot videos", "Seedance, from the locked references (one take each)")
        : check("frames", "Shot frames", "The opening picture of every shot") + check("videos", "Shot videos", "Animates each frame")) +
      '<label class="field-label">Which ' + (PR().UNIT_KINDS[p.unitKind] || PR().UNIT_KINDS.episode).plural.toLowerCase() + '</label><div class="chips">' +
      chip(b.scope === "all", "sc-batch-scope", 'data-v="all"', "All ready") +
      chip(b.scope === "unit", "sc-batch-scope", 'data-v="unit"', "Only " + (ui.unit || "this one")) +
      "</div>" +
      '<div class="switch-row" style="margin-top:10px"><button class="switch' + (b.redo ? " on" : "") + '" data-action="sc-batch-toggle" data-k="redo"><span></span></button>Also redo things already made</div>' +
      '<div class="batch-sum">' + (total ? "<b>" + total + " steps:</b> " + parts.join(" · ") + '<span class="cost-pill">' + I.coin + costText + "</span>" : "Nothing left to make with these choices.") + "</div>" +
      '<button class="btn primary" style="width:100%;margin-top:10px" data-action="sc-batch-start"' + (total ? "" : " disabled") + ">" + I.layers + "Start batch</button></section>"
    );
  }

  // ---------- project ----------

  function bibleCard(p) {
    const { esc, I } = K();
    if (!ui.bibleOpen) return "";
    const b = p.bible || {};
    return (
      '<div class="bible">' +
      '<label class="field-label">Look · ' + esc(p.look.name) + '</label><div class="chips">' +
      PR()
        .LOOKS.map((l) => chip(p.look.id === l.id, "sc-look", 'data-v="' + l.id + '"', esc(l.name)))
        .join("") +
      "</div>" +
      ["camera", "lighting", "performance", "dialogue"]
        .map((k) => '<label class="field-label">' + k + '</label><textarea class="small" data-bible="' + k + '">' + esc(b[k] || "") + "</textarea>")
        .join("") +
      '<div class="help">Used in every prompt Claude writes from now on.</div></div>'
    );
  }

  function projectsSheet() {
    const { esc, I } = K();
    if (!ui.projectsOpen) return "";
    const list = PR().listProjects();
    const current = PR().project && PR().project.id;
    return (
      '<section class="card projects"><div class="row" style="margin-bottom:6px"><b>Your projects</b><span class="spacer"></span><button class="btn small primary" data-action="sc-new">' + I.plus + "New script</button></div>" +
      (list.length
        ? list
            .map(
              (x) =>
                '<div class="proj-row' + (x.id === current ? " current" : "") + '"><button class="proj-open" data-action="sc-open-project" data-id="' + x.id + '"><b>' + esc(x.title || "Untitled") + "</b><small>" + esc(x.type || "") + (x.units ? " · " + x.units + " parts" : "") + " · " + K().timeAgo(x.updatedAt) + "</small></button>" +
                '<button class="btn small icon ghost danger" data-action="sc-delete-project" data-id="' + x.id + '" title="Remove from this list">' + I.trash + "</button></div>"
            )
            .join("")
        : '<div class="help">No projects yet.</div>') +
      "</section>"
    );
  }

  function unitStats(unit) {
    const st = Studio.shots.unitStatus(unit);
    const { esc } = K();
    return (
      '<div class="unit-stats"><span><b>' + st.approved + "</b>/" + st.shots + " approved</span><span><b>" + st.review + "</b> to review</span><span><b>" + st.takes + "</b> takes</span><span><b>" + st.seconds + "</b> s</span>" +
      '<span title="Spent on this episode so far (estimate)">' + K().I.coin + " <b>" + Studio.pricing.money(Studio.pricing.summary((x) => x.unit === unit.code && x.project === PR().projectFolder()).total) + "</b> spent</span></div>" +
      (st.needsYou.length ? '<div class="needs">Needs you: ' + esc(st.needsYou.slice(0, 4).join(" · ")) + (st.needsYou.length > 4 ? " …" : "") + "</div>" : "")
    );
  }

  function renderProject(p) {
    const { esc, I } = K();
    const kit = K();
    if (!ui.unit || !p.units.find((u) => u.code === ui.unit)) ui.unit = (p.units.find((u) => u.status === "done") || p.units[0] || {}).code;
    const kind = PR().UNIT_KINDS[p.unitKind] || PR().UNIT_KINDS.episode;
    const refsMode = p.shotMode !== "frame";
    let html =
      projectsSheet() +
      '<section class="card project-card"><div class="project-head"><div><div class="project-title">' + esc(p.title || p.scriptName) + "</div>" +
      '<div class="project-meta">' + esc(p.type || "") + " · " + p.units.length + " " + kind.plural.toLowerCase() + " · " + esc(p.look ? p.look.name : "") + " · " + esc(p.ratio) + "</div></div>" +
      '<button class="btn small ghost" data-action="sc-projects">Projects</button></div>' +
      (p.logline ? '<div class="logline">' + esc(p.logline) + "</div>" : "") +
      '<div class="row" style="margin-top:8px"><button class="link-btn" data-action="sc-bible">' + (ui.bibleOpen ? "Hide" : "Look & bible") + "</button></div>" +
      bibleCard(p) +
      '<label class="field-label">How shots are made</label><div class="chips">' +
      chip(refsMode, "sc-mode", 'data-v="references"', "From references · Seedance") +
      chip(!refsMode, "sc-mode", 'data-v="frame"', "Picture first, then animate") +
      '</div><div class="help">' +
      (refsMode
        ? "Like the Seedance connector: lock each character, location and prop image, then every shot uses them as @image references. Faces are registered with BytePlus automatically."
        : "Each shot gets an opening picture first, then it's animated. Works with Higgsfield too.") +
      "</div>" +
      kit.engineMini("image") + kit.modelPickers("image") + (refsMode ? (Studio.ui.video.engine === "byteplus" ? kit.modelPickers("video") : "") : kit.engineMini("video") + kit.modelPickers("video")) +
      '<div class="row" style="margin-top:10px"><button class="btn small" data-action="cc-open" data-unit="' + (ui.unit || "") + '">' + I.spark + "Ask Claude for ideas</button></div>" +
      "</section>";

    html += progressCard(p);
    if (p.units.some((u) => u.status === "done")) html += batchCard(p);

    html += '<div class="unit-strip">' + p.units.map((u) => '<button class="unit-chip' + (u.code === ui.unit ? " active" : "") + '" data-action="sc-unit" data-id="' + u.code + '">' + unitDot(u) + esc(u.code) + "</button>").join("") + "</div>";

    const unit = p.units.find((u) => u.code === ui.unit);
    if (!unit) return html;
    html += '<section class="card unit-card"><div class="unit-head"><div><div class="unit-title">' + esc(unit.code) + " · " + esc(unit.title) + '</div><div class="unit-summary">' + esc(unit.summary) + "</div></div></div>";

    if (unit.status !== "done") {
      const msg = { pending: "Not prepared yet.", working: "Claude is writing the image and video prompts…", batched: "Waiting for Claude's batch service…", error: unit.error || "Something went wrong." }[unit.status];
      html +=
        '<div class="job-status' + (unit.status === "error" ? " error" : "") + '" style="margin-top:10px">' + (unit.status === "working" ? '<span class="spinner" style="display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:-2px"></span>' : "") + esc(msg) + "</div>" +
        (unit.status === "pending" || unit.status === "error" ? '<div class="job-actions"><button class="btn small primary" data-action="sc-prepare" data-id="' + unit.code + '">' + I.spark + "Prepare " + esc(unit.code) + "</button></div>" : "") +
        "</section>";
      return html;
    }

    const assets = unit.assetIds.map((id) => p.assets[id]).filter(Boolean);
    const lockedCount = assets.filter((a) => a.lockedId).length;
    html +=
      unitStats(unit) +
      '<div class="seg"><button class="seg-btn' + (ui.pane === "images" ? " active" : "") + '" data-action="sc-pane" data-v="images">' + I.image + "References <span>" + lockedCount + "/" + assets.length + "</span></button>" +
      '<button class="seg-btn' + (ui.pane === "videos" ? " active" : "") + '" data-action="sc-pane" data-v="videos">' + I.video + "Shots <span>" + unit.shots.length + "</span></button></div>" +
      '<div class="row unit-tools">' +
      (ui.pane === "images"
        ? '<button class="btn small" data-action="sc-unit-make" data-id="' + unit.code + '">' + I.layers + "Make all images</button>"
        : refsMode
        ? '<button class="btn small" data-action="sc-unit-prompts" data-id="' + unit.code + '">' + I.spark + "Write all prompts</button><button class=\"btn small\" data-action=\"sc-unit-generate\" data-id=\"" + unit.code + '">' + I.video + "Generate all</button>"
        : '<button class="btn small" data-action="sc-unit-make" data-id="' + unit.code + '">' + I.layers + "Make all frames</button><button class=\"btn small\" data-action=\"sc-unit-animate\" data-id=\"" + unit.code + '">' + I.video + "Animate all</button>") +
      '<span class="spacer"></span><button class="btn small icon ghost" data-action="sc-sheet" data-id="' + unit.code + '" title="Save prompt sheet (.txt)">' + I.download + "</button>" +
      '<button class="btn small icon ghost" data-action="sc-redo-unit" data-id="' + unit.code + '" title="Rewrite this ' + kind.word.toLowerCase() + "'s prompts\">" + I.refresh + "</button></div>" +
      (ui.pane === "videos"
        ? '<div class="row export-row"><button class="btn small primary" data-action="sc-export" data-id="' + unit.code + '">' + I.premiere + "Build in Premiere</button>" +
          '<button class="btn small ghost" data-action="sc-edl" data-id="' + unit.code + '">EDL</button><button class="btn small ghost" data-action="sc-manifest" data-id="' + unit.code + '">Manifest</button></div>'
        : "") +
      "</section>";

    if (ui.pane === "images") {
      if (refsMode && !Studio.portraits.enabled() && assets.some((a) => Studio.references.isFace(a)))
        html += '<div class="banner warn-banner"><div class="banner-text"><b>Add a BytePlus Access Key</b><small>Seedance can block AI faces as “real people”. With an Access Key, locked faces are registered in your private portrait library automatically.</small></div><button class="btn small" data-action="tab" data-tab="settings">Settings</button></div>';
      Object.keys(PR().ASSET_KINDS).forEach((k) => {
        const list = assets.filter((a) => a.kind === k);
        if (!list.length) return;
        html += '<div class="section-title">' + PR().ASSET_KINDS[k].label + " · " + list.filter((a) => a.lockedId).length + "/" + list.length + " locked</div>" + list.map((a) => assetCard(a, unit)).join("");
      });
    } else {
      html += '<div id="shots">' + unit.shots.map(shotCard).join("") + "</div>";
    }
    return html;
  }

  function render() {
    const p = PR().project;
    const html = p && p.status !== "failed" ? renderProject(p) : (p && p.status === "failed" ? '<div class="banner error-banner"><div class="banner-text"><b>That didn\'t work</b><small>' + K().esc(p.progress && p.progress.message) + "</small></div></div>" : "") + renderUpload();
    if (p && p.status === "analysing") {
      document.querySelector("#view").innerHTML =
        '<section class="card analysing"><div class="big-spinner"></div><b>Reading “' + K().esc(p.scriptName) + '”</b><small>Claude is working out what kind of production it is and how it divides. This takes about a minute.</small></section>';
      return;
    }
    const view = document.querySelector("#view");
    const top = view.scrollTop;
    view.innerHTML = html;
    if (view.scrollTop !== top) view.scrollTop = top;
  }

  /** Re-draw just the cards affected by a job, so text being edited elsewhere keeps its cursor. */
  function refreshParts() {
    const p = PR().project;
    if (!p) return;
    const unit = p.units.find((u) => u.code === ui.unit);
    if (!unit || unit.status !== "done") return render();
    const active = document.activeElement;
    if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
      // Only patch cards that aren't being typed in.
      patchCards(unit, active);
      return;
    }
    patchCards(unit, null);
    const bc = document.querySelector(".batch-card");
    if (bc) {
      const tmp = document.createElement("div");
      tmp.innerHTML = batchCard(p);
      bc.parentNode.replaceChild(tmp.firstChild, bc);
    }
  }

  function patchCards(unit, keep) {
    const p = PR().project;
    const swap = (id, html) => {
      const el = document.getElementById(id);
      if (!el || (keep && el.contains(keep))) return;
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      el.parentNode.replaceChild(tmp.firstChild, el);
    };
    if (ui.pane === "images") unit.assetIds.forEach((id) => p.assets[id] && swap("asset-" + id, assetCard(p.assets[id], unit)));
    else unit.shots.forEach((s, i) => swap("shot-" + s.id, shotCard(s, i)));
  }

  function renderOwnSheet() {
    const old = document.getElementById("own-sheet");
    if (old) old.remove();
    if (!ui.ownFor) return;
    const { esc, I } = K();
    const a = PR().project.assets[ui.ownFor];
    const pics = Studio.store.library.filter((x) => x.kind === "image");
    const el = document.createElement("div");
    el.id = "own-sheet";
    el.className = "sheet-backdrop";
    el.innerHTML =
      '<div class="sheet"><div class="sheet-head">Use your own image for ' + esc(a.name) + '<span class="spacer"></span><button class="btn icon ghost" data-action="sc-own-close">' + I.close + "</button></div>" +
      '<button class="btn primary" style="width:100%;margin-bottom:10px" data-action="sc-own-disk">' + I.upload14 + "Choose from my computer</button>" +
      (pics.length ? '<div class="help" style="margin-bottom:6px">Or pick one from your Library:</div><div class="grid">' + pics.map((x) => '<div class="pick"><button data-action="sc-own-lib" data-item="' + x.id + '">' + K().mediaTag(x) + "</button></div>").join("") + "</div>" : "") +
      "</div>";
    document.body.appendChild(el);
  }

  // ---------- actions ----------

  function guard(service) {
    if (Studio.store.has(service)) return true;
    K().needKey(service);
    return false;
  }

  function run(promise, okText) {
    return Promise.resolve(promise).then(
      () => okText && K().toast(okText, "ok"),
      (e) => K().toast(e.message, "error")
    );
  }

  const actions = {
    "sc-pick": async () => {
      ui.loadingFile = true;
      render();
      try {
        await PR().chooseScript();
      } catch (e) {
        K().toast(e.message, "error");
      }
      ui.loadingFile = false;
      render();
    },
    "sc-clear": () => PR().clearPending(),
    "sc-paste-on": () => {
      ui.pasteMode = true;
      render();
    },
    "sc-paste-off": () => {
      ui.pasteMode = false;
      PR().usePastedText("");
      render();
    },
    "sc-opt": (el) => {
      const k = el.getAttribute("data-k");
      ui.options[k] = el.getAttribute("data-v");
      saveOptions();
      render();
    },
    "sc-shots": (el) => {
      ui.options.maxShots = Math.max(2, Math.min(40, ui.options.maxShots + Number(el.getAttribute("data-d"))));
      saveOptions();
      render();
    },
    "sc-analyse": async () => {
      if (!guard("claude")) return;
      if (ui.pasteMode) PR().usePastedText(ui.pasteText);
      if (!PR().pending) return K().toast("Upload your script or paste it first.");
      ui.analysing = true;
      ui.unit = null;
      try {
        await PR().analyse(Object.assign({}, ui.options));
        ui.pasteText = "";
        ui.pasteMode = false;
        const p = PR().project;
        if (p && p.units.every((u) => u.status === "done")) K().toast("All prompts are ready.", "ok");
      } catch (e) {
        K().toast(e.message, "error");
      }
      ui.analysing = false;
      render();
    },
    "sc-new": () => {
      if (Studio.queue.summary().active) return K().toast("Wait for the batch to finish, or cancel it first.", "error");
      PR().reset();
      ui.unit = null;
      ui.projectsOpen = false;
      render();
    },
    "sc-projects": () => {
      ui.projectsOpen = !ui.projectsOpen;
      render();
    },
    "sc-open-project": (el) => {
      if (Studio.queue.summary().active) return K().toast("Wait for the batch to finish, or cancel it first.", "error");
      try {
        PR().openProject(el.getAttribute("data-id"));
      } catch (e) {
        return K().toast(e.message, "error");
      }
      ui.unit = null;
      ui.projectsOpen = false;
      render();
    },
    "sc-delete-project": (el) => {
      PR().deleteProject(el.getAttribute("data-id"));
      K().toast("Removed from your projects. Images and videos stay in your Library.");
      render();
    },
    "sc-bible": () => {
      ui.bibleOpen = !ui.bibleOpen;
      render();
    },
    "sc-look": (el) => {
      const look = PR().LOOKS.find((l) => l.id === el.getAttribute("data-v"));
      const p = PR().project;
      p.look = { id: look.id, name: look.name, bible: look.bible };
      PR().save();
    },
    "sc-shot-set": (el) => {
      const f = PR().findShot(el.getAttribute("data-id"));
      const k = el.getAttribute("data-k");
      if (k === "duration") f.shot.duration = Number(el.value);
      else {
        f.shot.transition = el.value;
        f.shot.continues = el.value === "CONTINUATION";
      }
      PR().save();
    },
    "sc-mode": (el) => {
      PR().setShotMode(el.getAttribute("data-v"));
      if (el.getAttribute("data-v") === "references" && Studio.ui.video.engine !== "byteplus") K().toast("Reference shots are made with Seedance on BytePlus.");
    },
    "sc-sel": (el) => {
      ui.sel[el.getAttribute("data-id")] = el.getAttribute("data-item");
      refreshParts();
    },
    "sc-lock": (el) => {
      const id = el.getAttribute("data-id");
      run(Studio.references.lock(id, el.getAttribute("data-item")), Studio.references.isFace(PR().project.assets[id]) && Studio.portraits.enabled() ? "Locked. Registering the face with BytePlus…" : "Locked");
    },
    "sc-unlock": (el) => {
      Studio.references.unlock(el.getAttribute("data-id"));
      K().toast("Unlocked. Pick another image, make a new one, or use your own — then lock it.");
    },
    "sc-face": (el) => {
      const a = PR().project.assets[el.getAttribute("data-id")];
      Studio.references.setHasFace(a.id, !Studio.references.isFace(a));
    },
    "sc-own": (el) => {
      ui.ownFor = el.getAttribute("data-id");
      renderOwnSheet();
    },
    "sc-own-disk": async () => {
      const id = ui.ownFor;
      ui.ownFor = null;
      renderOwnSheet();
      try {
        const item = await Studio.references.addFromDisk(id);
        if (item) {
          ui.sel[id] = item.id;
          K().toast("Added. Lock it when you're happy.", "ok");
          render();
        }
      } catch (e) {
        K().toast(e.message, "error");
      }
    },
    "sc-own-lib": (el) => {
      const id = ui.ownFor;
      ui.ownFor = null;
      renderOwnSheet();
      Studio.references.addCandidate(id, el.getAttribute("data-item"), false).then(() => {
        ui.sel[id] = el.getAttribute("data-item");
        render();
      });
    },
    "sc-own-close": () => {
      ui.ownFor = null;
      renderOwnSheet();
    },
    "sc-write": (el) => guard("claude") && run(Studio.shots.writePrompt(el.getAttribute("data-id"))),
    "sc-generate": (el) => guard("byteplus") && run(Studio.shots.generate(el.getAttribute("data-id")), "Take ready to review"),
    "sc-extra": (el) =>
      K().toast("This shot has used its " + Studio.shots.budget() + " takes.", "", {
        label: "One more take",
        run: () => run(Studio.shots.generate(el.getAttribute("data-id"), true), "Take ready to review"),
      }),
    "sc-take": (el) => {
      const f = PR().findShot(el.getAttribute("data-id"));
      f.shot.videoId = el.getAttribute("data-item");
      const t = f.shot.attempts.find((a) => a.id === f.shot.videoId);
      if (t && t.status !== "approved" && f.shot.status !== "approved") f.shot.status = "review";
      PR().save();
    },
    "sc-approve": (el) => {
      Studio.shots.approve(el.getAttribute("data-id"));
      K().toast("Approved", "ok");
    },
    "sc-reject": (el) => {
      const id = el.getAttribute("data-id");
      const note = ui.notes[id] || "";
      ui.notes[id] = "";
      if (!note.trim()) return K().toast("Say what to fix first, so Claude can change the prompt.");
      if (!guard("claude")) return;
      run(
        Studio.shots.reject(id, note).then(() => {
          const f = PR().findShot(id);
          if (f.shot.attempts.length < Studio.shots.budget()) return Studio.shots.generate(id);
          K().toast("Prompt fixed. This shot has used its takes; press “One more take” to try again.");
        }),
        ""
      );
    },
    "sc-unit-prompts": (el) => {
      if (!guard("claude")) return;
      const n = PR().queueBatch({ prompts: true }, [el.getAttribute("data-id")], false);
      K().toast(n ? "Writing " + n + " prompts in the background" : "Every shot already has its final prompt.");
    },
    "sc-unit-generate": (el) => {
      if (!guard("byteplus")) return;
      const n = PR().queueBatch({ prompts: true, videos: true }, [el.getAttribute("data-id")], false);
      K().toast(n ? "Added " + n + " to the batch. Shots wait for their references to be locked and approved." : "Nothing left to generate here.");
    },
    "sc-export": (el) => {
      const unit = PR().project.units.find((u) => u.code === el.getAttribute("data-id"));
      run(
        Studio.shots.exportToPremiere(unit).then((r) =>
          K().toast(r.sequence ? "Built a sequence with " + r.count + " shots, in order." : "Added " + r.count + " shots to a bin, in order. Select them and choose New Sequence from Clip.", "ok")
        )
      );
    },
    "sc-edl": async (el) => {
      const unit = PR().project.units.find((u) => u.code === el.getAttribute("data-id"));
      if (await Studio.platform.saveTextAs(unit.code + ".edl", Studio.shots.edl(unit))) K().toast("EDL saved", "ok");
    },
    "sc-manifest": async (el) => {
      const unit = PR().project.units.find((u) => u.code === el.getAttribute("data-id"));
      if (await Studio.platform.saveTextAs(unit.code + "_manifest.json", Studio.shots.manifest(unit))) K().toast("Manifest saved", "ok");
    },
    "sc-unit": (el) => {
      ui.unit = el.getAttribute("data-id");
      render();
    },
    "sc-pane": (el) => {
      ui.pane = el.getAttribute("data-v");
      render();
    },
    "sc-toggle": (el) => {
      const id = el.getAttribute("data-id");
      ui.open[id] = !ui.open[id];
      render();
    },
    "sc-prepare": (el) => guard("claude") && run(PR().breakdownAll([el.getAttribute("data-id")])),
    "sc-redo-unit": (el) => {
      const code = el.getAttribute("data-id");
      if (!guard("claude")) return;
      run(PR().breakdownAll([code]), code + " rewritten");
    },
    "sc-continue": () => guard("claude") && run(PR().breakdownAll()),
    "sc-continue-batch": () => guard("claude") && run(PR().submitBatch(), "Sent to Claude's batch service. Results usually arrive within the hour."),
    "sc-stop": () => {
      PR().stopAnalysis();
      K().toast("Stopping after the current one.");
    },
    "sc-batch-check": () => run(PR().checkBatch()),
    "sc-batch-cancel": () => run(PR().cancelBatch(), "Batch cancelled"),
    "sc-make-asset": (el) => guard(Studio.ui.image.engine) && run(PR().makeAsset(el.getAttribute("data-id"))),
    "sc-make-frame": (el) => guard(Studio.ui.image.engine) && run(PR().makeFrame(el.getAttribute("data-id"))),
    "sc-make-video": (el) => guard(Studio.ui.video.engine) && run(PR().makeVideo(el.getAttribute("data-id"))),
    "sc-unit-make": (el) => {
      const what = ui.pane === "images" ? { images: true, autoLock: false } : { frames: true };
      if (!guard(Studio.ui.image.engine)) return;
      const n = PR().queueBatch(what, [el.getAttribute("data-id")], false);
      K().toast(n ? "Added " + n + " to the batch" : "Everything here is already made.");
    },
    "sc-unit-animate": (el) => {
      if (!guard(Studio.ui.video.engine)) return;
      const n = PR().queueBatch({ frames: true, videos: true }, [el.getAttribute("data-id")], false);
      K().toast(n ? "Added " + n + " to the batch. Missing frames are made first." : "Every shot here is already animated.");
    },
    "sc-batch-open": () => {
      ui.batchOpen = !ui.batchOpen;
      render();
    },
    "sc-batch-toggle": (el) => {
      const k = el.getAttribute("data-k");
      ui.batch[k] = !ui.batch[k];
      render();
    },
    "sc-batch-scope": (el) => {
      ui.batch.scope = el.getAttribute("data-v");
      render();
    },
    "sc-batch-start": () => {
      const b = ui.batch;
      const refsMode = PR().project.shotMode !== "frame";
      if ((b.images || (!refsMode && b.frames)) && !guard(Studio.ui.image.engine)) return;
      if (b.videos && !guard(refsMode ? "byteplus" : Studio.ui.video.engine)) return;
      if (refsMode && b.prompts && !guard("claude")) return;
      const n = PR().queueBatch(b, b.scope === "unit" ? [ui.unit] : [], b.redo);
      ui.batchOpen = false;
      K().toast(n ? "Batch started: " + n + " to make. Keep working — progress is at the bottom." : "Nothing new to add.", n ? "ok" : "");
      render();
    },
    "sc-copy": async (el) => {
      const [type, id] = el.getAttribute("data-text").split(":");
      const p = PR().project;
      let text = "";
      if (type === "asset") text = p.assets[id].prompt || p.assets[id].description;
      else {
        const f = PR().findShot(id);
        text = f.shot.finalPrompt ? f.shot.finalPrompt : "Frame: " + f.shot.framePrompt + "\n\nMotion: " + f.shot.videoPrompt;
      }
      K().toast((await Studio.platform.copyText(text)) ? "Copied" : "Couldn't reach the clipboard");
    },
    "sc-sheet": async (el) => {
      const code = el.getAttribute("data-id");
      const p = PR().project;
      try {
        const ok = await Studio.platform.saveTextAs((p.title || "Project").replace(/[^\w\- ]+/g, "") + " " + code + " prompts.txt", PR().promptSheet(code));
        if (ok) K().toast("Prompt sheet saved", "ok");
      } catch (e) {
        K().toast(e.message, "error");
      }
    },
    "sc-import-shot": (el) => {
      const f = PR().findShot(el.getAttribute("data-id"));
      const item = PR().libItem(f.shot.videoId) || PR().libItem(f.shot.frameId);
      if (item) K().importItem(item.id);
    },
  };

  function onInput(t) {
    if (t.getAttribute("data-bind") === "sc-paste") {
      ui.pasteText = t.value;
      return true;
    }
    const p = PR().project;
    if (!p) return false;
    const assetId = t.getAttribute("data-asset");
    if (assetId && p.assets[assetId]) {
      p.assets[assetId].prompt = t.value;
      debounceSave();
      return true;
    }
    const noteFor = t.getAttribute("data-note");
    if (noteFor) {
      ui.notes[noteFor] = t.value;
      return true;
    }
    const bible = t.getAttribute("data-bible");
    if (bible) {
      PR().setBible(bible, t.value);
      return true;
    }
    const field = t.getAttribute("data-shot-field");
    if (field) {
      const f = PR().findShot(t.getAttribute("data-id"));
      if (f) f.shot[field] = t.value;
      debounceSave();
      return true;
    }
    return false;
  }

  let timer = null;
  function debounceSave() {
    clearTimeout(timer);
    timer = setTimeout(() => Studio.platform.setPref("project", PR().project), 600);
  }

  Studio.scriptView = { ui, render, refreshParts, actions, onInput, assetCard };
})();
