// Shared UI plumbing: DOM helpers, status log, tabs, events, voices, stills, voice change.
(function () {
  const A = window.AIA;
  const uxp = require("uxp");
  const $ = (id) => document.getElementById(id);

  // ----- DOM ---------------------------------------------------------------
  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.keys(props || {}).forEach((k) => {
      const v = props[k];
      if (v == null) return;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "value") node.value = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    (children || []).forEach((c) => c && node.appendChild(c));
    return node;
  }

  // ----- status + activity log ----------------------------------------------
  function log(msg, kind) {
    const line = el("div", { class: kind || "", text: new Date().toLocaleTimeString() + "  " + msg });
    $("log").appendChild(line);
    $("log").scrollTop = $("log").scrollHeight;
    $("statusText").textContent = msg;
    $("statusDot").className = "dot " + (kind || "busy");
  }

  // Runs an async action with its button disabled; errors go to the status bar.
  async function busy(button, fn) {
    if (button) button.disabled = true;
    try {
      return await fn();
    } catch (e) {
      log(e.message || String(e), "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  // ----- tabs ------------------------------------------------------------------
  function goTo(tab) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.id === "tab-" + tab));
    emit("tab", tab);
  }

  // ----- controls -------------------------------------------------------------
  function segmented(id, onChange) {
    const root = $(id);
    root.querySelectorAll(".seg").forEach((seg) => {
      seg.addEventListener("click", () => {
        root.querySelectorAll(".seg").forEach((s) => s.classList.toggle("active", s === seg));
        onChange(seg.dataset.value);
      });
    });
    return () => root.querySelector(".seg.active").dataset.value;
  }

  // Renders filter chips: items = [{ value, label, count, swatch }]
  function chips(container, items, active, onPick) {
    container.innerHTML = "";
    items.forEach((it) => {
      const chip = el("button", { class: "chip" + (it.value === active ? " active" : "") }, [
        it.swatch ? el("span", { class: "swatch c-" + it.swatch }) : null,
        el("span", { text: it.label }),
        it.count != null ? el("span", { class: "count", text: String(it.count) }) : null,
      ]);
      chip.addEventListener("click", () => onPick(it.value));
      container.appendChild(chip);
    });
  }

  function initCollapsibles(root) {
    (root || document).querySelectorAll(".coll-head").forEach((head) => {
      if (head.dataset.bound) return;
      head.dataset.bound = "1";
      head.addEventListener("click", () => {
        const body = head.parentNode.querySelector(".coll-body");
        const open = body.classList.toggle("hidden") === false;
        const chev = head.querySelector(".chev");
        if (chev) chev.textContent = open ? "▴" : "▾";
      });
    });
  }

  // Two-click delete button.
  function confirmButton(label, onConfirm) {
    const btn = el("button", { class: "btn tiny danger", text: label });
    let armed = false;
    btn.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        btn.textContent = "Sure?";
        btn.classList.add("armed");
        setTimeout(() => {
          armed = false;
          btn.textContent = label;
          btn.classList.remove("armed");
        }, 3000);
        return;
      }
      busy(btn, onConfirm);
    });
    return btn;
  }

  // ----- tiny event bus ----------------------------------------------------------
  const handlers = {};
  function on(name, fn) {
    (handlers[name] = handlers[name] || []).push(fn);
  }
  function emit(name, data) {
    (handlers[name] || []).forEach((fn) => {
      try { fn(data); } catch (e) { log(e.message || String(e), "error"); }
    });
  }

  // ----- shared state -------------------------------------------------------------
  const state = {
    voices: [],
    cast: [], // global character-voice library
    film: null, // { sequence, start, duration, stills, script, cast, sound, scene }
  };

  // ----- voices -------------------------------------------------------------------
  function defaultVoiceId() {
    const id = A.settings.get("defaultVoice");
    return state.voices.some((v) => v.voice_id === id) ? id : state.voices.length ? state.voices[0].voice_id : "";
  }

  function voiceName(id) {
    const v = state.voices.find((x) => x.voice_id === id);
    return v ? v.name : "voice";
  }

  // Character voices first, then own voices (★), then the rest.
  function fillVoiceSelect(select, selected, opts) {
    opts = opts || {};
    select.innerHTML = "";
    if (opts.placeholder) select.appendChild(el("option", { value: "", text: opts.placeholder }));
    if (!state.voices.length) {
      if (!opts.placeholder) select.appendChild(el("option", { value: "", text: "No voices · add your ElevenLabs key" }));
      return;
    }
    const want = selected != null ? selected : opts.placeholder ? "" : defaultVoiceId();
    const castIds = {};
    state.cast.forEach((c) => {
      if (castIds[c.voice_id] || !state.voices.some((v) => v.voice_id === c.voice_id)) return;
      castIds[c.voice_id] = true;
      select.appendChild(el("option", { value: c.voice_id, text: "🎭 " + c.name + " · " + (c.project || "") }));
    });
    state.voices.forEach((v) => {
      if (castIds[v.voice_id]) return;
      select.appendChild(el("option", { value: v.voice_id, text: v.own ? "★ " + v.name : v.name }));
    });
    select.value = want;
    if (select.value !== want && !opts.placeholder) select.selectedIndex = 0;
  }

  function refillVoiceSelects() {
    document.querySelectorAll(".voice-select").forEach((s) => fillVoiceSelect(s, s.value || null));
  }

  async function refreshVoices() {
    try {
      state.cast = await A.library.castList();
    } catch (e) {
      state.cast = [];
    }
    if (await A.settings.getKey("elevenlabs")) {
      try {
        state.voices = await A.eleven.listVoices();
      } catch (e) {
        log(e.message, "error");
      }
    }
    refillVoiceSelects();
    emit("voices");
  }

  // ----- stills --------------------------------------------------------------------
  const thumbCache = {};
  async function stillDataUrl(path) {
    if (!thumbCache[path]) {
      const bytes = await A.premiere.readFileBytes(path);
      thumbCache[path] = "data:image/jpeg;base64," + A.util.bytesToBase64(bytes);
    }
    return thumbCache[path];
  }

  async function stillBase64(path) {
    return (await stillDataUrl(path)).slice("data:image/jpeg;base64,".length);
  }

  // ----- voice change (shared by Cast and Tools) ---------------------------------------
  // Converts one timeline clip into `voiceId` and lays the result in sync on the first free track below it.
  async function changeClip(project, bin, seq, clip, voiceId, denoise, subfolder) {
    const source = await A.premiere.readFileBytes(clip.path);
    const fileName = clip.path.split(/[\\/]/).pop();
    let upload = source;
    let trimmed = false;
    if (A.wav.isWav(source)) {
      upload = A.wav.sliceWav(source, clip.inSec, clip.outSec).buffer;
      trimmed = true;
    } else if (source.byteLength > 50 * 1024 * 1024) {
      throw new Error(fileName + " is over 50 MB. Export the dialogue as a WAV and try again.");
    }
    const track = await A.premiere.findFreeAudioTrack(seq, clip.trackIndex + 1, clip.startSec, clip.endSec);
    if (track < 0) throw new Error("No free audio track below A" + (clip.trackIndex + 1) + ". Add an audio track and try again.");

    log("Changing " + clip.name + " to " + voiceName(voiceId) + "…");
    const bytes = await A.eleven.changeVoice(voiceId, trimmed ? fileName.replace(/\.[^.]+$/, "") + ".wav" : fileName, upload, denoise);
    const saved = await A.premiere.saveAudio(clip.name.replace(/\.[^.]+$/, "") + " " + voiceName(voiceId), bytes, A.eleven.fileExtension(), subfolder || ["voice_change"]);
    const projectItem = await A.premiere.importFile(project, bin, saved);
    if (trimmed) await A.premiere.placeAt(project, projectItem, track, clip.startSec);
    else await A.premiere.placeAt(project, projectItem, track, clip.startSec, clip.inSec, clip.outSec);
    log(clip.name + " → " + voiceName(voiceId) + " on A" + (track + 1) + ".", "ok");
    return saved;
  }

  // Rough length of generated audio from its byte size.
  function estimateSeconds(bytes) {
    const fmt = A.settings.get("outputFormat");
    if (fmt.startsWith("pcm_")) return (bytes.byteLength - 44) / ((parseInt(fmt.split("_")[1], 10) || 44100) * 2);
    const kbps = parseInt(fmt.split("_")[2], 10) || 128;
    return (bytes.byteLength * 8) / (kbps * 1000);
  }

  // Imports a saved file and places it at `atSec` on the first free track from `fromTrack` (1-based).
  // Returns the 1-based track used, or 0 if it only went into the bin.
  async function importAndPlace(saved, atSec, lengthSec, fromTrack) {
    const project = await A.premiere.getProject();
    const bin = await A.premiere.getBin(project);
    const item = await A.premiere.importFile(project, bin, saved);
    const seq = await project.getActiveSequence();
    if (!seq || atSec == null) return 0;
    const track = await A.premiere.findFreeAudioTrack(seq, (fromTrack || 1) - 1, atSec, atSec + Math.max(0.5, lengthSec));
    if (track < 0) return 0;
    await A.premiere.placeAt(project, item, track, atSec);
    return track + 1;
  }

  A.ui = {
    $, el, log, busy, goTo, segmented, chips, initCollapsibles, confirmButton, on, emit, state,
    defaultVoiceId, voiceName, fillVoiceSelect, refillVoiceSelects, refreshVoices,
    stillDataUrl, stillBase64, changeClip, estimateSeconds, importAndPlace, uxp,
  };
})();
