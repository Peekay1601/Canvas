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

  // 44.1/48 kHz WAV needs a Pro plan. If ElevenLabs refuses it, drop to 24 kHz WAV for the rest
  // of the session so generated audio can still be mixed by the panel.
  let pcmFallback = null;
  function effectiveFormat(fmt) {
    return pcmFallback && /^pcm_(44100|48000)$/.test(fmt) ? pcmFallback : fmt;
  }

  // Runs `call(format)`; on a plan error for high-rate WAV, retries at 24 kHz. Returns { buffer, format }.
  async function withFormat(requested, call) {
    const fmt = effectiveFormat(requested);
    try {
      return { buffer: await call(fmt), format: fmt };
    } catch (e) {
      const status = parseInt((/ElevenLabs (\d+)/.exec(e.message) || [])[1], 10);
      if (/^pcm_(44100|48000)$/.test(fmt) && status >= 400 && status < 500 && status !== 401 && status !== 429) {
        pcmFallback = "pcm_24000";
        return { buffer: await call(pcmFallback), format: pcmFallback };
      }
      throw e;
    }
  }

  function rateOf(fmt) {
    return parseInt(fmt.split("_")[1], 10) || 44100;
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

  // ElevenLabs Voice Library (community voices). Returns { voices, hasMore }.
  async function searchSharedVoices(opts) {
    opts = opts || {};
    const resp = await request("/v1/shared-voices", {
      query: { page_size: 30, page: opts.page || 0, search: opts.search, gender: opts.gender, language: opts.language },
    });
    const data = await resp.json();
    const voices = (data.voices || []).map((v) => ({
      voice_id: v.voice_id,
      owner: v.public_owner_id,
      name: v.name,
      previewUrl: v.preview_url || "",
      description: [[v.gender, v.age, v.accent, v.language, v.descriptive, v.use_case].filter(Boolean).join(", "), v.description]
        .filter(Boolean).join(" — "),
    }));
    return { voices, hasMore: !!data.has_more };
  }

  // Copies a Voice Library voice into the user's own voices; returns the new voice_id.
  async function addSharedVoice(ownerId, voiceId, name) {
    const resp = await request("/v1/voices/add/" + encodeURIComponent(ownerId) + "/" + encodeURIComponent(voiceId), {
      method: "POST",
      body: { new_name: name },
    });
    return (await resp.json()).voice_id;
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

  function textToSpeech(voiceId, text, outputFormat) {
    return withFormat(outputFormat || S().get("outputFormat"), async (fmt) => {
      const resp = await request("/v1/text-to-speech/" + encodeURIComponent(voiceId), {
        method: "POST",
        query: { output_format: fmt },
        body: { text, model_id: S().get("ttsModel") },
      });
      return resp.arrayBuffer();
    });
  }

  async function soundEffect(text, durationSeconds, loop) {
    const body = { text, prompt_influence: 0.4, model_id: "eleven_text_to_sound_v2" };
    // Seamless loop, for ambience beds that run longer than one 30 s generation.
    if (loop) body.loop = true;
    // ElevenLabs accepts 0.5–30 s; leave it out to let the model pick.
    if (durationSeconds > 0) body.duration_seconds = Math.min(30, Math.max(0.5, durationSeconds));
    return withFormat(S().get("outputFormat"), async (fmt) => {
      const resp = await request("/v1/sound-generation", { method: "POST", query: { output_format: fmt }, body });
      return resp.arrayBuffer();
    });
  }

  async function music(prompt, durationSeconds, instrumental) {
    const body = { prompt, force_instrumental: instrumental !== false };
    // Music length is 3 s – 10 min; leave it out to let the model pick.
    if (durationSeconds > 0) body.music_length_ms = Math.round(Math.min(600, Math.max(3, durationSeconds)) * 1000);
    return withFormat(S().get("outputFormat"), async (fmt) => {
      const resp = await request("/v1/music", { method: "POST", query: { output_format: fmt }, body });
      return resp.arrayBuffer();
    });
  }

  // pcm_* formats are raw 16-bit little-endian samples with no header; wrap them in a WAV header.
  // Speech is mono, but music (and some sound effects) come back as interleaved stereo, so the
  // channel count must be right or Premiere plays the file at half speed and garbled.
  function pcmToWav(buffer, sampleRate, channels) {
    const ch = channels || 1;
    const dataLen = buffer.byteLength - (buffer.byteLength % (2 * ch));
    const out = new ArrayBuffer(44 + dataLen);
    const v = new DataView(out);
    const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2 * ch, true);
    v.setUint16(32, 2 * ch, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, dataLen, true);
    new Uint8Array(out, 44).set(new Uint8Array(buffer, 0, dataLen));
    return out;
  }

  // Raw PCM carries no channel count. Interleaved stereo shows in the samples themselves: each
  // sample is far closer to the one two steps on (same channel) than to its neighbour (other
  // channel), or the step inside a frame (L->R) differs from the step across frames (R->next L).
  // The requested length is a second witness; music defaults to stereo when nothing is decisive.
  function pcmChannels(buffer, sampleRate, expectedSeconds, preferStereo) {
    const n = Math.floor(buffer.byteLength / 2);
    if (n % 2) return 1;
    const v = new DataView(buffer);
    let within = 0, across = 0, frameStep = 0;
    for (let i = 0; i + 2 < n; i += 2) {
      const a = v.getInt16(i * 2, true), b = v.getInt16(i * 2 + 2, true), c = v.getInt16(i * 2 + 4, true);
      within += (b - a) * (b - a);
      across += (c - b) * (c - b);
      frameStep += (c - a) * (c - a);
    }
    if (within || across) {
      const lo = Math.min(within, across), hi = Math.max(within, across);
      if (lo < hi * 0.6 || within > frameStep * 1.5) return 2;
      if (lo > hi * 0.9 && within < frameStep) return 1;
    }
    if (expectedSeconds > 0) {
      const asMono = n / sampleRate;
      return Math.abs(asMono / 2 - expectedSeconds) < Math.abs(asMono - expectedSeconds) ? 2 : 1;
    }
    return preferStereo ? 2 : 1;
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

  // Generate one plan item; returns bytes ready to write to a .mp3 / .wav file (see fileExtension).
  async function generate(item) {
    const out = await generateRaw(item);
    if (!out.format.startsWith("pcm_")) return out.buffer;
    const rate = rateOf(out.format);
    const channels = item.type === "speech" ? 1 : pcmChannels(out.buffer, rate, item.duration_seconds, item.type === "music");
    return pcmToWav(out.buffer, rate, channels);
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
  async function speakSample(voiceId, text) {
    return (await textToSpeech(voiceId, text, "mp3_44100_128")).buffer;
  }

  // ----- voice changer (speech to speech) --------------------------------

  // Re-performs a recording in another voice, keeping timing and delivery.
  // Default: bytes ready to write to a .mp3 / .wav file. opts.raw: { samples: Float32Array, sampleRate } (always WAV quality).
  async function changeVoice(voiceId, fileName, bytes, removeNoise, opts) {
    opts = opts || {};
    const key = await S().getKey("elevenlabs");
    if (!key) throw new Error("Add your ElevenLabs API key in Settings.");
    if (!voiceId) throw new Error("Pick the voice to change into.");
    const ext = (fileName.split(".").pop() || "").toLowerCase();
    const requested = opts.raw ? "pcm_44100" : S().get("outputFormat");
    const out = await withFormat(requested, async (fmt) => {
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
      return resp.arrayBuffer();
    });
    if (opts.raw) {
      if (!out.format.startsWith("pcm_")) throw new Error("Expected WAV audio from the voice changer.");
      return { samples: window.AIA.audio.pcm16ToFloat(out.buffer), sampleRate: rateOf(out.format) };
    }
    return out.format.startsWith("pcm_") ? pcmToWav(out.buffer, rateOf(out.format), 1) : out.buffer;
  }

  function fileExtension() {
    return effectiveFormat(S().get("outputFormat")).startsWith("pcm") ? "wav" : "mp3";
  }

  window.AIA.eleven = {
    listVoices, searchSharedVoices, addSharedVoice, deleteVoice, downloadPreview, speakSample, generate, fileExtension,
    cloneVoice, designVoice, saveDesignedVoice, changeVoice,
  };
})();
