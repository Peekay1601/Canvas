// Claude turns a free-form prompt into a list of audio items for ElevenLabs.
// Plain fetch to the Messages API: the panel runs in Premiere's UXP runtime (no Node, no bundler),
// so the Node SDK isn't available here.
(function () {
  const S = () => window.AIA.settings;

  const PLAN_SCHEMA = {
    type: "object",
    properties: {
      summary: { type: "string", description: "One or two sentences on what will be generated." },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["speech", "sfx", "music"] },
            name: { type: "string", description: "Short file-friendly name, e.g. 'VO intro line'." },
            text: {
              type: "string",
              description: "speech: the exact words to speak. sfx/music: the generation prompt.",
            },
            voice_id: { type: "string", description: "speech: a voice_id from the provided list. Otherwise empty." },
            duration_seconds: { type: "number", description: "sfx/music length in seconds; 0 = let the model decide. 0 for speech." },
            start_offset_seconds: { type: "number", description: "Where this starts, in seconds after the playhead." },
            notes: { type: "string", description: "Anything the editor should know. Empty if nothing." },
          },
          required: ["type", "name", "text", "voice_id", "duration_seconds", "start_offset_seconds", "notes"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "items"],
    additionalProperties: false,
  };

  const SYSTEM = [
    "You are an audio producer working inside an Adobe Premiere Pro panel.",
    "The editor describes the audio they want. Break it into separate ElevenLabs generations:",
    "- speech: voiceover or dialogue. Put only the words to speak in `text`; ElevenLabs v4 audio tags like [whispers], [laughs], [excited] are allowed inline. Pick the best-fitting voice_id from the voice list. Never invent a voice_id; if the list is empty, leave it empty and say so in notes.",
    "- sfx: one sound effect per item, prompt written as a concrete sound description (source, action, space, perspective). 0.5–30 seconds.",
    "- music: instrumental music, prompt covering genre, mood, instruments, tempo and structure. 3–600 seconds.",
    "Set start_offset_seconds so the items line up the way the editor described (0 = at the playhead).",
    "If the editor says \"my voice\" or names a voice, use the matching voice from the list.",
    "Keep the plan to what was asked for; do not add extra items the editor didn't request.",
  ].join("\n");

  async function plan(userPrompt, context, voices) {
    const voiceList = voices.length
      ? voices.map((v) => "- " + v.voice_id + " | " + v.name + (v.description ? " | " + v.description : "")).join("\n")
      : "(no voices available)";
    const parts = ["Available ElevenLabs voices (voice_id | name | description):", voiceList];
    if (context) parts.push("", "Premiere sequence context:", JSON.stringify(context));
    parts.push("", "Request:", userPrompt);

    return structuredCall(SYSTEM, parts.join("\n"), PLAN_SCHEMA);
  }

  // One Messages API call whose answer is JSON matching `schema`.
  // `content` is a string or an array of content blocks (text, image, document).
  async function structuredCall(system, content, schema, opts) {
    opts = opts || {};
    const key = await S().getKey("claude");
    if (!key) throw new Error("Add your Claude API key in Settings.");
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        // Re-runs the request on a fallback model if the primary model declines it.
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: S().get("claudeModel"),
        max_tokens: opts.maxTokens || 16000,
        system,
        messages: [{ role: "user", content }],
        output_config: { effort: opts.effort || "medium", format: { type: "json_schema", schema } },
        fallbacks: "default",
      }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = (data.error && data.error.message) || resp.statusText;
      throw new Error("Claude " + resp.status + ": " + msg);
    }
    if (data.stop_reason === "refusal") {
      const why = data.stop_details && data.stop_details.explanation;
      throw new Error("Claude declined this request" + (why ? ": " + why : "."));
    }
    if (data.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off; try fewer stills or a shorter range.");

    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error("Couldn't read Claude's answer.");
    }
  }

  const VOICE_SCHEMA = {
    type: "object",
    properties: {
      name: { type: "string", description: "Short voice name, e.g. 'Warm Narrator'." },
      voice_description: {
        type: "string",
        description: "20–1000 characters for ElevenLabs Voice Design: age, gender, accent, tone, pace, texture, recording quality.",
      },
      preview_text: {
        type: "string",
        description: "100–1000 characters the voice will read as a preview, in the style it will be used for.",
      },
    },
    required: ["name", "voice_description", "preview_text"],
    additionalProperties: false,
  };

  const VOICE_SYSTEM = [
    "You write prompts for ElevenLabs Voice Design inside an Adobe Premiere Pro panel.",
    "Turn the editor's brief into a precise voice description: age range, gender, accent, pitch, tone, pace, texture and emotional colour, plus 'studio-quality recording'.",
    "Keep voice_description between 20 and 1000 characters.",
    "Write a preview_text of 100–1000 characters in the language and style the voice will be used for, so the editor can judge it in context.",
    "Never describe or imitate a specific real, named person.",
  ].join("\n");

  async function designVoice(brief) {
    const result = await structuredCall(VOICE_SYSTEM, brief, VOICE_SCHEMA);
    result.voice_description = result.voice_description.slice(0, 1000);
    if (result.preview_text.length > 1000) result.preview_text = result.preview_text.slice(0, 1000);
    return result;
  }


  // ----- film analysis: shared media -----------------------------------------
  // film = { context, stills: [{ index, seconds, b64 }], script: { kind: "text"|"pdf", name, text|b64 }, clips: [...] }
  function filmContent(film) {
    const U = window.AIA.util;
    const blocks = [];
    const ctx = film.context || {};
    blocks.push({
      type: "text",
      text: "Premiere project: " + (ctx.project || "?") + "\nSequence: " + (ctx.sequence || "?") +
        "\nAnalysed range: " + U.fmtTime(film.start || 0) + " to " + U.fmtTime((film.start || 0) + (film.duration || 0)) +
        " (" + (film.duration || 0) + " s)\n" + film.stills.length + " stills from the timeline follow, in order, each labelled with its timeline time.",
    });
    film.stills.forEach((st) => {
      blocks.push({ type: "text", text: "Still " + st.index + " at " + U.fmtTime(st.seconds) + " (" + st.seconds + " s)" });
      blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: st.b64 } });
    });
    if (film.clips && film.clips.length) {
      blocks.push({
        type: "text",
        text: "Audio clips on the timeline (possible dub files; names often contain character names):\n" +
          film.clips.map((c) => "- " + c.name + " | A" + (c.trackIndex + 1) + " | " + U.fmtTime(c.startSec) + "–" + U.fmtTime(c.endSec)).join("\n"),
      });
    }
    if (film.dubFiles && film.dubFiles.length) {
      blocks.push({
        type: "text",
        text: "Dubbing files the editor uploaded (one full-length file per character; the file name usually is the character's name):\n" +
          film.dubFiles.map((d) => "- " + d.name).join("\n"),
      });
    }
    if (film.dubSheet) {
      blocks.push({ type: "text", text: "Dubbing cue sheet / dialogue list (character names and lines): " + film.dubSheet.name });
      if (film.dubSheet.kind === "pdf") {
        blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: film.dubSheet.b64 } });
      } else {
        blocks.push({ type: "text", text: "<dub_cue_sheet>\n" + film.dubSheet.text + "\n</dub_cue_sheet>" });
      }
    }
    if (film.script) {
      blocks.push({ type: "text", text: "Script (backup reference only; the picture comes first): " + film.script.name });
      if (film.script.kind === "pdf") {
        blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: film.script.b64 } });
      } else {
        blocks.push({ type: "text", text: "<script>\n" + film.script.text + "\n</script>" });
      }
    } else {
      blocks.push({ type: "text", text: "No script was supplied." });
    }
    // Cache the stills + script so the cast and sound passes don't pay for them twice.
    blocks[blocks.length - 1].cache_control = { type: "ephemeral" };
    return blocks;
  }

  const FILM_SYSTEM = [
    "You are the post-production assistant inside an Adobe Premiere Pro panel, working on a film.",
    "You receive evenly spaced stills from the editor's timeline (each labelled with its time), an optional script and the names of audio clips on the timeline.",
    "You cannot hear the audio and you only see the stills, so motion between stills is inferred: say so where it matters.",
    "The picture is the primary reference; the script is backup for names, dialogue and context the picture cannot show.",
  ].join("\n");

  // ----- cast: characters + voice prompts --------------------------------------
  const CAST_SCHEMA = {
    type: "object",
    properties: {
      characters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Short lowercase id, e.g. 'ravi'." },
            name: { type: "string", description: "Character name: from the dubbing file names and dubbing cue sheet first, then the script, otherwise a short visual description like 'Old Priest'." },
            name_source: { type: "string", enum: ["dub_file", "script", "visual"] },
            age_range: { type: "string", description: "e.g. 'late 60s'." },
            gender: { type: "string" },
            look: { type: "string", description: "Appearance seen in the stills: build, face, hair, costume, period. One or two sentences." },
            personality: { type: "string", description: "Bearing and temperament as seen or as the script states." },
            voice_prompt: { type: "string", description: "ElevenLabs Voice Design description, 150–900 characters: age, gender, accent and region fitting the film's cultural setting, pitch, timbre, pace, texture, emotional colour, and 'studio-quality recording'. Grounded in the character's age and look." },
            preview_line: { type: "string", description: "100–900 characters this character would say, in the film's language and register. Use the character's real lines from the script when available." },
            best_still: { type: "integer", description: "Still number with the clearest view of this character's face; 0 if they can't be identified in any still." },
            dub_file: { type: "string", description: "Exact name of the uploaded dubbing file for this character, or empty." },
            stills: { type: "array", items: { type: "integer" }, description: "Still numbers where the character appears." },
            dub_clips: { type: "array", items: { type: "string" }, description: "Exact names of timeline audio clips that are this character's dub/dialogue. Empty if none match." },
            notes: { type: "string", description: "Uncertainties worth flagging. Empty if none." },
          },
          required: ["id", "name", "name_source", "age_range", "gender", "look", "personality", "voice_prompt", "preview_line", "best_still", "dub_file", "stills", "dub_clips", "notes"],
          additionalProperties: false,
        },
      },
    },
    required: ["characters"],
    additionalProperties: false,
  };

  async function analyzeCast(film) {
    const content = filmContent(film).concat([{
      type: "text",
      text: [
        "TASK: map the characters.",
        "List every distinct speaking or prominent on-screen character (skip background extras).",
        "Every uploaded dubbing file is one character: list each of them, even when you can't match them to a face (best_still 0).",
        "Name characters from the dubbing file names and the dubbing cue sheet first, then the script, otherwise describe them visually.",
        "Match faces in the stills to those names using the script and cue sheet (who speaks when, ages, descriptions).",
        "Match timeline audio clips to characters by their names; never guess a clip that doesn't clearly belong.",
        "Write a voice_prompt from the character's age, look, bearing and the film's cultural and period setting. Never describe or imitate a real, named person.",
      ].join("\n"),
    }]);
    const out = await structuredCall(FILM_SYSTEM, content, CAST_SCHEMA, { maxTokens: 16000 });
    out.characters.forEach((c) => {
      c.voice_prompt = c.voice_prompt.slice(0, 1000);
      if (c.preview_line.length > 1000) c.preview_line = c.preview_line.slice(0, 1000);
    });
    return out;
  }

  // ----- sound: cue sheet from the master brief ------------------------------------
  const CUE_SCHEMA = {
    type: "object",
    properties: {
      scene: {
        type: "object",
        properties: {
          setting_period: { type: "string" },
          emotion_arc: { type: "string", description: "starting feeling → change → final feeling" },
          perspective: { type: "string" },
          key_moments: { type: "string", description: "Timestamps of key dramatic moments." },
          ending: { type: "string" },
        },
        required: ["setting_period", "emotion_arc", "perspective", "key_moments", "ending"],
        additionalProperties: false,
      },
      cues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "e.g. 'AMB-01', 'FOL-07'." },
            category: { type: "string", enum: ["ambience", "foley", "human", "hard_fx", "designed_fx"] },
            title: { type: "string", description: "Short cue name for the cue sheet." },
            start_seconds: { type: "number", description: "Timeline time in seconds." },
            duration_seconds: { type: "number", description: "Length on the timeline. Ambience may run long; other cues 0.5–30 s." },
            prompt: { type: "string", description: "Self-contained ElevenLabs sound-effects prompt under 450 characters: source, material, action, intensity, space and perspective. No music, no speech." },
            evidence: { type: "string", enum: ["observed", "script", "inferred"] },
            stills: { type: "array", items: { type: "integer" } },
            loop: { type: "boolean", description: "true for continuous beds that should loop seamlessly (ambience, room tone)." },
            intensity: { type: "string", enum: ["soft", "medium", "strong"] },
            mood: { type: "string", enum: ["Tense", "Hopeful", "Sad", "Epic", "Romantic", "Mysterious", "Joyful", "Calm", "Divine", "Action", "Dark", "Other"], description: "Emotional mood of the moment this cue serves." },
            notes: { type: "string" },
          },
          required: ["id", "category", "title", "start_seconds", "duration_seconds", "prompt", "evidence", "stills", "loop", "intensity", "mood", "notes"],
          additionalProperties: false,
        },
      },
      limitations: { type: "string", description: "What could not be judged from stills alone." },
    },
    required: ["scene", "cues", "limitations"],
    additionalProperties: false,
  };

  async function analyzeSound(film, brief) {
    const content = filmContent(film).concat([{
      type: "text",
      text: [
        "TASK: build the sound cue sheet for this footage following the brief below. Each cue becomes one ElevenLabs sound-effects generation.",
        "Categories: ambience (beds, room tone, environment layers), foley (footsteps, cloth, props, touch), human (non-verbal vocals: breaths, efforts, crowd walla — never words), hard_fx (impacts, doors, weapons, vehicles, machinery), designed_fx (supernatural, transitions, subjective or stylised sounds).",
        "Time every cue to the still where its cause is visible. Mark evidence honestly: observed (visible in a still), script (only the script says so), inferred (plausible between stills).",
        "Do not add music, narration or dialogue cues.",
        "",
        "=== MASTER SOUND DESIGN BRIEF ===",
        brief,
      ].join("\n"),
    }]);
    return structuredCall(FILM_SYSTEM, content, CUE_SCHEMA, { maxTokens: 32000 });
  }

  // ----- music: score prompt ------------------------------------------------------
  const MUSIC_SCHEMA = {
    type: "object",
    properties: {
      title: { type: "string", description: "Short cue title, e.g. 'Dawn at the river'." },
      prompt: { type: "string", description: "ElevenLabs Music prompt under 900 characters: genre and tradition, mood arc, instrumentation, tempo (BPM), key/mode, dynamics and structure with timings." },
    },
    required: ["title", "prompt"],
    additionalProperties: false,
  };

  async function writeMusicPrompt(mood, brief, seconds, scene) {
    const lines = [
      "Write one film score cue prompt for ElevenLabs Music.",
      "Mood: " + mood,
      "Length: " + seconds + " seconds",
      brief ? "What the editor wants: " + brief : "",
      scene ? "Scene analysis from the footage: " + JSON.stringify(scene) : "",
      "Fit the film's cultural and period setting where known. Instrumental unless the editor asks for voices.",
    ];
    return structuredCall("You are a film composer writing prompts for an AI music generator inside Adobe Premiere Pro.", lines.filter(Boolean).join("\n"), MUSIC_SCHEMA);
  }

  async function ping() {
    const key = await S().getKey("claude");
    if (!key) throw new Error("No Claude key saved.");
    const resp = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
    });
    if (!resp.ok) throw new Error("Claude key rejected (" + resp.status + ").");
  }

  window.AIA.claude = { plan, designVoice, analyzeCast, analyzeSound, writeMusicPrompt, ping };
})();
