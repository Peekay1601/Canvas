/*
 * Script → production, the same workflow as the Seedance Production connector:
 *   1. Analyse: what kind of production, how it divides (episodes / scenes / ad shots), cast and places.
 *   2. For every unit: image prompts (characters, costumes, locations, props) and video prompts (shots).
 *   3. Make the images, the shot frames and the videos — one by one, or as a batch.
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const P = () => Studio.platform;
  const S = () => Studio.store;

  const LOOKS = [
    { id: "natural_realism", name: "Natural realism", goodFor: "drama, slice-of-life web series, social realism",
      bible: "Photoreal contemporary live action. Real skin texture, pores and pigmentation; no beauty filter. Motivated practical and window light only, readable eyes, soft low-key shadows. Natural colour, gentle film grain. Handheld that breathes with the actors; underplayed acting." },
    { id: "warm_nostalgic", name: "Warm nostalgic film", goodFor: "family drama, romance, period pieces, memories",
      bible: "Photoreal live action with a warm 35mm film feel: soft halation on highlights, amber and olive palette, fine grain, slightly lifted blacks. Golden-hour and tungsten practicals. Calm, composed camera." },
    { id: "gritty_handheld", name: "Gritty handheld thriller", goodFor: "crime, thriller, action, urban stories",
      bible: "Photoreal live action, high contrast, desaturated cool palette with sodium-orange practicals at night. Nervous handheld close to the actors, real grime and sweat, deep shadows with readable faces." },
    { id: "noir_low_key", name: "Noir / low-key", goodFor: "mystery, psychological drama, horror-adjacent",
      bible: "Photoreal live action in low-key light: single hard motivated sources, deep negative fill, silhouettes and slashes of light, restrained palette of black, steel blue and one warm accent. Locked-off or slow creeping camera." },
    { id: "bright_comedy", name: "Bright comedy", goodFor: "sitcom, rom-com, light family entertainment",
      bible: "Photoreal live action, bright even daylight and warm interiors, saturated but natural colours, clean frames with clear geography for comic timing. Mostly steady camera; quick reaction coverage." },
    { id: "epic_cinematic", name: "Epic cinematic", goodFor: "feature films, period epics, big trailers",
      bible: "Photoreal large-format cinema look: wide vistas, strong backlight and rim light, atmospheric haze, rich contrast, controlled teal-and-gold separation without going orange-teal cliché. Deliberate dolly and crane-like moves." },
    { id: "glossy_commercial", name: "Glossy commercial", goodFor: "product ads, brand films, fashion",
      bible: "Photoreal premium commercial look: immaculate surfaces, controlled specular highlights, crisp detail, clean colour matched to the brand palette, smooth precise camera moves, hero product always perfectly lit and readable." },
    { id: "documentary_verite", name: "Documentary vérité", goodFor: "documentary, testimonials, raw social ads",
      bible: "Photoreal observational documentary look: available light only, real locations, imperfect focus pulls and reframes, natural sound, people unaware of the lens. No stylised grading." },
  ];

  const UNIT_KINDS = {
    episode: { prefix: "EP", digits: 2, word: "Episode", plural: "Episodes" },
    scene: { prefix: "SC", digits: 3, word: "Scene", plural: "Scenes" },
    shot: { prefix: "SH", digits: 2, word: "Ad shot", plural: "Ad shots" },
  };

  const ASSET_KINDS = {
    character: { label: "Characters", aspect: "3:4" },
    costume: { label: "Costumes", aspect: "3:4" },
    location: { label: "Locations", aspect: "16:9" },
    prop: { label: "Props", aspect: "1:1" },
  };

  const SCRIPT_TYPES = ["pdf", "docx", "txt", "md", "fountain"];

  const listeners = [];
  const emit = () => listeners.forEach((fn) => fn());

  // Projects: an index plus one saved record each; the open one is `project`.
  function loadIndex() {
    let index = P().getPref("projects", null);
    if (!index) {
      index = [];
      const legacy = P().getPref("project", null);
      if (legacy) {
        P().setPref("project:" + legacy.id, legacy);
        index.push({ id: legacy.id, title: legacy.title || legacy.scriptName, updatedAt: Date.now() });
        P().setPref("activeProject", legacy.id);
      }
      P().setPref("projects", index);
    }
    return index;
  }
  let index = loadIndex();
  let project = (P().getPref("activeProject", null) && P().getPref("project:" + P().getPref("activeProject", null), null)) || null;
  // The script being prepared on the upload screen (not saved until it's analysed).
  let pending = null;
  // In-memory copy of the script source for this session.
  let sourceCache = null;

  function save() {
    if (project) {
      P().setPref("project:" + project.id, project);
      const entry = index.find((x) => x.id === project.id);
      const info = { id: project.id, title: project.title || project.scriptName, type: project.type || "", units: project.units.length, updatedAt: Date.now() };
      if (entry) Object.assign(entry, info);
      else index.unshift(info);
      P().setPref("projects", index);
      P().setPref("activeProject", project.id);
    } else {
      P().setPref("activeProject", null);
    }
    emit();
  }

  function listProjects() {
    return index.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function openProject(id) {
    const p = P().getPref("project:" + id, null);
    if (!p) throw new Error("That project couldn't be found.");
    clearTimeout(batchTimer);
    project = p;
    sourceCache = null;
    pending = null;
    afterOpen();
    save();
  }

  function deleteProject(id) {
    index = index.filter((x) => x.id !== id);
    P().setPref("projects", index);
    P().setPref("project:" + id, null);
    if (project && project.id === id) {
      project = null;
      sourceCache = null;
    }
    save();
  }

  function unitCode(kind, n) {
    const k = UNIT_KINDS[kind] || UNIT_KINDS.episode;
    return k.prefix + String(n).padStart(k.digits, "0");
  }

  function normId(v) {
    return String(v || "")
      .trim()
      .toUpperCase()
      .replace(/[\s\-]+/g, "_")
      .replace(/[^A-Z0-9_]/g, "");
  }

  // ---------- loading a script ----------

  /** Read an uploaded file into a source Claude can take: PDFs go as documents, the rest as text. */
  async function readScriptFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "pdf") return { kind: "pdf", name: file.name, base64: P().toBase64(file.buffer), bytes: file.buffer.byteLength };
    let text;
    if (ext === "docx") text = Studio.docx.docxText(file.buffer);
    else text = Studio.docx.utf8(new Uint8Array(file.buffer));
    text = text.replace(/^﻿/, "");
    if (text.replace(/\s/g, "").length < 100) throw new Error("Almost no text could be read from " + file.name + ". Try saving it as PDF or .docx.");
    return { kind: "text", name: file.name, text, bytes: file.buffer.byteLength };
  }

  async function chooseScript() {
    const file = await P().pickFile(SCRIPT_TYPES);
    if (!file) return null;
    pending = await readScriptFile(file);
    pending.buffer = file.buffer;
    emit();
    return pending;
  }

  function usePastedText(text) {
    pending = text && text.trim() ? { kind: "text", name: "Pasted script", text, bytes: text.length, buffer: null } : null;
  }

  function clearPending() {
    pending = null;
    emit();
  }

  async function keepSource(src) {
    const fileName = "script-" + Date.now().toString(36) + (src.kind === "pdf" ? ".pdf" : ".txt");
    const buffer = src.buffer || new TextEncoder().encode(src.text).buffer;
    await P().keepFile(fileName, src.kind === "pdf" ? src.buffer : buffer);
    return fileName;
  }

  async function source() {
    if (sourceCache) return sourceCache;
    if (!project || !project.scriptFile) throw new Error("The script isn't available any more. Upload it again with New script.");
    const buffer = await P().loadKeptFile(project.scriptFile);
    if (!buffer) throw new Error("The script isn't available any more. Upload it again with New script.");
    sourceCache =
      project.scriptKind === "pdf"
        ? { kind: "pdf", name: project.scriptName, base64: P().toBase64(buffer) }
        : { kind: "text", name: project.scriptName, text: Studio.docx.utf8(new Uint8Array(buffer)) };
    return sourceCache;
  }

  // ---------- step 1: analyse ----------

  /**
   * options: { unitKind: "auto"|"episode"|"scene"|"shot", lookId: "auto"|id, ratio, maxShots, mode: "now"|"batch" }
   */
  async function analyse(options) {
    if (!pending) throw new Error("Upload a script or paste one first.");
    const src = pending;
    const status = { phase: "reading", message: "Reading the script…" };
    project = {
      id: "p" + Date.now().toString(36),
      status: "analysing",
      progress: status,
      scriptName: src.name,
      scriptKind: src.kind,
      ratio: options.ratio,
      maxShots: options.maxShots,
      mode: options.mode,
      units: [],
      assets: {},
      createdAt: Date.now(),
    };
    sourceCache = { kind: src.kind, name: src.name, base64: src.base64, text: src.text };
    save();
    try {
      project.scriptFile = await keepSource(src);
      const result = await Studio.claude.analyseScript({ source: sourceCache, unitKind: options.unitKind, looks: LOOKS });
      const look = LOOKS.find((l) => l.id === (options.lookId !== "auto" ? options.lookId : result.suggestedLook)) || LOOKS[0];
      Object.assign(project, {
        title: result.title,
        type: result.type,
        unitKind: UNIT_KINDS[result.unitKind] ? result.unitKind : "episode",
        why: result.why,
        logline: result.logline,
        look: { id: look.id, name: look.name, bible: look.bible },
        bible: result.bible || {},
        shotMode: "references",
      });
      project.units = (result.units || []).map((u, i) => ({
        number: u.number || i + 1,
        code: unitCode(project.unitKind, u.number || i + 1),
        title: u.title,
        summary: u.summary,
        status: "pending",
        assetIds: [],
        shots: [],
      }));
      (result.characters || []).forEach((c) => addAsset({ kind: "character", id: c.id, name: c.name, description: c.description }));
      (result.locations || []).forEach((c) => addAsset({ kind: "location", id: c.id, name: c.name, description: c.description }));
      pending = null;
      project.status = "ready";
      project.progress = null;
      save();
    } catch (e) {
      project.status = "failed";
      project.progress = { phase: "error", message: e.message };
      save();
      throw e;
    }
    if (options.mode === "batch") return submitBatch();
    return breakdownAll();
  }

  function addAsset(a, unitCodeStr) {
    const id = normId(a.id);
    if (!id) return null;
    const existing = project.assets[id];
    if (existing) {
      if (!existing.prompt && a.prompt) {
        existing.prompt = a.prompt;
        existing.unit = existing.unit || unitCodeStr;
      }
      if (!existing.description && a.description) existing.description = a.description;
      if (a.hasFace !== undefined && !existing.lockedId) existing.hasFace = !!a.hasFace;
      if (a.characterId && !existing.characterId) existing.characterId = normId(a.characterId);
      return existing;
    }
    const kind = ASSET_KINDS[a.kind] ? a.kind : "prop";
    project.assets[id] = {
      id,
      kind,
      name: a.name || id,
      description: a.description || "",
      prompt: a.prompt || "",
      unit: a.prompt ? unitCodeStr : "",
      hasFace: a.hasFace !== undefined ? !!a.hasFace : kind === "character",
      characterId: normId(a.characterId || ""),
      imageId: null,
      candidates: [],
      lockedId: null,
      ref: { status: "none" },
    };
    return project.assets[id];
  }

  function knownAssets() {
    return Object.values(project.assets).map((a) => ({ kind: a.kind, id: a.id, name: a.name, description: a.description, done: !!a.lockedId || !!a.prompt }));
  }

  function applyBreakdown(unit, result) {
    unit.summary = result.summary || unit.summary;
    unit.assetIds = [];
    (result.assets || []).forEach((a) => {
      const asset = addAsset(a, unit.code);
      if (asset && unit.assetIds.indexOf(asset.id) < 0) unit.assetIds.push(asset.id);
    });
    unit.shots = (result.shots || []).map((s, i) => ({
      id: unit.code + "_S" + String(i + 1).padStart(3, "0"),
      title: s.title,
      duration: Math.max(4, Math.min(15, Number(s.duration) || 5)),
      assetIds: (s.assetIds || []).map(normId).filter((id) => project.assets[id]),
      framePrompt: s.framePrompt,
      videoPrompt: s.videoPrompt,
      continues: !!s.continues,
      frameId: null,
      videoId: null,
      status: "draft",
      attempts: [],
      finalPrompt: "",
      handles: [],
    }));
    unit.status = "done";
    unit.error = "";
  }

  // ---------- step 2: image + video prompts per unit ----------

  async function breakdownUnit(code) {
    const unit = project.units.find((u) => u.code === code);
    if (!unit) return;
    unit.status = "working";
    unit.error = "";
    save();
    try {
      const result = await Studio.claude.breakdownUnit({
        source: await source(),
        project,
        unit,
        knownAssets: knownAssets(),
        maxShots: project.maxShots || 12,
      });
      applyBreakdown(unit, result);
    } catch (e) {
      unit.status = "error";
      unit.error = e.message;
    }
    save();
  }

  let stopRequested = false;

  /** One unit after another, so each one reuses the cast and places found before it. */
  async function breakdownAll(codes) {
    stopRequested = false;
    const list = codes || project.units.filter((u) => u.status !== "done").map((u) => u.code);
    project.running = true;
    save();
    for (const code of list) {
      if (stopRequested) break;
      await breakdownUnit(code);
    }
    project.running = false;
    save();
  }

  function stopAnalysis() {
    stopRequested = true;
  }

  // ---------- step 2, batch mode (Claude Message Batches: half price) ----------

  async function submitBatch(codes) {
    const units = codes ? project.units.filter((u) => codes.indexOf(u.code) >= 0) : project.units.filter((u) => u.status !== "done");
    if (!units.length) return;
    const src = await source();
    const known = knownAssets();
    const requests = units.map((unit) => ({
      id: unit.code,
      args: Studio.claude.breakdownArgs({ source: src, project, unit, knownAssets: known, maxShots: project.maxShots || 12 }),
    }));
    const batch = await Studio.claude.createBatch(requests);
    units.forEach((u) => {
      u.status = "batched";
      u.error = "";
    });
    project.batch = { id: batch.id, status: batch.status, submittedAt: Date.now(), checkedAt: Date.now(), codes: units.map((u) => u.code) };
    save();
    scheduleBatchCheck();
  }

  let batchTimer = null;

  function scheduleBatchCheck() {
    clearTimeout(batchTimer);
    if (!project || !project.batch) return;
    batchTimer = setTimeout(() => checkBatch().catch(() => scheduleBatchCheck()), 30000);
  }

  async function checkBatch() {
    if (!project || !project.batch) return;
    const b = await Studio.claude.getBatch(project.batch.id);
    project.batch.status = b.status;
    project.batch.counts = b.counts;
    project.batch.checkedAt = Date.now();
    if (b.status === "ended") {
      const results = await Studio.claude.batchResults(b.resultsUrl);
      // Apply in story order so assets keep their first appearance.
      project.units.forEach((unit) => {
        const r = results[unit.code];
        if (!r) return;
        if (r.ok) applyBreakdown(unit, r.value);
        else {
          unit.status = "error";
          unit.error = r.error;
        }
      });
      project.units.forEach((u) => u.status === "batched" && ((u.status = "error"), (u.error = "No result came back from the batch.")));
      project.batch = null;
      save();
      return;
    }
    save();
    scheduleBatchCheck();
  }

  async function cancelBatch() {
    if (!project || !project.batch) return;
    try {
      await Studio.claude.cancelBatch(project.batch.id);
    } catch (e) {
      /* already ended */
    }
    project.units.forEach((u) => u.status === "batched" && (u.status = "pending"));
    project.batch = null;
    save();
  }

  // ---------- step 3: making things ----------

  function libItem(id) {
    return id ? S().library.find((x) => x.id === id) : null;
  }

  function findShot(id) {
    for (const u of project.units) {
      const s = u.shots.find((x) => x.id === id);
      if (s) return { unit: u, shot: s };
    }
    return null;
  }

  // Folder names used on disk and as Premiere bins: <project>/<episode>/<type>/
  const FOLDERS = { character: "Characters", costume: "Costumes", location: "Locations", prop: "Props" };

  function projectFolder() {
    return (project.title || project.scriptName || "Project").replace(/[\\/]+/g, "-");
  }

  /** Where an asset's files live: the episode it first appears in (or Shared), then its type. */
  function assetFolder(a) {
    return projectFolder() + "/" + (a.unit || "Shared") + "/" + FOLDERS[a.kind];
  }

  function unitOfShot(shotId) {
    return shotId.split("_")[0];
  }

  function shotSource(shotId, extra) {
    return Object.assign({ shot: shotId, folder: projectFolder() + "/" + unitOfShot(shotId) + "/Shots", project: projectFolder(), unit: unitOfShot(shotId) }, extra || {});
  }

  function engines() {
    const ui = Studio.ui;
    return { image: ui.image.engine, imageModel: ui.image.engine === "higgsfield" ? ui.image.model : "", video: ui.video, videoEngine: ui.video.engine };
  }

  function assetPrompt(a) {
    return a.prompt || a.name + ": " + a.description + ". " + project.look.bible;
  }

  /** Make a new candidate image for an asset. autoLock: lock it straight away if nothing is locked yet. */
  function makeAsset(id, autoLock) {
    const a = project.assets[id];
    if (!a) return Promise.resolve();
    const e = engines();
    return Studio.jobs
      .createImage({ prompt: assetPrompt(a), engine: e.image, ratio: ASSET_KINDS[a.kind].aspect, model: e.imageModel, source: { asset: id, folder: assetFolder(a), name: a.id + "_" + ((a.candidates || []).length + 1), project: projectFolder(), unit: a.unit || "Shared" } })
      .then((item) => Studio.references.addCandidate(id, item.id, autoLock).then(() => item));
  }

  /** The shot's opening frame. On Seedream, the shot's character/location images go along as references. */
  function makeFrame(shotId) {
    const found = findShot(shotId);
    if (!found) return Promise.resolve();
    const { shot } = found;
    const e = engines();
    const refs = shot.assetIds.map((id) => project.assets[id] && libItem(project.assets[id].lockedId || project.assets[id].imageId)).filter(Boolean);
    return Studio.jobs
      .createImage({ prompt: shot.framePrompt, engine: e.image, ratio: project.ratio, model: e.imageModel, references: e.image === "byteplus" ? refs : [], source: shotSource(shotId, { name: shotId + "_frame" }) })
      .then((item) => {
        shot.frameId = item.id;
        save();
        return item;
      });
  }

  function videoDuration(engine, d) {
    if (engine === "higgsfield") return d > 7 ? 10 : 5;
    return Math.max(4, Math.min(15, d));
  }

  function makeVideo(shotId) {
    const found = findShot(shotId);
    if (!found) return Promise.resolve();
    const { shot } = found;
    const frame = libItem(shot.frameId);
    if (!frame) return Promise.reject(new Error(shot.id + " needs its frame first."));
    const e = engines();
    return Studio.jobs
      .createVideo({
        prompt: shot.videoPrompt,
        engine: e.videoEngine,
        ratio: project.ratio,
        duration: videoDuration(e.videoEngine, shot.duration),
        resolution: e.video.resolution,
        audio: e.video.audio,
        model: e.videoEngine === "higgsfield" ? e.video.model : "",
        startImage: frame,
        source: shotSource(shotId, { video: true, name: shotId + "_video" }),
      })
      .then((item) => {
        S().updateLibrary(item.id, { poster: frame.src });
        shot.videoId = item.id;
        save();
        return item;
      });
  }

  /**
   * Batch processing: queue everything chosen across the chosen units.
   * what: { images, autoLock, prompts, videos, frames }  codes: unit codes (empty = all)  redo: remake existing results.
   * Reference route (project.shotMode "references"): images → lock (auto-upload) → final prompts → Seedance videos.
   * Frame route: images → shot frames (using the images as references) → videos animated from the frames.
   */
  function queueBatch(what, codes, redo) {
    const units = project.units.filter((u) => u.status === "done" && (!codes || !codes.length || codes.indexOf(u.code) >= 0));
    const refsMode = project.shotMode !== "frame";
    const tasks = [];
    const has = (id) => !!libItem(id);
    const seen = {};
    units.forEach((u) => {
      if (what.images) {
        u.assetIds.forEach((id) => {
          const a = project.assets[id];
          if (!a || seen[id]) return;
          seen[id] = 1;
          Studio.references.migrate(a);
          if (redo || !a.candidates.some(has)) tasks.push({ key: "asset:" + id, label: a.name + " (" + a.kind + ")", kind: "image", run: () => makeAsset(id, what.autoLock) });
          else if (what.autoLock && !a.lockedId) tasks.push({ key: "lock:" + id, label: "Lock " + a.name, kind: "image", run: () => Studio.references.lock(id, a.candidates.find(has)) });
        });
      }
      u.shots.forEach((s) => {
        Studio.shots.migrate(s);
        const assetDeps = s.assetIds.map((id) => "asset:" + id).concat(s.assetIds.map((id) => "lock:" + id));
        if (refsMode) {
          if (what.prompts && (redo || !s.finalPrompt)) tasks.push({ key: "prompt:" + s.id, label: s.id + " prompt", kind: "text", run: () => Studio.shots.writePrompt(s.id) });
          if (what.videos && (redo || (s.status !== "approved" && !has(s.videoId)))) {
            tasks.push({ key: "video:" + s.id, label: s.id + " video", kind: "video", deps: assetDeps.concat(["prompt:" + s.id]), run: () => Studio.shots.generate(s.id) });
          }
          return;
        }
        if (what.frames && (redo || !has(s.frameId))) tasks.push({ key: "frame:" + s.id, label: s.id + " frame", kind: "image", deps: assetDeps, run: () => makeFrame(s.id) });
        if (what.videos && (redo || !has(s.videoId))) {
          tasks.push({
            key: "video:" + s.id,
            label: s.id + " video",
            kind: "video",
            deps: ["frame:" + s.id],
            run: () => {
              if (!has(s.frameId)) {
                const err = new Error("Skipped: no frame for " + s.id);
                err.skipped = !what.frames;
                throw err;
              }
              return makeVideo(s.id);
            },
          });
        }
      });
    });
    return Studio.queue.add(tasks);
  }

  /** How many things a batch would make (for the summary line). */
  function countBatch(what, codes, redo) {
    const units = project.units.filter((u) => u.status === "done" && (!codes || !codes.length || codes.indexOf(u.code) >= 0));
    const refsMode = project.shotMode !== "frame";
    const has = (id) => !!libItem(id);
    const seen = {};
    const n = { images: 0, locks: 0, prompts: 0, frames: 0, videos: 0, seconds: 0, usd: 0, credits: 0 };
    const ui = Studio.ui;
    const PRC = Studio.pricing;
    const img = PRC.imagePrice(ui.image.engine, ui.image.engine === "higgsfield" ? ui.image.model : "");
    const vidEngine = refsMode ? "byteplus" : ui.video.engine;
    const addVideo = (s) => {
      const v = PRC.videoPrice(vidEngine, vidEngine === "higgsfield" ? ui.video.model : "", s.duration, ui.video.resolution, project.ratio);
      n.usd += v.usd;
      n.credits += v.credits || 0;
    };
    units.forEach((u) => {
      if (what.images)
        u.assetIds.forEach((id) => {
          const a = project.assets[id];
          if (!a || seen[id]) return;
          seen[id] = 1;
          Studio.references.migrate(a);
          if (redo || !a.candidates.some(has)) {
            n.images++;
            n.usd += img.usd;
            n.credits += img.credits || 0;
          }
          if (what.autoLock && !a.lockedId) n.locks++;
        });
      u.shots.forEach((s) => {
        Studio.shots.migrate(s);
        if (refsMode) {
          if (what.prompts && (redo || !s.finalPrompt)) {
            n.prompts++;
            n.usd += 0.02; // a final prompt from Claude, roughly
          }
          if (what.videos && (redo || (s.status !== "approved" && !has(s.videoId)))) {
            n.videos++;
            n.seconds += s.duration;
            addVideo(s);
          }
          return;
        }
        if (what.frames && (redo || !has(s.frameId))) {
          n.frames++;
          n.usd += img.usd;
          n.credits += img.credits || 0;
        }
        if (what.videos && (redo || !has(s.videoId))) {
          n.videos++;
          n.seconds += s.duration;
          addVideo(s);
        }
      });
    });
    return n;
  }

  // ---------- prompt sheet ----------

  function promptSheet(code) {
    const units = code ? project.units.filter((u) => u.code === code) : project.units.filter((u) => u.status === "done");
    const rule = "─".repeat(72);
    const lines = [(project.title || "Project") + " — PROMPT SHEET", (project.type || "") + "   |   Look: " + project.look.name + "   |   Frame: " + project.ratio, ""];
    units.forEach((u) => {
      lines.push(rule, u.code + " — " + u.title, u.summary, "", "IMAGE PROMPTS", "");
      u.assetIds.forEach((id, i) => {
        const a = project.assets[id];
        if (!a) return;
        lines.push(i + 1 + ". " + a.kind.toUpperCase() + "  " + a.id + "  (" + a.name + ")", "Aspect: " + ASSET_KINDS[a.kind].aspect);
        lines.push(a.unit && a.unit !== u.code ? "Reused from " + a.unit + "." : assetPrompt(a), "");
      });
      lines.push("VIDEO PROMPTS", "");
      u.shots.forEach((s) => {
        lines.push(s.id + "  " + s.title + "  (" + s.duration + " s)" + (s.assetIds.length ? "   uses: " + s.assetIds.join(", ") : ""));
        lines.push("Frame:  " + s.framePrompt, "Motion: " + s.videoPrompt);
        if (s.finalPrompt) lines.push("Final (Seedance): " + s.finalPrompt + (s.handles && s.handles.length ? "\nReferences: " + s.handles.map((h) => h.handle + " = " + h.assetId).join(", ") : ""));
        lines.push("");
      });
    });
    return lines.join("\n");
  }

  /** Close the open project (it stays in the project list) to start a new one. */
  function reset() {
    stopRequested = true;
    clearTimeout(batchTimer);
    project = null;
    sourceCache = null;
    pending = null;
    save();
  }

  function setShotMode(mode) {
    project.shotMode = mode;
    save();
  }

  function setBible(key, value) {
    project.bible = project.bible || {};
    project.bible[key] = value;
    P().setPref("project:" + project.id, project);
  }

  /** Pick up where things were when the panel was closed. */
  function afterOpen() {
    if (!project) return;
    if (project.batch) setTimeout(() => checkBatch().catch(() => scheduleBatchCheck()), 1500);
    project.running = false;
    project.units.forEach((u) => {
      if (u.status === "working") u.status = "pending";
      u.shots.forEach((s) => {
        Studio.shots.migrate(s);
        if (s.status === "generating" || s.status === "fixing") s.status = s.finalPrompt ? "ready" : "draft";
        s.writing = false;
      });
    });
    Object.values(project.assets).forEach((a) => Studio.references.migrate(a));
    setTimeout(() => Studio.references.resume(), 0);
  }
  setTimeout(afterOpen, 0);

  Studio.production = {
    LOOKS,
    UNIT_KINDS,
    ASSET_KINDS,
    SCRIPT_TYPES,
    get project() {
      return project;
    },
    set project(p) {
      project = p;
      save();
    },
    get pending() {
      return pending;
    },
    onChange: (fn) => listeners.push(fn),
    save,
    chooseScript,
    usePastedText,
    clearPending,
    analyse,
    breakdownUnit,
    breakdownAll,
    stopAnalysis,
    submitBatch,
    checkBatch,
    cancelBatch,
    makeAsset,
    makeFrame,
    makeVideo,
    queueBatch,
    countBatch,
    promptSheet,
    findShot,
    reset,
    listProjects,
    openProject,
    deleteProject,
    setShotMode,
    setBible,
    libItem,
    FOLDERS,
    projectFolder,
    assetFolder,
    shotSource,
    readScriptFile,
  };
})();
