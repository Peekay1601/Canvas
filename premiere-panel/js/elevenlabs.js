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

  const OWN_CATEGORIES = ["cloned", "generated", "professional"];

  // Every voice in the user's ElevenLabs account, their own voices first.
  async function listVoices() {
    const all = [];
    let token = null;
    for (let page = 0; page < 10; page++) {
      const resp = await request("/v2/voices", { query: { page_size: 100, next_page_token: token } });
      const data = await resp.json();
      (data.voices || []).forEach((v) => all.push(v));
      if (!data.has_more || !data.next_page_token) break;
      token = data.next_page_token;
    }
    const voices = all.map((v) => {
      const labels = v.labels ? Object.values(v.labels).filter(Boolean) : [];
      return {
        voice_id: v.voice_id,
        name: v.name,
        category: v.category || "",
        own: OWN_CATEGORIES.indexOf(v.category) !== -1,
        labels,
        previewUrl: v.preview_url || "",
        description: [labels.join(", "), v.description].filter(Boolean).join(" — "),
      };
    });
    voices.sort((a, b) => (a.own === b.own ? a.name.localeCompare(b.name) : a.own ? -1 : 1));
    return voices;
  }

  async function deleteVoice(voiceId) {
    await request("/v1/voices/" + encodeURIComponent(voiceId), { method: "DELETE" });
  }

  // Downloads a voice's sample clip.
  async function downloadPreview(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Couldn't download the preview (" + resp.status + ").");
    return resp.arrayBuffer();
  }

  async function textToSpeech(voiceId, text, outputFormat) {
    const resp = await request("/v1/text-to-speech/" + encodeURIComponent(voiceId), {
      method: "POST",
      query: { output_format: outputFormat || S().get("outputFormat") },
      body: { text, model_id: S().get("ttsModel") },
    });
    return resp.arrayBuffer();
  }

  async function soundEffect(text, durationSeconds, loop) {
    const body = { text, prompt_influence: 0.4, model_id: "eleven_text_to_sound_v2" };
    // Seamless loop, for ambience beds that run longer than one 30 s generation.
    if (loop) body.loop = true;
    // ElevenLabs accepts 0.5–30 s; leave it out to let the model pick.
    if (durationSeconds > 0) body.duration_seconds = Math.min(30, Math.max(0.5, durationSeconds));
    const resp = await request("/v1/sound-generation", {
      method: "POST",
      query: { output_format: S().get("outputFormat") },
      body,
    });
    return resp.arrayBuffer();
  }

  async function music(prompt, durationSeconds, instrumental) {
    const body = { prompt, force_instrumental: instrumental !== false };
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
    if (item.type === "sfx") return soundEffect(item.text, item.duration_seconds, item.loop);
    if (item.type === "music") return music(item.text, item.duration_seconds, item.instrumental);
    throw new Error("Unknown item type: " + item.type);
  }

  // Generate one plan item; returns bytes ready to write to a .mp3 / .wav file.
  async function generate(item) {
    const bytes = await generateRaw(item);
    const fmt = S().get("outputFormat");
    if (fmt.startsWith("pcm_")) return pcmToWav(bytes, parseInt(fmt.split("_")[1], 10) || 44100);
    return bytes;
  }

  // ----- voices: clone and design --------------------------------------

  // Builds a multipart/form-data body by hand (UXP's FormData can't carry binary files reliably).
  function multipart(fields, files) {
    const boundary = "----aia" + Date.now().toString(16) + Math.random().toString(16).slice(2);
    const enc = (s) => {
      const bytes = unescape(encodeURIComponent(s)); // UTF-8
      const out = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) out[i] = bytes.charCodeAt(i);
      return out;
    };
    const parts = [];
    Object.keys(fields).forEach((k) => {
      parts.push(enc("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + k + "\"\r\n\r\n" + fields[k] + "\r\n"));
    });
    files.forEach((f) => {
      parts.push(enc("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + f.field + "\"; filename=\"" +
        f.name.replace(/"/g, "") + "\"\r\nContent-Type: " + (f.type || "application/octet-stream") + "\r\n\r\n"));
      parts.push(new Uint8Array(f.data));
      parts.push(enc("\r\n"));
    });
    parts.push(enc("--" + boundary + "--\r\n"));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const body = new Uint8Array(total);
    let off = 0;
    parts.forEach((p) => { body.set(p, off); off += p.length; });
    return { body: body.buffer, contentType: "multipart/form-data; boundary=" + boundary };
  }

  const AUDIO_TYPES = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", ogg: "audio/ogg" };

  // Instant voice clone from the user's own recordings. files: [{ name, data: ArrayBuffer }]
  async function cloneVoice(name, files, removeNoise) {
    const key = await S().getKey("elevenlabs");
    if (!key) throw new Error("Add your ElevenLabs API key in Settings.");
    const { body, contentType } = multipart(
      { name, remove_background_noise: removeNoise ? "true" : "false" },
      files.map((f) => ({
        field: "files",
        name: f.name,
        type: AUDIO_TYPES[(f.name.split(".").pop() || "").toLowerCase()],
        data: f.data,
      }))
    );
    const resp = await fetch(BASE + "/v1/voices/add", {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": contentType },
      body,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const d = data.detail;
      throw new Error("ElevenLabs " + resp.status + ": " + ((d && (d.message || d)) || resp.statusText));
    }
    return data.voice_id;
  }

  // Plain base64 decoder (atob isn't guaranteed in every UXP version).
  function base64ToBytes(b64) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const lookup = new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
    const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
    const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
    let o = 0;
    for (let i = 0; i < clean.length; i += 4) {
      const a = lookup[clean.charCodeAt(i)], b = lookup[clean.charCodeAt(i + 1)];
      const c = lookup[clean.charCodeAt(i + 2)], d = lookup[clean.charCodeAt(i + 3)];
      out[o++] = (a << 2) | (b >> 4);
      if (i + 2 < clean.length) out[o++] = ((b & 15) << 4) | (c >> 2);
      if (i + 3 < clean.length) out[o++] = ((c & 3) << 6) | d;
    }
    return out.buffer.slice(0, o);
  }

  // Voice design: returns previews [{ generated_voice_id, bytes }] as MP3.
  async function designVoice(description, text) {
    const resp = await request("/v1/text-to-voice/design", {
      method: "POST",
      query: { output_format: "mp3_44100_128" },
      body: { voice_description: description, text, model_id: "eleven_multilingual_ttv_v2" },
    });
    const data = await resp.json();
    return (data.previews || []).map((p) => ({
      generated_voice_id: p.generated_voice_id,
      bytes: base64ToBytes(p.audio_base_64),
    }));
  }

  // Keeps a designed preview as a permanent voice in the user's library.
  async function saveDesignedVoice(name, description, generatedVoiceId) {
    const resp = await request("/v1/text-to-voice", {
      method: "POST",
      body: { voice_name: name, voice_description: description, generated_voice_id: generatedVoiceId },
    });
    return (await resp.json()).voice_id;
  }

  // A short MP3 line in a voice, for auditioning voices that have no stored sample.
  function speakSample(voiceId, text) {
    return textToSpeech(voiceId, text, "mp3_44100_128");
  }

  // ----- voice changer (speech to speech) --------------------------------

  // Re-performs a recording in another voice, keeping timing and delivery.
  // Returns bytes ready to write to a .mp3 / .wav file.
  async function changeVoice(voiceId, fileName, bytes, removeNoise) {
    const key = await S().getKey("elevenlabs");
    if (!key) throw new Error("Add your ElevenLabs API key in Settings.");
    if (!voiceId) throw new Error("Pick the voice to change into.");
    const fmt = S().get("outputFormat");
    const ext = (fileName.split(".").pop() || "").toLowerCase();
    const { body, contentType } = multipart(
      { model_id: "eleven_multilingual_sts_v2", remove_background_noise: removeNoise ? "true" : "false" },
      [{ field: "audio", name: fileName, type: AUDIO_TYPES[ext] || "application/octet-stream", data: bytes }]
    );
    const resp = await fetch(
      BASE + "/v1/speech-to-speech/" + encodeURIComponent(voiceId) + "?output_format=" + encodeURIComponent(fmt),
      { method: "POST", headers: { "xi-api-key": key, "Content-Type": contentType }, body }
    );
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      const d = data.detail;
      throw new Error("ElevenLabs " + resp.status + ": " + ((d && (d.message || d)) || resp.statusText));
    }
    const out = await resp.arrayBuffer();
    if (fmt.startsWith("pcm_")) return pcmToWav(out, parseInt(fmt.split("_")[1], 10) || 44100);
    return out;
  }

  function fileExtension() {
    return S().get("outputFormat").startsWith("pcm") ? "wav" : "mp3";
  }

  window.AIA.eleven = {
    listVoices, deleteVoice, downloadPreview, speakSample, generate, fileExtension,
    cloneVoice, designVoice, saveDesignedVoice, changeVoice,
  };
})();
