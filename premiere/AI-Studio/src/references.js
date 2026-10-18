/*
 * Reference images: every character, costume, location and prop collects candidate images
 * (generated, from disk or from the Library). Locking one makes it THE reference and uploads it
 * automatically:
 *   - faces (characters, and costumes shown worn) are registered in BytePlus's private portrait
 *     library when an Access Key is set, so Seedance accepts them; shots then use asset://<id>
 *   - everything else is sent with each shot (by link while fresh, otherwise as the image itself)
 * "Change" unlocks it: pick or make another image and lock again; the old portrait is kept on a
 * cleanup list instead of being deleted.
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const PR = () => Studio.production;
  const S = () => Studio.store;
  const PT = () => Studio.portraits;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function lib(id) {
    return id ? S().library.find((x) => x.id === id) : null;
  }

  function project() {
    return PR().project;
  }

  function isFace(a) {
    return a.kind === "character" ? a.hasFace !== false : a.kind === "costume" ? !!a.hasFace : false;
  }

  /** Bring old projects (one image per asset) up to the candidates/lock model. */
  function migrate(a) {
    if (!a.candidates) a.candidates = a.imageId ? [a.imageId] : [];
    if (a.lockedId === undefined) a.lockedId = null;
    if (!a.ref) a.ref = { status: "none" };
    if (a.hasFace === undefined) a.hasFace = a.kind === "character";
    return a;
  }

  function addCandidate(assetId, itemId, autoLock) {
    const a = migrate(project().assets[assetId]);
    a.candidates = [itemId].concat(a.candidates.filter((x) => x !== itemId));
    a.imageId = itemId;
    PR().save();
    if (autoLock && !a.lockedId) return lock(assetId, itemId);
    return Promise.resolve();
  }

  /** "Use my own image": from disk into the Library, then as a candidate. */
  async function addFromDisk(assetId) {
    const file = await Studio.platform.pickImage();
    if (!file) return null;
    const id = "own-" + Date.now().toString(36);
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const saved = await Studio.platform.saveMedia(id + "." + ext, file.buffer);
    const a = project().assets[assetId];
    const item = {
      id,
      kind: "image",
      engine: "own",
      engineLabel: "Your image",
      prompt: a.name + " — " + file.name,
      src: saved.src,
      path: saved.path,
      fileName: saved.fileName,
      remoteUrl: "",
      createdAt: Date.now(),
      imported: false,
    };
    S().addToLibrary(item);
    await addCandidate(assetId, id, false);
    return item;
  }

  // ---------- lock / change ----------

  async function lock(assetId, itemId) {
    const a = migrate(project().assets[assetId]);
    const item = lib(itemId || a.candidates[0]);
    if (!item) throw new Error("Make or choose an image for " + a.name + " first.");
    if (a.ref && a.ref.assetId && a.lockedId !== item.id) retire(a);
    a.lockedId = item.id;
    a.imageId = item.id;
    a.lockedAt = Date.now();
    a.ref = { status: "uploading" };
    PR().save();
    try {
      await upload(a, item);
    } catch (e) {
      a.ref = { status: "failed", error: e.message };
      PR().save();
      throw e;
    }
  }

  function unlock(assetId) {
    const a = migrate(project().assets[assetId]);
    retire(a);
    a.lockedId = null;
    a.ref = { status: "none" };
    PR().save();
  }

  function retire(a) {
    if (!a.ref || !a.ref.assetId) return;
    const p = project();
    p.retiredPortraits = (p.retiredPortraits || []).concat([{ assetId: a.ref.assetId, subject: a.id, at: Date.now() }]);
  }

  function setHasFace(assetId, value) {
    const a = migrate(project().assets[assetId]);
    a.hasFace = !!value;
    PR().save();
    if (a.lockedId) lock(assetId, a.lockedId).catch(() => {});
  }

  // ---------- upload ----------

  /** A link BytePlus can fetch: the image's own generation link while fresh, else a private-bucket copy. */
  async function fetchableUrl(item, sha) {
    const fresh = item.remoteUrl && /^https:/.test(item.remoteUrl) && Date.now() - (item.createdAt || 0) < 12 * 3600e3;
    if (fresh) return { url: item.remoteUrl, tosKey: null };
    const pic = await Studio.jobs.pictureInput(item);
    const { key, url } = await PT().stash(pic.buffer, pic.mime, sha);
    return { url, tosKey: key };
  }

  let createChain = Promise.resolve();
  let lastCreate = 0;

  async function upload(a, item) {
    const pic = await Studio.jobs.pictureInput(item);
    const sha = Studio.crypto.sha256Hex(new Uint8Array(pic.buffer));
    const p = project();

    if (!isFace(a) || !PT().enabled()) {
      a.ref = {
        status: "ready",
        sha,
        note: isFace(a) ? "Sent with each shot. Add a BytePlus Access Key in Settings so faces aren't blocked as real people." : "Sent with each shot.",
      };
      PR().save();
      return;
    }

    // Same image already registered for this character: reuse it, no quota used.
    p.portraits = p.portraits || {};
    const subject = a.kind === "costume" && a.characterId ? a.characterId : a.id;
    const twin = p.portraits[sha + ":" + subject];
    if (twin && twin.status === "active") {
      a.ref = { status: "active", sha, assetId: twin.assetId, groupId: twin.groupId };
      PR().save();
      return;
    }
    const used = Object.values(p.portraits).filter((x) => x.status === "active" || x.status === "processing").length + (p.retiredPortraits || []).length;
    if (used >= PT().cfg().limit) {
      throw new Error("The portrait library is full (" + PT().cfg().limit + "). Remove unused portraits in Settings.");
    }

    a.ref = { status: "uploading", sha };
    PR().save();
    // BytePlus allows about 3 new portraits a minute on the Entry tier: one at a time, spaced out.
    const mine = createChain.then(async () => {
      const wait = 20000 - (Date.now() - lastCreate);
      if (wait > 0) await sleep(wait);
      const groupId = await PT().groupFor(p.title, subject);
      const { url, tosKey } = await fetchableUrl(item, sha);
      lastCreate = Date.now();
      const assetId = await PT().createAsset(groupId, url, subject + " " + item.id);
      return { groupId, assetId, tosKey };
    });
    createChain = mine.catch(() => {});
    const { groupId, assetId, tosKey } = await mine;
    a.ref = { status: "processing", sha, assetId, groupId, tosKey };
    p.portraits[sha + ":" + subject] = { assetId, groupId, status: "processing" };
    PR().save();
    watch(a.id);
  }

  // ---------- polling registrations until BytePlus has decided ----------

  const watching = {};

  async function watch(assetId) {
    if (watching[assetId]) return;
    watching[assetId] = true;
    try {
      for (let i = 0; i < 240; i++) {
        await sleep(i < 4 ? 8000 : 15000);
        const p = project();
        const a = p && p.assets[assetId];
        if (!a || !a.ref || a.ref.status !== "processing") return;
        let res;
        try {
          res = await PT().getAsset(a.ref.assetId);
        } catch (e) {
          continue; // network hiccup: keep checking
        }
        if (res.status === "processing") continue;
        a.ref.status = res.status;
        a.ref.error = res.reason || "";
        const subject = a.kind === "costume" && a.characterId ? a.characterId : a.id;
        if (p.portraits && p.portraits[a.ref.sha + ":" + subject]) p.portraits[a.ref.sha + ":" + subject].status = res.status;
        if (a.ref.tosKey) PT().unstash(a.ref.tosKey);
        PR().save();
        Studio.kit && Studio.kit.toast(res.status === "active" ? a.name + "'s face is approved by BytePlus." : "BytePlus refused " + a.name + "'s image: " + (res.reason || "no reason given") + ". Choose another.", res.status === "active" ? "ok" : "error");
        return;
      }
    } finally {
      delete watching[assetId];
    }
  }

  /** After reopening the panel, carry on checking anything still being processed. */
  function resume() {
    const p = project();
    if (!p) return;
    Object.values(p.assets).forEach((a) => {
      migrate(a);
      if (a.ref.status === "processing") watch(a.id);
      if (a.ref.status === "uploading") a.ref = { status: "failed", error: "The upload was interrupted. Lock it again." };
    });
  }

  // ---------- what a shot sends ----------

  /** Ready = locked, and (for registered faces) Active. */
  function refState(a) {
    if (!a) return "missing";
    migrate(a);
    if (!a.lockedId || !lib(a.lockedId)) return "unlocked";
    if (a.ref.status === "active" || a.ref.status === "ready") return "ready";
    if (a.ref.status === "failed") return "failed";
    return "waiting";
  }

  /** Reference entries for Seedance, in handle order. */
  async function shotReferences(handles) {
    const out = [];
    for (const h of handles) {
      if (h.handle.indexOf("@image") !== 0) continue; // reference videos go separately
      if (h.itemId) {
        out.push({ url: await Studio.jobs.pictureRef(lib(h.itemId)) });
        continue;
      }
      const a = project().assets[h.assetId];
      if (a.ref.status === "active" && a.ref.assetId) out.push({ url: "asset://" + a.ref.assetId });
      else out.push({ url: await Studio.jobs.pictureRef(lib(a.lockedId)) });
    }
    return out;
  }

  // ---------- cleanup ----------

  function unusedPortraits() {
    const p = project();
    if (!p) return [];
    const inUse = {};
    Object.values(p.assets).forEach((a) => a.ref && a.ref.assetId && (inUse[a.ref.assetId] = 1));
    return (p.retiredPortraits || []).filter((r) => !inUse[r.assetId]);
  }

  async function cleanup() {
    const p = project();
    const list = unusedPortraits();
    let removed = 0;
    for (const r of list) {
      try {
        await PT().deleteAsset(r.assetId);
        removed++;
      } catch (e) {
        /* leave it on the list */
        continue;
      }
      p.retiredPortraits = p.retiredPortraits.filter((x) => x.assetId !== r.assetId);
      Object.keys(p.portraits || {}).forEach((k) => p.portraits[k].assetId === r.assetId && delete p.portraits[k]);
    }
    PR().save();
    return removed;
  }

  Studio.references = { migrate, addCandidate, addFromDisk, lock, unlock, setHasFace, refState, shotReferences, isFace, unusedPortraits, cleanup, resume, watch };
})();
