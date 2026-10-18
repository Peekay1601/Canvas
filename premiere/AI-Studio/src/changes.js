/*
 * "Change with Claude": tell Claude what to change in a picture or video, in your own words.
 *   Pictures: on Seedream, Claude writes a LIRA edit prompt (CHANGE + PRESERVE EXACTLY) and the new
 *             picture is made FROM the current one, so everything else stays; on Higgsfield it rewrites
 *             the full prompt. Character/location/prop images land as a new candidate (lock it if you
 *             prefer it); a shot frame is replaced.
 *   Videos:   a shot take is rejected with your note, Claude patches the shot's prompt and a new take
 *             is made; any other video gets a patched prompt and is made again with the same settings.
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const S = () => Studio.store;
  const PR = () => Studio.production;

  function lib(id) {
    return id ? S().library.find((x) => x.id === id) : null;
  }

  /** What an item is in the project: an asset image, a shot frame, a shot take, or a free item. */
  function whereIs(itemId) {
    const p = PR().project;
    if (p) {
      for (const a of Object.values(p.assets)) {
        if ((a.candidates || []).indexOf(itemId) >= 0 || a.lockedId === itemId) return { type: "asset", asset: a };
      }
      for (const u of p.units) {
        for (const s of u.shots) {
          if (s.frameId === itemId) return { type: "frame", shot: s, unit: u };
          if ((s.attempts || []).some((t) => t.id === itemId) || s.videoId === itemId) return { type: "take", shot: s, unit: u };
        }
      }
    }
    return { type: "free" };
  }

  function label(itemId) {
    const it = lib(itemId);
    const w = whereIs(itemId);
    if (w.type === "asset") return w.asset.name + " · " + w.asset.kind + " image";
    if (w.type === "frame") return w.shot.id + " · opening frame";
    if (w.type === "take") return w.shot.id + " · take " + (w.shot.attempts.findIndex((t) => t.id === itemId) + 1);
    return it ? (it.kind === "video" ? "Video" : "Picture") + " · " + (it.engineLabel || "") : "";
  }

  async function imageRefFor(item) {
    const fresh = item.remoteUrl && /^https:/.test(item.remoteUrl) && Date.now() - (item.createdAt || 0) < 12 * 3600e3;
    if (fresh) return item.remoteUrl;
    try {
      return (await Studio.jobs.pictureInput(item)).dataUrl;
    } catch (e) {
      return null;
    }
  }

  /** Step 1: Claude writes the new prompt (so you can read and edit it before anything is made). */
  async function preview(itemId, instruction) {
    const item = lib(itemId);
    if (!item) throw new Error("That file is no longer in your Library.");
    const w = whereIs(itemId);
    if (item.kind === "image") {
      const editing = Studio.ui.image.engine === "byteplus";
      const base = w.type === "asset" ? w.asset.prompt || w.asset.description : w.type === "frame" ? w.shot.framePrompt : item.prompt;
      return Studio.claude.changeImagePrompt({ prompt: base, instruction, imageRef: await imageRefFor(item), editing });
    }
    if (w.type === "take") {
      const p = PR().project;
      const handles = w.shot.handles && w.shot.handles.length ? w.shot.handles : Studio.shots.handlesFor(w.shot);
      if (p.shotMode !== "frame" && w.shot.finalPrompt) {
        return Studio.claude.patchShotPrompt({ project: p, shot: w.shot, handles, previous: null, note: instruction });
      }
      const frame = lib(w.shot.frameId);
      return Studio.claude.changeVideoPrompt({ prompt: w.shot.videoPrompt, instruction, frameRef: frame ? await imageRefFor(frame) : null });
    }
    const poster = item.poster && /^https:/.test(item.poster) ? item.poster : null;
    return Studio.claude.changeVideoPrompt({ prompt: item.prompt, instruction, frameRef: poster });
  }

  /** Step 2: make the new version from the (possibly edited) prompt. */
  async function make(itemId, prompt, instruction) {
    const item = lib(itemId);
    const w = whereIs(itemId);
    const ui = Studio.ui;
    if (item.kind === "image") {
      const engine = ui.image.engine;
      const editing = engine === "byteplus";
      let source = { folder: item.folder || "Create/Pictures", name: (item.fileName || item.id).split("/").pop().replace(/\.[^.]+$/, "") + "_v" + Date.now().toString(36).slice(-3) };
      let ratio = item.ratio || "16:9";
      if (w.type === "asset") {
        source = Object.assign({}, source, { asset: w.asset.id, folder: PR().assetFolder(w.asset), project: PR().projectFolder(), unit: w.asset.unit || "Shared" });
        ratio = PR().ASSET_KINDS[w.asset.kind].aspect;
      } else if (w.type === "frame") {
        source = PR().shotSource(w.shot.id, { name: w.shot.id + "_frame_v" + Date.now().toString(36).slice(-3) });
        ratio = PR().project.ratio;
      }
      const made = await Studio.jobs.createImage({
        prompt,
        engine,
        ratio,
        model: engine === "higgsfield" ? ui.image.model : "",
        reference: editing ? item : null,
        source,
      });
      S().updateLibrary(made.id, { changedFrom: item.id, changeNote: instruction });
      if (w.type === "asset") await Studio.references.addCandidate(w.asset.id, made.id, false);
      if (w.type === "frame") {
        w.shot.frameId = made.id;
        PR().save();
      }
      return made;
    }
    if (w.type === "take") {
      const p = PR().project;
      if (p.shotMode !== "frame") {
        const take = w.shot.attempts.find((t) => t.id === itemId);
        if (take) {
          take.status = "rejected";
          take.note = instruction;
        }
        w.shot.finalPrompt = prompt;
        w.shot.status = "ready";
        PR().save();
        return Studio.shots.generate(w.shot.id, w.shot.attempts.length >= Studio.shots.budget());
      }
      w.shot.videoPrompt = prompt;
      PR().save();
      return PR().makeVideo(w.shot.id);
    }
    // A free video (from Create): same settings, new prompt.
    const engine = item.engine === "higgsfield" ? "higgsfield" : "byteplus";
    if (engine === "higgsfield") throw new Error("Higgsfield videos start from a picture: use Animate in the Library with the new prompt.");
    const made = await Studio.jobs.createVideo({
      prompt,
      engine,
      ratio: item.ratio || "16:9",
      duration: item.duration || 5,
      resolution: item.resolution || ui.video.resolution,
      audio: ui.video.audio,
      model: item.model || "",
      source: { folder: item.folder || "Create/Videos", name: (item.fileName || item.id).split("/").pop().replace(/\.[^.]+$/, "") + "_v" + Date.now().toString(36).slice(-3) },
    });
    S().updateLibrary(made.id, { changedFrom: item.id, changeNote: instruction });
    return made;
  }

  /** A short description of what's open, for the Ask Claude chat. */
  function contextText(focus) {
    const p = PR().project;
    const lines = [];
    if (p) {
      lines.push("Project: " + (p.title || p.scriptName) + " (" + (p.type || "") + "), look: " + (p.look ? p.look.name : "") + ", frame " + p.ratio + ".");
      if (p.logline) lines.push("Logline: " + p.logline);
    }
    if (focus && focus.unit && p) {
      const u = p.units.find((x) => x.code === focus.unit);
      if (u) lines.push("Episode " + u.code + " — " + u.title + ": " + u.summary);
    }
    if (focus && focus.assetId && p && p.assets[focus.assetId]) {
      const a = p.assets[focus.assetId];
      lines.push("Selected " + a.kind + ": " + a.name + " (" + a.id + "). " + a.description + "\nIts image prompt: " + a.prompt);
    }
    if (focus && focus.shotId && p) {
      const f = PR().findShot(focus.shotId);
      if (f) lines.push("Selected shot " + f.shot.id + " — " + f.shot.title + " (" + f.shot.duration + " s).\nVideo prompt: " + (f.shot.finalPrompt || f.shot.videoPrompt));
    }
    if (focus && focus.itemId) {
      const it = lib(focus.itemId);
      if (it) lines.push("Selected " + (it.kind === "video" ? "video" : "picture") + ": " + label(it.id) + ". Its prompt: " + it.prompt);
    }
    if (focus && focus.idea) lines.push("The idea in the Create box: " + focus.idea);
    return lines.join("\n");
  }

  Studio.changes = { whereIs, label, preview, make, contextText, imageRefFor };
})();
