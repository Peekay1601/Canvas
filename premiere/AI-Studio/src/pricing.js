/*
 * Models, resolutions and cost estimates.
 *
 * Prices change and differ per account, so every rate is editable in Settings → Models & costs.
 * The defaults are starting estimates, not quotes: set them from your ModelArk console and Higgsfield plan.
 *   Seedream (pictures): price per image.
 *   Seedance (video):    price per million tokens, where tokens = width × height × 24 fps × seconds / 1024
 *                        (BytePlus's formula for Seedance video tokens).
 *   Higgsfield:          credits per picture / per second of video, times your price per credit.
 *   Claude:              per million input / output tokens, from each reply's usage.
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const S = () => Studio.store;

  const IMAGE_MODELS = {
    byteplus: [
      { id: "seedream-4-5-251128", label: "Seedream 4.5", price: 0.04 },
      { id: "seedream-4-0-250828", label: "Seedream 4.0", price: 0.03 },
    ],
    higgsfield: [
      { id: "higgsfield-ai/soul/standard", label: "Soul", credits: 2 },
      { id: "bytedance/seedream/v4/text-to-image", label: "Seedream 4", credits: 2 },
    ],
  };

  const VIDEO_MODELS = {
    byteplus: [
      { id: "dreamina-seedance-2-5-260628", label: "Seedance 2.5", perMTokens: 2.5 },
      { id: "seedance-1-0-pro-250528", label: "Seedance 1.0 Pro", perMTokens: 2.5 },
      { id: "seedance-1-0-pro-fast-251015", label: "Seedance 1.0 Pro Fast", perMTokens: 1.0 },
      { id: "seedance-1-0-lite-i2v-250428", label: "Seedance 1.0 Lite", perMTokens: 1.8 },
    ],
    higgsfield: [
      { id: "higgsfield-ai/dop/standard", label: "DoP", creditsPerSecond: 2 },
      { id: "kling-video/v2.1/pro/image-to-video", label: "Kling 2.1 Pro", creditsPerSecond: 3 },
      { id: "bytedance/seedance/v1/pro/image-to-video", label: "Seedance Pro", creditsPerSecond: 2 },
    ],
  };

  // Per million tokens: input, output, cache read (from the Claude pricing table).
  const CLAUDE = {
    "claude-opus-5-5": { in: 4, out: 20, cached: 0.2 },
    "claude-sonnet-5-5": { in: 2, out: 10, cached: 0.2 },
    "claude-haiku-5-5": { in: 0.1, out: 0.5, cached: 0.01 },
  };

  const IMAGE_RES = [
    { id: "1K", label: "1K · fast", scale: 0.5 },
    { id: "2K", label: "2K · standard", scale: 1 },
    { id: "4K", label: "4K · print", scale: 2 },
  ];

  const VIDEO_RES = [
    { id: "480p", label: "480p · draft", h: 480 },
    { id: "720p", label: "720p · HD", h: 720 },
    { id: "1080p", label: "1080p · full HD", h: 1080 },
  ];

  /** Seedream pixel sizes per shape at 2K (Seedream 4.5 needs ~3.7 MP); 1K / 4K scale from these. */
  const SEEDREAM_2K = { "16:9": [2560, 1440], "9:16": [1440, 2560], "1:1": [2048, 2048], "4:3": [2304, 1728], "3:4": [1728, 2304], "21:9": [3024, 1296] };

  function seedreamSize(ratio, res) {
    const base = SEEDREAM_2K[ratio] || SEEDREAM_2K["16:9"];
    const scale = (IMAGE_RES.find((r) => r.id === res) || IMAGE_RES[1]).scale;
    // Seedream 4.5 has a minimum of about 3.7 MP, so 1K stays at 2K on it.
    const s = scale < 1 && /4-5/.test(S().settings.seedreamModel) ? 1 : scale;
    return Math.round(base[0] * s) + "x" + Math.round(base[1] * s);
  }

  function videoDims(ratio, res) {
    const h = (VIDEO_RES.find((r) => r.id === res) || VIDEO_RES[1]).h;
    const [a, b] = (ratio || "16:9").split(":").map(Number);
    if (a >= b) return [Math.round((h * a) / b), h];
    return [h, Math.round((h * b) / a)];
  }

  // ---------- editable rates ----------

  function rates() {
    return Object.assign({ usdPerCredit: 0.06, currency: "$" }, S().settings.rates || {});
  }

  function setRate(key, value) {
    const r = Object.assign({}, S().settings.rates || {});
    r[key] = value;
    S().saveSettings({ rates: r });
  }

  function find(list, id) {
    return list.find((m) => m.id === id);
  }

  function imagePrice(engine, model) {
    const r = rates();
    if (engine === "byteplus") {
      const id = model || S().settings.seedreamModel;
      const m = find(IMAGE_MODELS.byteplus, id) || { price: 0.04 };
      return { usd: r["img:" + id] != null ? Number(r["img:" + id]) : m.price };
    }
    const id = model || S().settings.higgsfieldImageModel;
    const m = find(IMAGE_MODELS.higgsfield, id) || { credits: 2 };
    const credits = r["img:" + id] != null ? Number(r["img:" + id]) : m.credits;
    return { credits, usd: credits * r.usdPerCredit };
  }

  function videoPrice(engine, model, seconds, res, ratio) {
    const r = rates();
    seconds = Number(seconds) || 5;
    if (engine === "byteplus") {
      const id = model || S().settings.seedanceModel;
      const m = find(VIDEO_MODELS.byteplus, id) || { perMTokens: 2.5 };
      const per = r["vid:" + id] != null ? Number(r["vid:" + id]) : m.perMTokens;
      const [w, h] = videoDims(ratio, res);
      const tokens = Math.round((w * h * 24 * seconds) / 1024);
      return { tokens, usd: (tokens / 1e6) * per };
    }
    const id = model || S().settings.higgsfieldVideoModel;
    const m = find(VIDEO_MODELS.higgsfield, id) || { creditsPerSecond: 2 };
    const cps = r["vid:" + id] != null ? Number(r["vid:" + id]) : m.creditsPerSecond;
    const credits = cps * seconds;
    return { credits, usd: credits * r.usdPerCredit };
  }

  function claudePrice(model, usage) {
    const p = CLAUDE[model] || CLAUDE["claude-opus-5-5"];
    const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25;
    return (inTok * p.in + (usage.cache_read_input_tokens || 0) * p.cached + (usage.output_tokens || 0) * p.out) / 1e6;
  }

  function money(usd) {
    if (usd == null || isNaN(usd)) return "";
    const c = rates().currency || "$";
    if (usd > 0 && usd < 0.01) return "<" + c + "0.01";
    return c + (usd < 10 ? usd.toFixed(2) : usd.toFixed(0));
  }

  function describe(est) {
    if (!est) return "";
    return "≈ " + money(est.usd) + (est.credits ? " · " + Math.round(est.credits * 10) / 10 + " credits" : "") + (est.tokens ? " · " + Math.round(est.tokens / 1000) + "k tokens" : "");
  }

  // ---------- spend log ----------

  function spend() {
    return S().settings.spend || [];
  }

  /** Record a cost: { service, model, kind: "image"|"video"|"text", usd, credits?, project?, unit? }. */
  function record(entry) {
    const list = spend().slice(-4999);
    list.push(Object.assign({ at: Date.now() }, entry));
    S().saveSettings({ spend: list });
  }

  function summary(filter) {
    const rows = spend().filter(filter || (() => true));
    const by = (key) => {
      const out = {};
      rows.forEach((r) => {
        const k = r[key] || "—";
        out[k] = out[k] || { usd: 0, credits: 0, count: 0 };
        out[k].usd += r.usd || 0;
        out[k].credits += r.credits || 0;
        out[k].count++;
      });
      return out;
    };
    return { total: rows.reduce((a, r) => a + (r.usd || 0), 0), credits: rows.reduce((a, r) => a + (r.credits || 0), 0), count: rows.length, byService: by("service"), byKind: by("kind"), byUnit: by("unit"), byModel: by("model") };
  }

  Studio.pricing = { IMAGE_MODELS, VIDEO_MODELS, CLAUDE, IMAGE_RES, VIDEO_RES, seedreamSize, videoDims, rates, setRate, imagePrice, videoPrice, claudePrice, money, describe, record, summary, spend };
})();
