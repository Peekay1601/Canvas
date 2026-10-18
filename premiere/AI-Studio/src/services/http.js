/* Shared fetch helpers: JSON in/out, readable errors, polling and downloads. */
(function () {
  const Studio = (window.Studio = window.Studio || {});

  class ServiceError extends Error {
    constructor(service, message, detail) {
      super(message);
      this.service = service;
      this.detail = detail || "";
    }
  }

  /** Plain-language explanations for the errors people actually hit. */
  function friendly(service, status, bodyText) {
    const body = String(bodyText || "");
    if (status === 401 || status === 403) return `${service} didn't accept your key. Check it in Settings.`;
    if (status === 402 || /insufficient|balance|credit|quota/i.test(body))
      return `Your ${service} account is out of credits or over its limit.`;
    if (status === 404) return `${service} couldn't find that model. Check the model name in Settings → Advanced.`;
    if (status === 422 || status === 400) {
      if (/sensitive|safety|nsfw|moderation|policy/i.test(body))
        return `${service} blocked this request for safety reasons. Try rewording it.`;
      return `${service} didn't like one of the settings.`;
    }
    if (status === 429) return `${service} is busy (too many requests). Wait a moment and try again.`;
    if (status >= 500) return `${service} is having trouble right now. Try again in a minute.`;
    return `${service} returned an error (${status}).`;
  }

  async function requestJSON(service, url, options) {
    let resp;
    try {
      resp = await fetch(url, options);
    } catch (e) {
      throw new ServiceError(service, `Couldn't reach ${service}. Check your internet connection.`, String(e));
    }
    const text = await resp.text();
    if (!resp.ok) throw new ServiceError(service, friendly(service, resp.status, text), `HTTP ${resp.status}: ${text.slice(0, 1500)}`);
    try {
      return text ? JSON.parse(text) : {};
    } catch (e) {
      throw new ServiceError(service, `${service} sent back something unexpected.`, text.slice(0, 500));
    }
  }

  async function download(url) {
    let resp;
    try {
      resp = await fetch(url);
    } catch (e) {
      throw new ServiceError("Download", "Couldn't download the result. Check your internet connection.", String(e));
    }
    if (!resp.ok) throw new ServiceError("Download", `Couldn't download the result (${resp.status}).`);
    return await resp.arrayBuffer();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Find the first media URL anywhere in a JSON response (APIs nest results differently per model). */
  function findMediaUrl(obj, kind) {
    const wantVideo = kind === "video";
    const seen = [];
    (function walk(v, key) {
      if (!v) return;
      if (typeof v === "string") {
        if (/^https?:\/\//.test(v)) seen.push({ url: v, key: key || "" });
        return;
      }
      if (Array.isArray(v)) return v.forEach((x) => walk(x, key));
      if (typeof v === "object") Object.keys(v).forEach((k) => walk(v[k], k));
    })(obj);
    const score = (s) => {
      const u = s.url.toLowerCase();
      let n = 0;
      if (wantVideo && (/\.(mp4|mov|webm)(\?|$)/.test(u) || /video/.test(s.key))) n += 2;
      if (!wantVideo && (/\.(png|jpe?g|webp)(\?|$)/.test(u) || /image/.test(s.key))) n += 2;
      if (s.key === "url") n += 1;
      if (/thumb|poster|preview/.test(s.key)) n -= 3;
      return n;
    };
    seen.sort((a, b) => score(b) - score(a));
    return seen.length ? seen[0].url : null;
  }

  Studio.http = { ServiceError, requestJSON, download, sleep, findMediaUrl };
})();
