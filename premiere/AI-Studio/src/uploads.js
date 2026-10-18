/*
 * Your own files: upload images and videos straight into the project, then tag them with the same
 * choices as the Seedance Production connector:
 *   images → Character / Costume / Location / Prop (main image or extra angle, which episode, human face)
 *            or a shot's Reference image / First frame / Last frame
 *   videos → tagged for BytePlus as a reference (motion, camera move, style & look, performance) on a shot,
 *            sent to Seedance as @video1… (Seedance 2.x multimodal reference)
 * Tagged files are filed into <project>/<episode>/<type>/ like everything else.
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const P = () => Studio.platform;
  const S = () => Studio.store;
  const PR = () => Studio.production;

  const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];
  const VIDEO_EXTS = ["mp4", "mov", "m4v", "webm"];

  // Dropdown choices (connector wording).
  const IMAGE_USES = [
    { id: "", label: "Not tagged yet" },
    { id: "character", label: "Character" },
    { id: "costume", label: "Costume" },
    { id: "location", label: "Location" },
    { id: "prop", label: "Prop" },
    { id: "shot", label: "Shot image" },
  ];
  const IMAGE_SLOTS = [
    { id: "main", label: "Main image (lock & upload)" },
    { id: "extra", label: "Extra angle" },
  ];
  const SHOT_ROLES = [
    { id: "reference_image", label: "Reference image" },
    { id: "first_frame", label: "First frame" },
    { id: "last_frame", label: "Last frame" },
  ];
  const VIDEO_TAGS = [
    { id: "", label: "Not a reference" },
    { id: "motion", label: "Motion reference", hint: "copy the movement / action" },
    { id: "camera", label: "Camera-move reference", hint: "copy the camera move" },
    { id: "style", label: "Style & look reference", hint: "copy the look, grade and texture" },
    { id: "performance", label: "Acting / performance reference", hint: "copy the performance and timing" },
  ];
  const TRANSITIONS = ["CUT", "CONTINUATION", "NEW_SCENE", "INSERT", "ESTABLISHING"];

  function lib(id) {
    return id ? S().library.find((x) => x.id === id) : null;
  }

  function projectFolder() {
    return PR().project ? PR().projectFolder() : "Uploads";
  }

  // ---------- upload ----------

  async function upload(kind) {
    const files = await P().pickFiles(kind === "video" ? VIDEO_EXTS : IMAGE_EXTS);
    const items = [];
    for (const f of files) {
      const id = "up-" + Date.now().toString(36) + "-" + items.length;
      const safe = f.name.replace(/[^\w.\- ]+/g, "_");
      const folder = projectFolder() + "/Uploads/Inbox";
      const saved = await P().saveMedia(folder + "/" + safe, f.buffer);
      const item = {
        id,
        kind,
        origin: "upload",
        engine: "own",
        engineLabel: "Uploaded",
        name: f.name,
        prompt: f.name,
        src: saved.src,
        path: saved.path,
        fileName: saved.fileName,
        folder,
        bytes: f.buffer.byteLength,
        remoteUrl: "",
        project: PR().project ? PR().project.id : "",
        tags: {},
        createdAt: Date.now(),
        imported: false,
      };
      S().addToLibrary(item);
      items.push(item);
    }
    return items;
  }

  /** Move a file into its tagged folder (copy, then remove the inbox copy). */
  async function refile(item, folder, base) {
    if (item.folder === folder) return;
    const ext = (item.fileName.split(".").pop() || (item.kind === "video" ? "mp4" : "png")).toLowerCase();
    let buffer;
    if (P().isUXP) buffer = await P().readMedia(item.fileName);
    else buffer = await Studio.http.download(item.src);
    const saved = await P().saveMedia(folder + "/" + base + "." + ext, buffer);
    const old = item.fileName;
    S().updateLibrary(item.id, { folder, fileName: saved.fileName, path: saved.path, src: saved.src });
    if (old !== saved.fileName) P().deleteMedia(old);
  }

  // ---------- tagging ----------

  /**
   * tags for images: { use, unit, assetId, newId, newName, slot, hasFace, shotId, role }
   * tags for videos: { use (VIDEO_TAGS id), unit, shotId, note }
   */
  async function applyTags(itemId, tags) {
    const item = lib(itemId);
    const p = PR().project;
    if (!item) throw new Error("That file is no longer in your Library.");
    if (!p && tags.use) throw new Error("Open a project in the Script tab first, so there's somewhere to tag it to.");
    untag(item);
    if (item.kind === "video") await tagVideo(item, tags);
    else await tagImage(item, tags);
    S().updateLibrary(item.id, { tags: Object.assign({}, tags) });
    PR().save();
  }

  async function tagImage(item, t) {
    const p = PR().project;
    if (!t.use) return;
    if (t.use === "shot") {
      const f = PR().findShot(t.shotId);
      if (!f) throw new Error("Choose which shot this image is for.");
      await refile(item, PR().projectFolder() + "/" + f.unit.code + "/Shots", f.shot.id + "_" + t.role);
      if (t.role === "first_frame") f.shot.frameId = item.id;
      else if (t.role === "last_frame") f.shot.lastFrameId = item.id;
      else {
        f.shot.imageRefs = (f.shot.imageRefs || []).filter((x) => x !== item.id).concat([item.id]);
        f.shot.finalPrompt = f.shot.finalPrompt; // handles are refreshed on the next "Write final prompt"
      }
      return;
    }
    // An asset: existing or new.
    let id = t.assetId;
    if (!id || id === "__new") {
      id = String(t.newId || t.newName || "")
        .trim()
        .toUpperCase()
        .replace(/[\s\-]+/g, "_")
        .replace(/[^A-Z0-9_]/g, "");
      if (!id) throw new Error("Give the new " + t.use + " a name.");
      if (!p.assets[id]) {
        p.assets[id] = {
          id,
          kind: t.use,
          name: t.newName || id,
          description: "",
          prompt: "",
          unit: t.unit || "",
          hasFace: t.use === "character" ? t.hasFace !== false : !!t.hasFace,
          characterId: "",
          imageId: null,
          candidates: [],
          lockedId: null,
          ref: { status: "none" },
        };
      }
      const unit = p.units.find((u) => u.code === t.unit);
      if (unit && unit.assetIds.indexOf(id) < 0) unit.assetIds.push(id);
    }
    const a = p.assets[id];
    if (!a) throw new Error("Choose which " + t.use + " this is.");
    if (t.hasFace !== undefined && (a.kind === "character" || a.kind === "costume") && !a.lockedId) a.hasFace = !!t.hasFace;
    Studio.references.migrate(a);
    await refile(item, PR().assetFolder(a), a.id + (t.slot === "extra" ? "_angle" + (a.candidates.length + 1) : "_main"));
    await Studio.references.addCandidate(a.id, item.id, false);
    if (t.slot !== "extra") await Studio.references.lock(a.id, item.id);
  }

  async function tagVideo(item, t) {
    if (!t.use) return;
    const f = t.shotId ? PR().findShot(t.shotId) : null;
    const unit = f ? f.unit.code : t.unit || "Shared";
    const tagLabel = (VIDEO_TAGS.find((x) => x.id === t.use) || {}).label || "Reference";
    await refile(item, PR().projectFolder() + "/" + unit + "/Uploads/Reference videos", (f ? f.shot.id + "_" : "") + t.use + "_" + item.id.slice(-4));
    if (f) {
      const others = (f.shot.videoRefs || []).filter((r) => r.itemId !== item.id);
      if (others.length >= 3) throw new Error("Seedance takes up to 3 reference videos per shot. Remove one from " + f.shot.id + " first.");
      f.shot.videoRefs = others.concat([{ itemId: item.id, tag: t.use, label: tagLabel, note: t.note || "" }]);
    }
  }

  /** Remove an item's previous tag from shots before applying a new one. */
  function untag(item) {
    const p = PR().project;
    if (!p) return;
    p.units.forEach((u) =>
      u.shots.forEach((s) => {
        if (s.videoRefs) s.videoRefs = s.videoRefs.filter((r) => r.itemId !== item.id);
        if (s.imageRefs) s.imageRefs = s.imageRefs.filter((x) => x !== item.id);
        if (s.lastFrameId === item.id) s.lastFrameId = null;
      })
    );
  }

  // ---------- sending reference videos to Seedance ----------

  /** Hosted links for a shot's tagged videos (Seedance fetches videos by URL). */
  async function videoRefUrls(shot) {
    const out = [];
    for (const r of shot.videoRefs || []) {
      const item = lib(r.itemId);
      if (!item) continue;
      if (item.hostedUrl && Date.now() - (item.hostedAt || 0) < 20 * 3600e3) {
        out.push({ url: item.hostedUrl });
        continue;
      }
      let buffer;
      if (P().isUXP) buffer = await P().readMedia(item.fileName);
      else buffer = await Studio.http.download(item.src);
      if (buffer.byteLength > 50e6) throw new Error(item.name + " is over 50 MB. Trim it to a few seconds for a reference.");
      const mime = P().mimeFor(item.fileName);
      let url;
      if (Studio.portraits.enabled()) {
        const sha = Studio.crypto.sha256Hex(new Uint8Array(buffer));
        url = (await Studio.portraits.stash(buffer, mime, sha, 24 * 3600)).url;
      } else if (S().has("higgsfield")) {
        url = await Studio.higgsfield.uploadImage(buffer, mime);
      } else {
        throw new Error("To send reference videos to Seedance, add a BytePlus Access Key (Settings → Character faces) or connect Higgsfield, so the video can be hosted.");
      }
      S().updateLibrary(item.id, { hostedUrl: url, hostedAt: Date.now() });
      out.push({ url });
    }
    return out;
  }

  function uploads() {
    return S().library.filter((x) => x.origin === "upload");
  }

  function tagSummary(item) {
    const t = item.tags || {};
    if (!t.use) return "";
    const p = PR().project;
    if (item.kind === "video") {
      const tag = (VIDEO_TAGS.find((x) => x.id === t.use) || {}).label || t.use;
      const f = t.shotId && p ? PR().findShot(t.shotId) : null;
      const handle = f && f.shot.videoRefs ? "@video" + (f.shot.videoRefs.findIndex((r) => r.itemId === item.id) + 1) : "";
      return tag + (f ? " · " + f.shot.id + (handle ? " · " + handle : "") : " · " + (t.unit || "Shared"));
    }
    if (t.use === "shot") return (SHOT_ROLES.find((r) => r.id === t.role) || {}).label + " · " + t.shotId;
    const a = p && p.assets[t.assetId && t.assetId !== "__new" ? t.assetId : String(t.newId || t.newName || "").toUpperCase().replace(/[\s\-]+/g, "_").replace(/[^A-Z0-9_]/g, "")];
    return (IMAGE_USES.find((u) => u.id === t.use) || {}).label + (a ? " · " + a.name : "") + " · " + (t.slot === "extra" ? "Extra angle" : "Main (locked)");
  }

  Studio.uploads = { upload, applyTags, videoRefUrls, uploads, tagSummary, IMAGE_USES, IMAGE_SLOTS, SHOT_ROLES, VIDEO_TAGS, TRANSITIONS, IMAGE_EXTS, VIDEO_EXTS };
})();
