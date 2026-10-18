/*
 * Claude writes and improves prompts, looks at pictures, and plans storyboards.
 * Raw HTTP to the Messages API: UXP has no Node or bundler, so the npm SDK isn't an option here.
 * The long skill files (Lira, CINEDANCE, Shotlist) go in a cached system block, so repeat
 * requests only pay full price for the short part that changes.
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const { requestJSON, ServiceError } = Studio.http;
  const NAME = "Claude";
  const API_URL = "https://api.anthropic.com/v1/messages";
  const FALLBACK_BETA = "server-side-fallback-2026-07-01";

  const PANEL_RULES = [
    "You are working inside AI Studio, a Premiere Pro panel used by editors who may not be prompt experts.",
    "Override any instruction in the reference material about which language to answer in, about asking clarifying questions, or about response format:",
    "never ask questions, never add commentary, headings, markdown or code fences. Write prompts in natural English prose.",
    "Aspect ratio, duration and resolution are set by the panel, not by the prompt; leave them out of the prompt text.",
  ].join(" ");

  let useFallbacks = true;

  function key() {
    const k = Studio.store.secrets.anthropic;
    if (!k) throw new ServiceError(NAME, "Add your Claude (Anthropic) API key in Settings first.");
    return k;
  }

  function headers(extraBeta) {
    const h = {
      "x-api-key": key(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    };
    if (extraBeta) h["anthropic-beta"] = extraBeta;
    return h;
  }

  /** The Messages API request body (shared by single calls and batches). */
  function buildParams({ system, skill, messages, maxTokens, format, conversational }) {
    const s = Studio.store.settings;
    const systemBlocks = [];
    if (skill) systemBlocks.push({ type: "text", text: skill, cache_control: { type: "ephemeral" } });
    // Prompt-writing tasks get the strict output rules; the chat may talk and ask back.
    systemBlocks.push({ type: "text", text: conversational ? system : PANEL_RULES + "\n\n" + system });
    return {
      model: s.claudeModel,
      max_tokens: maxTokens || 16000,
      system: systemBlocks,
      messages,
      output_config: Object.assign({ effort: s.claudeEffort || "medium" }, format ? { format } : {}),
    };
  }

  /** The text of a finished message, or a plain-language error. */
  function readMessage(data, structured) {
    if (data.stop_reason === "refusal") {
      throw new ServiceError(NAME, "Claude declined this request. Try describing it differently.", JSON.stringify(data.stop_details || {}));
    }
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) throw new ServiceError(NAME, "Claude didn't return any text.", JSON.stringify(data).slice(0, 800));
    if (data.stop_reason === "max_tokens" && structured)
      throw new ServiceError(NAME, "Claude's answer was cut off. Lower the number of shots per episode and try again.");
    return text;
  }

  async function call(args) {
    const body = buildParams(args);
    // If a safety check declines a request, let the API retry it on a fallback model automatically.
    const fallbackOk = useFallbacks && !/haiku/.test(body.model);
    if (fallbackOk) body.fallbacks = "default";

    let data;
    try {
      data = await requestJSON(NAME, API_URL, { method: "POST", headers: headers(fallbackOk ? FALLBACK_BETA : ""), body: JSON.stringify(body) });
    } catch (e) {
      // Accounts or models without the fallback beta: drop it once and retry plainly.
      if (fallbackOk && /fallback/i.test(e.detail || "")) {
        useFallbacks = false;
        return call(args);
      }
      throw e;
    }
    if (data.usage && Studio.pricing) {
      Studio.pricing.record({ service: "Claude", model: body.model, kind: "text", usd: Studio.pricing.claudePrice(body.model, data.usage) });
    }
    return readMessage(data, !!args.format);
  }

  function clean(text) {
    return text
      .replace(/^```[a-z]*\s*/i, "")
      .replace(/```\s*$/, "")
      .replace(/^(prompt|final prompt)\s*:\s*/i, "")
      .trim();
  }

  /** A picture for Claude to look at: an https URL, or a data URL under the 5 MB image limit. */
  function imageBlock(ref) {
    if (/^https:\/\//.test(ref || "")) return { type: "image", source: { type: "url", url: ref } };
    const m = /^data:([^;]+);base64,(.*)$/.exec(ref || "");
    if (!m || m[2].length > 6.5e6) return null;
    return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
  }

  /** Turn a rough idea into a production-ready picture prompt (Lira skill). */
  async function improveImagePrompt({ idea, engineLabel }) {
    const system =
      "Task: rewrite the user's idea as ONE final image-generation prompt for " +
      engineLabel +
      ". 60-150 words, flowing cinematic prose: subject, setting, light, lens/camera feel, palette, texture. Output only the prompt.";
    const text = await call({
      skill: Studio.SKILLS && Studio.SKILLS.lira,
      system,
      messages: [{ role: "user", content: idea }],
      maxTokens: 4000,
    });
    return clean(text);
  }

  /** Turn an idea (and optionally the starting picture) into a video prompt (CINEDANCE skill). */
  async function improveVideoPrompt({ idea, duration, startImage, engineLabel }) {
    const system =
      "Task: write ONE final video-generation prompt for " +
      engineLabel +
      ", for a " +
      duration +
      "-second shot." +
      (startImage
        ? " The attached picture is the first frame: describe the motion, acting and camera move that start from exactly this frame; do not re-describe everything visible, only what matters for continuity."
        : "") +
      " Keep it physically clear: who is visible, the one dominant action, where the camera is and how it moves, light. 50-140 words. Output only the prompt.";
    const content = [];
    const img = startImage && imageBlock(startImage);
    if (img) content.push(img);
    content.push({ type: "text", text: idea && idea.trim() ? idea : "Bring this picture to life with natural, cinematic motion." });
    const text = await call({
      skill: Studio.SKILLS && Studio.SKILLS.cinedance,
      system,
      messages: [{ role: "user", content }],
      maxTokens: 6000,
    });
    return clean(text);
  }

  // ---------- scripts: analyse, then break down each episode / scene / ad shot ----------

  const KIND_WORDS = { episode: "episode", scene: "scene", shot: "ad shot" };

  /** The uploaded script as a cacheable document block, so later calls reuse it at a tenth of the price. */
  function scriptDocument(source) {
    const doc =
      source.kind === "pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: source.base64 } }
        : { type: "document", source: { type: "text", media_type: "text/plain", data: source.text } };
    doc.title = source.name || "Script";
    doc.cache_control = { type: "ephemeral" };
    return doc;
  }

  function entitySchema() {
    return {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "description"],
      properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string" } },
    };
  }

  const ANALYSE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["title", "type", "unitKind", "why", "logline", "suggestedLook", "units", "characters", "locations", "bible"],
    properties: {
      title: { type: "string" },
      type: { type: "string" },
      unitKind: { type: "string", enum: ["episode", "scene", "shot"] },
      why: { type: "string" },
      logline: { type: "string" },
      suggestedLook: { type: "string" },
      units: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["number", "title", "summary"],
          properties: { number: { type: "integer" }, title: { type: "string" }, summary: { type: "string" } },
        },
      },
      characters: { type: "array", items: entitySchema() },
      locations: { type: "array", items: entitySchema() },
      bible: {
        type: "object",
        additionalProperties: false,
        required: ["camera", "lighting", "performance", "dialogue"],
        properties: { camera: { type: "string" }, lighting: { type: "string" }, performance: { type: "string" }, dialogue: { type: "string" } },
      },
    },
  };

  /** Step 1: what kind of production this is, how it divides, and its recurring cast and places. */
  async function analyseScript({ source, unitKind, looks }) {
    const system = [
      "Task: read the whole attached script and set up its production, like a first assistant director.",
      "Judge what it is: a series (divide into episodes), a feature film, short film or documentary (divide into scenes), or an ad, music video or promo (divide into shots).",
      unitKind && unitKind !== "auto"
        ? "The user has chosen to divide it into " + unitKind + "s: set unitKind to '" + unitKind + "'."
        : "Pick unitKind yourself and explain why in one sentence in `why`.",
      "type: a short label such as 'web series', 'short film' or 'advertisement'.",
      "units: every " + (unitKind && unitKind !== "auto" ? unitKind : "unit") + " in order, numbered from 1, each with a short English title and a one-line summary. Follow the script's own numbering when it has one.",
      "characters and locations: the recurring cast and places across the whole script. id in CAPITALS_WITH_UNDERSCORES (e.g. RAVI, CHAI_STALL_NIGHT); description is one visual line used later to keep them consistent (age, build, face, hair, usual clothes; or for places the geography and light sources).",
      "suggestedLook: the id of the look that fits best, from: " + looks.map((l) => l.id + " (" + l.goodFor + ")").join("; ") + ".",
      "bible: the production bible, 2-4 sentences each, consistent with the look you suggest: camera (lenses, movement, coverage style), lighting, performance (acting style), dialogue (language, delivery, how lines are written into video prompts).",
      "Write everything in English, even if the script is in another language.",
    ].join("\n");
    const text = await call({
      system,
      messages: [{ role: "user", content: [scriptDocument(source), { type: "text", text: "Analyse this script." }] }],
      maxTokens: 16000,
      format: { type: "json_schema", schema: ANALYSE_SCHEMA },
    });
    return parseJSON(text);
  }

  const BREAKDOWN_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "assets", "shots"],
    properties: {
      summary: { type: "string" },
      assets: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "id", "name", "description", "prompt", "hasFace", "characterId"],
          properties: {
            kind: { type: "string", enum: ["character", "costume", "location", "prop"] },
            hasFace: { type: "boolean" },
            characterId: { type: "string" },
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            prompt: { type: "string" },
          },
        },
      },
      shots: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "duration", "assetIds", "framePrompt", "videoPrompt", "continues"],
          properties: {
            continues: { type: "boolean" },
            title: { type: "string" },
            duration: { type: "integer" },
            assetIds: { type: "array", items: { type: "string" } },
            framePrompt: { type: "string" },
            videoPrompt: { type: "string" },
          },
        },
      },
    },
  };

  function bibleText(project) {
    const b = project.bible || {};
    const parts = ["camera", "lighting", "performance", "dialogue"].filter((k) => b[k]).map((k) => k[0].toUpperCase() + k.slice(1) + ": " + b[k]);
    return parts.length ? "Project bible — " + parts.join(" ") : "";
  }

  function breakdownSkill() {
    const k = Studio.SKILLS || {};
    return [
      "# SKILL: LIRA (image prompts)\n\n" + (k.lira || ""),
      "# SKILL: SHOTLIST (breaking a script into shots)\n\n" + (k.shotlist || ""),
      "# SKILL: CINEDANCE (video prompts)\n\n" + (k.cinedance || ""),
    ].join("\n\n---\n\n");
  }

  /** The request for one unit's image prompts and video prompts. Used live and in batches. */
  function breakdownArgs({ source, project, unit, knownAssets, maxShots }) {
    const word = KIND_WORDS[project.unitKind] || "unit";
    const known = knownAssets.length
      ? knownAssets.map((a) => "- " + a.kind + " " + a.id + " (" + a.name + "): " + a.description + (a.done ? " [already prepared in an earlier unit: include it with an empty prompt]" : "")).join("\n")
      : "(none yet)";
    const system = [
      "Task: prepare " + unit.code + " — the " + word + " titled '" + unit.title + "' (" + unit.summary + ") — of the attached script for AI generation. Work only on this " + word + ".",
      "Project: " + (project.title || "") + " (" + (project.type || "") + "). Frame shape for shots: " + project.ratio + ".",
      "Project look (apply it to every prompt): " + project.look.bible,
      bibleText(project),
      "",
      "PART 1 — IMAGE PROMPTS (follow the LIRA skill). List every character, costume, location and prop that appears in this " + word + ".",
      "Use the existing IDs below whenever the asset is already known; new IDs are CAPITALS_WITH_UNDERSCORES. For an asset marked 'already prepared', include it with an empty prompt.",
      "Otherwise write one production-ready image prompt per asset, 60-130 words: characters as identity reference images (clear face, neutral light, full outfit visible); costumes as garment-only images (flat lay, hanger or mannequin, no face); locations as clean establishing views with the practical light sources visible; props as clean product-style shots.",
      "description: one visual line, reused to keep the asset consistent in shots.",
      "hasFace: true for human characters (false for animals and creatures); for costumes true only if the image must show it worn. characterId: the character a costume belongs to, else empty.",
      "",
      "PART 2 — VIDEO PROMPTS (follow the SHOTLIST and CINEDANCE skills). Break the action into at most " + maxShots + " shots, in order. One shot = one video generation of 4-15 seconds (it may contain internal cuts); duration in whole seconds.",
      "assetIds: the asset IDs visible in the shot.",
      "framePrompt: the shot's opening frame as a still image prompt (50-110 words). It must stand alone: describe each character with their description, the location, framing, light.",
      "videoPrompt: the final CINEDANCE prompt for the motion that starts from that frame (50-130 words): the one dominant action, acting beat, where the camera is and how it moves, light continuity. Include short dialogue only if the script has it.",
      "continues: true when the shot picks up exactly where the previous shot ended (same action, no cut in time).",
      "summary: two sentences on what happens in this " + word + ".",
      "",
      "Known assets:",
      known,
    ].join("\n");
    return {
      skill: breakdownSkill(),
      system,
      messages: [{ role: "user", content: [scriptDocument(source), { type: "text", text: "Prepare " + unit.code + "." }] }],
      maxTokens: 32000,
      format: { type: "json_schema", schema: BREAKDOWN_SCHEMA },
    };
  }

  async function breakdownUnit(opts) {
    return parseJSON(await call(breakdownArgs(opts)));
  }

  function parseJSON(text) {
    try {
      return JSON.parse(clean(text));
    } catch (e) {
      throw new ServiceError(NAME, "Claude's answer couldn't be read. Try again.", text.slice(0, 500));
    }
  }

  // ---------- final Seedance prompts with frozen @image handles (connector: prepare_shot_prompt) ----------

  function shotBrief({ project, shot, handles, previous }) {
    return [
      "Shot " + shot.id + " — " + shot.title + " (" + shot.duration + " s, frame " + project.ratio + ").",
      "Draft motion: " + shot.videoPrompt,
      "Opening frame: " + shot.framePrompt,
      "Reference images attached to this shot, in this exact order:",
      handles.map((h) => h.handle + " = " + (h.assetId ? h.assetId + " (" + h.kind + ", " + h.name + ")" : h.kind) + ": " + h.description).join("\n") || "(none)",
      previous ? "Previous shot (" + previous.id + "): " + (previous.finalPrompt || previous.videoPrompt) + (shot.continues ? "\nThis shot CONTINUES it with no cut in time: open on exactly how that shot ended, described in words." : "") : "",
      "Project look: " + project.look.bible,
      bibleText(project),
    ].join("\n");
  }

  const SHOT_RULES =
    "Task: write the FINAL Seedance prompt for this shot, following CINEDANCE and the ACTING skill. Refer to each reference by its handle " +
    "(e.g. '@image1 as the man at the counter', 'camera move as in @video1') at least once and never invent other handles. A reference video is only a guide for what its tag says (motion, camera move, look or performance), never its content. Keep it physically clear: who is visible, the one dominant action, " +
    "the acting beat, where the camera is and how it moves, light. 70-160 words. Output only the prompt.";

  async function writeShotPrompt(opts) {
    const k = Studio.SKILLS || {};
    return clean(
      await call({
        skill: "# SKILL: CINEDANCE\n\n" + (k.cinedance || "") + "\n\n---\n\n# SKILL: ACTING\n\n" + (k.acting || ""),
        system: SHOT_RULES,
        messages: [{ role: "user", content: shotBrief(opts) }],
        maxTokens: 8000,
      })
    );
  }

  /** Review loop: the editor rejected a take; fix the prompt from their note (handles stay frozen). */
  async function patchShotPrompt(opts) {
    const k = Studio.SKILLS || {};
    return clean(
      await call({
        skill: "# SKILL: CINEDANCE\n\n" + (k.cinedance || "") + "\n\n---\n\n# SKILL: ACTING\n\n" + (k.acting || ""),
        system:
          SHOT_RULES +
          " This is a repair: the editor reviewed the generated video and rejected it. Keep everything that worked, patch only what the note asks for (use CINEDANCE's common failure fixes). Keep the same handles.",
        messages: [
          {
            role: "user",
            content: shotBrief(opts) + "\n\nCurrent prompt:\n" + opts.shot.finalPrompt + "\n\nEditor's note on the take: " + opts.note,
          },
        ],
        maxTokens: 8000,
      })
    );
  }

  // ---------- "Change with Claude" and the Ask Claude chat ----------

  /**
   * Change a picture. With a picture to edit from (Seedream image-to-image), Claude writes a LIRA edit
   * prompt: a minimal CHANGE plus an exhaustive PRESERVE EXACTLY. Without one, a full new prompt.
   */
  async function changeImagePrompt({ prompt, instruction, imageRef, editing }) {
    const k = Studio.SKILLS || {};
    const system = editing
      ? "Task: the user wants to change the attached picture. Write ONE edit prompt for an image-to-image model that receives this picture: a short CHANGE block with only what the user asked for, then a PRESERVE EXACTLY block listing everything else that must stay identical (identity, face, wardrobe, pose, framing, light, background). In edit prompts, explicit removal is allowed when paired with what fills the gap. Output only the prompt."
      : "Task: rewrite the image-generation prompt so it includes the user's change and keeps everything else. 60-150 words of flowing prose. Output only the prompt.";
    const content = [];
    const img = imageRef && imageBlock(imageRef);
    if (img) content.push(img);
    content.push({ type: "text", text: "Current prompt:\n" + (prompt || "(none)") + "\n\nChange: " + instruction });
    return clean(await call({ skill: k.lira, system, messages: [{ role: "user", content }], maxTokens: 6000 }));
  }

  /** Change a video that isn't part of a shot list: rewrite its prompt with the requested change. */
  async function changeVideoPrompt({ prompt, instruction, frameRef }) {
    const k = Studio.SKILLS || {};
    const content = [];
    const img = frameRef && imageBlock(frameRef);
    if (img) content.push(img);
    content.push({ type: "text", text: "Current video prompt:\n" + (prompt || "(none)") + "\n\nThe editor watched the result and wants this changed: " + instruction });
    return clean(
      await call({
        skill: "# SKILL: CINEDANCE\n\n" + (k.cinedance || ""),
        system: "Task: patch the video prompt so the next generation fixes what the editor asked for. Keep everything that worked; change only what the note asks (use CINEDANCE's common failure fixes). Keep any @image/@video handles exactly. 50-160 words. Output only the prompt.",
        messages: [{ role: "user", content }],
        maxTokens: 6000,
      })
    );
  }

  /**
   * The Ask Claude chat: ideas and advice, aware of what's open in the panel.
   * history: [{ role: "user"|"assistant", text }]. context: a short text block describing what's selected.
   */
  async function chat({ history, context, imageRef }) {
    const k = Studio.SKILLS || {};
    const messages = history.map((m, i) => {
      if (i === history.length - 1 && m.role === "user" && imageRef) {
        const img = imageBlock(imageRef);
        return { role: "user", content: img ? [img, { type: "text", text: m.text }] : m.text };
      }
      return { role: m.role, content: m.text };
    });
    const text = await call({
      skill: "# SKILL: LIRA (image prompts)\n\n" + (k.lira || "") + "\n\n---\n\n# SKILL: CINEDANCE (video prompts)\n\n" + (k.cinedance || ""),
      system:
        "You are the creative partner inside AI Studio, a Premiere Pro panel for making AI pictures and videos. Talk in plain, friendly language; the user may not be technical. " +
        "Be concise: short paragraphs or a short list. When you suggest something the user can generate, put the ready-to-use prompt on its own line starting with 'PROMPT: '. " +
        "You may use markdown-free plain text only.\n\nWhat's open in the panel right now:\n" + (context || "(nothing selected)"),
      messages,
      maxTokens: 8000,
      conversational: true,
    });
    return text;
  }

  // ---------- Message Batches: half price, results within 24 h (usually much sooner) ----------

  const BATCH_URL = "https://api.anthropic.com/v1/messages/batches";

  /** requests: [{ id, args }] where args are what breakdownArgs returns. */
  async function createBatch(requests) {
    const body = { requests: requests.map((r) => ({ custom_id: r.id, params: buildParams(r.args) })) };
    const data = await requestJSON(NAME, BATCH_URL, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    return { id: data.id, status: data.processing_status };
  }

  async function getBatch(id) {
    const data = await requestJSON(NAME, BATCH_URL + "/" + id, { headers: headers() });
    return { id: data.id, status: data.processing_status, counts: data.request_counts || {}, resultsUrl: data.results_url };
  }

  /** Map of custom_id -> { ok, value } with parsed JSON, or { ok: false, error }. */
  async function batchResults(resultsUrl) {
    let resp;
    try {
      resp = await fetch(resultsUrl, { headers: headers() });
    } catch (e) {
      throw new ServiceError(NAME, "Couldn't download the batch results. Check your internet connection.");
    }
    if (!resp.ok) throw new ServiceError(NAME, "Couldn't download the batch results (" + resp.status + ").");
    const out = {};
    (await resp.text()).split("\n").forEach((line) => {
      if (!line.trim()) return;
      const row = JSON.parse(line);
      const r = row.result || {};
      if (r.type !== "succeeded") {
        out[row.custom_id] = { ok: false, error: r.type === "errored" ? (r.error && r.error.error && r.error.error.message) || "Request failed" : "Request " + r.type };
        return;
      }
      if (r.message && r.message.usage && Studio.pricing) {
        // Batches are billed at half price.
        Studio.pricing.record({ service: "Claude", model: r.message.model, kind: "text", usd: Studio.pricing.claudePrice(r.message.model, r.message.usage) / 2, unit: row.custom_id });
      }
      try {
        out[row.custom_id] = { ok: true, value: parseJSON(readMessage(r.message, true)) };
      } catch (e) {
        out[row.custom_id] = { ok: false, error: e.message };
      }
    });
    return out;
  }

  async function cancelBatch(id) {
    await requestJSON(NAME, BATCH_URL + "/" + id + "/cancel", { method: "POST", headers: headers() });
  }

  async function test() {
    await call({ system: "Reply with the single word: ready", messages: [{ role: "user", content: "ping" }], maxTokens: 2000 });
    return true;
  }

  Studio.claude = {
    improveImagePrompt,
    improveVideoPrompt,
    analyseScript,
    breakdownUnit,
    breakdownArgs,
    writeShotPrompt,
    patchShotPrompt,
    changeImagePrompt,
    changeVideoPrompt,
    chat,
    createBatch,
    getBatch,
    batchResults,
    cancelBatch,
    test,
  };
})();
