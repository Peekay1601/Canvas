/* Settings, secrets and the saved library. One place, so every screen sees the same values. */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const P = () => Studio.platform;

  const DEFAULT_SETTINGS = {
    claudeModel: "claude-opus-5-5",
    claudeEffort: "medium",

    arkBaseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3",
    seedreamModel: "seedream-4-5-251128",
    seedanceModel: "dreamina-seedance-2-5-260628",

    higgsfieldBaseUrl: "https://api.higgsfield.ai",
    higgsfieldImageModel: "higgsfield-ai/soul/standard",
    higgsfieldVideoModel: "higgsfield-ai/dop/standard",
    higgsfieldImageExtra: "",
    higgsfieldVideoExtra: "",

    binName: "AI Studio",
    autoImport: false,

    imageRes: "2K",
    videoRes: "720p",
    rates: {},
    spend: [],

    batchImages: 3,
    batchVideos: 2,
    retryBudget: 3,

    byteplusRegion: "ap-southeast-1",
    arkProject: "default",
    tosBucket: "",
    portraitLimit: 50,
  };

  // Ready-made Higgsfield models with plain-language names. Any other model id can be typed in Settings.
  const HIGGSFIELD_IMAGE_MODELS = [
    { id: "higgsfield-ai/soul/standard", label: "Soul", hint: "Realistic people and fashion" },
    { id: "bytedance/seedream/v4/text-to-image", label: "Seedream 4", hint: "All-rounder, sharp detail" },
  ];
  const HIGGSFIELD_VIDEO_MODELS = [
    { id: "higgsfield-ai/dop/standard", label: "DoP", hint: "Cinematic camera moves" },
    { id: "kling-video/v2.1/pro/image-to-video", label: "Kling 2.1 Pro", hint: "Natural motion" },
    { id: "bytedance/seedance/v1/pro/image-to-video", label: "Seedance Pro", hint: "Fast, faithful to the picture" },
  ];

  const SECRET_NAMES = ["anthropic", "ark", "higgsfieldKey", "higgsfieldSecret", "byteplusAk", "byteplusSk"];

  /**
   * What people actually paste: the key plus a line break, a non-breaking or zero-width space from a web
   * page, quotes, or a whole "ARK_API_KEY=..." / "Authorization: Bearer ..." line. No key contains
   * any of those, so they're removed before saving.
   */
  function cleanKey(value) {
    let v = String(value || "")
      .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "")
      .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ")
      .trim();
    v = v.replace(/^(?:export\s+|\$env:)?[A-Z][A-Z0-9]*_[A-Z0-9_]*(?:KEY|TOKEN|SECRET)[A-Z0-9_]*\s*[=:]\s*/, ""); // ARK_API_KEY=..., HF_KEY: ...
    v = v.replace(/^(?:authorization\s*:\s*)?(?:bearer|key)\s+/i, "");
    v = v.replace(/^x-api-key\s*:\s*/i, "");
    v = v.replace(/^["'`\u201C\u201D\u2018\u2019]+|["'`\u201C\u201D\u2018\u2019,;]+$/g, "");
    return v.replace(/\s+/g, "");
  }

  /** "sk-ant-api03-…9fQ2 · 108 characters": enough to see which key is saved, never the key itself. */
  function fingerprint(value) {
    const v = String(value || "");
    if (!v) return "";
    if (v.length < 12) return v.length + " characters";
    const head = v.length > 16 ? v.slice(0, Math.min(12, v.indexOf("-", 7) > 0 ? v.indexOf("-", 7) + 1 : 6)) : v.slice(0, 3);
    return head + "…" + v.slice(-4) + " · " + v.length + " characters";
  }

  const store = {
    settings: Object.assign({}, DEFAULT_SETTINGS, P().getPref("settings", {})),
    secrets: { anthropic: "", ark: "", higgsfieldKey: "", higgsfieldSecret: "", byteplusAk: "", byteplusSk: "" },
    secretWhere: {},
    cleanKey,
    fingerprint,
    library: P().getPref("library", []),
    status: { claude: "unknown", byteplus: "unknown", higgsfield: "unknown" },

    HIGGSFIELD_IMAGE_MODELS,
    HIGGSFIELD_VIDEO_MODELS,
    DEFAULT_SETTINGS,

    async load() {
      for (const name of SECRET_NAMES) this.secrets[name] = cleanKey(await P().getSecret(name));
    },

    saveSettings(patch) {
      Object.assign(this.settings, patch || {});
      P().setPref("settings", this.settings);
    },

    async saveSecret(name, value) {
      this.secrets[name] = cleanKey(value);
      try {
        this.secretWhere[name] = await P().setSecret(name, this.secrets[name]);
      } catch (e) {
        // Never lose the key for this session just because it couldn't be stored.
        this.secretWhere[name] = "session";
      }
    },

    has(service) {
      if (service === "claude") return !!this.secrets.anthropic;
      if (service === "byteplus") return !!this.secrets.ark;
      if (service === "higgsfield") {
        const k = this.secrets.higgsfieldKey || "";
        const sec = this.secrets.higgsfieldSecret || "";
        return !!((k && sec) || k.indexOf(":") > 0 || sec.indexOf(":") > 0);
      }
      return false;
    },

    addToLibrary(item) {
      this.library.unshift(item);
      this.persistLibrary();
    },

    updateLibrary(id, patch) {
      const item = this.library.find((x) => x.id === id);
      if (item) Object.assign(item, patch);
      this.persistLibrary();
      return item;
    },

    removeFromLibrary(id) {
      const item = this.library.find((x) => x.id === id);
      this.library = this.library.filter((x) => x.id !== id);
      this.persistLibrary();
      return item;
    },

    persistLibrary() {
      // Blob URLs only live for this page view in the browser preview; don't keep them.
      P().setPref(
        "library",
        this.library.map((x) => Object.assign({}, x, { src: x.src && x.src.indexOf("blob:") === 0 ? "" : x.src }))
      );
    },
  };

  Studio.store = store;
})();
