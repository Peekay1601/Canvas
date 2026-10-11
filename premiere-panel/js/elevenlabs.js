// ElevenLabs REST calls: voices, text to speech, sound effects, music.
(function () {
  const BASE = "https://api.elevenlabs.io";
  const S = () => window.AIA.settings;

  async function request(path, { method = "GET", query, body } = {}) {
    const key = await S().getKey("elevenlabs");
    if (!key) throw new Error("Add your ElevenLabs API key in Settings.");
    let url = BASE + path;
    if (query) {
      const qs = Object.keys(query)
        .filter((k) => query[k] != null && query[k] !== "")
        .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(query[k]))
        .join("&");
      if (qs) url += "?" + qs;
    }
    const headers = { "xi-api-key": key };
    if (body) headers["Content-Type"] = "application/json";
    const resp = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!resp.ok) {
      let detail = "";
      try {
        const err = await resp.json();
        detail = (err.detail && (err.detail.message || err.detail)) || JSON.stringify(err);
      } catch (e) {
        detail = await resp.text().catch(() => "");
      }
      throw new Error("ElevenLabs " + resp.status + ": " + (typeof detail === "string" ? detail : JSON.stringify(detail)));
    }
    return resp;
  }

  async function listVoices() {
    const resp = await request("/v2/voices", { query: { page_size: 100 } });
    const data = await resp.json();
    return (data.voices || []).map((v) => ({
      voice_id: v.voice_id,
      name: v.name,
      description: [v.labels && Object.values(v.labels).join(", "), v.description].filter(Boolean).join(" — "),
    }));
  }

  async function textToSpeech(voiceId, text) {
    const resp = await request("/v1/text-to-speech/" + encodeURIComponent(voiceId), {
      method: "POST",
      query: { output_format: S().get("outputFormat") },
      body: { text, model_id: S().get("ttsModel") },
    });
    return resp.arrayBuffer();
  }

  async function soundEffect(text, durationSeconds) {
    const body = { text, prompt_influence: 0.4 };
    // ElevenLabs accepts 0.5–30 s; leave it out to let the model pick.
    if (durationSeconds > 0) body.duration_seconds = Math.min(30, Math.max(0.5, durationSeconds));
    const resp = await request("/v1/sound-generation", {
      method: "POST",
      query: { output_format: S().get("outputFormat") },
      body,
    });
    return resp.arrayBuffer();
  }

  async function music(prompt, durationSeconds) {
    const body = { prompt };
    // Music length is 3 s – 10 min; leave it out to let the model pick.
    if (durationSeconds > 0) body.music_length_ms = Math.round(Math.min(600, Math.max(3, durationSeconds)) * 1000);
    const resp = await request("/v1/music", {
      method: "POST",
      query: { output_format: S().get("outputFormat") },
      body,
    });
    return resp.arrayBuffer();
  }

  // pcm_* formats are raw 16-bit mono little-endian samples; wrap them in a WAV header.
  function pcmToWav(buffer, sampleRate) {
    const dataLen = buffer.byteLength;
    const out = new ArrayBuffer(44 + dataLen);
    const v = new DataView(out);
    const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, dataLen, true);
    new Uint8Array(out, 44).set(new Uint8Array(buffer));
    return out;
  }

  async function generateRaw(item) {
    if (item.type === "speech") {
      if (!item.voice_id) throw new Error('"' + item.name + '" has no voice selected.');
      return textToSpeech(item.voice_id, item.text);
    }
    if (item.type === "sfx") return soundEffect(item.text, item.duration_seconds);
    if (item.type === "music") return music(item.text, item.duration_seconds);
    throw new Error("Unknown item type: " + item.type);
  }

  // Generate one plan item; returns bytes ready to write to a .mp3 / .wav file.
  async function generate(item) {
    const bytes = await generateRaw(item);
    const fmt = S().get("outputFormat");
    if (fmt.startsWith("pcm_")) return pcmToWav(bytes, parseInt(fmt.split("_")[1], 10) || 44100);
    return bytes;
  }

  function fileExtension() {
    return S().get("outputFormat").startsWith("pcm") ? "wav" : "mp3";
  }

  window.AIA.eleven = { listVoices, generate, fileExtension };
})();
