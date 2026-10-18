/* The panel UI: Create, Script, Library and Settings (the Script tab lives in src/views/script.js). */
(function () {
  const Studio = window.Studio;
  const P = Studio.platform;
  const store = Studio.store;
  const jobs = Studio.jobs;

  // ---------- icons (simple inline SVG, safe in UXP) ----------

  const I = {
    image:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
    video:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="13" height="14" rx="3"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
    spark:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7z"/><path d="M19 15l1 2.6 2.5 1-2.5 1-1 2.4-1-2.4-2.5-1 2.5-1z"/></svg>',
    plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>',
    premiere:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 12h12M11 6l6 6-6 6"/><path d="M20 4v16"/></svg>',
    play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>',
    trash:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/></svg>',
    lock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>',
    film: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>',
    chevronDown: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 9l6 6 6-6"/></svg>',
    chevronUp: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 15l6-6 6 6"/></svg>',
    close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
    gear: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
    coin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2c-1 0-2-.5-2.5-1.5M12 6v12"/></svg>',
    edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/></svg>',
    upload14: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3"/></svg>',
    doc: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
    upload: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3"/></svg>',
    layers: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
    check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2"><path d="M5 12l5 5 9-10"/></svg>',
    download: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    refresh: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/></svg>',
    character: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/></svg>',
    costume: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3l3 3 3-3 5 3-2 4-2-1v12H8V9l-2 1-2-4z"/></svg>',
    location: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 20l6-10 4 6 3-4 5 8z"/><circle cx="17" cy="6" r="2"/></svg>',
    prop: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 8h11v7a5 5 0 01-5 5h-1a5 5 0 01-5-5z"/><path d="M16 10h2a2 2 0 010 4h-2M9 3v2M12 3v2"/></svg>',
  };

  // ---------- UI state ----------

  const firstEngine = () => (store.has("byteplus") || !store.has("higgsfield") ? "byteplus" : "higgsfield");

  const ui = {
    tab: P.getPref("tab", "create"),
    mode: "image",
    idea: "",
    improved: "",
    useImproved: true,
    improving: false,
    start: null,
    image: Object.assign({ engine: "byteplus", ratio: "16:9", model: "" }, P.getPref("imageOpts", {})),
    video: Object.assign({ engine: "byteplus", ratio: "16:9", duration: 5, resolution: "720p", audio: false, model: "" }, P.getPref("videoOpts", {})),
    libFilter: "all",
    picker: false,
    advanced: false,
    planning: false,
    openShot: {},
    showDetail: {},
    test: {},
    reveal: {},
  };

  const IMAGE_EXAMPLES = [
    "Tea seller laughing in the Mumbai rain, under a blue tarp, warm bulb light",
    "Product shot of a brass chai kettle on dark slate, soft morning window light",
    "Wide shot of a lonely train platform at dawn, fog, one figure with an umbrella",
  ];
  const VIDEO_EXAMPLES = [
    "She looks up from her phone and smiles, camera slowly pushes in",
    "Steam rises from the cup as the camera orbits slowly around the table",
    "Handheld follow shot as he runs through the crowded market",
  ];

  const RATIOS = [
    { id: "16:9", label: "Wide", w: 16, h: 9 },
    { id: "9:16", label: "Tall", w: 9, h: 16 },
    { id: "1:1", label: "Square", w: 12, h: 12 },
    { id: "4:3", label: "4:3", w: 14, h: 10.5 },
    { id: "21:9", label: "Cinema", w: 18, h: 7.7 },
  ];

  // ---------- helpers ----------

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  function closestAttr(el, attr) {
    while (el && el !== document) {
      if (el.getAttribute && el.getAttribute(attr) != null) return el;
      el = el.parentNode;
    }
    return null;
  }

  function fmtElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function timeAgo(t) {
    const m = Math.floor((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + " h ago";
    return Math.floor(h / 24) + " d ago";
  }

  function toast(text, type, action) {
    const box = $("#toasts");
    const el = document.createElement("div");
    el.className = "toast " + (type || "");
    el.innerHTML =
      '<div class="t-dot"></div><div class="t-text">' +
      esc(text) +
      "</div>" +
      (action ? '<button class="link-btn">' + esc(action.label) + "</button>" : "");
    if (action) el.querySelector("button").onclick = () => (el.remove(), action.run());
    box.appendChild(el);
    setTimeout(() => el.remove(), type === "error" ? 7000 : 4000);
  }

  function goSettings() {
    setTab("settings");
  }

  function needKey(service) {
    const names = { claude: "Claude", byteplus: "BytePlus", higgsfield: "Higgsfield" };
    toast("Connect " + names[service] + " first — it takes a minute.", "error", { label: "Set up", run: goSettings });
  }

  function saveOpts() {
    P.setPref("imageOpts", ui.image);
    P.setPref("videoOpts", ui.video);
  }

  function setTab(tab) {
    ui.tab = tab;
    P.setPref("tab", tab);
    render();
    const view = $("#view");
    if (view) view.scrollTop = 0;
  }

  function shape(r) {
    return '<span class="shape" style="width:' + r.w + "px;height:" + r.h + 'px"></span>';
  }

  function mediaTag(item, cls) {
    if (!item) return "";
    const src = item.src || item.remoteUrl;
    if (item.kind === "video") {
      return (
        '<video class="' + (cls || "") + '" src="' + esc(src) + '"' + (item.poster ? ' poster="' + esc(item.poster) + '"' : "") + ' muted loop playsinline data-hoverplay></video>'
      );
    }
    return '<img class="' + (cls || "") + '" src="' + esc(src) + '" alt="" />';
  }

  function libItem(id) {
    return store.library.find((x) => x.id === id);
  }

  // ---------- header ----------

  function renderStatus() {
    const row = $("#status-row");
    const svc = [
      ["claude", "Claude"],
      ["higgsfield", "Higgsfield"],
      ["byteplus", "BytePlus"],
    ];
    row.innerHTML = svc
      .map(([id, name]) => {
        const st = store.status[id] === "problem" ? "problem" : store.has(id) ? "ready" : "";
        const title = st === "ready" ? name + " connected" : st === "problem" ? name + " has a problem" : name + " not connected";
        return '<div class="status-pill ' + st + '" title="' + title + '" data-action="tab" data-tab="settings"><span class="dot"></span>' + name + "</div>";
      })
      .join("");
    const tabs = document.querySelectorAll(".tab");
    for (let i = 0; i < tabs.length; i++) tabs[i].className = "tab" + (tabs[i].getAttribute("data-tab") === ui.tab ? " active" : "");
    if ($("#settings-tab") && !$("#settings-tab").innerHTML) $("#settings-tab").innerHTML = I.gear;
    const madeCount = store.library.filter((x) => x.origin !== "upload").length;
    $("#lib-count").textContent = madeCount ? String(madeCount) : "";
    const upCount = store.library.filter((x) => x.origin === "upload").length;
    if ($("#up-count")) $("#up-count").textContent = upCount ? String(upCount) : "";
  }

  // ---------- Create ----------

  function engineCard(kind, engine) {
    const opts = ui[kind];
    const active = opts.engine === engine;
    const connected = store.has(engine);
    const info = {
      image: {
        byteplus: ["Seedream 4.5", "Crisp detail, products, text in the frame"],
        higgsfield: ["Higgsfield", "Realistic people and fashion looks (Soul)"],
      },
      video: {
        byteplus: ["Seedance 2.5", "Cinematic motion, optional sound. Picture optional"],
        higgsfield: ["Higgsfield", "Animates your picture: DoP, Kling, Seedance"],
      },
    }[kind][engine];
    return (
      '<button class="engine' + (active ? " active" : "") + '" data-action="engine" data-kind="' + kind + '" data-engine="' + engine + '">' +
      '<div class="logo ' + engine + '">' + (engine === "byteplus" ? "B+" : "H") + "</div>" +
      '<div class="engine-text"><b>' + info[0] + (connected ? "" : '<span class="tag off">Not connected</span>') + "</b><small>" + info[1] + "</small></div>" +
      '<div class="radio"></div></button>'
    );
  }

  function higgsModelChips(kind) {
    const list = kind === "image" ? store.HIGGSFIELD_IMAGE_MODELS : store.HIGGSFIELD_VIDEO_MODELS;
    const current = ui[kind].model || (kind === "image" ? store.settings.higgsfieldImageModel : store.settings.higgsfieldVideoModel);
    return (
      '<label class="field-label">Higgsfield model</label><div class="chips">' +
      list
        .map((m) => '<button class="chip' + (m.id === current ? " active" : "") + '" data-action="hmodel" data-kind="' + kind + '" data-id="' + esc(m.id) + '" title="' + esc(m.hint) + '">' + esc(m.label) + "</button>")
        .join("") +
      "</div><div class=\"help\">" + esc((list.find((m) => m.id === current) || { hint: "Custom model from Settings" }).hint) + "</div>"
    );
  }

  /** Model + resolution dropdowns for pictures or videos, and the cost of one. Used by Create and Script. */
  function modelPickers(kind) {
    const PRC = Studio.pricing;
    const sel = Studio.panels.select;
    const engine = ui[kind].engine;
    const list = kind === "image" ? PRC.IMAGE_MODELS[engine] : PRC.VIDEO_MODELS[engine];
    const current = engine === "byteplus" ? (kind === "image" ? store.settings.seedreamModel : store.settings.seedanceModel) : ui[kind].model || (kind === "image" ? store.settings.higgsfieldImageModel : store.settings.higgsfieldVideoModel);
    const options = list.map((m) => ({ id: m.id, label: m.label }));
    if (!options.some((o) => o.id === current)) options.push({ id: current, label: "Custom: " + current });
    const res =
      kind === "image"
        ? engine === "byteplus"
          ? sel("set-res", PRC.IMAGE_RES, store.settings.imageRes || "2K", 'data-kind="image"')
          : ""
        : engine === "byteplus"
        ? sel("set-res", PRC.VIDEO_RES, ui.video.resolution, 'data-kind="video"')
        : "";
    return (
      '<div class="picker-row"><div class="picker"><label class="field-label">' + (kind === "image" ? "Picture model" : "Video model") + "</label>" + sel("set-model", options, current, 'data-kind="' + kind + '"') + "</div>" +
      (res ? '<div class="picker"><label class="field-label">Resolution</label>' + res + "</div>" : "") +
      "</div>"
    );
  }

  function estimate(kind, seconds) {
    const PRC = Studio.pricing;
    const o = ui[kind];
    if (kind === "image") return PRC.imagePrice(o.engine, o.engine === "higgsfield" ? o.model : "");
    return PRC.videoPrice(o.engine, o.engine === "higgsfield" ? o.model : "", seconds || o.duration, o.resolution, o.ratio);
  }

  function ratioChips(kind) {
    return (
      '<div class="chips">' +
      RATIOS.map((r) => '<button class="chip' + (ui[kind].ratio === r.id ? " active" : "") + '" data-action="ratio" data-kind="' + kind + '" data-id="' + r.id + '">' + shape(r) + r.label + "</button>").join("") +
      "</div>"
    );
  }

  function startPicture() {
    if (ui.start) {
      return (
        '<div class="dropzone filled"><div class="dz-icon"><img src="' + esc(ui.start.src || ui.start.dataUrl || ui.start.remoteUrl) + '" /></div>' +
        '<div class="dz-text"><b>Starting picture</b><small>The video begins from this frame</small>' +
        '<div class="dz-actions"><button class="btn small" data-action="pick-start">Change</button><button class="btn small ghost" data-action="clear-start">Remove</button></div></div></div>'
      );
    }
    const needs = ui.video.engine === "higgsfield";
    return (
      '<div class="dropzone"><div class="dz-icon">' + I.image + "</div>" +
      '<div class="dz-text"><b>Start from a picture ' + (needs ? "(needed for Higgsfield)" : "(optional)") + "</b>" +
      "<small>Videos look most consistent when they start from a picture you like</small>" +
      '<div class="dz-actions"><button class="btn small" data-action="pick-start">From Library</button><button class="btn small" data-action="pick-file">From my computer</button></div></div></div>'
    );
  }

  function renderCreate() {
    const isImage = ui.mode === "image";
    const kind = ui.mode;
    const opts = ui[kind];
    const nothing = !store.has("claude") && !store.has("byteplus") && !store.has("higgsfield");
    const examples = isImage ? IMAGE_EXAMPLES : VIDEO_EXAMPLES;

    let html = "";
    if (nothing) {
      html +=
        '<div class="banner"><div class="banner-text"><b>Welcome to AI Studio 👋</b><small>Connect your accounts once and you can make pictures and videos without leaving Premiere.</small></div>' +
        '<button class="btn primary" data-action="tab" data-tab="settings">Set up</button></div>';
    }

    html +=
      '<section class="card"><div class="step"><span class="step-num">1</span>What do you want to make?</div><div class="mode-toggle">' +
      '<button class="mode' + (isImage ? " active" : "") + '" data-action="mode" data-mode="image"><div class="mode-icon">' + I.image + "</div><div><b>Picture</b><small>A still frame</small></div></button>" +
      '<button class="mode' + (!isImage ? " active" : "") + '" data-action="mode" data-mode="video"><div class="mode-icon">' + I.video + "</div><div><b>Video</b><small>A moving shot</small></div></button>" +
      "</div></section>";

    html +=
      '<section class="card"><div class="step"><span class="step-num">2</span>' + (isImage ? "Describe your picture" : "Describe the shot") + '<span class="step-hint">in your own words</span></div>' +
      (isImage ? "" : startPicture() + '<div style="height:10px"></div>') +
      '<textarea id="idea" data-bind="idea" placeholder="' +
      (isImage ? "e.g. A girl laughing at a chai stall in the rain, warm evening light" : "What happens? e.g. She looks up and smiles, the camera slowly pushes in") +
      '">' + esc(ui.idea) + "</textarea>" +
      '<div class="examples"><span class="label">Try:</span>' +
      examples.map((e, i) => '<button class="example" data-action="example" data-i="' + i + '">' + esc(e.split(",")[0]) + "</button>").join("") +
      "</div>" +
      '<div class="row" style="margin-top:12px"><button class="btn claude" data-action="improve"' + (ui.improving ? " disabled" : "") + ">" +
      (ui.improving ? '<span class="spinner" style="width:13px;height:13px;margin-right:7px"></span>Claude is writing…' : I.spark + "Polish with Claude") +
      '</button></div><div class="help">Claude turns your words into a detailed, pro-level prompt. You can still edit it.</div>';

    if (ui.improved) {
      html +=
        '<div class="improved"><div class="improved-head">' + I.spark + '<span style="margin-left:6px">Claude\'s version</span><span class="spacer"></span>' +
        '<button class="link-btn" data-action="improve">Try again</button></div>' +
        '<textarea class="small" data-bind="improved" rows="5">' + esc(ui.improved) + "</textarea>" +
        '<div class="switch-row"><button class="switch' + (ui.useImproved ? " on" : "") + '" data-action="toggle-improved"><span></span></button>' +
        (ui.useImproved ? "Using Claude's version (you can edit it)" : "Using your own words") + "</div></div>";
    }
    html += "</section>";

    html +=
      '<section class="card"><div class="step"><span class="step-num">3</span>Choose the look</div>' +
      '<label class="field-label">Made with</label>' + engineCard(kind, "byteplus") + engineCard(kind, "higgsfield") +
      modelPickers(kind) +
      '<label class="field-label">Shape</label>' + ratioChips(kind);

    if (!isImage) {
      html +=
        '<label class="field-label">Length</label><div class="chips">' +
        [5, 10].map((d) => '<button class="chip' + (opts.duration === d ? " active" : "") + '" data-action="duration" data-d="' + d + '">' + d + " seconds</button>").join("") +
        "</div>";
      if (opts.engine === "byteplus") {
        html += '<div class="switch-row" style="margin-top:12px"><button class="switch' + (opts.audio ? " on" : "") + '" data-action="toggle-audio"><span></span></button>Add sound (ambience, effects, voices)</div>';
      }
    }
    html += "</section>";

    html +=
      '<div class="create-wrap"><button class="btn primary big" data-action="generate">' + (isImage ? I.image : I.video) + (isImage ? "Create picture" : "Create video") + "</button>" +
      '<div class="eta"><span class="cost-pill">' + I.coin + " " + Studio.pricing.describe(estimate(kind)) + "</span> " + (isImage ? "Usually ready in 15–40 seconds" : "Takes 1–5 minutes. Keep editing — we'll let you know.") + "</div></div>";

    html += '<div id="jobs"></div>';
    $("#view").innerHTML = html;
    renderJobs();
  }

  function phaseText(job) {
    if (job.status === "error") return job.error;
    return (
      {
        queued: "Waiting in line…",
        uploading: "Sending your picture…",
        running: job.kind === "image" ? "Painting your picture…" : "Filming your shot…",
        saving: "Saving to your Library…",
      }[job.phase] || "Working…"
    );
  }

  function jobCard(job) {
    const item = job.itemId && libItem(job.itemId);
    const thumb = item ? mediaTag(item) : job.thumb ? '<img src="' + esc(job.thumb) + '" />' : job.kind === "image" ? I.image : I.video;
    let actions = "";
    if (job.status === "done" && item) {
      actions =
        '<div class="job-actions"><button class="btn small primary" data-action="import" data-id="' + item.id + '">' + I.premiere + "Add to Premiere</button>" +
        (item.kind === "image" ? '<button class="btn small" data-action="animate" data-id="' + item.id + '">' + I.play + "Animate</button>" : "") +
        '<button class="btn small" data-action="ch-open" data-id="' + item.id + '">' + I.spark + "Change</button>" +
        '<button class="btn small ghost" data-action="dismiss" data-id="' + job.id + '">Done</button></div>';
    } else if (job.status === "error") {
      actions =
        '<div class="job-actions"><button class="btn small" data-action="retry" data-id="' + job.id + '">Try again</button>' +
        (job.errorDetail ? '<button class="btn small ghost" data-action="detail" data-id="' + job.id + '">' + (ui.showDetail[job.id] ? "Hide details" : "Details") + "</button>" : "") +
        '<button class="btn small ghost" data-action="dismiss" data-id="' + job.id + '">Dismiss</button></div>' +
        (ui.showDetail[job.id] ? '<div class="details">' + esc(job.errorDetail) + "</div>" : "");
    }
    return (
      '<div class="job"><div class="job-thumb">' + thumb + '</div><div class="job-body">' +
      '<div class="job-title">' + (job.kind === "image" ? "Picture" : "Video") + '<span class="spacer"></span>' +
      (job.status === "working" ? '<span class="job-sub" data-elapsed="' + job.startedAt + '">' + fmtElapsed(Date.now() - job.startedAt) + "</span>" : "") +
      (job.status === "done" ? '<span class="badge ready">Ready</span>' : "") +
      '</div><div class="job-sub">' + esc(job.engineLabel) + " · " + esc(job.prompt) + "</div>" +
      '<div class="job-status' + (job.status === "error" ? " error" : "") + '">' + esc(job.status === "done" ? "Saved to your Library" : phaseText(job)) + "</div>" +
      (job.status === "working" ? '<div class="progress"><span></span></div>' : "") +
      actions + "</div></div>"
    );
  }

  function renderJobs() {
    const box = $("#jobs");
    if (!box) return;
    const list = jobs.list.filter((j) => !j.source);
    box.innerHTML = list.length ? '<div class="section-title">Your requests<span class="spacer"></span></div>' + list.map(jobCard).join("") : "";
  }

  function currentPrompt() {
    return (ui.improved && ui.useImproved ? ui.improved : ui.idea).trim();
  }

  async function improve() {
    if (!store.has("claude")) return needKey("claude");
    const idea = ui.idea.trim();
    if (!idea && !(ui.mode === "video" && ui.start)) {
      toast("Write a few words first, then Claude can polish them.");
      const el = $("#idea");
      el && el.focus();
      return;
    }
    ui.improving = true;
    render();
    try {
      if (ui.mode === "image") {
        const engineLabel = ui.image.engine === "byteplus" ? "Seedream 4.5" : jobs.engineLabel("image", "higgsfield", ui.image.model);
        ui.improved = await Studio.claude.improveImagePrompt({ idea, engineLabel });
      } else {
        let startRef = null;
        if (ui.start) {
          const fresh = ui.start.remoteUrl && Date.now() - (ui.start.createdAt || 0) < 12 * 3600e3;
          startRef = fresh ? ui.start.remoteUrl : (await jobs.pictureInput(ui.start)).dataUrl;
        }
        const engineLabel = ui.video.engine === "byteplus" ? "Seedance 2.5" : jobs.engineLabel("video", "higgsfield", ui.video.model);
        ui.improved = await Studio.claude.improveVideoPrompt({ idea, duration: ui.video.duration, startImage: startRef, engineLabel });
      }
      ui.useImproved = true;
    } catch (e) {
      store.status.claude = /key/i.test(e.message) ? "problem" : store.status.claude;
      toast(e.message, "error");
    }
    ui.improving = false;
    render();
  }

  function startJob(kind, prompt, opts, start) {
    const p =
      kind === "image"
        ? jobs.createImage({ prompt, engine: opts.engine, ratio: opts.ratio, model: opts.engine === "higgsfield" ? opts.model : "" })
        : jobs.createVideo({
            prompt,
            engine: opts.engine,
            ratio: opts.ratio,
            duration: opts.duration,
            resolution: opts.resolution,
            audio: opts.audio,
            model: opts.engine === "higgsfield" ? opts.model : "",
            startImage: start,
          });
    p.then(
      (item) => toast((kind === "image" ? "Your picture" : "Your video") + " is ready", "ok", { label: "Add to Premiere", run: () => importItem(item.id) }),
      (e) => toast(e.message, "error")
    );
  }

  function generate() {
    const kind = ui.mode;
    const opts = ui[kind];
    let prompt = currentPrompt();
    if (!prompt && kind === "video" && ui.start) prompt = "Bring this picture to life with natural, subtle motion and a slow cinematic camera push-in.";
    if (!prompt) {
      toast("Describe what you want first.");
      const el = $("#idea");
      el && el.focus();
      return;
    }
    if (!store.has(opts.engine)) return needKey(opts.engine);
    if (kind === "video" && opts.engine === "higgsfield" && !ui.start) {
      toast("Higgsfield videos start from a picture. Add one above, or switch to Seedance.", "error");
      return;
    }
    startJob(kind, prompt, Object.assign({}, opts), ui.start);
    renderJobs();
    const box = $("#jobs");
    const view = $("#view");
    if (box && view) view.scrollTop = Math.max(0, box.offsetTop - view.offsetTop - 8);
  }

  function retry(jobId) {
    const job = jobs.list.find((j) => j.id === jobId);
    if (!job) return;
    jobs.dismiss(jobId);
    const opts = Object.assign({}, ui[job.kind], { engine: job.engine, ratio: job.ratio || ui[job.kind].ratio, duration: job.duration || ui.video.duration });
    startJob(job.kind, job.prompt, opts, job.kind === "video" ? ui.start : null);
  }

  // ---------- picking a starting picture ----------

  async function pickFile() {
    try {
      const f = await P.pickImage();
      if (!f) return;
      ui.start = { name: f.name, mime: f.mime, buffer: f.buffer, dataUrl: "data:" + f.mime + ";base64," + P.toBase64(f.buffer) };
      ui.start.src = ui.start.dataUrl;
      render();
    } catch (e) {
      toast("Couldn't open that picture: " + e.message, "error");
    }
  }

  function renderPicker() {
    const old = $("#picker");
    if (old) old.remove();
    if (!ui.picker) return;
    const pics = store.library.filter((x) => x.kind === "image");
    const el = document.createElement("div");
    el.id = "picker";
    el.className = "sheet-backdrop";
    el.setAttribute("data-action", "close-picker");
    el.innerHTML =
      '<div class="sheet" data-stop><div class="sheet-head">Choose a starting picture<span class="spacer"></span><button class="btn icon ghost" data-action="close-picker">' + I.close + "</button></div>" +
      (pics.length
        ? '<div class="grid">' + pics.map((p) => '<div class="pick"><button data-action="use-start" data-id="' + p.id + '"><img src="' + esc(p.src || p.remoteUrl) + '" /></button></div>').join("") + "</div>"
        : '<div class="empty"><b>No pictures yet</b>Create a picture first, or pick one from your computer.</div>') +
      "</div>";
    document.body.appendChild(el);
  }

  function animate(id) {
    const item = libItem(id);
    if (!item) return;
    ui.mode = "video";
    ui.start = item;
    ui.idea = "";
    ui.improved = "";
    ui.video.ratio = item.ratio || ui.video.ratio;
    setTab("create");
    toast("Picture added as the first frame. Describe the motion, or just press Create video.");
  }

  // ---------- Library ----------

  function renderLibrary() {
    // Uploads have their own tab; the Library is what the panel made.
    const made = store.library.filter((x) => x.origin !== "upload");
    const items = made.filter((x) => ui.libFilter === "all" || x.kind === ui.libFilter);
    let html =
      '<div class="row" style="margin-bottom:10px"><div class="chips">' +
      [
        ["all", "Everything"],
        ["image", "Pictures"],
        ["video", "Videos"],
      ]
        .map((f) => '<button class="chip' + (ui.libFilter === f[0] ? " active" : "") + '" data-action="lib-filter" data-id="' + f[0] + '">' + f[1] + "</button>")
        .join("") +
      '</div><span class="spacer"></span>' +
      (store.library.length && P.hasPremiere ? '<button class="btn small" data-action="import-all">' + I.premiere + "Add all</button>" : "") +
      "</div>";

    if (!items.length) {
      html +=
        '<div class="empty"><div class="empty-art">' + I.film + "</div><b>" + (store.library.length ? "Nothing in this filter" : "Your Library is empty") + "</b>" +
        "Pictures and videos you create land here, ready to drop into Premiere." +
        '<div style="margin-top:14px"><button class="btn primary" data-action="tab" data-tab="create">' + I.plus + "Create something</button></div></div>";
      $("#view").innerHTML = html;
      return;
    }

    html +=
      '<div class="grid">' +
      items
        .map(
          (it) =>
            '<div class="tile"><div class="tile-inner"><div class="tile-media">' + mediaTag(it) +
            '<span class="kind">' + (it.kind === "image" ? "Picture" : "Video · " + (it.duration || 5) + "s") + "</span>" +
            (it.imported ? '<span class="in-pr">In project</span>' : "") +
            '</div><div class="tile-body"><div class="tile-meta"><span class="meta-text">' + esc(it.engineLabel) + " · " + timeAgo(it.createdAt) + "</span>" +
            '<button class="icon-btn" data-action="copy" data-id="' + it.id + '" title="Copy prompt">' + I.copy + "</button>" +
            '<button class="icon-btn danger" data-action="delete" data-id="' + it.id + '" title="Delete">' + I.trash + "</button></div>" +
            '<div class="tile-prompt" title="' + esc(it.prompt) + '">' + esc(it.prompt) + "</div>" +
            '<div class="tile-foot">' + (it.cost ? '<span class="cost-pill small">' + Studio.pricing.money(it.cost.usd) + "</span>" : "") + (it.folder ? '<span class="path" title="' + esc(it.folder) + '">' + I.folder + " " + esc(it.folder) + "</span>" : "") + "</div>" +
            '<div class="tile-actions"><button class="btn small primary" data-action="import" data-id="' + it.id + '" title="Add to your Premiere project">' + I.premiere + "Add</button>" +
            (it.kind === "image" ? '<button class="btn small" data-action="animate" data-id="' + it.id + '" title="Turn into a video">' + I.play + "Animate</button>" : "") +
            '<button class="btn small icon" data-action="ch-open" data-id="' + it.id + '" title="Change with Claude">' + I.spark + "</button>" +
            "</div></div></div></div>"
        )
        .join("") +
      "</div>";
    $("#view").innerHTML = html;
  }

  async function importItem(id) {
    const item = libItem(id);
    if (!item) return;
    try {
      if (!item.path) throw new Error("Open this panel inside Premiere Pro to add clips to your project.");
      const bin = store.settings.binName + (item.folder ? "/" + item.folder : "");
      await P.importToPremiere([item.path], bin);
      store.updateLibrary(id, { imported: true });
      toast("Added to your project in the “" + bin.replace(/\//g, " ▸ ") + "” bin", "ok");
      render();
    } catch (e) {
      toast(e.message, "error");
    }
  }

  async function importAll() {
    const paths = store.library.filter((x) => x.path && !x.imported).map((x) => x.path);
    if (!paths.length) return toast("Everything is already in your project.");
    try {
      await P.importToPremiere(paths, store.settings.binName);
      store.library.forEach((x) => x.path && (x.imported = true));
      store.persistLibrary();
      toast("Added " + paths.length + " clips to your project", "ok");
      render();
    } catch (e) {
      toast(e.message, "error");
    }
  }

  // ---------- shared with the Script tab ----------

  function engineMini(kind) {
    return (
      '<div class="mini-select">' + (kind === "image" ? "Pictures with" : "Videos with") + '<div class="chips">' +
      ["byteplus", "higgsfield"]
        .map((e) => '<button class="chip' + (ui[kind].engine === e ? " active" : "") + '" data-action="engine" data-kind="' + kind + '" data-engine="' + e + '">' + (e === "byteplus" ? (kind === "image" ? "Seedream" : "Seedance") : "Higgsfield") + "</button>")
        .join("") +
      "</div></div>"
    );
  }

  // ---------- Settings ----------

  function serviceCard(id, name, what, fields, link) {
    const st = ui.test[id];
    const badge =
      st === "testing"
        ? '<span class="badge">Checking…</span>'
        : store.status[id] === "problem"
        ? '<span class="badge problem">Problem</span>'
        : store.has(id)
        ? '<span class="badge ready">Connected</span>'
        : '<span class="badge">Not set up</span>';
    return (
      '<section class="card"><div class="service-head"><div class="logo ' + id + '">' + { claude: "C", byteplus: "B+", higgsfield: "H" }[id] + "</div>" +
      '<div class="service-text"><b>' + name + "</b><small>" + what + "</small></div>" + badge + "</div>" +
      fields
        .map(
          (f) =>
            '<label class="field-label">' + f.label + '</label><div class="key-row"><input type="' + (ui.reveal[f.secret] ? "text" : "password") + '" data-secret="' + f.secret + '" placeholder="' + esc(f.placeholder) + '" value="' + esc(store.secrets[f.secret]) + '" />' +
            '<button class="btn small ghost" data-action="reveal" data-id="' + f.secret + '">' + (ui.reveal[f.secret] ? "Hide" : "Show") + "</button></div>"
        )
        .join("") +
      '<div class="row" style="margin-top:8px"><a data-action="open" data-url="' + link.url + '">' + link.label + ' ↗</a><span class="spacer"></span>' +
      '<button class="btn small primary" data-action="save-test" data-id="' + id + '">Save & check</button></div>' +
      (ui.test[id + "Msg"] ? '<div class="test-result ' + (store.status[id] === "problem" ? "bad" : "ok") + '">' + esc(ui.test[id + "Msg"]) + "</div>" : "") +
      "</section>"
    );
  }

  function adv(label, key, placeholder) {
    return '<label class="field-label">' + label + '</label><input type="text" data-setting="' + key + '" value="' + esc(store.settings[key]) + '" placeholder="' + esc(placeholder || "") + '" />';
  }

  function renderSettings() {
    const s = store.settings;
    let html =
      serviceCard("claude", "Claude", "Breaks down your scripts and writes every prompt", [{ label: "API key", secret: "anthropic", placeholder: "sk-ant-…" }], {
        url: "https://console.anthropic.com/settings/keys",
        label: "Get a key",
      }) +
      serviceCard("higgsfield", "Higgsfield", "Pictures with Soul, videos with DoP, Kling and more", [
        { label: "API key", secret: "higgsfieldKey", placeholder: "Key ID" },
        { label: "API secret", secret: "higgsfieldSecret", placeholder: "Secret" },
      ], { url: "https://cloud.higgsfield.ai/", label: "Get a key" }) +
      serviceCard("byteplus", "BytePlus ModelArk", "Pictures with Seedream, videos with Seedance", [{ label: "API key", secret: "ark", placeholder: "ModelArk API key" }], {
        url: "https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey",
        label: "Get a key",
      });

    const pt = ui.ptTest;
    const unused = Studio.references.unusedPortraits();
    html +=
      '<section class="card"><div class="service-head"><div class="logo byteplus">' + I.character + '</div><div class="service-text"><b>Character faces · BytePlus portrait library</b><small>So Seedance doesn\'t block your AI characters as real people. Locked faces are registered automatically.</small></div>' +
      (Studio.portraits.enabled() ? '<span class="badge ready">On</span>' : '<span class="badge">Off</span>') + "</div>" +
      '<div class="help" style="margin:0 0 4px">Create it in BytePlus IAM for a user with <b>ArkFullAccess</b> and <b>TOSFullAccess</b>. It\'s separate from the API key above.</div>' +
      [
        { label: "Access Key ID", secret: "byteplusAk", placeholder: "AKLT…" },
        { label: "Secret Access Key", secret: "byteplusSk", placeholder: "Shown once when you create the key" },
      ]
        .map(
          (f) =>
            '<label class="field-label">' + f.label + '</label><div class="key-row"><input type="' + (ui.reveal[f.secret] ? "text" : "password") + '" data-secret="' + f.secret + '" placeholder="' + esc(f.placeholder) + '" value="' + esc(store.secrets[f.secret]) + '" />' +
            '<button class="btn small ghost" data-action="reveal" data-id="' + f.secret + '">' + (ui.reveal[f.secret] ? "Hide" : "Show") + "</button></div>"
        )
        .join("") +
      '<div class="row" style="margin-top:8px"><a data-action="open" data-url="https://console.byteplus.com/iam/identitymanage/user">BytePlus IAM ↗</a><span class="spacer"></span>' +
      '<button class="btn small primary" data-action="pt-test"' + (pt === "testing" ? " disabled" : "") + ">" + (pt === "testing" ? "Checking…" : "Save & check") + "</button></div>" +
      (Array.isArray(pt)
        ? '<div class="steps">' + pt.map((x) => '<div class="step-row ' + (x.ok ? "ok" : "bad") + '"><span>' + (x.ok ? "✓" : "✕") + "</span><div><b>" + esc(x.step) + "</b><small>" + esc(x.ok ? x.detail : x.error) + "</small></div></div>").join("") + "</div>"
        : "") +
      (unused.length
        ? '<div class="row" style="margin-top:10px"><span class="help" style="margin:0">' + unused.length + " portrait(s) no longer used (they count against your limit).</span><span class=\"spacer\"></span><button class=\"btn small\" data-action=\"pt-cleanup\">Remove</button></div>"
        : "") +
      "</section>";

    html +=
      '<section class="card"><div class="service-head"><div class="logo" style="background:#2b1a5e;color:#c9b8ff">Pr</div><div class="service-text"><b>Premiere Pro</b><small>Where your results go in the project</small></div>' +
      (P.hasPremiere ? '<span class="badge ready">Connected</span>' : '<span class="badge">Preview mode</span>') + "</div>" +
      adv("Bin name", "binName", "AI Studio") +
      '<div class="switch-row" style="margin-top:12px"><button class="switch' + (s.autoImport ? " on" : "") + '" data-action="toggle-autoimport"><span></span></button>Add every new result to my project automatically</div></section>';

    html +=
      modelsCard() + spendCard() +
      '<section class="card"><div class="service-head" style="margin-bottom:8px"><div class="logo claude">C</div><div class="service-text"><b>Claude model</b><small>Opus writes the best prompts; Haiku is cheapest</small></div></div><div class="chips">' +
      [
        ["claude-opus-5-5", "Opus 5.5 · best"],
        ["claude-sonnet-5-5", "Sonnet 5.5 · faster"],
        ["claude-haiku-5-5", "Haiku 5.5 · cheapest"],
      ]
        .map((m) => '<button class="chip' + (s.claudeModel === m[0] ? " active" : "") + '" data-action="claude-model" data-id="' + m[0] + '">' + m[1] + "</button>")
        .join("") +
      "</div></section>";

    html +=
      '<section class="card"><div class="service-head" style="margin-bottom:8px"><div class="logo" style="background:#2c2c36;color:#c9b8ff">' + I.layers + '</div><div class="service-text"><b>Batch processing</b><small>How many to make at the same time. Lower it if a service says you are sending too many.</small></div></div>' +
      '<label class="field-label">Takes per shot (retry budget)</label><div class="chips">' +
      [1, 2, 3, 5].map((n) => '<button class="chip' + (Number(s.retryBudget) === n ? " active" : "") + '" data-action="batch-limit" data-k="retryBudget" data-v="' + n + '">' + n + "</button>").join("") +
      '</div><label class="field-label">Pictures at once</label><div class="chips">' +
      [1, 2, 3, 4, 6].map((n) => '<button class="chip' + (Number(s.batchImages) === n ? " active" : "") + '" data-action="batch-limit" data-k="batchImages" data-v="' + n + '">' + n + "</button>").join("") +
      '</div><label class="field-label">Videos at once</label><div class="chips">' +
      [1, 2, 3, 4].map((n) => '<button class="chip' + (Number(s.batchVideos) === n ? " active" : "") + '" data-action="batch-limit" data-k="batchVideos" data-v="' + n + '">' + n + "</button>").join("") +
      "</div></section>";

    html +=
      '<section class="card"><button class="collapser" data-action="toggle-advanced">Advanced settings<span class="spacer"></span>' + (ui.advanced ? I.chevronUp : I.chevronDown) + "</button>";
    if (ui.advanced) {
      html +=
        '<div class="help">Only change these if a service tells you a model name or address is different for your account.</div>' +
        adv("BytePlus address", "arkBaseUrl") +
        adv("Seedream model ID", "seedreamModel") +
        adv("Seedance model ID", "seedanceModel") +
        adv("BytePlus region (portraits)", "byteplusRegion", "ap-southeast-1") +
        adv("ModelArk project (portraits only work with videos in the same project)", "arkProject", "default") +
        adv("Storage bucket (leave empty: a private one is created)", "tosBucket", "") +
        adv("Higgsfield address", "higgsfieldBaseUrl") +
        adv("Higgsfield picture model", "higgsfieldImageModel") +
        adv("Higgsfield video model", "higgsfieldVideoModel") +
        adv("Extra Higgsfield picture settings (JSON)", "higgsfieldImageExtra", '{"resolution": "1080p"}') +
        adv("Extra Higgsfield video settings (JSON)", "higgsfieldVideoExtra", '{"resolution": "720p"}') +
        '<label class="field-label">How hard Claude thinks</label><div class="chips">' +
        ["low", "medium", "high"].map((e) => '<button class="chip' + (s.claudeEffort === e ? " active" : "") + '" data-action="effort" data-id="' + e + '">' + e[0].toUpperCase() + e.slice(1) + "</button>").join("") +
        "</div>" +
        '<div class="row" style="margin-top:14px"><button class="btn small ghost" data-action="reset-advanced">Reset to defaults</button></div>';
    }
    html += "</section>";

    html +=
      '<div class="privacy">' + I.lock + "<div>Your keys are kept in your computer's secure keychain and are only ever sent to their own service. Pictures and videos are saved on this computer.</div></div>";
    $("#view").innerHTML = html;
  }

  function rateInput(key, value, unit) {
    return '<div class="rate"><input type="text" data-rate="' + esc(key) + '" value="' + esc(String(value)) + '" /><span>' + unit + "</span></div>";
  }

  /** Default models, resolution and the editable price table used for every estimate. */
  function modelsCard() {
    const PRC = Studio.pricing;
    const sel = Studio.panels.select;
    const r = PRC.rates();
    const s = store.settings;
    const opts = (list, cur) => {
      const o = list.map((m) => ({ id: m.id, label: m.label }));
      if (!o.some((x) => x.id === cur)) o.push({ id: cur, label: "Custom: " + cur });
      return o;
    };
    const rows = [];
    PRC.IMAGE_MODELS.byteplus.forEach((m) => rows.push(["BytePlus · " + m.label, rateInput("img:" + m.id, r["img:" + m.id] != null ? r["img:" + m.id] : m.price, "$ / picture")]));
    PRC.VIDEO_MODELS.byteplus.forEach((m) => rows.push(["BytePlus · " + m.label, rateInput("vid:" + m.id, r["vid:" + m.id] != null ? r["vid:" + m.id] : m.perMTokens, "$ / 1M tokens")]));
    PRC.IMAGE_MODELS.higgsfield.forEach((m) => rows.push(["Higgsfield · " + m.label, rateInput("img:" + m.id, r["img:" + m.id] != null ? r["img:" + m.id] : m.credits, "credits / picture")]));
    PRC.VIDEO_MODELS.higgsfield.forEach((m) => rows.push(["Higgsfield · " + m.label, rateInput("vid:" + m.id, r["vid:" + m.id] != null ? r["vid:" + m.id] : m.creditsPerSecond, "credits / second")]));
    rows.push(["Higgsfield credit price", rateInput("usdPerCredit", r.usdPerCredit, "$ / credit")]);
    return (
      '<section class="card"><div class="service-head"><div class="logo" style="background:#203a2c;color:#7fe0b0">' + I.coin + '</div><div class="service-text"><b>Models & costs</b><small>Which models to use, and the prices behind every estimate</small></div></div>' +
      '<div class="picker-row"><div class="picker"><label class="field-label">BytePlus picture</label>' + sel("st-model", opts(PRC.IMAGE_MODELS.byteplus, s.seedreamModel), s.seedreamModel, 'data-k="seedreamModel"') + "</div>" +
      '<div class="picker"><label class="field-label">Picture size</label>' + sel("st-model", PRC.IMAGE_RES, s.imageRes || "2K", 'data-k="imageRes"') + "</div></div>" +
      '<div class="picker-row"><div class="picker"><label class="field-label">BytePlus video</label>' + sel("st-model", opts(PRC.VIDEO_MODELS.byteplus, s.seedanceModel), s.seedanceModel, 'data-k="seedanceModel"') + "</div>" +
      '<div class="picker"><label class="field-label">Video size</label>' + sel("st-videores", PRC.VIDEO_RES, ui.video.resolution, "") + "</div></div>" +
      '<div class="picker-row"><div class="picker"><label class="field-label">Higgsfield picture</label>' + sel("st-model", opts(PRC.IMAGE_MODELS.higgsfield, s.higgsfieldImageModel), s.higgsfieldImageModel, 'data-k="higgsfieldImageModel"') + "</div>" +
      '<div class="picker"><label class="field-label">Higgsfield video</label>' + sel("st-model", opts(PRC.VIDEO_MODELS.higgsfield, s.higgsfieldVideoModel), s.higgsfieldVideoModel, 'data-k="higgsfieldVideoModel"') + "</div></div>" +
      '<button class="collapser" style="margin-top:12px" data-action="toggle-rates">Prices used for estimates<span class="spacer"></span>' + (ui.ratesOpen ? I.chevronUp : I.chevronDown) + "</button>" +
      (ui.ratesOpen
        ? '<div class="help">Starting estimates — set them from your ModelArk console and Higgsfield plan. Seedance is billed by tokens: width × height × 24 fps × seconds ÷ 1024 (a 5 s 720p shot ≈ 108k tokens).</div>' +
          '<div class="rates">' + rows.map((x) => '<div class="rate-row"><span>' + esc(x[0]) + "</span>" + x[1] + "</div>").join("") + "</div>"
        : "") +
      "</section>"
    );
  }

  /** What's been spent, by service, by type and by episode (estimates from the price table). */
  function spendCard() {
    const PRC = Studio.pricing;
    const sum = PRC.summary();
    const p = Studio.production.project;
    const proj = p ? PRC.summary((x) => x.project === Studio.production.projectFolder()) : null;
    const rowsOf = (obj) =>
      Object.keys(obj)
        .sort((a, b) => obj[b].usd - obj[a].usd)
        .map((k) => '<div class="spend-row"><span>' + esc(k) + '</span><span class="muted">' + obj[k].count + "×</span><b>" + PRC.money(obj[k].usd) + "</b></div>")
        .join("");
    return (
      '<section class="card"><div class="service-head"><div class="logo" style="background:#203a2c;color:#7fe0b0">' + I.coin + '</div><div class="service-text"><b>Spending so far</b><small>Estimated from the prices above' + (sum.count ? " · " + sum.count + " requests" : "") + "</small></div>" +
      '<div class="spend-total">' + PRC.money(sum.total) + "</div></div>" +
      (sum.count
        ? '<div class="spend-cols"><div><div class="field-label">By service</div>' + rowsOf(sum.byService) + '</div><div><div class="field-label">By type</div>' + rowsOf(sum.byKind) + "</div></div>" +
          (proj && proj.count ? '<div class="field-label">' + esc(p.title || "This project") + " · by episode</div>" + rowsOf(proj.byUnit) : "") +
          (sum.credits ? '<div class="help">Higgsfield credits used: ' + Math.round(sum.credits) + "</div>" : "") +
          '<div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn small ghost" data-action="spend-reset">Reset</button></div>'
        : '<div class="help">Nothing spent yet. Every picture, video and Claude request is added here.</div>') +
      "</section>"
    );
  }

  async function saveAndTest(id) {
    const inputs = document.querySelectorAll("[data-secret]");
    for (let i = 0; i < inputs.length; i++) await store.saveSecret(inputs[i].getAttribute("data-secret"), inputs[i].value);
    if (!store.has(id)) {
      store.status[id] = "unknown";
      ui.test[id + "Msg"] = "";
      toast("Paste your key first.");
      return render();
    }
    ui.test[id] = "testing";
    render();
    try {
      await { claude: Studio.claude, byteplus: Studio.byteplus, higgsfield: Studio.higgsfield }[id].test();
      store.status[id] = "ready";
      ui.test[id + "Msg"] = "All good — you're connected.";
    } catch (e) {
      store.status[id] = "problem";
      ui.test[id + "Msg"] = e.message + (e.detail ? "  (" + e.service + " said: " + e.detail + ")" : "");
    }
    ui.test[id] = "";
    render();
  }

  // ---------- render + events ----------

  function render() {
    renderStatus();
    const views = {
      create: renderCreate,
      script: () => Studio.scriptView.render(),
      assets: () => Studio.assetsView.render(),
      uploads: () => Studio.uploadsView.render(),
      library: renderLibrary,
      settings: renderSettings,
    };
    // Keep the scroll position across redraws (UXP may reset it when the content is replaced).
    const view = $("#view");
    const top = view ? view.scrollTop : 0;
    (views[ui.tab] || renderCreate)();
    if (view && view.scrollTop !== top) view.scrollTop = top;
    renderPicker();
    renderBatchBar();
    Studio.panels.renderChat();
  }

  const actions = {
    tab: (el) => setTab(el.getAttribute("data-tab")),
    mode: (el) => {
      if (ui.mode === el.getAttribute("data-mode")) return;
      ui.mode = el.getAttribute("data-mode");
      ui.improved = "";
      render();
    },
    example: (el) => {
      const list = ui.mode === "image" ? IMAGE_EXAMPLES : VIDEO_EXAMPLES;
      ui.idea = list[Number(el.getAttribute("data-i"))];
      ui.improved = "";
      render();
    },
    engine: (el) => {
      ui[el.getAttribute("data-kind")].engine = el.getAttribute("data-engine");
      saveOpts();
      render();
    },
    hmodel: (el) => {
      ui[el.getAttribute("data-kind")].model = el.getAttribute("data-id");
      saveOpts();
      render();
    },
    ratio: (el) => {
      ui[el.getAttribute("data-kind")].ratio = el.getAttribute("data-id");
      saveOpts();
      render();
    },
    duration: (el) => {
      ui.video.duration = Number(el.getAttribute("data-d"));
      saveOpts();
      render();
    },
    resolution: (el) => {
      ui.video.resolution = el.getAttribute("data-id");
      saveOpts();
      render();
    },
    "toggle-audio": () => {
      ui.video.audio = !ui.video.audio;
      saveOpts();
      render();
    },
    "toggle-improved": () => {
      ui.useImproved = !ui.useImproved;
      render();
    },
    improve,
    generate,
    retry: (el) => retry(el.getAttribute("data-id")),
    dismiss: (el) => jobs.dismiss(el.getAttribute("data-id")),
    detail: (el) => {
      const id = el.getAttribute("data-id");
      ui.showDetail[id] = !ui.showDetail[id];
      renderJobs();
    },
    "pick-start": () => {
      ui.picker = true;
      renderPicker();
    },
    "pick-file": pickFile,
    "clear-start": () => {
      ui.start = null;
      render();
    },
    "close-picker": () => {
      ui.picker = false;
      renderPicker();
    },
    "use-start": (el) => {
      ui.start = libItem(el.getAttribute("data-id"));
      ui.picker = false;
      render();
    },
    animate: (el) => animate(el.getAttribute("data-id")),
    import: (el) => importItem(el.getAttribute("data-id")),
    "import-all": importAll,
    copy: async (el) => {
      const it = libItem(el.getAttribute("data-id"));
      if (it) toast((await P.copyText(it.prompt)) ? "Prompt copied" : "Couldn't reach the clipboard");
    },
    delete: (el) => {
      const it = store.removeFromLibrary(el.getAttribute("data-id"));
      if (it) P.deleteMedia(it.fileName);
      if (ui.start && it && ui.start.id === it.id) ui.start = null;
      render();
      toast("Deleted from your Library (it stays in your Premiere project if you added it)");
    },
    "lib-filter": (el) => {
      ui.libFilter = el.getAttribute("data-id");
      render();
    },
    reveal: (el) => {
      const id = el.getAttribute("data-id");
      const inputs = document.querySelectorAll("[data-secret]");
      for (let i = 0; i < inputs.length; i++) store.secrets[inputs[i].getAttribute("data-secret")] = inputs[i].value;
      ui.reveal[id] = !ui.reveal[id];
      render();
    },
    "save-test": (el) => saveAndTest(el.getAttribute("data-id")),
    open: (el) => P.openExternal(el.getAttribute("data-url")),
    "toggle-autoimport": () => {
      store.saveSettings({ autoImport: !store.settings.autoImport });
      render();
    },
    "claude-model": (el) => {
      store.saveSettings({ claudeModel: el.getAttribute("data-id") });
      render();
    },
    effort: (el) => {
      store.saveSettings({ claudeEffort: el.getAttribute("data-id") });
      render();
    },
    "toggle-advanced": () => {
      ui.advanced = !ui.advanced;
      render();
    },
    "reset-advanced": () => {
      const d = store.DEFAULT_SETTINGS;
      const keys = ["byteplusRegion", "arkProject", "tosBucket", "arkBaseUrl", "seedreamModel", "seedanceModel", "higgsfieldBaseUrl", "higgsfieldImageModel", "higgsfieldVideoModel", "higgsfieldImageExtra", "higgsfieldVideoExtra", "claudeEffort"];
      const patch = {};
      keys.forEach((k) => (patch[k] = d[k]));
      store.saveSettings(patch);
      render();
      toast("Advanced settings reset");
    },
  };

  document.addEventListener("click", (e) => {
    const el = closestAttr(e.target, "data-action");
    if (!el) return;
    // Clicks inside the picker sheet shouldn't close it via the backdrop.
    if (el.getAttribute("data-action") === "close-picker" && el.className === "sheet-backdrop" && closestAttr(e.target, "data-stop")) return;
    if (el.disabled) return;
    const fn = actions[el.getAttribute("data-action")];
    if (fn) fn(el, e);
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (Studio.panels.onInput(t) || Studio.uploadsView.onInput(t) || Studio.scriptView.onInput(t)) return;
    const bind = t.getAttribute("data-bind");
    if (bind === "idea") ui.idea = t.value;
    else if (bind === "improved") ui.improved = t.value;
    const rate = t.getAttribute("data-rate");
    if (rate) {
      const v = parseFloat(t.value);
      if (!isNaN(v)) Studio.pricing.setRate(rate, v);
      return;
    }
    const setting = t.getAttribute("data-setting");
    if (setting) store.saveSettings({ [setting]: t.value });
  });

  // Hover to preview videos.
  document.addEventListener("mouseover", (e) => {
    const v = e.target;
    if (v && v.tagName === "VIDEO" && v.getAttribute("data-hoverplay") != null && v.play) {
      try {
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      } catch (err) {
        /* ignore */
      }
    }
  });
  document.addEventListener("mouseout", (e) => {
    const v = e.target;
    if (v && v.tagName === "VIDEO" && v.pause) v.pause();
  });

  // Live elapsed timers on running jobs.
  setInterval(() => {
    const els = document.querySelectorAll("[data-elapsed]");
    for (let i = 0; i < els.length; i++) els[i].textContent = fmtElapsed(Date.now() - Number(els[i].getAttribute("data-elapsed")));
  }, 1000);

  jobs.onChange(() => {
    renderStatus();
    if (ui.tab === "create") renderJobs();
    else if (ui.tab === "script") Studio.scriptView.refreshParts();
    else if (ui.tab === "library") renderLibrary();
    else if (ui.tab === "assets" && !typing()) Studio.assetsView.render();
  });

  Object.assign(actions, Studio.scriptView.actions, Studio.assetsView.actions, Studio.uploadsView.actions, Studio.panels.actions, {
    "set-model": (el) => {
      const kind = el.getAttribute("data-kind");
      if (ui[kind].engine === "byteplus") store.saveSettings(kind === "image" ? { seedreamModel: el.value } : { seedanceModel: el.value });
      else ui[kind].model = el.value;
      saveOpts();
      render();
    },
    "set-res": (el) => {
      if (el.getAttribute("data-kind") === "image") store.saveSettings({ imageRes: el.value });
      else ui.video.resolution = el.value;
      saveOpts();
      render();
    },
  });

  // Dropdowns (<select data-change="action">).
  document.addEventListener("change", (e) => {
    const el = e.target;
    const name = el && el.getAttribute && el.getAttribute("data-change");
    if (name && actions[name]) actions[name](el, e);
  });

  document.addEventListener("keydown", (e) => Studio.panels.onKey(e));

  function typing() {
    const a = document.activeElement;
    return !!(a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT"));
  }

  Studio.production.onChange(() => {
    renderStatus();
    if (ui.tab === "assets" && !typing()) Studio.assetsView.render();
    if (ui.tab === "uploads" && !typing()) Studio.uploadsView.render();
    if (ui.tab !== "script") return;
    const a = document.activeElement;
    if (a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT")) Studio.scriptView.refreshParts();
    else Studio.scriptView.render();
  });

  Studio.queue.onChange(() => {
    renderBatchBar();
    if (ui.tab === "script") Studio.scriptView.refreshParts();
  });

  // ---------- batch bar (visible on every tab while a batch runs) ----------

  function renderBatchBar() {
    const bar = $("#batchbar");
    if (!bar) return;
    const q = Studio.queue.summary();
    document.body.className = q.total ? "has-batch" : "";
    if (!q.total) {
      bar.className = "batchbar hidden";
      bar.innerHTML = "";
      return;
    }
    const finished = q.done + q.failed + q.cancelled;
    const pct = Math.round((finished / q.total) * 100);
    const state = q.active ? (q.paused ? "Paused" : "Batch running") : q.failed ? "Batch finished with problems" : "Batch finished";
    bar.className = "batchbar" + (q.failed ? " has-failed" : "") + (q.active ? "" : " finished");
    bar.innerHTML =
      '<div class="bb-top"><span class="bb-title">' + I.layers + state + '</span><span class="bb-count">' + finished + " / " + q.total + "</span></div>" +
      '<div class="progress determinate"><i style="width:' + pct + '%"></i></div>' +
      '<div class="bb-sub">' + [q.running && q.running + " making now", q.waiting && q.waiting + " waiting", q.done && q.done + " done", q.failed && q.failed + " failed"].filter(Boolean).join(" · ") + "</div>" +
      '<div class="bb-actions">' +
      (q.active ? (q.paused ? '<button class="btn small primary" data-action="q-resume">Resume</button>' : '<button class="btn small" data-action="q-pause">Pause</button>') + '<button class="btn small ghost" data-action="q-cancel">Cancel waiting</button>' : "") +
      (q.failed ? '<button class="btn small" data-action="q-retry">Retry failed</button>' : "") +
      (!q.active ? '<button class="btn small ghost" data-action="q-clear">Close</button>' : "") +
      "</div>";
  }

  Object.assign(actions, {
    "q-pause": () => Studio.queue.pause(),
    "q-resume": () => Studio.queue.resume(),
    "q-cancel": () => {
      Studio.queue.cancelWaiting();
      toast("Cancelled what was waiting. Anything already being made will finish.");
    },
    "q-retry": () => Studio.queue.retryFailed(),
    "q-clear": () => Studio.queue.clearFinished(),
    "pt-test": async () => {
      const inputs = document.querySelectorAll("[data-secret]");
      for (let i = 0; i < inputs.length; i++) await store.saveSecret(inputs[i].getAttribute("data-secret"), inputs[i].value);
      ui.ptTest = "testing";
      render();
      try {
        ui.ptTest = await Studio.portraits.test();
      } catch (e) {
        ui.ptTest = [{ step: "Check", ok: false, error: e.message }];
      }
      render();
    },
    "pt-cleanup": async () => {
      try {
        const n = await Studio.references.cleanup();
        toast("Removed " + n + " unused portrait(s)", "ok");
      } catch (e) {
        toast(e.message, "error");
      }
      render();
    },
    "st-model": (el) => {
      store.saveSettings({ [el.getAttribute("data-k")]: el.value });
      render();
    },
    "st-videores": (el) => {
      ui.video.resolution = el.value;
      saveOpts();
      render();
    },
    "toggle-rates": () => {
      ui.ratesOpen = !ui.ratesOpen;
      render();
    },
    "spend-reset": () => {
      store.saveSettings({ spend: [] });
      toast("Spending reset");
      render();
    },
    "batch-limit": (el) => {
      store.saveSettings({ [el.getAttribute("data-k")]: Number(el.getAttribute("data-v")) });
      render();
    },
  });

  function activeJob(match) {
    return jobs.list.find((j) => j.status === "working" && match(j));
  }

  Studio.kit = { esc, I, toast, needKey, mediaTag, shape, RATIOS, phaseText, timeAgo, engineMini, importItem, activeJob, libItem, modelPickers, estimate };

  async function boot() {
    await store.load();
    if (!P.getPref("imageOpts", null)) ui.image.engine = firstEngine();
    if (!P.getPref("videoOpts", null)) ui.video.engine = firstEngine();
    if (Studio.demo) Studio.demo.setup(ui);
    render();
  }

  // Register the panel with UXP (harmless in the browser preview).
  try {
    require("uxp").entrypoints.setup({ panels: { aiStudioPanel: { show() {} } } });
  } catch (e) {
    /* not in UXP */
  }

  Studio.ui = ui;
  Studio.render = render;
  boot();
})();
