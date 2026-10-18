/*
 * Demo mode for the browser preview only: open index.html?demo in a browser to click
 * through the panel with fake services and sample pictures. Never active inside Premiere.
 */
(function () {
  const Studio = window.Studio;
  if (Studio.platform.isUXP || !/[?&]demo\b/.test(location.search)) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Little painted scenes so the Library has something to show.
  const SCENES = [
    ["#0f1c3f", "#e86a4a", "#f7c66b", "#1b1530"],
    ["#14324a", "#4fa3b8", "#d7f0f0", "#0b1c26"],
    ["#2a0f3a", "#c04a8f", "#ffb36b", "#160a20"],
    ["#1d2a1a", "#7aa35a", "#f3e7a1", "#0f160d"],
    ["#301a12", "#c9733a", "#ffd9a0", "#1a0d08"],
    ["#101827", "#5b6cff", "#c7cdff", "#080c16"],
  ];

  function scene(i, w, h) {
    const [sky, mid, sun, ground] = SCENES[i % SCENES.length];
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + sky + '"/><stop offset="0.75" stop-color="' + mid + '"/></linearGradient></defs>' +
      '<rect width="100%" height="100%" fill="url(#g)"/>' +
      '<circle cx="' + w * (0.3 + 0.1 * (i % 4)) + '" cy="' + h * 0.55 + '" r="' + h * 0.16 + '" fill="' + sun + '" opacity="0.92"/>' +
      '<path d="M0 ' + h * 0.72 + " L" + w * 0.22 + " " + h * 0.5 + " L" + w * 0.42 + " " + h * 0.68 + " L" + w * 0.63 + " " + h * 0.46 + " L" + w + " " + h * 0.7 + " L" + w + " " + h + " L0 " + h + 'Z" fill="' + ground + '" opacity="0.9"/>' +
      '<path d="M0 ' + h * 0.86 + " L" + w * 0.35 + " " + h * 0.74 + " L" + w * 0.7 + " " + h * 0.84 + " L" + w + " " + h * 0.78 + " L" + w + " " + h + " L0 " + h + 'Z" fill="#000" opacity="0.35"/>' +
      "</svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  const SAMPLE_PROMPTS = [
    "Golden-hour wide shot of a roadside chai stall on a misty hill road, kettle steam catching the light, 35mm, warm amber palette",
    "Rain-soaked Mumbai street at night, neon reflections on wet asphalt, a lone scooter rider, anamorphic flare",
    "Portrait of a young woman laughing under a blue tarp in monsoon rain, shallow depth of field, soft bulb light",
    "Aerial view of terraced tea gardens at sunrise, low fog between the rows, cinematic, muted greens",
    "Close-up of a brass kettle pouring chai into a clay cup, slow steam, dark slate background",
    "Empty train platform at dawn, blue hour, one figure with an umbrella, long lens compression",
  ];

  let n = 0;

  Studio.demo = {
    setup(ui) {
      const store = Studio.store;
      store.secrets = { anthropic: "demo", ark: "demo", higgsfieldKey: "demo", higgsfieldSecret: "demo", byteplusAk: "demo", byteplusSk: "demo" };
      store.status = { claude: "ready", byteplus: "ready", higgsfield: "ready" };
      if (!store.library.length) {
        store.library = SAMPLE_PROMPTS.map((p, i) => ({
          id: "demo-" + i,
          kind: i === 1 || i === 4 ? "video" : "image",
          engine: i % 2 ? "higgsfield" : "byteplus",
          engineLabel: i === 1 ? "DoP · Higgsfield" : i === 4 ? "Seedance · BytePlus" : i % 2 ? "Soul · Higgsfield" : "Seedream · BytePlus",
          prompt: p,
          ratio: "16:9",
          duration: 5,
          src: scene(i, 640, 360),
          poster: scene(i, 640, 360),
          remoteUrl: "",
          path: "",
          fileName: "",
          createdAt: Date.now() - (i + 1) * 23 * 60000,
          imported: i < 2,
        }));
      }
      if (/script/.test(location.search)) {
        Studio.production.project = demoProject(store);
        // Folders, costs and uploads, as a real project would have them.
        store.library.forEach((x, i) => {
          x.folder = x.folder || (x.kind === "video" ? "Monsoon Chai/EP01/Shots" : ["Monsoon Chai/EP01/Characters", "Monsoon Chai/EP01/Locations"][i % 2]);
          x.cost = x.cost || { usd: x.kind === "video" ? 0.27 : 0.04 };
        });
        if (!store.library.some((x) => x.origin === "upload")) {
          store.library.push(
            { id: "up-1", kind: "image", origin: "upload", name: "nani_casting.jpg", src: scene(5, 640, 480), folder: "Monsoon Chai/EP01/Characters", fileName: "x", bytes: 840000, tags: { use: "character", assetId: "RAVI", unit: "EP01", slot: "extra" }, createdAt: Date.now() - 3600e3 },
            { id: "up-2", kind: "video", origin: "upload", name: "dolly_ref.mp4", src: "", poster: scene(1, 640, 360), folder: "Monsoon Chai/EP01/Uploads/Reference videos", fileName: "y", bytes: 6400000, tags: { use: "camera", unit: "EP01", shotId: "EP01_S002", note: "slow dolly-in" }, createdAt: Date.now() - 1800e3 },
            { id: "up-3", kind: "image", origin: "upload", name: "stall_location_scout.png", src: scene(3, 640, 360), folder: "Monsoon Chai/Uploads/Inbox", fileName: "z", bytes: 2100000, tags: {}, createdAt: Date.now() - 600e3 }
          );
          const s2 = Studio.production.project.units[0].shots[1];
          s2.videoRefs = [{ itemId: "up-2", tag: "camera", label: "Camera-move reference", note: "slow dolly-in" }];
        }
        if (!(store.settings.spend || []).length) {
          const sp = [];
          for (let i = 0; i < 9; i++) sp.push({ service: "BytePlus", model: "seedream-4-5-251128", kind: "image", usd: 0.04, project: "Monsoon Chai", unit: "EP01" });
          for (let i = 0; i < 4; i++) sp.push({ service: "BytePlus", model: "dreamina-seedance-2-5-260628", kind: "video", usd: 0.32, project: "Monsoon Chai", unit: i < 3 ? "EP01" : "EP02" });
          for (let i = 0; i < 2; i++) sp.push({ service: "Higgsfield", model: "higgsfield-ai/soul/standard", kind: "image", usd: 0.12, credits: 2, project: "Monsoon Chai", unit: "EP02" });
          for (let i = 0; i < 6; i++) sp.push({ service: "Claude", model: "claude-opus-5-5", kind: "text", usd: 0.03, project: "Monsoon Chai", unit: "EP01" });
          store.settings.spend = sp;
        }
      }
      if (/upload/.test(location.search)) {
        Studio.production.usePastedText("x");
        Object.assign(Studio.production.pending, { kind: "pdf", name: "Monsoon Chai - Season 1.pdf", bytes: 2400000 });
      }
      if (/runbatch/.test(location.search)) {
        setTimeout(() => {
          Studio.ui.image.engine = "byteplus";
          Studio.production.queueBatch({ images: true, frames: true, videos: true }, [], false);
        }, 300);
      }
      if (/improved/.test(location.search)) {
        ui.idea = "girl laughing at a chai stall in the rain";
        ui.improved =
          "A young woman in a damp mustard kurta laughs openly under a sagging blue tarp at a roadside chai stall, heavy monsoon rain sheeting past a single warm tungsten bulb. Shot on a 50mm lens at eye level, shallow depth of field, rain drops catching the light in soft bokeh, steam curling from a clay cup in her hands. Deep teal night against amber skin tones, fine film grain, natural skin texture.";
      }
      if (/video/.test(location.search)) {
        ui.mode = "video";
        ui.start = store.library[2];
        ui.idea = "She looks up from her cup and laughs, camera slowly pushes in";
      }
    },
  };

  const CAST = [
    ["character", "RAVI", "Ravi", "Tea seller in his 60s, lean, silver stubble, kind tired eyes, faded maroon shirt and a checked lungi"],
    ["character", "MEERA", "Meera", "Woman in her 20s, long wet hair tied back, mustard cotton kurta, silver nose stud, quick nervous smile"],
    ["costume", "MEERA_RAIN_KURTA", "Meera's rain-soaked kurta", "Mustard cotton kurta darkened by rain, plain dupatta"],
    ["location", "CHAI_STALL_NIGHT", "Chai stall at night", "Roadside tin-roofed stall, blue tarp, one bare tungsten bulb, rain curtain at the edge"],
    ["location", "BUS_STOP", "Empty bus stop", "Concrete shelter, flickering tube light, puddles reflecting sodium street lamps"],
    ["prop", "BRASS_KETTLE", "Brass kettle", "Dented brass kettle with a long spout, soot on the base"],
  ];

  function demoProject(store) {
    const units = [
      ["The Last Bus", "Meera misses the last bus and takes shelter at Ravi's stall as the storm hits."],
      ["Two Cups", "Ravi refuses her money; they trade stories while the rain keeps everyone in."],
      ["Power Cut", "The bulb dies. In the dark, Meera admits why she ran from home."],
      ["Morning", "The rain stops. She has to decide whether to get on the first bus."],
      ["The Letter", "Ravi finds the letter she left behind."],
      ["Return", "A year later, a stranger asks Ravi for two cups."],
    ];
    const assets = {};
    const pics = { RAVI: ["demo-2"], MEERA: ["demo-5", "demo-3"], MEERA_RAIN_KURTA: ["demo-0"], CHAI_STALL_NIGHT: ["demo-4", "demo-1", "demo-0"] };
    const refs = {
      RAVI: { status: "active", assetId: "demo-asset-1" },
      MEERA: { status: "processing", assetId: "demo-asset-2" },
      MEERA_RAIN_KURTA: { status: "ready", note: "sent with each shot" },
    };
    CAST.forEach(([kind, id, name, description]) => {
      const cands = pics[id] || [];
      const locked = refs[id] ? cands[0] : null;
      assets[id] = { id, kind, name, description, unit: "EP01", hasFace: kind === "character", candidates: cands, lockedId: locked, imageId: cands[0] || null,
        ref: refs[id] || { status: "none" },
        prompt: "Photoreal identity reference of " + name.toLowerCase() + ": " + description + ". Neutral soft light, plain grey backdrop, full outfit visible, natural skin texture, 50mm, eye level." };
    });
    const shots = [
      ["Rain on the tin roof", 6, ["RAVI", "CHAI_STALL_NIGHT"], "demo-0", "demo-1", "approved"],
      ["Ravi pours the tea", 5, ["RAVI", "BRASS_KETTLE"], "demo-4", "demo-4", "review"],
      ["Meera runs in from the rain", 8, ["MEERA", "MEERA_RAIN_KURTA", "CHAI_STALL_NIGHT"], null, null, "ready"],
      ["First smile", 7, ["MEERA", "RAVI"], null, null, "draft"],
      ["The bus drives past", 5, ["BUS_STOP"], null, null, "draft"],
    ];
    return {
      id: "demo", status: "ready", scriptName: "Monsoon Chai - Season 1.pdf", scriptKind: "pdf", ratio: "16:9", maxShots: 12, mode: "now",
      title: "Monsoon Chai", type: "Web series", unitKind: "episode",
      why: "Six numbered episodes of 8–10 pages each, with a cast that carries across them.",
      logline: "A runaway and an old tea seller are stranded together through one monsoon night that changes both their lives.",
      look: { id: "warm_nostalgic", name: "Warm nostalgic film", bible: "" },
      shotMode: "references",
      bible: { camera: "35mm and 50mm primes, mostly locked-off with slow push-ins; handheld only in the storm.", lighting: "One bare tungsten bulb as the key, cold blue rain as the edge light.", performance: "Underplayed, long silences, small gestures.", dialogue: "Telugu dialogue written into prompts as short quoted lines." },
      assets,
      units: units.map(([title, summary], i) => ({
        number: i + 1, code: "EP0" + (i + 1), title, summary,
        status: i < 4 ? "done" : i === 4 ? "working" : "pending",
        assetIds: Object.keys(assets),
        shots: shots.map(([t, d, ids, frame, video, status], k) => {
          const handles = ids.map((id, n) => ({ handle: "@image" + (n + 1), assetId: id, kind: assets[id].kind, name: assets[id].name, description: assets[id].description }));
          const first = i === 0;
          return {
            id: "EP0" + (i + 1) + "_S00" + (k + 1), title: t, duration: d, assetIds: ids, continues: k === 2,
            framePrompt: "Opening frame: " + t.toLowerCase() + ". Warm tungsten bulb against blue rain, 35mm, eye level.",
            videoPrompt: "The rain keeps falling as " + t.toLowerCase() + "; the camera pushes in slowly at eye level on a 35mm lens, warm practical light holding on the faces.",
            finalPrompt: first && status !== "draft" ? "@image1 as the old tea seller stands behind the counter of @image" + ids.length + ", rain sheeting off the blue tarp behind him. He wipes a glass, glances up at the road and gives a tired half-smile. Locked-off 35mm at chest height; the bare tungsten bulb swings slightly, warm on his face against the cold blue rain." : "",
            handles: first && status !== "draft" ? handles : [],
            status: first ? status : "draft",
            attempts: first && video ? (status === "approved" ? [{ id: "demo-3", status: "rejected", note: "too dark" }, { id: video, status: "approved" }] : [{ id: video, status: "review" }]) : [],
            approvedId: first && status === "approved" ? video : null,
            frameId: first ? frame : null, videoId: first ? video : null,
          };
        }),
      })),
      running: true,
    };
  }

  // Fake services: same shapes as the real ones, with realistic waits.
  Studio.claude = {
    async improveImagePrompt({ idea }) {
      await sleep(1400);
      return "Cinematic still: " + idea + ". Eye-level 50mm, shallow depth of field, warm practical light against a cool night, fine film grain, natural skin texture.";
    },
    async improveVideoPrompt({ idea }) {
      await sleep(1400);
      return (idea || "Natural motion") + ". The camera holds at eye level, then pushes in slowly on a 50mm lens; rain keeps falling in the background, steam drifts from the cup.";
    },
    async analyseScript() {
      await sleep(1500);
      return {
        title: "Monsoon Chai", type: "web series", unitKind: "episode", why: "Three numbered episodes with a recurring cast.",
        logline: "A runaway and an old tea seller are stranded together through one monsoon night.", suggestedLook: "warm_nostalgic",
        units: [1, 2, 3].map((n) => ({ number: n, title: ["The Last Bus", "Two Cups", "Power Cut"][n - 1], summary: "Episode " + n + " summary." })),
        characters: CAST.filter((c) => c[0] === "character").map((c) => ({ id: c[1], name: c[2], description: c[3] })),
        locations: CAST.filter((c) => c[0] === "location").map((c) => ({ id: c[1], name: c[2], description: c[3] })),
      };
    },
    breakdownArgs: (o) => o,
    async writeShotPrompt({ handles }) {
      await sleep(1200);
      return handles.map((h) => h.handle + " as " + h.name).join(", ") + " — the camera holds at eye level, then pushes in slowly.";
    },
    async changeImagePrompt({ instruction }) {
      await sleep(1000);
      return "CHANGE: " + instruction + ".\nPRESERVE EXACTLY: his face, silver stubble and expression, the checked lungi, the pose, the tungsten bulb light, the blue tarp and rain behind him, the framing.";
    },
    async changeVideoPrompt({ prompt, instruction }) {
      await sleep(1000);
      return prompt + " " + instruction + ".";
    },
    async chat({ history }) {
      await sleep(900);
      return "Three ideas for Ravi in this shot:\n1. Start on his hands, then tilt up to his face as the kettle lifts.\n2. Shoot through the rain curtain so the bulb flares behind him.\n3. Hold on a reaction: he notices Meera before she speaks.\nPROMPT: Close-up of an old tea seller's weathered hands lifting a dented brass kettle, slow tilt up to his tired, kind face, bare tungsten bulb flaring through the rain behind him, 50mm, warm against cold blue";
    },
    async patchShotPrompt({ shot }) {
      await sleep(1200);
      return shot.finalPrompt + " He looks at her, not the camera.";
    },
    async breakdownUnit() {
      await sleep(1200);
      return {
        summary: "Meera takes shelter at the stall.",
        assets: CAST.map(([kind, id, name, description]) => ({ kind, id, name, description, prompt: "Reference image of " + name + ". " + description })),
        shots: [0, 1, 2].map((k) => ({ title: "Shot " + (k + 1), duration: 6, assetIds: ["RAVI", "CHAI_STALL_NIGHT"], framePrompt: SAMPLE_PROMPTS[k], videoPrompt: "Slow push-in while the rain continues." })),
      };
    },
    async createBatch() {
      return { id: "msgbatch_demo", status: "in_progress" };
    },
    async getBatch() {
      return { id: "msgbatch_demo", status: "in_progress", counts: { processing: 2, succeeded: 1 } };
    },
    async test() {
      await sleep(600);
      return true;
    },
  };

  const fakeEngine = {
    async generateImage(args, onUpdate) {
      onUpdate && onUpdate({ phase: "running" });
      await sleep(2500);
      return { url: scene(n++, 640, 360) };
    },
    async generateVideo(args, onUpdate) {
      onUpdate && onUpdate({ phase: "queued" });
      await sleep(2500);
      onUpdate && onUpdate({ phase: "running" });
      await sleep(/hold/.test(location.search) ? 1e9 : 6000);
      return { url: scene(n++, 640, 360) };
    },
    async uploadImage() {
      return "";
    },
    async test() {
      await sleep(600);
      return true;
    },
  };
  Studio.byteplus = fakeEngine;
  Studio.portraits = Object.assign({}, Studio.portraits, {
    enabled: () => true,
    cfg: () => ({ limit: 50 }),
    groupFor: async () => "demo-group",
    createAsset: async () => "demo-asset-" + n++,
    getAsset: async () => (await sleep(2500), { status: "active", reason: "" }),
    stash: async () => ({ key: "", url: "https://example.com/x.png" }),
    unstash: async () => {},
    deleteAsset: async () => {},
    test: async () => [
      { step: "Access Key + portrait library", ok: true, detail: "3 portrait group(s) in project 'default'" },
      { step: "Private storage bucket", ok: true, detail: "bucket seedance-portraits-3f9a2c1b7d4e" },
      { step: "Upload + download link", ok: true, detail: "uploaded, fetched through a 30-minute link, deleted" },
    ],
  });
  Studio.higgsfield = fakeEngine;
})();
