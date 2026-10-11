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
  async function structuredCall(system, userText, schema) {
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
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: userText }],
        output_config: { effort: "medium", format: { type: "json_schema", schema } },
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
    if (data.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off; try a shorter request.");

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

  window.AIA.claude = { plan, designVoice, ping };
})();
