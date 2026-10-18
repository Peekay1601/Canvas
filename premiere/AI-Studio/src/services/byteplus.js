/*
 * BytePlus ModelArk: Seedream for pictures, Seedance for video.
 *   POST {BASE}/images/generations                -> { data: [{ url }] }       (synchronous)
 *   POST {BASE}/contents/generations/tasks        -> { id }                    (video, async)
 *   GET  {BASE}/contents/generations/tasks/{id}   -> { status, content: { video_url } }
 * Same request shapes as the Seedance Production connector this panel grew out of.
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const { requestJSON, sleep, ServiceError } = Studio.http;
  const NAME = "BytePlus";

  // Seedream 4.5 needs at least ~3.7 MP, so every shape is sized at "2K" or a little over.
  const SEEDREAM_SIZES = {
    "16:9": "2560x1440",
    "9:16": "1440x2560",
    "1:1": "2048x2048",
    "4:3": "2304x1728",
    "3:4": "1728x2304",
    "21:9": "3024x1296",
  };

  function cfg() {
    const s = Studio.store.settings;
    const key = Studio.store.secrets.ark;
    if (!key) throw new ServiceError(NAME, "Add your BytePlus API key in Settings first.");
    return { base: s.arkBaseUrl.replace(/\/+$/, ""), key, s };
  }

  function headers(key) {
    return { Authorization: "Bearer " + key, "Content-Type": "application/json" };
  }

  async function generateImage({ prompt, ratio, referenceImages, model, size }) {
    const { base, key, s } = cfg();
    const body = {
      model: model || s.seedreamModel,
      prompt,
      size: size || SEEDREAM_SIZES[ratio] || "2K",
      response_format: "url",
      watermark: false,
    };
    if (referenceImages && referenceImages.length) {
      body.image = referenceImages.length === 1 ? referenceImages[0] : referenceImages;
    }
    const data = await requestJSON(NAME, base + "/images/generations", {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify(body),
    });
    const first = (data.data || [])[0];
    if (!first || !first.url) throw new ServiceError(NAME, "BytePlus didn't return a picture.", JSON.stringify(data).slice(0, 800));
    return { url: first.url };
  }

  /** firstFrame: a data URL or https URL of the starting picture (optional). */
  /**
   * firstFrame: a picture the video starts from (data or https URL), optional.
   * references: [{ url }] reference images in @image1..N order: https/data URLs, or asset://<id> for registered faces.
   */
  async function generateVideo({ prompt, ratio, duration, resolution, audio, firstFrame, references, videoRefs, model }, onUpdate) {
    const { base, key, s } = cfg();
    const content = [{ type: "text", text: prompt }];
    if (firstFrame) content.push({ type: "image_url", image_url: { url: firstFrame }, role: "first_frame" });
    (references || []).forEach((r) => content.push({ type: "image_url", image_url: { url: r.url }, role: "reference_image" }));
    // Seedance 2.x multimodal reference: tagged videos go as @video1..N (hosted links only).
    (videoRefs || []).forEach((r) => content.push({ type: "video_url", video_url: { url: r.url }, role: "reference_video" }));
    const body = {
      model: model || s.seedanceModel,
      content,
      duration: Number(duration) || 5,
      resolution: resolution || "720p",
      ratio: ratio || "16:9",
      generate_audio: !!audio,
      watermark: false,
    };
    const created = await requestJSON(NAME, base + "/contents/generations/tasks", {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify(body),
    });
    if (!created.id) throw new ServiceError(NAME, "BytePlus didn't start the video.", JSON.stringify(created).slice(0, 800));
    onUpdate && onUpdate({ phase: "queued", taskId: created.id });

    for (let i = 0; i < 360; i++) {
      await sleep(i < 6 ? 5000 : 10000);
      const task = await requestJSON(NAME, base + "/contents/generations/tasks/" + created.id, { headers: headers(key) });
      const status = String(task.status || "").toLowerCase();
      if (status === "succeeded") {
        const url = task.content && task.content.video_url;
        if (!url) throw new ServiceError(NAME, "The video finished but no file came back.", JSON.stringify(task).slice(0, 800));
        return { url, taskId: created.id };
      }
      if (status === "failed" || status === "cancelled" || status === "expired") {
        const msg = (task.error && (task.error.message || task.error.code)) || status;
        const blocked = /sensitive|real person|policy/i.test(msg);
        throw new ServiceError(
          NAME,
          blocked ? "BytePlus blocked this video (it may look like a real person or break a content rule)." : "The video failed: " + msg,
          JSON.stringify(task).slice(0, 1500)
        );
      }
      onUpdate && onUpdate({ phase: status === "running" ? "running" : "queued", taskId: created.id });
    }
    throw new ServiceError(NAME, "This video is taking unusually long. It may still finish on BytePlus.");
  }

  // ModelArk keys only work in the region they were made in: BytePlus (Southeast Asia) or Volcengine (China).
  const ARK_BASES = ["https://ark.ap-southeast.bytepluses.com/api/v3", "https://ark.cn-beijing.volces.com/api/v3"];

  /**
   * Cheap key check: listing tasks costs nothing; a bad key comes back 401. If the saved address refuses
   * the key, the other region is tried and kept when it works.
   */
  async function test() {
    const { base, key } = cfg();
    const fp = Studio.store.fingerprint(key);
    if (/^AK[A-Z]{2}/.test(key))
      throw new ServiceError(NAME, "That's an Access Key ID (" + key.slice(0, 4) + "…), not a ModelArk API key. Put it under Character faces below, and paste the key from ModelArk → API keys here.", fp);
    if (/^sk-ant-/.test(key)) throw new ServiceError(NAME, "That's a Claude key. Paste it in the Claude card, and the ModelArk API key here.", fp);
    const bases = [base].concat(ARK_BASES.filter((b) => b !== base));
    let last = null;
    for (const b of bases) {
      let resp;
      try {
        resp = await fetch(b + "/contents/generations/tasks?page_size=1", { headers: headers(key) });
      } catch (e) {
        last = last || { status: 0, text: String(e) };
        continue;
      }
      const text = await resp.text();
      if (resp.status !== 401 && resp.status !== 403) {
        if (b !== base) Studio.store.saveSettings({ arkBaseUrl: b });
        if (resp.ok || resp.status === 404 || resp.status === 400) return true;
        throw new ServiceError(NAME, "BytePlus accepted the key but answered with an error (" + resp.status + ").", text.slice(0, 300));
      }
      last = { status: resp.status, text };
    }
    if (!last || last.status === 0) throw new ServiceError(NAME, "Couldn't reach BytePlus. Check your internet connection.", last && last.text);
    throw new ServiceError(
      NAME,
      "BytePlus didn't accept this key in either region. Copy it again from ModelArk → API keys (the key itself, not its name), and check it isn't disabled. Saved key: " + fp + ".",
      "HTTP " + last.status + ": " + String(last.text || "").slice(0, 300)
    );
  }

  Studio.byteplus = { generateImage, generateVideo, test, SEEDREAM_SIZES };
})();
