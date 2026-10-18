/*
 * Higgsfield Cloud. Every model is its own endpoint:
 *   POST {BASE}/{model_id}                 -> { request_id, status }
 *   GET  {BASE}/requests/{id}/status       -> { status: queued|in_progress|completed|failed|nsfw|canceled, images|video }
 *   POST {BASE}/files/generate-upload-url  -> { public_url, upload_url }  then PUT the bytes to upload_url
 * Auth: "Authorization: Key <api key>:<api secret>" (from the official higgsfield-client SDK).
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const { requestJSON, sleep, findMediaUrl, ServiceError } = Studio.http;
  const NAME = "Higgsfield";

  // The official SDK talks to api.higgsfield.ai; the docs also show platform.higgsfield.ai.
  const BASES = ["https://api.higgsfield.ai", "https://platform.higgsfield.ai"];

  /**
   * "KEY_ID:KEY_SECRET". Higgsfield Cloud often shows the credential as one string, so if either
   * field already contains "id:secret", that string is used as it is.
   */
  function credential() {
    const key = (Studio.store.secrets.higgsfieldKey || "").trim();
    const secret = (Studio.store.secrets.higgsfieldSecret || "").trim();
    if (key.indexOf(":") > 0) return key;
    if (secret.indexOf(":") > 0) return secret;
    if (key && secret) return key + ":" + secret;
    return "";
  }

  /**
   * The two ways Higgsfield takes credentials: "Authorization: Key id:secret" (Cloud API and its SDK) or
   * hf-api-key / hf-secret headers (the platform API). Save & check finds the one this account uses.
   */
  function authFor(style, cred) {
    if (style === "hf") {
      const i = cred.indexOf(":");
      return { "hf-api-key": cred.slice(0, i), "hf-secret": cred.slice(i + 1) };
    }
    return { Authorization: "Key " + cred };
  }

  function cfg() {
    const cred = credential();
    if (!cred) throw new ServiceError(NAME, "Add your Higgsfield key and secret in Settings first (or the combined KEY_ID:KEY_SECRET in the first box).");
    const s = Studio.store.settings;
    return { base: (s.higgsfieldBaseUrl || BASES[0]).replace(/\/+$/, ""), auth: authFor(s.higgsfieldAuth || "key", cred), cred };
  }

  function headers(auth) {
    return Object.assign({ "Content-Type": "application/json" }, auth);
  }

  function parseExtra(text) {
    if (!text || !text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new ServiceError(NAME, "The extra Higgsfield settings in Settings → Advanced aren't valid JSON.");
    }
  }

  /** Upload a local picture so video models can start from it. Returns a public URL. */
  async function uploadImage(buffer, mime) {
    const { base, auth } = cfg();
    const info = await requestJSON(NAME, base + "/files/generate-upload-url", {
      method: "POST",
      headers: headers(auth),
      body: JSON.stringify({ content_type: mime || "image/png" }),
    });
    if (!info.upload_url || !info.public_url) throw new ServiceError(NAME, "Higgsfield didn't give an upload link.", JSON.stringify(info));
    let put;
    try {
      put = await fetch(info.upload_url, { method: "PUT", headers: { "Content-Type": mime || "image/png" }, body: buffer });
    } catch (e) {
      throw new ServiceError(NAME, "Uploading the picture to Higgsfield failed.", String(e));
    }
    if (!put.ok) throw new ServiceError(NAME, "Uploading the picture to Higgsfield failed (" + put.status + ").");
    return info.public_url;
  }

  async function run(modelId, args, kind, onUpdate) {
    const { base, auth } = cfg();
    const submitted = await requestJSON(NAME, base + "/" + modelId.replace(/^\/+/, ""), {
      method: "POST",
      headers: headers(auth),
      body: JSON.stringify(args),
    });
    const id = submitted.request_id || submitted.id;
    if (!id) throw new ServiceError(NAME, "Higgsfield didn't start the job.", JSON.stringify(submitted).slice(0, 800));
    onUpdate && onUpdate({ phase: "queued", taskId: id });

    for (let i = 0; i < 400; i++) {
      await sleep(i < 10 ? 3000 : 8000);
      const st = await requestJSON(NAME, base + "/requests/" + id + "/status", { headers: headers(auth) });
      const status = String(st.status || "").toLowerCase();
      if (status === "completed") {
        const url = findMediaUrl(st, kind);
        if (!url) throw new ServiceError(NAME, "The job finished but no file came back.", JSON.stringify(st).slice(0, 1500));
        return { url, taskId: id };
      }
      if (status === "nsfw") throw new ServiceError(NAME, "Higgsfield blocked this result for safety reasons. Try rewording it.");
      if (status === "failed" || status === "canceled" || status === "cancelled")
        throw new ServiceError(NAME, "Higgsfield couldn't finish this one (" + status + ").", JSON.stringify(st).slice(0, 1500));
      onUpdate && onUpdate({ phase: status === "in_progress" ? "running" : "queued", taskId: id });
    }
    throw new ServiceError(NAME, "This is taking unusually long. It may still finish on Higgsfield.");
  }

  async function generateImage({ prompt, ratio, model }, onUpdate) {
    const s = Studio.store.settings;
    const modelId = model || s.higgsfieldImageModel;
    const args = Object.assign({ prompt, aspect_ratio: ratio || "16:9" }, parseExtra(s.higgsfieldImageExtra));
    return run(modelId, args, "image", onUpdate);
  }

  async function generateVideo({ prompt, duration, imageUrl, model }, onUpdate) {
    const s = Studio.store.settings;
    const modelId = model || s.higgsfieldVideoModel;
    if (!imageUrl) throw new ServiceError(NAME, "Higgsfield video models start from a picture. Add a starting picture first.");
    const args = Object.assign({ prompt, image_url: imageUrl, duration: Number(duration) || 5 }, parseExtra(s.higgsfieldVideoExtra));
    return run(modelId, args, "video", onUpdate);
  }

  /**
   * Key check that costs nothing: ask for an upload link (no file is uploaded, nothing is generated).
   * If the saved address refuses, the other known address is tried and kept if it works.
   */
  async function test() {
    const { cred } = cfg();
    const s = Studio.store.settings;
    const saved = (s.higgsfieldBaseUrl || BASES[0]).replace(/\/+$/, "");
    const bases = [saved].concat(BASES.filter((b) => b !== saved));
    const styles = [s.higgsfieldAuth || "key"].concat(["key", "hf"].filter((x) => x !== (s.higgsfieldAuth || "key")));
    let last = null;
    for (const base of bases) {
      for (const style of styles) {
        let resp;
        try {
          resp = await fetch(base + "/files/generate-upload-url", {
            method: "POST",
            headers: headers(authFor(style, cred)),
            body: JSON.stringify({ content_type: "image/png" }),
          });
        } catch (e) {
          last = last || { status: 0, text: String(e) };
          break; // this address can't be reached at all; try the next one
        }
        const text = await resp.text();
        if (resp.ok) {
          if (base !== saved || style !== (s.higgsfieldAuth || "key")) Studio.store.saveSettings({ higgsfieldBaseUrl: base, higgsfieldAuth: style });
          return true;
        }
        if (!last || last.status === 0 || resp.status === 401 || resp.status === 403) last = { status: resp.status, text };
      }
    }
    if (!last || last.status === 0) throw new ServiceError(NAME, "Couldn't reach Higgsfield. Check your internet connection.", last && last.text);
    const said = (last.text || "").slice(0, 300);
    if (last.status === 401 || last.status === 403) {
      throw new ServiceError(
        NAME,
        "Higgsfield didn't accept this key. Copy the API key ID and secret again from cloud.higgsfield.ai (or paste the combined KEY_ID:KEY_SECRET into the first box), and check the account has API credits. Saved: " + Studio.store.fingerprint(cred) + ".",
        "HTTP " + last.status + ": " + said
      );
    }
    throw new ServiceError(NAME, "Higgsfield answered with an error (" + last.status + ").", said);
  }

  Studio.higgsfield = { generateImage, generateVideo, uploadImage, test };
})();
