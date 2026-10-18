/*
 * Runs generations on whichever engine was picked, tracks their progress, downloads the result
 * into the panel's media folder and adds it to the library.
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const P = () => Studio.platform;
  const S = () => Studio.store;

  const listeners = [];
  const jobs = [];
  let seq = 0;

  function emit() {
    listeners.forEach((fn) => {
      try {
        fn(jobs);
      } catch (e) {
        console.error(e);
      }
    });
  }

  function newId(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + (++seq).toString(36);
  }

  function engineLabel(kind, engine, model) {
    if (engine === "byteplus") {
      const PRC = Studio.pricing;
      const list = kind === "image" ? PRC.IMAGE_MODELS.byteplus : PRC.VIDEO_MODELS.byteplus;
      const id = model || (kind === "image" ? S().settings.seedreamModel : S().settings.seedanceModel);
      const found = list.find((m) => m.id === id);
      return (found ? found.label : id) + " · BytePlus";
    }
    const list = kind === "image" ? S().HIGGSFIELD_IMAGE_MODELS : S().HIGGSFIELD_VIDEO_MODELS;
    const id = model || (kind === "image" ? S().settings.higgsfieldImageModel : S().settings.higgsfieldVideoModel);
    const found = list.find((m) => m.id === id);
    return (found ? found.label : id.split("/").slice(-2).join(" ")) + " · Higgsfield";
  }

  /** Get bytes + data URL for a picture that's in the library or was picked from disk. */
  async function pictureInput(pic) {
    if (pic.buffer) {
      return { buffer: pic.buffer, mime: pic.mime, dataUrl: pic.dataUrl || "data:" + pic.mime + ";base64," + P().toBase64(pic.buffer) };
    }
    let buffer;
    if (P().isUXP && pic.fileName) buffer = await P().readMedia(pic.fileName);
    else buffer = await Studio.http.download(pic.src || pic.remoteUrl);
    const mime = P().mimeFor(pic.fileName || "x.png");
    return { buffer, mime, dataUrl: "data:" + mime + ";base64," + P().toBase64(buffer) };
  }

  async function finish(job, url) {
    job.phase = "saving";
    emit();
    const buffer = await Studio.http.download(url);
    const ext = job.kind === "video" ? "mp4" : /^data:image\/svg/.test(url) ? "svg" : /\.jpe?g(\?|$)/i.test(url) ? "jpg" : /\.webp(\?|$)/i.test(url) ? "webp" : "png";
    // Files are kept in folders: <project>/<episode>/<Characters|Costumes|Locations|Props|Shots>/…
    const src = job.source || {};
    const folder = src.folder || (job.kind === "image" ? "Create/Pictures" : "Create/Videos");
    const saved = await P().saveMedia(folder + "/" + (src.name || job.id) + "." + ext, buffer);
    const item = {
      id: job.id,
      kind: job.kind,
      engine: job.engine,
      engineLabel: job.engineLabel,
      prompt: job.prompt,
      ratio: job.ratio,
      duration: job.duration,
      remoteUrl: url,
      src: saved.src,
      path: saved.path,
      fileName: saved.fileName,
      poster: job.thumb && job.thumb.indexOf("data:") !== 0 ? job.thumb : "",
      folder,
      model: job.model,
      resolution: job.resolution,
      cost: job.est || null,
      project: src.project || "",
      unit: src.unit || "",
      createdAt: Date.now(),
      imported: false,
    };
    S().addToLibrary(item);
    if (job.est) {
      Studio.pricing.record({ service: job.engine === "byteplus" ? "BytePlus" : "Higgsfield", model: job.model, kind: job.kind, usd: job.est.usd, credits: job.est.credits || 0, project: src.project || "", unit: src.unit || "" });
    }
    if (S().settings.autoImport && P().hasPremiere && item.path) {
      try {
        await P().importToPremiere([item.path], S().settings.binName + "/" + folder);
        S().updateLibrary(item.id, { imported: true });
      } catch (e) {
        console.warn(e);
      }
    }
    return item;
  }

  async function run(job, work) {
    jobs.unshift(job);
    emit();
    try {
      const result = await work((u) => {
        job.phase = u.phase || job.phase;
        emit();
      });
      const item = await finish(job, result.url);
      job.status = "done";
      job.itemId = item.id;
      emit();
      return item;
    } catch (e) {
      job.status = "error";
      job.error = e.message || String(e);
      job.errorDetail = e.detail || "";
      emit();
      throw e;
    }
  }

  /** A picture as Seedream wants it: its service link while fresh (small request), else the bytes. */
  async function pictureRef(pic) {
    const fresh = pic.remoteUrl && Date.now() - (pic.createdAt || 0) < 12 * 3600e3;
    return fresh ? pic.remoteUrl : (await pictureInput(pic)).dataUrl;
  }

  function createImage({ prompt, engine, ratio, model, imageRes, reference, references, source }) {
    model = model || (engine === "byteplus" ? S().settings.seedreamModel : S().settings.higgsfieldImageModel);
    imageRes = imageRes || S().settings.imageRes || "2K";
    const job = {
      id: newId("img"),
      kind: "image",
      engine,
      engineLabel: engineLabel("image", engine, model),
      model,
      resolution: imageRes,
      est: Studio.pricing.imagePrice(engine, model),
      prompt,
      ratio,
      status: "working",
      phase: "queued",
      startedAt: Date.now(),
      source: source || null,
    };
    return run(job, async (update) => {
      if (engine === "byteplus") {
        update({ phase: "running" });
        const pics = (references || []).concat(reference ? [reference] : []).slice(0, 6);
        const refs = [];
        for (const pic of pics) refs.push(await pictureRef(pic));
        return Studio.byteplus.generateImage({ prompt, ratio, referenceImages: refs, model, size: Studio.pricing.seedreamSize(ratio, imageRes) });
      }
      return Studio.higgsfield.generateImage({ prompt, ratio, model }, update);
    });
  }

  function createVideo({ prompt, engine, ratio, duration, resolution, audio, startImage, references, videoRefs, model, source }) {
    model = model || (engine === "byteplus" ? S().settings.seedanceModel : S().settings.higgsfieldVideoModel);
    const job = {
      id: newId("vid"),
      kind: "video",
      engine,
      engineLabel: engineLabel("video", engine, model),
      model,
      resolution,
      est: Studio.pricing.videoPrice(engine, model, duration, resolution, ratio),
      prompt,
      ratio,
      duration,
      status: "working",
      phase: "queued",
      startedAt: Date.now(),
      thumb: startImage ? startImage.src || startImage.dataUrl : (source && source.poster) || "",
      source: source || null,
    };
    return run(job, async (update) => {
      if (engine === "byteplus") {
        const first = startImage ? (await pictureInput(startImage)).dataUrl : null;
        const refs = references ? await references() : null; // resolved late, so links are fresh
        const vrefs = videoRefs ? await videoRefs() : null;
        return Studio.byteplus.generateVideo({ prompt, ratio, duration, resolution, audio, firstFrame: first, references: refs, videoRefs: vrefs, model }, update);
      }
      let imageUrl = startImage && startImage.remoteUrl && Date.now() - (startImage.createdAt || 0) < 12 * 3600e3 ? startImage.remoteUrl : "";
      if (startImage && !imageUrl) {
        update({ phase: "uploading" });
        const pic = await pictureInput(startImage);
        imageUrl = await Studio.higgsfield.uploadImage(pic.buffer, pic.mime);
      }
      return Studio.higgsfield.generateVideo({ prompt, duration, imageUrl, model }, update);
    });
  }

  function dismiss(id) {
    const i = jobs.findIndex((j) => j.id === id);
    if (i >= 0) jobs.splice(i, 1);
    emit();
  }

  Studio.jobs = {
    list: jobs,
    onChange: (fn) => listeners.push(fn),
    createImage,
    createVideo,
    dismiss,
    engineLabel,
    pictureInput,
    pictureRef,
  };
})();
