/*
 * Shots, the connector way:
 *   prepare  → the shot's locked references get @image handles (@image1 = RAVI, …)
 *   prompt   → Claude writes the final Seedance prompt with those handles; the handles are frozen with it
 *   generate → Seedance with the reference images (asset:// for registered faces), within a retry budget
 *   review   → approve, or reject with a note and Claude patches the prompt
 *   export   → approved takes into Premiere in order (bin + sequence), plus an EDL and a manifest
 * The simpler "picture first, then animate" route stays available (and is what Higgsfield uses).
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const PR = () => Studio.production;
  const REF = () => Studio.references;
  const S = () => Studio.store;

  const KIND_ORDER = { character: 0, costume: 1, location: 2, prop: 3 };
  const MAX_REFS = 6;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function lib(id) {
    return id ? S().library.find((x) => x.id === id) : null;
  }

  function project() {
    return PR().project;
  }

  function migrate(s) {
    if (!s.attempts) s.attempts = s.videoId ? [{ id: s.videoId, at: Date.now(), prompt: s.videoPrompt, status: "review" }] : [];
    if (!s.status) s.status = s.videoId ? "review" : "draft";
    return s;
  }

  /** Reference handles for a shot: characters, costumes, locations, props — at most six. */
  /**
   * Reference handles for a shot: characters, costumes, locations, props (locked images), then any
   * uploaded reference images tagged to the shot — @image1…; then tagged reference videos — @video1….
   */
  function handlesFor(shot) {
    const p = project();
    const images = shot.assetIds
      .map((id) => p.assets[id])
      .filter(Boolean)
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
      .map((a) => ({ assetId: a.id, kind: a.kind, name: a.name, description: a.description }))
      .concat(
        (shot.imageRefs || [])
          .map((id) => lib(id))
          .filter(Boolean)
          .map((it) => ({ itemId: it.id, kind: "reference image", name: it.name || it.id, description: "uploaded reference image" }))
      )
      .slice(0, MAX_REFS + 3)
      .map((h, i) => Object.assign({ handle: "@image" + (i + 1) }, h));
    const videos = (shot.videoRefs || [])
      .filter((r) => lib(r.itemId))
      .slice(0, 3)
      .map((r, i) => ({ handle: "@video" + (i + 1), itemId: r.itemId, kind: "reference video", name: r.label, description: r.label + (r.note ? ": " + r.note : "") }));
    return images.concat(videos);
  }

  /** What's stopping this shot from being generated, in plain words (empty when it's ready). */
  function blockers(shot) {
    const p = project();
    const handles = shot.handles && shot.handles.length ? shot.handles : handlesFor(shot);
    const out = [];
    handles.forEach((h) => {
      if (!h.assetId) return; // uploaded images and videos are always ready
      const st = REF().refState(p.assets[h.assetId]);
      const name = (p.assets[h.assetId] || { name: h.assetId }).name;
      if (st === "unlocked") out.push({ type: "lock", text: "Lock " + name + "'s image" });
      else if (st === "waiting") out.push({ type: "wait", text: name + "'s face is being checked by BytePlus" });
      else if (st === "failed") out.push({ type: "lock", text: name + "'s image was refused — choose another" });
    });
    return out;
  }

  /** Warnings about the frozen prompt (unknown handles, references never mentioned). */
  function promptWarnings(shot) {
    if (!shot.finalPrompt) return [];
    const used = (shot.finalPrompt.match(/@(image|video)\d+/g) || []).filter((v, i, a) => a.indexOf(v) === i);
    const known = (shot.handles || []).map((h) => h.handle);
    const w = [];
    used.forEach((u) => known.indexOf(u) < 0 && w.push(u + " isn't attached to this shot."));
    known.forEach((k) => used.indexOf(k) < 0 && w.push(k + " is attached but never mentioned."));
    return w;
  }

  function previousShot(unit, shot) {
    const i = unit.shots.indexOf(shot);
    return i > 0 ? unit.shots[i - 1] : null;
  }

  async function writePrompt(shotId) {
    const { unit, shot } = PR().findShot(shotId);
    migrate(shot);
    const handles = handlesFor(shot);
    shot.writing = true;
    PR().save();
    try {
      shot.finalPrompt = await Studio.claude.writeShotPrompt({ project: project(), shot, handles, previous: previousShot(unit, shot) });
      shot.handles = handles;
      shot.status = "ready";
    } finally {
      shot.writing = false;
      PR().save();
    }
  }

  function budget() {
    return Number(S().settings.retryBudget) || 3;
  }

  /** Seedance from the locked references. extra: allow one take beyond the budget. */
  async function generate(shotId, extra) {
    const { shot } = PR().findShot(shotId);
    migrate(shot);
    if (!shot.finalPrompt) await writePrompt(shotId);
    const spent = shot.attempts.length;
    if (spent >= budget() && !extra) {
      const e = new Error(shot.id + " has used its " + budget() + " takes. Use “One more take” if you want to keep going.");
      e.budget = true;
      throw e;
    }
    // Wait (up to ~30 min) for faces still being checked; fail fast on anything unlocked or refused.
    for (let i = 0; ; i++) {
      const b = blockers(shot);
      if (!b.length) break;
      if (b.some((x) => x.type === "lock")) throw new Error(shot.id + ": " + b.map((x) => x.text).join("; ") + ".");
      if (i > 120) throw new Error(shot.id + ": still waiting for BytePlus to check the faces. Try again later.");
      shot.waitingFor = b.map((x) => x.text).join("; ");
      PR().save();
      await sleep(15000);
    }
    shot.waitingFor = "";
    shot.status = "generating";
    PR().save();
    const p = project();
    const firstRef = lib((p.assets[(shot.handles[0] || {}).assetId] || {}).lockedId);
    try {
      const item = await Studio.jobs.createVideo({
        prompt: shot.finalPrompt,
        engine: "byteplus",
        ratio: p.ratio,
        duration: Math.max(4, Math.min(15, shot.duration)),
        resolution: Studio.ui.video.resolution,
        audio: Studio.ui.video.audio,
        references: () => REF().shotReferences(shot.handles),
        videoRefs: shot.videoRefs && shot.videoRefs.length ? () => Studio.uploads.videoRefUrls(shot) : null,
        source: PR().shotSource(shotId, { video: true, poster: firstRef ? firstRef.src : "", name: shotId + "_take" + (shot.attempts.length + 1) }),
      });
      shot.attempts.push({ id: item.id, at: Date.now(), prompt: shot.finalPrompt, status: "review" });
      shot.videoId = item.id;
      shot.status = "review";
      PR().save();
      return item;
    } catch (e) {
      shot.attempts.push({ id: null, at: Date.now(), prompt: shot.finalPrompt, status: "failed", error: e.message });
      shot.status = "failed";
      PR().save();
      throw e;
    }
  }

  function approve(shotId, attemptId) {
    const { shot } = PR().findShot(shotId);
    migrate(shot);
    const take = shot.attempts.find((a) => a.id === (attemptId || shot.videoId));
    if (!take) return;
    shot.attempts.forEach((a) => a.status === "approved" && (a.status = "review"));
    take.status = "approved";
    shot.approvedId = take.id;
    shot.videoId = take.id;
    shot.status = "approved";
    PR().save();
  }

  /** Reject the latest take; Claude patches the prompt from the note. */
  async function reject(shotId, note) {
    const { unit, shot } = PR().findShot(shotId);
    migrate(shot);
    const take = shot.attempts[shot.attempts.length - 1];
    if (take) {
      take.status = "rejected";
      take.note = note;
    }
    if (shot.approvedId === (take && take.id)) shot.approvedId = null;
    shot.status = "fixing";
    PR().save();
    try {
      if (note && note.trim()) {
        if (!shot.handles || !shot.handles.length) shot.handles = handlesFor(shot);
        shot.finalPrompt = await Studio.claude.patchShotPrompt({ project: project(), shot, handles: shot.handles, previous: previousShot(unit, shot), note });
      }
      shot.status = "ready";
    } catch (e) {
      shot.status = "review";
      throw e;
    } finally {
      PR().save();
    }
  }

  function unitStatus(unit) {
    const st = { shots: unit.shots.length, approved: 0, review: 0, ready: 0, draft: 0, failed: 0, takes: 0, seconds: 0, approvedSeconds: 0, needsYou: [] };
    unit.shots.forEach((s) => {
      migrate(s);
      st.takes += s.attempts.filter((a) => a.id).length;
      st.seconds += s.duration;
      if (s.status === "approved") {
        st.approved++;
        st.approvedSeconds += s.duration;
      } else if (s.status === "review") {
        st.review++;
        st.needsYou.push(s.id + " needs review");
      } else if (s.status === "failed") st.failed++;
      else if (s.finalPrompt) st.ready++;
      else st.draft++;
      blockers(s)
        .filter((b) => b.type === "lock")
        .forEach((b) => st.needsYou.indexOf(b.text) < 0 && st.needsYou.push(b.text));
    });
    return st;
  }

  // ---------- export ----------

  function finalTake(s) {
    return lib(s.approvedId) || lib(s.videoId) || lib(s.frameId);
  }

  function timecode(sec, fps) {
    const f = Math.round(sec * fps);
    const pad = (n) => String(n).padStart(2, "0");
    return pad(Math.floor(f / (3600 * fps))) + ":" + pad(Math.floor(f / (60 * fps)) % 60) + ":" + pad(Math.floor(f / fps) % 60) + ":" + pad(f % fps);
  }

  /** CMX3600 EDL of the approved takes (24 fps, Seedance's frame rate). */
  function edl(unit) {
    const fps = 24;
    const lines = ["TITLE: " + (project().title || "AI Studio") + " " + unit.code, "FCM: NON-DROP FRAME", ""];
    let t = 0;
    let n = 0;
    unit.shots.forEach((s) => {
      const take = finalTake(s);
      if (!take) return;
      n++;
      const d = take.kind === "video" ? s.duration : 3;
      lines.push(String(n).padStart(3, "0") + "  AX       V     C        " + timecode(0, fps) + " " + timecode(d, fps) + " " + timecode(t, fps) + " " + timecode(t + d, fps));
      lines.push("* FROM CLIP NAME: " + (take.fileName ? take.fileName.split("/").pop() : s.id));
      lines.push("* COMMENT: " + s.id + " " + s.title);
      lines.push("");
      t += d;
    });
    return lines.join("\n");
  }

  function manifest(unit) {
    return JSON.stringify(
      {
        project: project().title,
        unit: unit.code,
        title: unit.title,
        shots: unit.shots.map((s) => {
          const take = finalTake(s);
          return { id: s.id, title: s.title, duration: s.duration, approved: !!lib(s.approvedId), file: take ? take.path || take.fileName : null, prompt: s.finalPrompt || s.videoPrompt, references: s.handles || [] };
        }),
      },
      null,
      2
    );
  }

  /** Import the takes in story order into a bin, then try to lay them on a new sequence. */
  async function exportToPremiere(unit) {
    const takes = unit.shots.map(finalTake).filter((x) => x && x.path);
    if (!takes.length) throw new Error("Nothing to export yet. Approve some shots first (or open the panel inside Premiere).");
    const name = ((project().title || "AI Studio") + " " + unit.code).slice(0, 60);
    await Studio.platform.importToPremiere(takes.map((t) => t.path), name);
    takes.forEach((t) => S().updateLibrary(t.id, { imported: true }));
    const placed = await Studio.platform.buildSequence(name, takes.map((t) => ({ path: t.path, seconds: t.kind === "video" ? t.duration || 5 : 3 })));
    return { count: takes.length, sequence: placed };
  }

  Studio.shots = { migrate, handlesFor, blockers, promptWarnings, writePrompt, generate, approve, reject, unitStatus, edl, manifest, exportToPremiere, budget, finalTake };
})();
