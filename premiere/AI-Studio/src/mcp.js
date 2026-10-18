/*
 * The Seedance Production connector, inside Premiere.
 *
 * Every tool the connector gives Claude (same names, same arguments, same checks), its four workflow
 * prompts, its production options and its skills, running on the panel's own projects instead of a
 * Python server and a folder on disk. The MCP tab can run any tool by hand, or let Claude drive them
 * (src/views/mcp.js); the rest of the panel sees the same project, so the Script, Assets and Shots views
 * update as the tools work.
 *
 * Differences from the desktop connector, because a UXP panel can't run Python or read any path:
 *   - "files" are the panel's Library and the script you load (Script tab, or Load script here)
 *   - the background worker is the panel's batch queue (it runs while Premiere is open)
 *   - export_unit also builds the Premiere bin + sequence, and saves the EDL / manifest where you choose
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const PR = () => Studio.production;
  const SH = () => Studio.shots;
  const REF = () => Studio.references;
  const S = () => Studio.store;
  const P = () => Studio.platform;

  class ToolError extends Error {}
  const fail = (msg) => {
    throw new ToolError(msg);
  };

  // ---------- the connector's options (seedance/project.py) ----------

  const PROJECT_TYPES = {
    "web series": "episode", "tv series": "episode", "mini series": "episode",
    "feature film": "scene", "short film": "scene", "documentary": "scene",
    "advertisement": "shot", "music video": "shot", "promo / trailer": "shot", "social media video": "shot",
  };
  const RESOLUTIONS = {
    "480p": "Cheapest and fastest. Use for tests and blocking checks.",
    "720p": "Good balance for review and most web delivery.",
    "1080p": "Final delivery quality. Costs the most per second.",
  };
  const RATIOS = {
    "16:9": "Widescreen: YouTube, OTT, TV, most series and films.",
    "21:9": "Cinemascope: feature-film look with letterbox feel.",
    "9:16": "Vertical: Reels, Shorts, Stories, vertical ads.",
    "1:1": "Square: feed posts and some ads.",
    "4:3": "Classic TV / nostalgic boxy frame.",
    "3:4": "Tall portrait: some feed ads and posters in motion.",
  };
  const KINDS = { characters: "character", costumes: "costume", locations: "location", props: "prop" };
  const PLURAL = { character: "characters", costume: "costumes", location: "locations", prop: "props" };
  const TRANSITIONS = ["CUT", "CONTINUATION", "NEW_SCENE", "INSERT", "ESTABLISHING"];
  const SHOT_FIELDS = ["seq", "duration", "transition", "characters", "costumes", "props", "location", "time_of_day", "shot_size", "camera", "action", "dialogue", "performance", "intent", "blocking", "notes", "ratio", "resolution", "generate_audio", "max_attempts", "status"];
  const REF_FIELDS = ["characters", "costumes", "props", "location", "transition", "seq"];

  // Connector settings (manifest user_config) and where each lives in the panel.
  const CONNECTOR_SETTINGS = [
    { id: "ark_api_key", title: "BytePlus API key", where: "Settings → BytePlus ModelArk → API key", secret: "ark" },
    { id: "seedance_model", title: "Seedance model ID", where: "Settings → Advanced → Seedance model", setting: "seedanceModel" },
    { id: "projects_folder", title: "Projects folder", where: "The panel keeps projects itself (Script tab → Projects); files go to its data folder and Premiere bins" },
    { id: "byteplus_access_key", title: "BytePlus Access Key ID", where: "Settings → Character faces → Access Key ID", secret: "byteplusAk" },
    { id: "byteplus_secret_key", title: "BytePlus Secret Access Key", where: "Settings → Character faces → Secret Access Key", secret: "byteplusSk" },
    { id: "tos_bucket", title: "Storage bucket (advanced)", where: "Settings → Advanced → TOS bucket", setting: "tosBucket" },
    { id: "ark_project", title: "ModelArk project (advanced)", where: "Settings → Advanced → ModelArk project", setting: "arkProject" },
    { id: "api_base_url", title: "API address (advanced)", where: "Settings → Advanced → ModelArk address", setting: "arkBaseUrl" },
  ];

  function looks() {
    return PR().LOOKS.map((l) => ({ id: l.id, name: l.name, good_for: l.goodFor, bible: l.bible }));
  }

  function findLook(id) {
    const want = String(id || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    return PR().LOOKS.find((l) => l.id === want || l.name.toLowerCase() === want);
  }

  // ---------- helpers ----------

  function need() {
    const p = PR().project;
    if (!p) fail("No project is open. Use open_project(name, create=true), or load a script in the Script tab.");
    p.units = p.units || [];
    p.assets = p.assets || {};
    p.bible = p.bible || {};
    return p;
  }

  const normId = (v) =>
    String(v || "")
      .trim()
      .toUpperCase()
      .replace(/[\s\-]+/g, "_")
      .replace(/[^A-Z0-9_]/g, "");

  const lib = (id) => (id ? S().library.find((x) => x.id === id) : null);

  function unitKind(p) {
    return PR().UNIT_KINDS[p.unitKind] ? p.unitKind : "episode";
  }

  function unitCode(p, n) {
    const k = PR().UNIT_KINDS[unitKind(p)];
    return k.prefix + String(n).padStart(k.digits, "0");
  }

  function parseUnit(ref) {
    if (ref == null || ref === "") fail("Say which unit: a number or a code like EP01 / SC012 / SH03.");
    if (typeof ref === "number") return ref;
    const m = /(\d+)\s*$/.exec(String(ref).trim());
    if (!m) fail("Couldn't read a unit number from '" + ref + "'.");
    return Number(m[1]);
  }

  function findUnit(ref, create) {
    const p = need();
    const code = String(ref).trim().toUpperCase().replace(/\s+/g, "");
    let u = p.units.find((x) => x.code === code);
    if (u) return u;
    const n = parseUnit(ref);
    u = p.units.find((x) => x.number === n);
    if (u) return u;
    if (!create) fail("No unit " + ref + ". list_units shows them; set_units creates them.");
    u = { number: n, code: unitCode(p, n), title: "", summary: "", status: "pending", assetIds: [], shots: [] };
    p.units.push(u);
    p.units.sort((a, b) => a.number - b.number);
    return u;
  }

  function findShot(id) {
    need();
    const found = PR().findShot(String(id || "").trim().toUpperCase());
    if (!found) fail("No shot " + id + ". list_shots(unit) shows them.");
    SH().migrate(found.shot);
    return found;
  }

  function assetRow(a) {
    if (!a) return null;
    REF().migrate(a);
    const locked = lib(a.lockedId);
    return {
      kind: PLURAL[a.kind],
      id: a.id,
      name: a.name,
      description: a.description,
      unit: a.unit || null,
      prompt: a.prompt || null,
      character_id: a.characterId || null,
      has_face: REF().isFace(a),
      acting_profile: a.actingProfile || null,
      voice_prompt: a.voicePrompt || null,
      aspect: a.aspect || PR().ASSET_KINDS[a.kind].aspect,
      notes: a.notes || null,
      status: REF().refState(a) === "ready" ? "ready" : a.lockedId ? REF().refState(a) : a.candidates.some(lib) ? "has_images_not_locked" : "needed",
      locked_image: locked ? locked.path || locked.fileName || locked.id : null,
      candidates: a.candidates.filter(lib).length,
      portrait: a.ref && a.ref.assetId ? { asset_id: a.ref.assetId, status: a.ref.status, error: a.ref.error || null } : a.ref ? { status: a.ref.status, error: a.ref.error || null } : null,
    };
  }

  function getAssetOrFail(kind, id) {
    const p = need();
    const a = p.assets[normId(id)];
    if (!a || (kind && KINDS[kind] && a.kind !== KINDS[kind])) fail("No " + (KINDS[kind] || "asset") + " " + id + ".");
    return a;
  }

  /** Create or update an asset; only the fields given change (like the connector's upsert). */
  function upsertAsset(kind, f) {
    const p = need();
    const singular = KINDS[kind] || kind;
    if (!PR().ASSET_KINDS[singular]) fail("kind must be one of characters, costumes, locations, props.");
    const id = normId(f.id);
    if (!id) fail("id is required (CAPITALS_WITH_UNDERSCORES, e.g. ANU, ANU_HOME_01).");
    let a = p.assets[id];
    if (a && a.kind !== singular) fail(id + " is already a " + a.kind + ".");
    if (!a) {
      a = p.assets[id] = { id, kind: singular, name: id, description: "", prompt: "", unit: "", hasFace: singular === "character", characterId: "", imageId: null, candidates: [], lockedId: null, ref: { status: "none" } };
    }
    REF().migrate(a);
    if (f.name != null) a.name = f.name;
    if (f.description != null) a.description = f.description;
    if (f.prompt != null) a.prompt = f.prompt;
    if (f.character_id != null) a.characterId = normId(f.character_id);
    if (f.acting_profile != null) a.actingProfile = f.acting_profile;
    if (f.voice_prompt != null) a.voicePrompt = f.voice_prompt;
    if (f.aspect != null) a.aspect = f.aspect;
    if (f.notes != null) a.notes = f.notes;
    if (f.unit != null) {
      const u = findUnit(f.unit, true);
      a.unit = u.code;
      if (u.assetIds.indexOf(id) < 0) u.assetIds.push(id);
    }
    if (f.has_face != null && !!f.has_face !== REF().isFace(a)) REF().setHasFace(id, !!f.has_face);
    if (Array.isArray(f.reference_images)) {
      const ids = f.reference_images.map((r) => (lib(r) ? r : (S().library.find((x) => x.fileName === r || x.path === r) || {}).id)).filter(Boolean);
      ids.reverse().forEach((itemId) => REF().addCandidate(id, itemId, false));
    }
    PR().save();
    return a;
  }

  // ---------- scripts ----------

  const NUMBER_WORDS = {};
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty"
    .split(" ")
    .forEach((w, i) => (NUMBER_WORDS[w] = i));
  Object.keys(NUMBER_WORDS)
    .slice(1, 10)
    .forEach((w) => ["-", " "].forEach((sep) => (NUMBER_WORDS["twenty" + sep + w] = 20 + NUMBER_WORDS[w])));
  NUMBER_WORDS.thirty = 30;
  const NUM =
    "(\\d{1,3}|" +
    Object.keys(NUMBER_WORDS)
      .sort((a, b) => b.length - a.length)
      .map((w) => w.replace(" ", "[ \\t]"))
      .join("|") +
    ")";
  const HEADINGS = {
    episode: "^[ \\t#*_\\[(]*(?:episode|epi\\.?|ep\\.?|ఎపిసోడ్|எபிசோட்|एपिसोड)[ \\t]*[-–—:#.]?[ \\t]*" + NUM + "(?![\\w])",
    scene: "^[ \\t#*_\\[(]*(?:scene|sc\\.?|సీన్|సన్నివేశం|காட்சி|दृश्य)[ \\t]*[-–—:#.]?[ \\t]*" + NUM + "(?![\\w])",
    shot: "^[ \\t#*_\\[(]*(?:shot|sh\\.?|frame|షాట్)[ \\t]*[-–—:#.]?[ \\t]*" + NUM + "(?![\\w])",
  };
  const SLUGLINE = /^[ \t]*(?:\d+[A-Z]?[ \t.]+)?(?:INT\.?\/EXT|EXT\.?\/INT|I\/E|INT|EXT)[ \t.]/gim;

  /** Unit headings in order (same rules as the connector's find_units). */
  function findUnits(text, kind) {
    const hits = [];
    const re = new RegExp(HEADINGS[kind], "gim");
    let m;
    while ((m = re.exec(text))) {
      const raw = m[1].toLowerCase().replace(/[ \t]+/g, " ");
      const number = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
      const end = text.indexOf("\n", m.index);
      if (number) hits.push({ start: m.index, number, heading: text.slice(m.index, end < 0 ? undefined : end).trim().slice(0, 80) });
    }
    const minLen = kind === "episode" ? 300 : 40;
    let real = hits.filter((h, i) => (i + 1 < hits.length ? hits[i + 1].start : text.length) - h.start >= minLen);
    if (kind === "scene" && real.length < 2) {
      real = [];
      let i = 0;
      SLUGLINE.lastIndex = 0;
      while ((m = SLUGLINE.exec(text))) {
        const end = text.indexOf("\n", m.index);
        real.push({ start: m.index, number: ++i, heading: text.slice(m.index, end < 0 ? undefined : end).trim().slice(0, 80) });
      }
    }
    let found = [];
    real.forEach((h, i) => {
      if (i && real[i - 1].number === h.number) return;
      found = found.filter((f) => f.number !== h.number).concat([h]);
    });
    found.sort((a, b) => a.start - b.start);
    found.forEach((f, i) => (f.end = i + 1 < found.length ? found[i + 1].start : text.length));
    return found;
  }

  async function scriptSource() {
    const p = need();
    if (!p.scriptFile) fail("No script yet. Load one with “Load script” on the MCP tab (or upload it in the Script tab).");
    const buffer = await P().loadKeptFile(p.scriptFile);
    if (!buffer) fail("The script file isn't available any more. Load it again.");
    if (p.scriptKind === "pdf") return { kind: "pdf", name: p.scriptName, base64: P().toBase64(buffer) };
    return { kind: "text", name: p.scriptName, text: Studio.docx.utf8(new Uint8Array(buffer)) };
  }

  /** Load a script file (PDF, Word, text) into the open project, creating a project if none is open. */
  async function loadScript() {
    const file = await P().pickFile(PR().SCRIPT_TYPES);
    if (!file) return null;
    const src = await PR().readScriptFile(file);
    if (!PR().project) newProject(file.name.replace(/\.[^.]+$/, ""));
    const p = need();
    const fileName = "script-" + Date.now().toString(36) + (src.kind === "pdf" ? ".pdf" : ".txt");
    await P().keepFile(fileName, src.kind === "pdf" ? file.buffer : new TextEncoder().encode(src.text).buffer);
    Object.assign(p, { scriptFile: fileName, scriptKind: src.kind, scriptName: src.name });
    PR().save();
    return { file: src.name, kind: src.kind, characters: src.text ? src.text.length : null };
  }

  function newProject(name) {
    const look = PR().LOOKS[0];
    PR().project = {
      id: "p" + Date.now().toString(36),
      status: "ready",
      title: name,
      type: "",
      unitKind: "episode",
      scriptName: "",
      ratio: "16:9",
      maxShots: 12,
      mode: "now",
      units: [],
      assets: {},
      bible: {},
      look: { id: look.id, name: look.name, bible: look.bible },
      shotMode: "references",
      createdAt: Date.now(),
    };
    return PR().project;
  }

  // ---------- shots ----------

  function shotAssetIds(p, s) {
    const ids = []
      .concat(s.characters || [])
      .concat(Object.values(s.costumes || {}))
      .concat(s.location ? [s.location] : [])
      .concat(s.props || [])
      .map(normId)
      .filter(Boolean);
    return ids.filter((id, i) => ids.indexOf(id) === i);
  }

  function shotRow(s) {
    const takes = s.attempts.filter((a) => a.id).length;
    return {
      id: s.id,
      seq: s.seq || Number(s.id.slice(-3)),
      duration: s.duration,
      transition: s.transition || (s.continues ? "CONTINUATION" : "CUT"),
      characters: s.characters || s.assetIds.filter((id) => (need().assets[id] || {}).kind === "character"),
      location: s.location || null,
      action: s.action || s.title || "",
      status: s.status,
      has_prompt: !!s.finalPrompt,
      attempts: takes,
      max_attempts: s.max_attempts || SH().budget(),
    };
  }

  function previousShot(unit, shot) {
    const i = unit.shots.indexOf(shot);
    return i > 0 ? unit.shots[i - 1] : null;
  }

  function continuationProblem(unit, shot) {
    if ((shot.transition || (shot.continues ? "CONTINUATION" : "")) !== "CONTINUATION") return null;
    const prev = previousShot(unit, shot);
    if (!prev) return "A CONTINUATION shot needs a shot before it.";
    if (prev.status !== "approved") return "CONTINUATION: approve " + prev.id + " first; this shot starts where it ends.";
    return null;
  }

  const LEAK = [/\bsame as before\b/i, /\bas above\b/i, /\bprevious(ly)? shot\b/i, /\bfrom last shot\b/i, /\bEP\d{1,2}\b/i, /\bscene \d+\b/i];

  /** The connector's prompt checks: errors block saving, warnings are CINEDANCE rules worth a look. */
  function lintPrompt(unit, shot, handles, prompt) {
    const p = need();
    const errors = [];
    const warnings = [];
    if (!String(prompt || "").trim()) errors.push("Prompt is empty.");
    const cont = continuationProblem(unit, shot);
    if (cont) errors.push(cont);
    const words = String(prompt).split(/\s+/).length;
    if (words > 1500) warnings.push("Prompt is " + words + " words. CINEDANCE: the best prompt is not the longest one.");
    const known = handles.map((h) => h.handle);
    const used = (String(prompt).match(/@(image|video)\d+/gi) || []).map((x) => x.toLowerCase()).filter((v, i, a) => a.indexOf(v) === i);
    const bad = used.filter((u) => known.indexOf(u) < 0);
    if (bad.length) errors.push("Handles " + bad.join(", ") + " have no attached reference (this shot has " + (known.join(", ") || "none") + ").");
    const unused = known.filter((k) => used.indexOf(k) < 0);
    if (unused.length) warnings.push("Attached but never mentioned: " + unused.join(", ") + ". Mention them or drop the reference.");
    if (/NEGATIVE CONSTRAINTS/i.test(prompt)) warnings.push("Has a NEGATIVE CONSTRAINTS block; CINEDANCE prefers local positive locks.");
    if (/\bno blur\b/i.test(prompt) && /action/i.test(shot.intent || "")) warnings.push('"no blur" in an action shot causes strobing; use the 180-degree shutter cadence block.');
    LEAK.forEach((re) => {
      const m = re.exec(prompt);
      if (m) warnings.push('Context leakage: "' + m[0] + '". The prompt must be a sealed current-shot document.');
    });
    if (shot.dialogue) {
      shot.assetIds.forEach((id) => {
        const c = p.assets[id];
        if (!c || c.kind !== "character" || !c.voicePrompt) return;
        const speaks = new RegExp("\\b(" + id + "|" + (c.name || id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")\\b", "i").test(shot.dialogue);
        if (speaks && prompt.indexOf(c.voicePrompt.trim()) < 0) warnings.push(id + " speaks but their voice_prompt is not pasted verbatim.");
      });
    }
    return { errors, warnings };
  }

  // Generations started by generate_shot / generate_video, so check_* can report on them.
  const running = {};

  function startShot(shotId, extra) {
    const { shot } = findShot(shotId);
    const budget = shot.max_attempts || SH().budget();
    const spent = shot.attempts.filter((a) => a.id).length;
    if (spent >= budget && !extra) fail(shotId + " has used its retry budget (" + spent + "/" + budget + "). Review it, or pass extra_attempt=true to spend one more take.");
    if (!shot.finalPrompt) fail(shotId + " has no prompt yet: prepare_shot_prompt, then set_shot_prompt.");
    if (running[shotId] && running[shotId].status === "working") return { shot_id: shotId, status: "already generating" };
    const job = (running[shotId] = { status: "working", startedAt: Date.now() });
    SH()
      .generate(shotId, true)
      .then(
        (item) => Object.assign(job, { status: "done", item: item && item.id }),
        (e) => Object.assign(job, { status: "failed", error: e.message })
      );
    return { shot_id: shotId, status: "submitted", attempt: spent + 1, of: budget, note: "Generating on Seedance. Poll with check_shot." };
  }

  // ---------- brief ----------

  function bibleOf(p) {
    return Object.assign({ look: p.look ? p.look.bible : "" }, p.bible || {});
  }

  function buildBrief(unit, shot) {
    const p = need();
    const handles = shot.handles && shot.handles.length && shot.finalPrompt ? shot.handles : SH().handlesFor(shot);
    const assets = shot.assetIds.map((id) => p.assets[id]).filter(Boolean);
    const prev = previousShot(unit, shot);
    const attempts = shot.attempts.map((a, i) => ({ attempt: i + 1, status: a.status, prompt: a.prompt, error: a.error || null, review: a.note || null }));
    const lang = p.promptLanguage || "English";
    return {
      shot: Object.assign({}, shotRow(shot), {
        intent: shot.intent || null,
        shot_size: shot.shot_size || null,
        camera: shot.camera || null,
        blocking: shot.blocking || null,
        dialogue: shot.dialogue || null,
        performance: shot.performance || null,
        time_of_day: shot.time_of_day || null,
        notes: shot.notes || null,
        frame_prompt: shot.framePrompt || null,
        motion_prompt: shot.videoPrompt || null,
      }),
      blocking_problem: continuationProblem(unit, shot),
      current_prompt: shot.finalPrompt || null,
      active_references: handles.map((h) => ({ handle: h.handle, is: h.name + (h.kind ? " (" + h.kind + ")" : ""), asset_id: h.assetId || null, description: h.description || "", ready: h.assetId ? REF().refState(p.assets[h.assetId]) : "ready" })),
      characters: assets
        .filter((a) => a.kind === "character")
        .map((c) => {
          const costumeId = (shot.costumes || {})[c.id] || (assets.find((x) => x.kind === "costume" && x.characterId === c.id) || {}).id;
          return { id: c.id, name: c.name, description: c.description, acting_profile: c.actingProfile || null, voice_prompt: c.voicePrompt || null, costume: costumeId ? assetRow(p.assets[costumeId]) : null };
        }),
      location: (assets.find((a) => a.kind === "location") && assetRow(assets.find((a) => a.kind === "location"))) || null,
      props: assets.filter((a) => a.kind === "prop").map(assetRow),
      previous_shot: prev ? { id: prev.id, transition: prev.transition || null, action: prev.action || prev.title, blocking: prev.blocking || null, status: prev.status, prompt: prev.finalPrompt || null } : null,
      series_bible: bibleOf(p),
      earlier_attempts: attempts,
      instructions:
        "Write the final Seedance prompt in " + lang + " following get_skill('cinedance') and write each character's performance with get_skill('acting'): adapt their acting_profile to this exact moment, and paste voice_prompt verbatim for any character who speaks. Use ONLY the handles in active_references, each exactly as given. Duration, ratio and resolution are API settings; leave them out of the prompt text. " +
        ((shot.transition || "") === "CONTINUATION" ? "This shot continues straight on from previous_shot: describe the exact end state of previous_shot (positions, pose, props, light) as this shot's first frame. " : "") +
        (attempts.length ? "This is a retry: keep what worked in current_prompt and patch only the sections that earlier_attempts' reviews flag. " : "") +
        "Then save it with set_shot_prompt.",
    };
  }

  // ---------- status ----------

  function problems(p) {
    const out = [];
    if (!S().has("claude")) out.push("No Claude key: add it in Settings (Claude writes every prompt).");
    if (!S().has("byteplus")) out.push("No BytePlus API key: add it in Settings → BytePlus ModelArk (Seedance and Seedream).");
    if (!p) return out.concat(["No project open. open_project(name, create=true) or load a script."]);
    if (!p.type) out.push("Project type not set yet. Use the start_project workflow (or set_project).");
    if (!p.units.length) out.push(p.scriptFile ? "Script loaded (" + p.scriptName + "); split it into units with split_script or set_units." : "No script yet. Load it on the MCP tab or the Script tab.");
    const chars = Object.values(p.assets).filter((a) => REF().isFace(REF().migrate(a)));
    if (chars.length && !Studio.portraits.enabled())
      out.push("Character faces can't be sent to Seedance as plain images (BytePlus blocks photoreal faces). Add a BytePlus Access Key in Settings → Character faces so they're registered in the private portrait library automatically.");
    const refused = chars.filter((a) => a.ref && a.ref.status === "failed");
    if (refused.length) out.push("BytePlus refused " + refused.length + " portrait(s); see portrait_status.");
    const needed = Object.values(p.assets).filter((a) => !a.lockedId).length;
    if (needed) out.push(needed + " assets are waiting for a locked image (write_image_prompts, then make or add images and sync_assets).");
    return out;
  }

  function portraitStatus() {
    const p = need();
    const faces = Object.values(p.assets).filter((a) => REF().isFace(REF().migrate(a)));
    const by = (st) => faces.filter((a) => a.ref && a.ref.status === st);
    const used = Object.values(p.portraits || {}).filter((x) => x.status === "active" || x.status === "processing").length + (p.retiredPortraits || []).length;
    return {
      enabled: Studio.portraits.enabled(),
      active: by("active").map((a) => a.id),
      processing: by("processing").map((a) => a.id),
      waiting: faces.filter((a) => a.lockedId && (!a.ref || a.ref.status === "none" || a.ref.status === "uploading")).map((a) => a.id),
      not_locked: faces.filter((a) => !a.lockedId).map((a) => a.id),
      failed: by("failed").map((a) => ({ id: a.id, reason: a.ref.error || "" })),
      sent_as_plain_image: by("ready").map((a) => a.id),
      used,
      limit: Studio.portraits.cfg().limit,
      unused_portraits: REF().unusedPortraits().length,
    };
  }

  function unitStatus(u) {
    const st = SH().unitStatus(u);
    const byStatus = {};
    u.shots.forEach((s) => (byStatus[s.status] = (byStatus[s.status] || 0) + 1));
    return Object.assign({ unit: u.code, title: u.title, by_status: byStatus, generations: st.takes, seconds: st.seconds, approved_seconds: st.approvedSeconds, needs_you: st.needsYou }, {
      shots_needing_a_prompt: u.shots.filter((s) => !s.finalPrompt).map((s) => s.id),
    });
  }

  // ---------- the tools ----------

  const T = (name, description, properties, required, run, opts) => Object.assign({ name, description, input_schema: { type: "object", properties: properties || {}, required: required || [] }, run }, opts || {});
  const str = (d) => ({ type: "string", description: d });
  const int = (d) => ({ type: "integer", description: d });
  const bool = (d) => ({ type: "boolean", description: d });
  const unitP = { description: "A number, or a code like EP01 / SC012 / SH03.", anyOf: [{ type: "integer" }, { type: "string" }] };
  const kindP = { type: "string", enum: ["characters", "locations", "costumes", "props"] };
  const imagesP = { type: "array", items: { type: "string" }, description: "Library item ids (first = identity master); usually filled by sync_assets / add_asset_image." };

  const shotSchema = {
    type: "object",
    properties: {
      seq: int("Order within the unit, starting at 1. Becomes the S number in EP01_S001."),
      duration: { type: "integer", minimum: 2, maximum: 30, description: "Seconds. One generation (Seedance takes 4-15)." },
      transition: { type: "string", enum: TRANSITIONS, description: "CONTINUATION starts from the previous approved shot's end state." },
      characters: { type: "array", items: { type: "string" }, description: "Character IDs in frame, e.g. ['ANU']." },
      costumes: { type: "object", additionalProperties: { type: "string" }, description: "Character ID -> costume ID." },
      props: { type: "array", items: { type: "string" } },
      location: { type: "string" },
      time_of_day: { type: "string" },
      intent: str("The shot's one dominant job, e.g. 'performance / dialogue coverage'."),
      shot_size: { type: "string" },
      camera: { type: "string" },
      blocking: str("Approved positions, eyelines, distances, camera side."),
      action: { type: "string" },
      dialogue: str("Exact lines, prefixed by speaker ID: 'ANU: ...'."),
      performance: str("Objective, beats and micro-beats for this moment."),
      notes: { type: "string" },
      ratio: str("Leave empty to use the project's aspect ratio."),
      resolution: str("Leave empty to use the project's resolution."),
      generate_audio: { type: "boolean" },
      max_attempts: int("Retry budget. Past this the shot waits for human review."),
    },
    required: ["seq", "duration"],
  };

  const imagePromptSchema = {
    type: "object",
    properties: {
      kind: kindP,
      id: str("CAPITALS_WITH_UNDERSCORES, e.g. ANU, ANU_HOME_01, APARTMENT_LIVING_ROOM."),
      prompt: str("The image prompt (Lira skill). Leave empty for an asset that's already finalised and is only reused here."),
      name: { type: "string" },
      description: str("One or two lines Claude uses later in video prompts."),
      character_id: str("Costumes only: who wears it."),
      aspect: str("Image aspect ratio. Defaults: characters/costumes 3:4, locations 16:9, props 1:1."),
      notes: str("Tips for the person generating it (model to use, what to check)."),
      redo: bool("Ask for a new image even though one is already finalised."),
      has_face: bool("Characters: false for animals and creatures. Costumes: true if the image shows the character wearing it. Prefer garment-only costume images."),
    },
    required: ["kind", "id"],
  };

  const TOOLS = [
    // basics
    T("production_status", "Start here. What the active project is, how it's divided, its settings, and what still needs doing.", {}, [], () => {
      const p = PR().project;
      const counts = {};
      if (p) Object.keys(KINDS).forEach((k) => (counts[k] = Object.values(p.assets || {}).filter((a) => a.kind === KINDS[k]).length));
      return {
        online: true,
        model: S().settings.seedanceModel,
        keys: { claude: S().has("claude"), byteplus: S().has("byteplus"), higgsfield: S().has("higgsfield"), portraits: Studio.portraits.enabled() },
        project: p ? p.title || p.scriptName : null,
        settings: p ? { title: p.title, type: p.type, unit_kind: unitKind(p), ratio: p.ratio, resolution: p.resolution || Studio.ui.video.resolution, look: p.look && p.look.name, prompt_language: p.promptLanguage || "English", notes: p.notes || null } : null,
        units: p ? p.units.map((u) => ({ code: u.code, title: u.title, has_script: !!u.script, shots: u.shots.length, assets_needed: u.assetIds.filter((id) => p.assets[id] && !p.assets[id].lockedId).length })) : [],
        full_script: p && p.scriptName ? p.scriptName : null,
        skills: Object.keys(Studio.SKILLS),
        counts: p ? Object.assign(counts, { shots: p.units.reduce((n, u) => n + u.shots.length, 0), generations: p.units.reduce((n, u) => n + u.shots.reduce((m, s) => m + (s.attempts || []).filter((a) => a.id).length, 0), 0) }) : null,
        portraits: p && Object.keys(p.assets).length ? (({ enabled, active, used, limit }) => ({ enabled, active: active.length, used, limit }))(portraitStatus()) : null,
        queue: Studio.queue.summary(),
        problems: problems(p),
      };
    }),
    T("get_skill", "Load one of the prompt-writing skills. Call with no file for the main instructions and the list of reference files; call again with file=... to read a reference (optics, blocking, micro-beats, ...).", { name: { type: "string", enum: ["cinedance", "shotlist", "acting", "lira"] }, file: str("A reference file listed by the main instructions.") }, ["name"], ({ name, file }) => {
      const main = Studio.SKILLS[name];
      if (!main) fail("Unknown skill " + name + ". Available: " + Object.keys(Studio.SKILLS).join(", "));
      const files = (Studio.SKILL_INFO[name] || {}).files || [];
      if (!file) return main + (files.length ? "\n\n---\nReference files in this skill (read with get_skill(name, file)):\n" + files.join("\n") : "");
      const key = files.find((f) => f === file || f.endsWith("/" + file) || f.split("/").pop().toLowerCase() === String(file).split("/").pop().toLowerCase());
      if (!key) fail(file + " is not part of " + name + ". Files: " + (files.join(", ") || "none"));
      return Studio.SKILL_FILES[name][key];
    }),
    T("production_options", "The choices to offer the user: project types and how each is divided, resolutions, aspect ratios and look presets (each with the bible text it sets). Show these as options and let the user pick.", {}, [], () => ({
      project_types: PROJECT_TYPES,
      unit_kinds: { episode: "EP01 ... (episodes)", scene: "SC001 ... (scenes)", shot: "SH01 ... (ad shots)" },
      resolutions: RESOLUTIONS,
      aspect_ratios: RATIOS,
      looks: looks(),
      custom_look: "Or describe your own look in a few lines; it becomes the 'look' section of the bible.",
      shot_transitions: TRANSITIONS,
      models: {
        claude: Object.keys(Studio.pricing.CLAUDE),
        picture: Studio.pricing.IMAGE_MODELS,
        video: Studio.pricing.VIDEO_MODELS,
        picture_resolutions: Studio.pricing.IMAGE_RES.map((r) => r.id),
        video_resolutions: Studio.pricing.VIDEO_RES.map((r) => r.id),
      },
      reference_video_tags: Studio.uploads.VIDEO_TAGS.filter((t) => t.id).map((t) => ({ id: t.id, label: t.label, hint: t.hint })),
      shot_image_roles: Studio.uploads.SHOT_ROLES,
      note: "Resolutions and ratios are what Seedance 2.x is known to take; check your ModelArk console if one is refused.",
    })),
    // projects + settings
    T("list_projects", "All projects (series, films, ads...), and which one is active.", {}, [], () => {
      const active = PR().project && PR().project.id;
      return PR().listProjects().map((x) => ({ name: x.title, id: x.id, type: x.type || null, units: x.units || 0, active: x.id === active }));
    }),
    T("open_project", "Switch to another project (create=True makes a new one). Everything else then works on that project.", { name: str("Project name (or id)."), create: bool("Make a new project with this name.") }, ["name"], ({ name, create }) => {
      const hit = PR().listProjects().find((x) => x.id === name || String(x.title || "").toLowerCase() === String(name).toLowerCase());
      if (hit && !create) {
        PR().openProject(hit.id);
        return { opened: hit.title, id: hit.id };
      }
      if (!create) fail("No project called " + name + ". list_projects shows them; pass create=true to make it.");
      const p = newProject(name);
      return { created: p.title, id: p.id, next: "Load the script (MCP tab → Load script), then read_full_script." };
    }),
    T("set_project", "Save the project's settings. type: e.g. 'web series', 'feature film', 'short film', 'advertisement', 'music video' (sets unit_kind automatically: series -> episode, film/short -> scene, ad -> shot). resolution / ratio: from production_options; every new shot uses them unless it says otherwise. look: a preset id from production_options, or your own description (saved as the bible's 'look').", { title: { type: "string" }, type: { type: "string" }, unit_kind: { type: "string", enum: ["episode", "scene", "shot"] }, resolution: { type: "string", enum: Object.keys(RESOLUTIONS) }, ratio: { type: "string", enum: Object.keys(RATIOS) }, look: { type: "string" }, prompt_language: { type: "string" }, notes: { type: "string" } }, [], (f) => {
      const p = need();
      let kind = f.unit_kind;
      if (f.type != null) {
        p.type = f.type;
        if (!kind && PROJECT_TYPES[String(f.type).toLowerCase()]) kind = PROJECT_TYPES[String(f.type).toLowerCase()];
      }
      if (kind && kind !== unitKind(p)) {
        if (p.units.some((u) => u.shots.length)) fail("This project already has shots planned as " + unitKind(p) + "s; start a new project instead.");
        p.unitKind = kind;
        p.units.forEach((u) => (u.code = unitCode(p, u.number)));
      }
      if (f.resolution != null) {
        if (!RESOLUTIONS[f.resolution]) fail("resolution must be one of " + Object.keys(RESOLUTIONS).join(", "));
        p.resolution = f.resolution;
        Studio.ui.video.resolution = f.resolution;
      }
      if (f.ratio != null) {
        if (!RATIOS[f.ratio]) fail("ratio must be one of " + Object.keys(RATIOS).join(", "));
        p.ratio = f.ratio;
      }
      if (f.look != null) {
        const preset = findLook(f.look);
        p.look = preset ? { id: preset.id, name: preset.name, bible: preset.bible } : { id: "custom", name: "Custom", bible: f.look };
      }
      if (f.title != null) p.title = f.title;
      if (f.prompt_language != null) p.promptLanguage = f.prompt_language;
      if (f.notes != null) p.notes = f.notes;
      PR().save();
      return { title: p.title, type: p.type, unit_kind: unitKind(p), ratio: p.ratio, resolution: p.resolution || Studio.ui.video.resolution, look: p.look.name, prompt_language: p.promptLanguage || "English", notes: p.notes || null };
    }),
    T("set_bible_section", "Save a section of the project bible (e.g. look, style, camera, lighting, performance, dialogue). The bible is included in every prompt brief.", { section: { type: "string" }, text: { type: "string" } }, ["section", "text"], ({ section, text }) => {
      const p = need();
      if (String(section).toLowerCase() === "look") p.look = Object.assign({}, p.look, { bible: text });
      else PR().setBible(section, text);
      PR().save();
      return "Saved bible section '" + section + "'.";
    }),
    T("get_bible", "Read the whole project bible.", {}, [], () => bibleOf(need())),
    // scripts + units
    T("read_full_script", "Read the whole script in pieces, to judge what kind of production it is, and to split it by hand when split_script can't find the headings. PDFs are attached for you to read directly.", { start: int("Character to start at."), length: int("How many characters (default 40000).") }, [], async ({ start, length }) => {
      const src = await scriptSource();
      if (src.kind === "pdf") return { file: src.name, kind: "pdf", note: "The PDF is attached below this result; read it there. split_script can't read PDFs, so save each unit with save_unit_script.", __document: src.base64 };
      const a = Number(start) || 0;
      const n = Number(length) || 40000;
      return { file: src.name, total_characters: src.text.length, start: a, text: src.text.slice(a, a + n), more: a + n < src.text.length };
    }),
    T("split_script", "Split the full script into units, using the project's unit kind (set it with set_project first): episodes ('EPISODE 1', 'Episode One', 'EP 01'), scenes ('SCENE 12', or every INT./EXT. slugline) or shots ('SHOT 3', 'FRAME 3'). Always preview first (write=false), show the user, then write=true. Existing unit scripts are kept unless overwrite=true. Ads usually need save_unit_script instead.", { write: bool("Save the units (after the user has seen the preview)."), overwrite: bool("Replace unit scripts that already exist.") }, [], async ({ write, overwrite }) => {
      const p = need();
      const src = await scriptSource();
      const k = unitKind(p);
      if (src.kind === "pdf") return { file: src.name, unit_kind: k, units_found: 0, note: "PDF scripts can't be split by headings here. Read it with read_full_script and save each " + k + " with save_unit_script." };
      const text = src.text;
      const units = findUnits(text, k);
      const numbers = units.map((u) => u.number);
      const max = numbers.length ? Math.max.apply(null, numbers) : 0;
      const gaps = [];
      for (let i = 1; i <= max; i++) if (numbers.indexOf(i) < 0) gaps.push(unitCode(p, i));
      const report = {
        file: src.name,
        unit_kind: k,
        units_found: units.length,
        units: units.map((u) => ({ unit: unitCode(p, u.number), heading: u.heading, characters: u.end - u.start, starts_with: text.slice(u.start, u.start + 160).replace(/\n/g, " ") })),
        missing_numbers: gaps,
        out_of_order: JSON.stringify(numbers) !== JSON.stringify(numbers.slice().sort((a, b) => a - b)),
      };
      if (!units.length) return Object.assign(report, { note: "No " + k + " headings found. Read the script with read_full_script and save each " + k + " with save_unit_script (or check the project type is right)." });
      if (!write) return Object.assign(report, { note: "Preview only. Check it, then call split_script again with write=true." });
      const written = [];
      const skipped = [];
      units.forEach((x) => {
        const u = findUnit(x.number, true);
        if (!u.title) u.title = x.heading;
        if (u.script && !overwrite) return skipped.push(u.code);
        u.script = text.slice(x.start, x.end);
        written.push(u.code);
      });
      PR().save();
      return Object.assign(report, { written, skipped_existing: skipped });
    }),
    T("save_unit_script", "Save one unit's script text (episode, scene or shot). Copy the script text exactly; never rewrite it.", { unit: unitP, text: { type: "string" }, overwrite: { type: "boolean" } }, ["unit", "text"], ({ unit, text, overwrite }) => {
      const u = findUnit(unit, true);
      if (u.script && !overwrite) fail(u.code + " already has a script. Pass overwrite=true to replace it.");
      u.script = text;
      PR().save();
      return "Saved " + u.code + "'s script (" + text.length + " characters).";
    }),
    T("set_units", 'Save the list of units with titles and one-line summaries: [{"number": 1, "title": "The Move", "summary": "..."}]. Each unit gets its folders (bins) under the project.', { units: { type: "array", items: { type: "object", properties: { number: { type: "integer" }, title: { type: "string" }, summary: { type: "string" } }, required: ["number"] } } }, ["units"], ({ units }) => {
      const out = (units || []).map((x) => {
        const u = findUnit(x.number, true);
        if (x.title != null) u.title = x.title;
        if (x.summary != null) u.summary = x.summary;
        return { code: u.code, title: u.title, summary: u.summary, folder: PR().projectFolder() + "/" + u.code };
      });
      PR().save();
      return out;
    }),
    T("list_units", "Every unit with its title, whether it has a script, how many shots, and how many images it's waiting for.", {}, [], () => {
      const p = need();
      return p.units.map((u) => ({ code: u.code, number: u.number, title: u.title, summary: u.summary, has_script: !!u.script, shots: u.shots.length, assets: u.assetIds.length, assets_needed: u.assetIds.filter((id) => p.assets[id] && !p.assets[id].lockedId).length }));
    }),
    T("read_unit", "Read one unit's script (an episode, a scene or an ad shot).", { unit: unitP }, ["unit"], ({ unit }) => {
      const u = findUnit(unit);
      if (u.script) return u.script;
      if (u.summary) return "(No script saved for " + u.code + " yet; save it with save_unit_script. Summary: " + u.summary + ")";
      fail(u.code + " has no script yet. split_script, or save_unit_script.");
    }),
    // assets
    T("upsert_character", "Create or update a character. Only the fields you pass are changed. acting_profile: the ACTING skill master profile. voice_prompt: the locked voice identity. unit: where the character first appears. has_face: false for animals and creatures (no human face): they skip the portrait library and its quota.", { id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, reference_images: imagesP, acting_profile: { type: "string" }, voice_prompt: { type: "string" }, unit: unitP, has_face: { type: "boolean" } }, ["id"], (f) => assetRow(upsertAsset("characters", f))),
    T("upsert_location", "Create or update a location. Describe geography, landmarks and practical light sources.", { id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, reference_images: imagesP, unit: unitP }, ["id"], (f) => assetRow(upsertAsset("locations", f))),
    T("upsert_costume", "Create or update a costume, e.g. ANU_HOME_01. has_face: true if its image shows the character wearing it (then it's registered as a portrait); garment-only images are better.", { id: { type: "string" }, character_id: { type: "string" }, description: { type: "string" }, reference_images: imagesP, unit: unitP, has_face: { type: "boolean" } }, ["id"], (f) => assetRow(upsertAsset("costumes", f))),
    T("upsert_prop", "Create or update a prop.", { id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, reference_images: imagesP, unit: unitP }, ["id"], (f) => assetRow(upsertAsset("props", f))),
    T("get_asset", "Look up one character, location, costume or prop.", { kind: kindP, id: { type: "string" } }, ["kind", "id"], ({ kind, id }) => assetRow(getAssetOrFail(kind, id))),
    T("list_assets", "List characters, locations, costumes or props (optionally only those introduced in one unit).", { kind: kindP, unit: unitP }, ["kind"], ({ kind, unit }) => {
      const p = need();
      const code = unit != null ? findUnit(unit).code : null;
      return Object.values(p.assets)
        .filter((a) => a.kind === KINDS[kind] && (!code || a.unit === code))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map(assetRow);
    }),
    T("list_asset_files", "Every image in the Library (generated, uploaded or your own), with what it's tagged to. Pass these ids to add_asset_image or reference_images.", {}, [], () => {
      const p = PR().project;
      const usedBy = {};
      if (p) Object.values(p.assets).forEach((a) => (a.candidates || []).forEach((id) => (usedBy[id] = (usedBy[id] || []).concat([a.id + (a.lockedId === id ? " (locked)" : "")]))));
      return S()
        .library.filter((x) => x.kind === "image")
        .map((x) => ({ id: x.id, file: x.path || x.fileName || null, made_with: x.engineLabel || x.engine, prompt: String(x.prompt || "").slice(0, 120), used_by: usedBy[x.id] || [], folder: (x.source && x.source.folder) || null }));
    }),
    T("write_image_prompts", "Write the unit's image prompt sheet: one block per image with its name, the aspect ratio and the prompt (Lira skill + the project's look). Each asset is registered as 'needed' until its image is made or added. Include already-finalised assets the unit reuses (no prompt) so the sheet lists them as 'nothing to generate'. The images can then be made on the References / Assets tabs or with the batch.", { unit: unitP, items: { type: "array", items: imagePromptSchema } }, ["unit", "items"], async ({ unit, items }) => {
      const p = need();
      const u = findUnit(unit, true);
      const lines = [(p.title || "Project") + " · " + u.code + " · IMAGE PROMPTS", "Look: " + (p.look ? p.look.name : ""), ""];
      const toMake = [];
      const reused = [];
      (items || []).forEach((it, i) => {
        const a = upsertAsset(it.kind, { id: it.id, prompt: it.prompt, name: it.name, description: it.description, character_id: it.character_id, aspect: it.aspect, notes: it.notes, has_face: it.has_face });
        if (!a.unit) a.unit = u.code;
        if (u.assetIds.indexOf(a.id) < 0) u.assetIds.push(a.id);
        const done = a.lockedId && !it.redo;
        (done || !it.prompt ? reused : toMake).push(a.id);
        lines.push(i + 1 + ". " + a.kind.toUpperCase() + "  " + a.id + "  (" + a.name + ")", "Folder: " + PR().assetFolder(a), "Aspect: " + (a.aspect || PR().ASSET_KINDS[a.kind].aspect));
        lines.push(done || !it.prompt ? "Nothing to generate (already finalised" + (a.unit && a.unit !== u.code ? " in " + a.unit : "") + ")." : it.prompt);
        if (it.notes) lines.push("Notes: " + it.notes);
        lines.push("");
      });
      u.imageSheet = lines.join("\n");
      const fileName = u.code + "_IMAGE_PROMPTS.txt";
      try {
        await P().keepFile(PR().projectFolder() + "/" + u.code + "/" + fileName, new TextEncoder().encode(u.imageSheet).buffer);
      } catch (e) {
        /* the sheet is still on the unit and in the result */
      }
      PR().save();
      return { sheet: fileName, to_make: toMake, reused, images_to_make: toMake.length, next: "Make the images (Assets tab → Make image, or the batch), or add your own with add_asset_image; then sync_assets.", text: u.imageSheet };
    }),
    T("sync_assets", "Link images to their assets: any asset with images but nothing locked gets its newest image locked (faces are then registered with BytePlus's portrait library in the background). Returns what's linked, what's still missing, and Library images not used by any asset.", {}, [], async () => {
      const p = need();
      const linked = [];
      const failed = [];
      const pending = [];
      for (const a of Object.values(p.assets)) {
        REF().migrate(a);
        if (a.lockedId) continue;
        const pick = a.candidates.find(lib);
        if (!pick) continue;
        pending.push(
          Promise.race([REF().lock(a.id, pick), new Promise((r) => setTimeout(r, 15000))]).then(
            () => linked.push(a.id),
            (e) => failed.push({ id: a.id, error: e.message })
          )
        );
      }
      await Promise.all(pending);
      const used = {};
      Object.values(p.assets).forEach((a) => (a.candidates || []).forEach((id) => (used[id] = 1)));
      return {
        linked,
        failed,
        missing: Object.values(p.assets).filter((a) => !a.lockedId && !a.candidates.some(lib)).map((a) => ({ kind: PLURAL[a.kind], id: a.id })),
        unmatched_images: S().library.filter((x) => x.kind === "image" && !used[x.id] && !(x.source && x.source.shot)).map((x) => ({ id: x.id, prompt: String(x.prompt || "").slice(0, 80) })),
        portraits: Studio.portraits.enabled() ? "Faces are registered in the background (about 20 s each, then BytePlus checks them). See portrait_status." : null,
      };
    }),
    T("add_asset_image", "Use an image the user already has. source: a Library item id (see list_asset_files), or 'pick' to choose a file from the computer. extra=True adds another angle instead of replacing the main image; otherwise it's locked as the main image (and a face is registered).", { kind: kindP, id: { type: "string" }, source: str("Library item id, or 'pick'."), unit: unitP, extra: { type: "boolean" } }, ["kind", "id", "source"], async ({ kind, id, source, unit, extra }) => {
      const a = upsertAsset(kind, Object.assign({ id }, unit != null ? { unit } : {}));
      let item;
      if (String(source).toLowerCase() === "pick") {
        item = await REF().addFromDisk(a.id);
        if (!item) fail("No file chosen.");
      } else {
        item = lib(source) || S().library.find((x) => x.fileName === source || x.path === source);
        if (!item) fail("No Library image " + source + ". list_asset_files shows them, or pass source='pick'.");
        await REF().addCandidate(a.id, item.id, false);
      }
      if (!extra) await Promise.race([REF().lock(a.id, item.id), new Promise((r) => setTimeout(r, 15000))]);
      return assetRow(a);
    }),
    T("portrait_status", "Character faces registered with BytePlus's private portrait library: how many are Active, still waiting or being checked, which were refused and why, and how much of the asset quota is used.", {}, [], portraitStatus),
    T("test_portrait_connection", "Live check of the portrait route, step by step, using no asset quota: the BytePlus Access Key and asset library, the private storage bucket, and a tiny upload + download link. It names the failing step and BytePlus's error.", {}, [], async () => {
      const steps = await Studio.portraits.test();
      const ok = steps.every((x) => x.ok);
      return { all_ok: ok, steps, next: ok ? "Everything works; registration runs in the background (portrait_status shows progress)." : "Fix the first failing step. Access Key errors: IAM user needs ArkFullAccess; storage errors: TOSFullAccess, and TOS must be activated in the BytePlus console." };
    }),
    T("register_portraits", "Register every locked character face image that isn't registered yet, in the background. Normally this happens by itself when images are locked; use it after adding a BytePlus Access Key.", {}, [], () => {
      const p = need();
      if (!Studio.portraits.enabled()) fail("Add a BytePlus Access Key ID and Secret in Settings → Character faces first.");
      const queued = [];
      Object.values(p.assets).forEach((a) => {
        REF().migrate(a);
        if (!REF().isFace(a) || !a.lockedId) return;
        if (a.ref && (a.ref.status === "active" || a.ref.status === "processing" || a.ref.status === "uploading")) return;
        queued.push(a.id);
        REF().lock(a.id, a.lockedId).catch(() => {});
      });
      REF().resume();
      return Object.assign({ queued_now: queued }, portraitStatus());
    }, { spends: "Uses portrait-library quota" }),
    T("cleanup_portraits", "Portraits in the BytePlus library that no character uses any more (replaced or removed images). They still count against the asset quota. confirm=false lists them; confirm=true deletes them from BytePlus permanently. Always show the list to the user and get their OK before confirming.", { confirm: { type: "boolean" } }, [], async ({ confirm }) => {
      const list = REF().unusedPortraits();
      if (!confirm) return { unused: list.map((r) => ({ subject: r.subject, asset_id: r.assetId })), note: "Nothing deleted. Call again with confirm=true to delete these." };
      const n = await REF().cleanup();
      return { deleted: n };
    }, { spends: (args) => (args && args.confirm ? "Deletes portraits from BytePlus permanently" : "") }),
    // shots
    T("create_shots", "Save a unit's shot breakdown. One shot = one Seedance generation (it may contain internal cuts). replace=True deletes the unit's shots that have no generations yet before saving.", { unit: unitP, shots: { type: "array", items: shotSchema }, replace: { type: "boolean" } }, ["unit", "shots"], ({ unit, shots, replace }) => {
      const p = need();
      const u = findUnit(unit, true);
      const seqs = (shots || []).map((s) => s.seq);
      const dupes = seqs.filter((x, i) => seqs.indexOf(x) !== i);
      if (dupes.length) fail("Duplicate seq numbers: " + dupes.join(", ") + ". Each shot needs its own seq.");
      if (replace) u.shots = u.shots.filter((s) => (s.attempts || []).some((a) => a.id));
      const saved = [];
      const kept = [];
      const unknown = [];
      shots.forEach((s) => {
        const id = u.code + "_S" + String(s.seq).padStart(3, "0");
        const existing = u.shots.find((x) => x.id === id);
        if (existing && (existing.attempts || []).some((a) => a.id)) return kept.push(id);
        const ids = shotAssetIds(p, s);
        ids.filter((x) => !p.assets[x]).forEach((x) => unknown.indexOf(x) < 0 && unknown.push(x));
        const shot = Object.assign({}, s, {
          id,
          title: s.action ? String(s.action).slice(0, 70) : s.intent || id,
          duration: Math.max(2, Math.min(30, Number(s.duration) || 5)),
          transition: s.transition || "CUT",
          characters: (s.characters || []).map(normId),
          costumes: Object.keys(s.costumes || {}).reduce((o, k) => ((o[normId(k)] = normId(s.costumes[k])), o), {}),
          props: (s.props || []).map(normId),
          location: s.location ? normId(s.location) : null,
          assetIds: ids.filter((x) => p.assets[x]),
          framePrompt: s.action || "",
          videoPrompt: [s.action, s.camera, s.performance].filter(Boolean).join(" "),
          continues: s.transition === "CONTINUATION",
          ratio: s.ratio || p.ratio,
          resolution: s.resolution || p.resolution || Studio.ui.video.resolution,
          frameId: null,
          videoId: null,
          status: "draft",
          attempts: [],
          finalPrompt: "",
          handles: [],
        });
        if (existing) u.shots[u.shots.indexOf(existing)] = shot;
        else u.shots.push(shot);
        ids.filter((x) => p.assets[x] && u.assetIds.indexOf(x) < 0).forEach((x) => u.assetIds.push(x));
        saved.push(id);
      });
      u.shots.sort((a, b) => (a.id < b.id ? -1 : 1));
      u.status = "done";
      u.error = "";
      PR().save();
      return { unit: u.code, saved, kept_unchanged: kept, unknown_assets: unknown, note: (kept.length ? "Kept shots already have generations; edit them with update_shot. " : "") + (unknown.length ? "Create the unknown assets with upsert_* (then update_shot) so their images are attached." : "") || null };
    }),
    T("list_shots", "All shots of a unit in order, with status and attempt counts.", { unit: unitP }, ["unit"], ({ unit }) => findUnit(unit).shots.map((s) => shotRow(SH().migrate(s)))),
    T("get_shot", "Full shot record plus every generation attempt.", { shot_id: { type: "string" } }, ["shot_id"], ({ shot_id }) => {
      const { shot } = findShot(shot_id);
      const out = Object.assign({}, shot);
      delete out.writing;
      out.generations = shot.attempts.map((a, i) => {
        const it = lib(a.id);
        return { attempt: i + 1, status: a.status, file: it ? it.path || it.fileName : null, error: a.error || null, review: a.note || null, created_at: new Date(a.at).toISOString() };
      });
      out.blockers = SH().blockers(shot);
      out.prompt_warnings = SH().promptWarnings(shot);
      return out;
    }),
    T("update_shot", 'Change shot fields (e.g. {"duration": 8, "camera": "..."}). Use set_shot_prompt for the prompt. Changing characters, costumes, props, location, transition or seq clears the prompt (its @image handles change).', { shot_id: { type: "string" }, fields: { type: "object" } }, ["shot_id", "fields"], ({ shot_id, fields }) => {
      const { unit, shot } = findShot(shot_id);
      const bad = Object.keys(fields || {}).filter((k) => SHOT_FIELDS.indexOf(k) < 0);
      if (bad.length) fail("Not editable: " + bad.join(", ") + ". Allowed: " + SHOT_FIELDS.join(", "));
      if (fields.seq != null && Number(fields.seq) !== Number(shot.id.slice(-3))) fail("seq can't change once a shot exists; create_shots with the new order instead.");
      Object.assign(shot, fields);
      if (fields.transition) shot.continues = fields.transition === "CONTINUATION";
      if (fields.action) shot.title = String(fields.action).slice(0, 70);
      const cleared = Object.keys(fields).some((k) => REF_FIELDS.indexOf(k) >= 0 && k !== "seq");
      if (cleared) {
        const p = need();
        shot.assetIds = shotAssetIds(p, shot).filter((x) => p.assets[x]);
        if (shot.finalPrompt) {
          shot.finalPrompt = "";
          shot.handles = [];
          if (shot.status === "ready") shot.status = "draft";
        }
      }
      PR().save();
      return Object.assign(shotRow(shot), { prompt_cleared: cleared, unit: unit.code });
    }),
    // prompts
    T("prepare_shot_prompt", "Get the brief for writing a shot's Seedance prompt: shot direction, the @image handles attached to it, characters with acting profiles and voice prompts, location, previous shot, project bible, earlier attempts and their reviews. Write the prompt with the cinedance and acting skills, then call set_shot_prompt.", { shot_id: { type: "string" } }, ["shot_id"], ({ shot_id }) => {
      const { unit, shot } = findShot(shot_id);
      return buildBrief(unit, shot);
    }),
    T("set_shot_prompt", "Save the final Seedance prompt for a shot. Its @image handles are frozen with it, so they can't shift before generation. It is checked first: wrong @image handles block saving; CINEDANCE rule warnings (unused handles, context leakage, missing voice prompt, ...) are returned.", { shot_id: { type: "string" }, prompt: { type: "string" } }, ["shot_id", "prompt"], ({ shot_id, prompt }) => {
      const { unit, shot } = findShot(shot_id);
      const handles = SH().handlesFor(shot);
      const check = lintPrompt(unit, shot, handles, prompt);
      if (check.errors.length) return { saved: false, errors: check.errors, warnings: check.warnings };
      shot.finalPrompt = String(prompt).trim();
      shot.handles = handles;
      if (shot.status !== "approved") shot.status = "ready";
      PR().save();
      return { saved: true, shot_id: shot.id, references: handles.map((h) => h.handle + " = " + (h.assetId || h.name)), warnings: check.warnings, blockers: SH().blockers(shot).map((b) => b.text) };
    }),
    // generation
    T("generate_shot", "Submit one shot to Seedance now (costs credits). Respects the retry budget unless extra_attempt=True.", { shot_id: { type: "string" }, extra_attempt: { type: "boolean" } }, ["shot_id"], ({ shot_id, extra_attempt }) => startShot(String(shot_id).toUpperCase(), !!extra_attempt), {
      spends: (a) => {
        try {
          const { shot } = findShot(a.shot_id);
          const p = need();
          const est = Studio.pricing.videoPrice("byteplus", "", shot.duration, Studio.ui.video.resolution, p.ratio);
          return "Seedance video, " + shot.duration + " s · " + Studio.pricing.describe(est);
        } catch (e) {
          return "Seedance video (costs credits)";
        }
      },
    }),
    T("check_shot", "Poll a generating shot. Reports its file when it's done (saved to the shot's folder and the Library).", { shot_id: { type: "string" } }, ["shot_id"], ({ shot_id }) => {
      const { shot } = findShot(shot_id);
      const job = running[shot.id];
      const last = shot.attempts[shot.attempts.length - 1];
      const it = last && lib(last.id);
      return {
        shot_id: shot.id,
        status: shot.status,
        waiting_for: shot.waitingFor || null,
        running_for_seconds: job && job.status === "working" ? Math.round((Date.now() - job.startedAt) / 1000) : null,
        latest_attempt: last ? { attempt: shot.attempts.length, status: last.status, file: it ? it.path || it.fileName : null, error: last.error || null } : null,
        error: job && job.status === "failed" ? job.error : null,
      };
    }),
    T("review_shot", "Review the latest generation. approve: marks it approved (it goes into the edit and EDL). retry: notes say exactly what failed; Claude patches only what the notes flag (CINEDANCE file-first repair) and the shot is ready to generate again. reject: stop for human review.", { shot_id: { type: "string" }, verdict: { type: "string", enum: ["approve", "retry", "reject"] }, notes: { type: "string" } }, ["shot_id", "verdict"], async ({ shot_id, verdict, notes }) => {
      const { shot } = findShot(shot_id);
      const last = shot.attempts[shot.attempts.length - 1];
      if (!last || !last.id) fail(shot.id + " has no generation to review yet.");
      if (verdict === "approve") {
        SH().approve(shot.id, last.id);
        return { shot_id: shot.id, status: "approved" };
      }
      if (verdict === "retry") {
        await SH().reject(shot.id, notes || "");
        if (notes) last.note = notes;
        PR().save();
        return { shot_id: shot.id, status: shot.status, patched_prompt: shot.finalPrompt, next: "queue_unit (or generate_shot) makes the new take." };
      }
      last.status = "rejected";
      last.note = notes || "";
      shot.status = "review";
      shot.hold = notes || "Rejected: waiting for a human decision.";
      PR().save();
      return { shot_id: shot.id, status: "needs_review", notes: notes || "" };
    }),
    T("queue_unit", "Hand a unit's ready shots to the background queue, and start it (unless start_worker=False). It generates them while you keep working in Premiere.", { unit: unitP, start_worker: { type: "boolean" } }, ["unit"], ({ unit, start_worker }) => {
      const u = findUnit(unit);
      const ready = u.shots.filter((s) => s.finalPrompt && (s.status === "ready" || s.status === "failed" || s.status === "draft"));
      if (start_worker === false) Studio.queue.pause();
      const added = Studio.queue.add(ready.map((s) => ({ key: "video:" + s.id, label: s.id + " video", kind: "video", run: () => SH().generate(s.id) })));
      if (start_worker !== false) Studio.queue.resume();
      return { queued: added, shots_needing_a_prompt: u.shots.filter((s) => !s.finalPrompt).map((s) => s.id), worker: Studio.queue.summary() };
    }, {
      spends: (a) => {
        try {
          const u = findUnit(a.unit);
          const p = need();
          const ready = u.shots.filter((s) => s.finalPrompt && (s.status === "ready" || s.status === "failed" || s.status === "draft"));
          let usd = 0;
          ready.forEach((s) => (usd += Studio.pricing.videoPrice("byteplus", "", s.duration, Studio.ui.video.resolution, p.ratio).usd || 0));
          return ready.length + " Seedance video(s) · ≈ " + Studio.pricing.money(usd);
        } catch (e) {
          return "Seedance videos (costs credits)";
        }
      },
    }),
    T("start_worker", "Start generating queued shots in the background. Safe to call if it's already running. concurrency: how many shots generate at once.", { unit: unitP, concurrency: int("How many videos at once (default 2).") }, [], ({ concurrency }) => {
      if (concurrency) S().saveSettings({ batchVideos: Math.max(1, Math.min(6, Number(concurrency))) });
      Studio.queue.resume();
      return Studio.queue.summary();
    }, { spends: () => (Studio.queue.summary().waiting ? "Runs " + Studio.queue.summary().waiting + " queued generation(s)" : "") }),
    T("worker_status", "Is the background queue running, and its latest entries (what was sent, finished, failed).", {}, [], () =>
      Object.assign({ running: Studio.queue.summary().active && !Studio.queue.summary().paused }, Studio.queue.summary(), {
        log: Studio.queue.tasks.slice(-20).map((t) => t.label + ": " + t.status + (t.error ? " (" + t.error + ")" : "")),
      })
    ),
    T("stop_worker", "Stop the background queue. Shots already sent to BytePlus finish there.", {}, [], () => {
      Studio.queue.pause();
      return Object.assign({ stopped: true }, Studio.queue.summary());
    }),
    T("unit_status", "Progress for one unit: shots by status, generations spent, shots that need you.", { unit: unitP }, ["unit"], ({ unit }) => unitStatus(findUnit(unit))),
    T("export_unit", "Assemble a unit's approved shots: a bin and sequence in Premiere (in story order), plus an EDL and a manifest.json (save=true asks where to save them).", { unit: unitP, save: bool("Ask where to save the EDL and manifest.") }, ["unit"], async ({ unit, save }) => {
      const u = findUnit(unit);
      const edl = SH().edl(u);
      const manifest = SH().manifest(u);
      const out = { unit: u.code, approved: u.shots.filter((s) => s.status === "approved").map((s) => s.id), edl, manifest: JSON.parse(manifest) };
      try {
        out.premiere = await SH().exportToPremiere(u);
      } catch (e) {
        out.premiere = { error: e.message };
      }
      if (save) {
        out.saved_edl = await P().saveTextAs(u.code + "_ROUGHCUT.edl", edl);
        out.saved_manifest = await P().saveTextAs(u.code + "_manifest.json", manifest);
      }
      return out;
    }),
    // raw generation
    T("generate_video", "Submit a one-off Seedance job outside the shots (costs credits). Poll with check_generation.", { prompt: { type: "string" }, duration: { type: "integer" }, resolution: { type: "string", enum: Object.keys(RESOLUTIONS) }, ratio: { type: "string", enum: Object.keys(RATIOS) }, reference_image_urls: { type: "array", items: { type: "string" } }, generate_audio: { type: "boolean" } }, ["prompt"], (a) => {
      const id = "gen-" + Date.now().toString(36);
      const job = (running[id] = { status: "working", startedAt: Date.now() });
      Studio.jobs
        .createVideo({
          prompt: a.prompt,
          engine: "byteplus",
          ratio: a.ratio || "16:9",
          duration: Number(a.duration) || 5,
          resolution: a.resolution || "480p",
          audio: !!a.generate_audio,
          references: a.reference_image_urls && a.reference_image_urls.length ? async () => a.reference_image_urls.map((url) => ({ url })) : null,
          source: { folder: (PR().project ? PR().projectFolder() + "/" : "") + "outputs", name: id },
        })
        .then(
          (item) => Object.assign(job, { status: "succeeded", item: item.id }),
          (e) => Object.assign(job, { status: "failed", error: e.message })
        );
      return { task_id: id, status: "submitted" };
    }, { spends: (a) => "One-off Seedance video, " + (Number(a.duration) || 5) + " s at " + (a.resolution || "480p") + " · " + Studio.pricing.describe(Studio.pricing.videoPrice("byteplus", "", Number(a.duration) || 5, a.resolution || "480p", a.ratio || "16:9")) }),
    T("check_generation", "Check a one-off job. When it has succeeded, the MP4 is in the Library (and the project's outputs folder).", { task_id: { type: "string" } }, ["task_id"], ({ task_id }) => {
      const job = running[task_id];
      if (!job) fail("No job " + task_id + " in this session.");
      const it = lib(job.item);
      return { task_id, status: job.status, file: it ? it.path || it.fileName : null, error: job.error || null };
    }),
  ];

  // ---------- workflow prompts (the connector's prompt menu) ----------

  const PROMPTS = [
    {
      name: "start_project",
      description: "Read a new script, decide what kind of production it is, set it up and choose its look.",
      args: [],
      text: () => `Help me start a new production from my script. I'm new to this: go one step at a time,
talk in plain language, and wait for my answer whenever you ask something.

1. Call production_status. If the active project already has shots, ask whether to continue it or start a
   new one; for a new one ask me for a name and call open_project(name, create=true). If there's no script
   loaded, tell me to press "Load script" on the MCP tab and stop.
2. Read the whole script with read_full_script (all pieces). Judge what it is: a series (episodes), a feature
   film, a short film or documentary (scenes), or an ad / music video / promo (shots). Tell me what you think
   it is and why, how many units you'd divide it into, and list them with a title and one-line summary each.
   Ask me to confirm or correct.
3. Call production_options and show me the choices as short numbered lists: aspect ratio (suggest one for
   where it will be shown), resolution (suggest 480p for tests, the final one for delivery), and look
   (suggest the 2-3 presets that fit this script and say why; I can also describe my own). Ask me to pick.
4. Save everything with set_project (title, type, ratio, resolution, look). Then split the script:
   split_script (preview), show me what it found, and after I confirm, write=true. If it can't find the
   units (common for ads and PDFs), save each one with save_unit_script, copying the text exactly. Save the
   titles and summaries with set_units.
5. Write the rest of the bible (camera, lighting, performance, dialogue) consistent with the chosen look and
   get_skill('cinedance'); show it to me, and save with set_bible_section after I approve.
6. Tell me the next step: "Prepare assets for <first unit>".`,
    },
    {
      name: "prepare_assets",
      description: "Write the image prompt sheet for one unit (episode / scene / shot) and collect the images.",
      args: ["unit"],
      text: (unit) => `Prepare the image assets for ${unit}.

1. read_unit('${unit}'). List every character, costume, location and prop that appears in it. Check
   list_assets for each one: anything already finalised in an earlier unit is reused, not regenerated
   (unless I ask for a new version).
2. Load get_skill('lira') and get_bible(). For each asset that still needs an image, write a production-ready
   image prompt in the project's look: characters as identity reference images (clear face, neutral light,
   full outfit visible), costumes as garment-only images (flat lay, on a hanger or mannequin, no
   face) unless the look only works worn, locations as clean establishing views with the practical
   light sources visible, props as clean product-style shots. Add a one-line description of each asset too;
   it is used later in the video prompts. Use IDs in CAPITALS_WITH_UNDERSCORES.
3. Save them with write_image_prompts('${unit}', items), including the reused assets without a prompt.
   Tell me how many images to make, and that I can make them on the Assets tab (Make image) or with the batch.
4. Stop and wait. When I say the images are made or added, call sync_assets and tell me what's linked and
   what's missing. For images it couldn't match, ask me which asset each one is and use add_asset_image.
5. When nothing is missing, tell me the next step: "Prepare ${unit}".`,
    },
    {
      name: "prepare_unit",
      description: "Break one unit into shots and write every Seedance prompt.",
      args: ["unit"],
      text: (unit) => `Prepare ${unit} for generation.

1. production_status: note the project type, unit kind, ratio and resolution. read_unit('${unit}').
2. Load get_skill('shotlist') and follow its phases, adapted to this pipeline and to the project type:
   - Series episode or film scene: break the action into shots, each one generation (up to ~15 s, may hold
     internal cuts). An ad shot: usually one generation; split it only if it's long or has several angles.
   - Assets: every character, costume, location and prop must exist with status 'ready'. If any is missing,
     stop and tell me to run "Prepare assets for ${unit}" first.
   - For any shot with 2+ characters or a key prop placement, propose the blocking and wait for my approval.
   - Instead of the HTML file, save the breakdown with create_shots('${unit}', shots). Leave ratio and
     resolution empty so the project settings apply.
3. For each shot: prepare_shot_prompt, then write the prompt with get_skill('cinedance') plus
   get_skill('acting'), then set_shot_prompt. Fix any errors and look at the warnings.
   CONTINUATION shots can only be written after the shot before them is approved; skip them for now and
   list them for me.
4. Finish with unit_status('${unit}') and a short summary: shots, total seconds, and anything uncertain.
   The next step is: "Queue ${unit}" (that starts generating in the background).`,
    },
    {
      name: "review_unit",
      description: "Review generated shots and patch failed prompts.",
      args: ["unit"],
      text: (unit) => `Review ${unit}.

Call unit_status('${unit}'). For each shot waiting for review, tell me its file and ask for my verdict,
then call review_shot (retry patches the prompt from my notes). For each CONTINUATION shot still without a
prompt whose previous shot is now approved, prepare_shot_prompt and write its prompt.
For each 'failed' shot, read the error in get_shot and tell me what went wrong.
Finally, queue_unit('${unit}') so the queue picks up the retries and new prompts (worker_status shows
progress). When everything is approved, offer export_unit('${unit}').`,
    },
  ];

  const INSTRUCTIONS =
    "You are the Seedance Production connector running inside AI Studio, an Adobe Premiere Pro panel. Production system for Seedance video projects of any kind: series (split into episodes), films and shorts (scenes), ads and music videos (shots). Call production_status first; it says what the project is and how it's divided. Every 'unit' argument takes a number or a code like EP01 / SC012 / SH03. Prompts are never templated: before writing a Seedance prompt load get_skill('cinedance') and get_skill('acting'); to break a unit into shots load get_skill('shotlist'); for image prompts (characters, costumes, locations, props) load get_skill('lira'). generate_shot, queue_unit and generate_video spend credits; the panel asks the user before they run. Talk in plain language to an editor, keep replies short, and wait for the user's answer whenever you ask something.";

  async function runTool(name, args) {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) throw new ToolError("Unknown tool " + name + ".");
    return await tool.run(args || {});
  }

  function spendNote(name, args) {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool || !tool.spends) return "";
    return typeof tool.spends === "function" ? tool.spends(args || {}) : tool.spends;
  }

  /** Tool definitions for the Messages API (stable order, so the prompt cache holds). */
  function apiTools() {
    return TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  }

  Studio.mcp = {
    TOOLS,
    PROMPTS,
    INSTRUCTIONS,
    CONNECTOR_SETTINGS,
    PROJECT_TYPES,
    RESOLUTIONS,
    RATIOS,
    runTool,
    spendNote,
    apiTools,
    loadScript,
    newProject,
    findUnits,
    lintPrompt,
    ToolError,
  };
})();
