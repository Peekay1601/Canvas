// Panel UI wiring.
(function () {
  const { settings, eleven, claude, premiere, wav } = window.AIA;
  const uxp = require("uxp");
  const $ = (id) => document.getElementById(id);

  let voices = [];
  let currentPlan = null;

  // ----- small DOM helper -------------------------------------------------
  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.keys(props || {}).forEach((k) => {
      if (k === "class") node.className = props[k];
      else if (k === "text") node.textContent = props[k];
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), props[k]);
      else node.setAttribute(k, props[k]);
    });
    (children || []).forEach((c) => c && node.appendChild(c));
    return node;
  }

  // ----- status + activity log -------------------------------------------
  function log(msg, kind) {
    const line = el("div", { class: kind || "", text: new Date().toLocaleTimeString() + "  " + msg });
    $("log").appendChild(line);
    $("log").scrollTop = $("log").scrollHeight;
    $("statusText").textContent = msg;
    $("statusDot").className = "dot " + (kind || "busy");
  }

  $("statusToggle").addEventListener("click", () => {
    const open = $("logPanel").classList.toggle("hidden") === false;
    $("statusArrow").textContent = open ? "Activity ▾" : "Activity ▴";
  });
  $("clearLogBtn").addEventListener("click", () => ($("log").innerHTML = ""));

  // Runs an async action with its button disabled and errors sent to the log.
  async function busy(button, fn) {
    button.disabled = true;
    try {
      await fn();
    } catch (e) {
      log(e.message || String(e), "error");
    } finally {
      button.disabled = false;
    }
  }

  // ----- tabs, segmented controls, collapsibles ---------------------------
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.id === "tab-" + tab.dataset.tab));
    });
  });

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

  document.querySelectorAll(".coll-head").forEach((head) => {
    head.addEventListener("click", () => {
      const body = head.parentNode.querySelector(".coll-body");
      const open = body.classList.toggle("hidden") === false;
      head.querySelector(".chev").textContent = open ? "▴" : "▾";
    });
  });

  // ----- keys + settings --------------------------------------------------
  async function refreshKeyPills() {
    $("keyEleven").classList.toggle("on", !!(await settings.getKey("elevenlabs")));
    $("keyClaude").classList.toggle("on", !!(await settings.getKey("claude")));
  }

  async function loadSettings() {
    $("claudeModel").value = settings.get("claudeModel");
    $("ttsModel").value = settings.get("ttsModel");
    $("outputFormat").value = settings.get("outputFormat");
    $("binName").value = settings.get("binName");
    $("elevenKey").placeholder = (await settings.getKey("elevenlabs")) ? "Saved · type to replace" : "xi-…";
    $("claudeKey").placeholder = (await settings.getKey("claude")) ? "Saved · type to replace" : "sk-ant-…";
    $("outputFolder").textContent = (await settings.getOutputFolder()).nativePath;
    await refreshKeyPills();
  }

  $("saveSettingsBtn").addEventListener("click", () =>
    busy($("saveSettingsBtn"), async () => {
      if ($("elevenKey").value) await settings.setKey("elevenlabs", $("elevenKey").value);
      if ($("claudeKey").value) await settings.setKey("claude", $("claudeKey").value);
      $("elevenKey").value = "";
      $("claudeKey").value = "";
      settings.set("claudeModel", $("claudeModel").value.trim());
      settings.set("ttsModel", $("ttsModel").value.trim());
      settings.set("outputFormat", $("outputFormat").value);
      settings.set("binName", $("binName").value.trim());
      await loadSettings();
      log("Settings saved.", "ok");
      await refreshVoices();
    })
  );

  $("chooseFolderBtn").addEventListener("click", () =>
    busy($("chooseFolderBtn"), async () => {
      const folder = await settings.chooseOutputFolder();
      if (folder) $("outputFolder").textContent = folder.nativePath;
    })
  );

  $("testKeysBtn").addEventListener("click", () =>
    busy($("testKeysBtn"), async () => {
      try {
        const v = await eleven.listVoices();
        log("ElevenLabs OK · " + v.length + " voices.", "ok");
      } catch (e) {
        log(e.message, "error");
      }
      try {
        await claude.ping();
        log("Claude OK.", "ok");
      } catch (e) {
        log(e.message, "error");
      }
    })
  );

  // ----- voices: shared state ----------------------------------------------
  function defaultVoiceId() {
    const id = settings.get("defaultVoice");
    return voices.some((v) => v.voice_id === id) ? id : voices.length ? voices[0].voice_id : "";
  }

  function voiceName(id) {
    const v = voices.find((x) => x.voice_id === id);
    return v ? v.name : "voice";
  }

  function fillVoiceSelect(select, selected) {
    select.innerHTML = "";
    if (!voices.length) {
      select.appendChild(el("option", { value: "", text: "No voices · add your ElevenLabs key" }));
      return;
    }
    const want = selected || defaultVoiceId();
    voices.forEach((v) => {
      const o = el("option", { value: v.voice_id, text: v.own ? "★ " + v.name : v.name });
      if (v.voice_id === want) o.selected = true;
      select.appendChild(o);
    });
  }

  function fillAllVoiceSelects() {
    document.querySelectorAll(".voice-select").forEach((s) => fillVoiceSelect(s, s.value));
  }

  async function refreshVoices() {
    if (!(await settings.getKey("elevenlabs"))) {
      renderVoiceList();
      return;
    }
    try {
      voices = await eleven.listVoices();
      fillAllVoiceSelects();
      renderVoiceList();
    } catch (e) {
      log(e.message, "error");
    }
  }

  // ----- voices: library ----------------------------------------------------
  const voiceFilter = segmented("voiceFilter", () => renderVoiceList());
  $("voiceSearch").addEventListener("input", () => renderVoiceList());
  $("refreshVoicesBtn").addEventListener("click", () =>
    busy($("refreshVoicesBtn"), async () => {
      await refreshVoices();
      log("Voices refreshed · " + voices.length + " total.", "ok");
    })
  );

  async function playVoiceSample(v) {
    let bytes;
    if (v.previewUrl) {
      bytes = await eleven.downloadPreview(v.previewUrl);
    } else {
      // Voices without a stored sample (often fresh clones): speak a short line.
      bytes = await eleven.speakSample(v.voice_id, "Hi, this is " + v.name + ". Here is how I sound in your project.");
    }
    await premiere.playPreview(v.name + " sample", bytes);
    log("Playing " + v.name + " in the Source Monitor.", "ok");
  }

  function renderVoiceList() {
    const box = $("voiceList");
    box.innerHTML = "";
    const q = $("voiceSearch").value.trim().toLowerCase();
    const onlyOwn = voiceFilter() === "own";
    const list = voices.filter((v) => (!onlyOwn || v.own) && (!q || (v.name + " " + v.description).toLowerCase().indexOf(q) !== -1));
    const def = settings.get("defaultVoice");

    if (!list.length) {
      const msg = !voices.length
        ? "Add your ElevenLabs key in Settings to see your voices."
        : onlyOwn && !q
          ? "No voices of your own yet. Clone your voice or design one below."
          : "No voices match.";
      box.appendChild(el("div", { class: "empty", text: msg }));
      return;
    }

    list.forEach((v) => {
      const isDefault = v.voice_id === def;
      const play = el("button", { class: "btn small", text: "Play", title: "Play in the Source Monitor" });
      play.addEventListener("click", () => busy(play, () => playVoiceSample(v)));

      const use = el("button", { class: "btn small" + (isDefault ? " primary" : ""), text: isDefault ? "Default" : "Use", title: "Use this voice by default" });
      use.addEventListener("click", () => {
        settings.set("defaultVoice", v.voice_id);
        document.querySelectorAll(".voice-select").forEach((s) => fillVoiceSelect(s, v.voice_id));
        renderVoiceList();
        log(v.name + " is now your default voice.", "ok");
      });

      const actions = [play, use];
      if (v.own) {
        const del = el("button", { class: "btn small danger", text: "Delete" });
        let armed = false;
        del.addEventListener("click", () => {
          if (!armed) {
            armed = true;
            del.textContent = "Sure?";
            del.classList.add("armed");
            setTimeout(() => {
              armed = false;
              del.textContent = "Delete";
              del.classList.remove("armed");
            }, 3000);
            return;
          }
          busy(del, async () => {
            await eleven.deleteVoice(v.voice_id);
            log("Deleted " + v.name + ".", "ok");
            await refreshVoices();
          });
        });
        actions.push(del);
      }

      box.appendChild(
        el("div", { class: "voice" + (isDefault ? " is-default" : "") }, [
          el("div", { class: "voice-main" }, [
            el("div", { class: "voice-name" }, [
              el("span", { text: v.name }),
              el("span", { class: "badge" + (v.own ? " own" : ""), text: v.own ? v.category : v.category || "voice" }),
            ]),
            el("div", { class: "voice-desc", text: v.description || " " }),
          ]),
          el("div", { class: "voice-actions" }, actions),
        ])
      );
    });
  }

  // ----- voices: clone ------------------------------------------------------
  let cloneFiles = [];

  $("cloneFilesBtn").addEventListener("click", () =>
    busy($("cloneFilesBtn"), async () => {
      const picked = await uxp.storage.localFileSystem.getFileForOpening({
        allowMultiple: true,
        types: ["mp3", "wav", "m4a", "aac", "flac", "ogg"],
      });
      cloneFiles = picked ? (Array.isArray(picked) ? picked : [picked]) : [];
      $("cloneFiles").textContent = cloneFiles.length ? cloneFiles.map((f) => f.name).join(", ") : "No files chosen";
    })
  );

  $("cloneBtn").addEventListener("click", () =>
    busy($("cloneBtn"), async () => {
      const name = $("cloneName").value.trim();
      if (!name) throw new Error("Give your voice a name.");
      if (!cloneFiles.length) throw new Error("Choose at least one recording of your voice.");
      const files = [];
      for (const f of cloneFiles) files.push({ name: f.name, data: await f.read({ format: uxp.storage.formats.binary }) });
      log("Uploading " + files.length + " recording(s) to ElevenLabs…");
      const id = await eleven.cloneVoice(name, files, $("cloneDenoise").checked);
      settings.set("defaultVoice", id);
      await refreshVoices();
      log('"' + name + '" created and set as your default voice.', "ok");
    })
  );

  // ----- voices: design with Claude ----------------------------------------
  $("designPlanBtn").addEventListener("click", () =>
    busy($("designPlanBtn"), async () => {
      const brief = $("designBrief").value.trim();
      if (!brief) throw new Error("Describe the voice first.");
      log("Claude is writing the voice…");
      const v = await claude.designVoice(brief);
      $("designName").value = v.name;
      $("designDescription").value = v.voice_description;
      $("designText").value = v.preview_text;
      $("designPreviews").innerHTML = "";
      $("designBox").classList.remove("hidden");
      log("Voice written. Edit it if you like, then make previews.", "ok");
    })
  );

  $("designPreviewBtn").addEventListener("click", () =>
    busy($("designPreviewBtn"), async () => {
      const description = $("designDescription").value.trim();
      const text = $("designText").value.trim();
      if (description.length < 20) throw new Error("The voice description needs at least 20 characters.");
      if (text.length < 100) throw new Error("The preview line needs at least 100 characters.");
      log("Making voice previews…");
      const previews = await eleven.designVoice(description, text);
      if (!previews.length) throw new Error("ElevenLabs returned no previews; try again.");

      const base = $("designName").value.trim() || "Voice";
      const box = $("designPreviews");
      box.innerHTML = "";
      previews.forEach((p, i) => {
        const play = el("button", { class: "btn small", text: "Play" });
        play.addEventListener("click", () => busy(play, () => premiere.playPreview(base + " preview " + (i + 1), p.bytes)));
        const keep = el("button", { class: "btn small primary", text: "Save" });
        keep.addEventListener("click", () =>
          busy(keep, async () => {
            const name = $("designName").value.trim() || base;
            const id = await eleven.saveDesignedVoice(name, description, p.generated_voice_id);
            settings.set("defaultVoice", id);
            await refreshVoices();
            keep.textContent = "Saved";
            log('"' + name + '" saved to your library and set as default.', "ok");
          })
        );
        box.appendChild(el("div", { class: "preview-row" }, [el("span", { text: "Preview " + (i + 1) }), play, keep]));
      });
      await premiere.playPreview(base + " preview 1", previews[0].bytes).catch(() => {});
      log(previews.length + " previews ready. Play each, then save the one you like.", "ok");
    })
  );

  // ----- create: modes ------------------------------------------------------
  function updateGenerateBox() {
    const mode = createMode();
    const hasPlan = currentPlan && currentPlan.items.length > 0;
    $("generateBox").classList.toggle("hidden", mode === "claude" && !hasPlan);
    $("generateBtn").textContent = mode === "claude" && hasPlan
      ? "Generate " + currentPlan.items.length + (currentPlan.items.length === 1 ? " item" : " items")
      : "Generate";
    $("trackField").querySelector("label").textContent = mode === "claude" ? "First audio track" : "Audio track";
    $("trackHint").classList.toggle("hidden", mode !== "claude");
  }

  const createMode = segmented("createMode", (mode) => {
    $("claudeMode").classList.toggle("hidden", mode !== "claude");
    $("directMode").classList.toggle("hidden", mode !== "direct");
    updateGenerateBox();
  });

  const directType = segmented("directType", (type) => {
    $("directVoiceField").classList.toggle("hidden", type !== "speech");
    $("directDurationField").classList.toggle("hidden", type === "speech");
    $("directTextLabel").textContent = type === "speech" ? "Text to speak" : "Describe the sound";
  });

  // ----- create: plan rendering --------------------------------------------
  function field(labelText, input) {
    return el("div", { class: "field" }, [el("label", { text: labelText }), input]);
  }

  function numberInput(value, step, onChange) {
    const input = el("input", { type: "number", step, min: "0" });
    input.value = String(value || 0);
    input.addEventListener("input", () => onChange(parseFloat(input.value) || 0));
    return input;
  }

  function renderPlan() {
    const box = $("planItems");
    box.innerHTML = "";
    $("planSummary").textContent = currentPlan.summary || "";

    currentPlan.items.forEach((item, idx) => {
      const name = el("input", { type: "text" });
      name.value = item.name;
      name.addEventListener("input", () => (item.name = name.value));
      const remove = el("button", { class: "btn ghost small", text: "Remove" });
      remove.addEventListener("click", () => {
        currentPlan.items.splice(idx, 1);
        renderPlan();
      });

      const text = el("textarea", { rows: "3" });
      text.value = item.text;
      text.addEventListener("input", () => (item.text = text.value));

      let left;
      if (item.type === "speech") {
        const sel = el("select", { class: "voice-select" });
        fillVoiceSelect(sel, item.voice_id);
        // Falls back to the default voice if Claude's pick isn't in the list.
        if (voices.length) item.voice_id = sel.value;
        sel.addEventListener("change", () => (item.voice_id = sel.value));
        left = field("Voice", sel);
      } else {
        left = field("Seconds (0 = auto)", numberInput(item.duration_seconds, "0.5", (v) => (item.duration_seconds = v)));
      }
      const right = field("Starts at (+s)", numberInput(item.start_offset_seconds, "0.1", (v) => (item.start_offset_seconds = v)));

      box.appendChild(
        el("div", { class: "item " + item.type }, [
          el("div", { class: "item-head" }, [el("span", { class: "badge " + item.type, text: item.type }), name, remove]),
          field(item.type === "speech" ? "Words" : "Prompt", text),
          el("div", { class: "item-row" }, [left, right]),
          item.notes ? el("div", { class: "notes", text: item.notes }) : null,
        ])
      );
    });

    $("planBox").classList.toggle("hidden", !currentPlan.items.length && !currentPlan.summary);
    updateGenerateBox();
  }

  $("planBtn").addEventListener("click", () =>
    busy($("planBtn"), async () => {
      const prompt = $("prompt").value.trim();
      if (!prompt) throw new Error("Describe what you want first.");
      if (!voices.length) await refreshVoices();

      let context = null;
      if ($("useContext").checked) {
        try {
          context = await premiere.getContext();
        } catch (e) {
          log("No sequence info: " + e.message);
        }
      }
      // Tell Claude which voice is the editor's default so "my voice" resolves to it.
      const def = defaultVoiceId();
      const withDefault = def ? prompt + "\n\n(My default voice is " + voiceName(def) + ", voice_id " + def + ".)" : prompt;
      log("Claude is planning…");
      currentPlan = await claude.plan(withDefault, context, voices);
      log("Plan ready · " + currentPlan.items.length + " item(s). Review, then generate.", "ok");
      renderPlan();
    })
  );

  $("clearPlanBtn").addEventListener("click", () => {
    currentPlan = null;
    $("planBox").classList.add("hidden");
    updateGenerateBox();
  });

  // ----- create: generate ---------------------------------------------------
  // Generates every item, saves it, imports it and optionally places it on its own track.
  async function produce(items, place, firstTrack) {
    const project = await premiere.getProject();
    const bin = await premiere.getBin(project);
    const ext = eleven.fileExtension();
    let ok = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const label = (items.length > 1 ? i + 1 + "/" + items.length + " " : "") + item.name;
      try {
        log("Generating " + label + "…");
        const bytes = await eleven.generate(item);
        const saved = await premiere.saveAudio(item.name, bytes, ext);
        const projectItem = await premiere.importFile(project, bin, saved);
        if (place) {
          const track = firstTrack + i;
          await premiere.placeOnTimeline(project, projectItem, track, item.start_offset_seconds);
          log("Added " + saved.fileName + " on A" + track + ".", "ok");
        } else {
          log("Imported " + saved.fileName + ".", "ok");
        }
        ok++;
      } catch (e) {
        log(label + ": " + (e.message || e), "error");
      }
    }
    if (items.length > 1) log("Done · " + ok + " of " + items.length + " item(s).", ok === items.length ? "ok" : "error");
  }

  $("generateBtn").addEventListener("click", () =>
    busy($("generateBtn"), async () => {
      const place = $("placeOnTimeline").checked;
      const firstTrack = Math.max(1, parseInt($("firstTrack").value, 10) || 1);
      if (createMode() === "claude") {
        if (!currentPlan || !currentPlan.items.length) throw new Error("Nothing to generate.");
        await produce(currentPlan.items, place, firstTrack);
        return;
      }
      const text = $("directText").value.trim();
      if (!text) throw new Error("Enter some text first.");
      const type = directType();
      await produce(
        [{
          type,
          name: (type === "speech" ? "VO " : type + " ") + text.slice(0, 24),
          text,
          voice_id: type === "speech" ? $("directVoice").value : "",
          duration_seconds: type === "speech" ? 0 : parseFloat($("directDuration").value) || 0,
          start_offset_seconds: 0,
        }],
        place,
        firstTrack
      );
    })
  );

  $("placeOnTimeline").addEventListener("change", () => {
    $("trackField").classList.toggle("hidden", !$("placeOnTimeline").checked);
  });

  // ----- change voice -------------------------------------------------------
  let selectedClips = [];
  let changeFile = null;

  const changeSource = segmented("changeSource", (src) => {
    $("changeTimeline").classList.toggle("hidden", src !== "timeline");
    $("changeFile").classList.toggle("hidden", src !== "file");
  });

  function fmtTime(s) {
    const m = Math.floor(s / 60);
    const sec = (s - m * 60).toFixed(1);
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  }

  async function readSelection() {
    const project = await premiere.getProject();
    selectedClips = await premiere.getSelectedAudioClips(project);
    const box = $("selectedClips");
    box.innerHTML = "";
    if (!selectedClips.length) throw new Error("No audio clips selected. Click an audio clip on the timeline (Shift-click for more).");
    selectedClips.forEach((c) => {
      box.appendChild(
        el("div", { class: "clip" }, [
          el("span", { text: c.name }),
          el("span", { class: "muted", text: "A" + (c.trackIndex + 1) + " · " + fmtTime(c.startSec) + " · " + (c.endSec - c.startSec).toFixed(1) + "s" }),
        ])
      );
    });
    log(selectedClips.length + " clip(s) ready to change.", "ok");
  }

  $("readSelectionBtn").addEventListener("click", () => busy($("readSelectionBtn"), readSelection));

  $("changeFileBtn").addEventListener("click", () =>
    busy($("changeFileBtn"), async () => {
      changeFile = await uxp.storage.localFileSystem.getFileForOpening({ types: ["wav", "mp3", "m4a", "aac", "flac", "ogg"] });
      $("changeFileName").textContent = changeFile ? changeFile.name : "No file chosen";
    })
  );

  // Rough length of a converted file, used to find a free track for it.
  function estimateSeconds(bytes) {
    const fmt = settings.get("outputFormat");
    if (fmt.startsWith("pcm_")) return (bytes.byteLength - 44) / ((parseInt(fmt.split("_")[1], 10) || 44100) * 2);
    const kbps = parseInt(fmt.split("_")[2], 10) || 128;
    return (bytes.byteLength * 8) / (kbps * 1000);
  }

  async function changeClip(project, bin, seq, clip, voiceId, denoise) {
    const source = await premiere.readFileBytes(clip.path);
    const fileName = clip.path.split(/[\\/]/).pop();
    let upload = source;
    let trimmed = false;
    if (wav.isWav(source)) {
      upload = wav.sliceWav(source, clip.inSec, clip.outSec).buffer;
      trimmed = true;
    } else if (source.byteLength > 50 * 1024 * 1024) {
      throw new Error(fileName + " is over 50 MB. Export the dialogue as a WAV and try again.");
    }

    const track = await premiere.findFreeAudioTrack(seq, clip.trackIndex + 1, clip.startSec, clip.endSec);
    if (track < 0) throw new Error("No free audio track below A" + (clip.trackIndex + 1) + ". Add an audio track and try again.");

    log("Changing " + clip.name + " to " + voiceName(voiceId) + "…");
    const bytes = await eleven.changeVoice(voiceId, trimmed ? fileName.replace(/\.[^.]+$/, "") + ".wav" : fileName, upload, denoise);
    const saved = await premiere.saveAudio(clip.name.replace(/\.[^.]+$/, "") + " " + voiceName(voiceId), bytes, eleven.fileExtension());
    const projectItem = await premiere.importFile(project, bin, saved);
    if (trimmed) await premiere.placeAt(project, projectItem, track, clip.startSec);
    else await premiere.placeAt(project, projectItem, track, clip.startSec, clip.inSec, clip.outSec);
    log(clip.name + " → " + voiceName(voiceId) + " on A" + (track + 1) + ".", "ok");
  }

  $("changeBtn").addEventListener("click", () =>
    busy($("changeBtn"), async () => {
      const voiceId = $("changeVoice").value;
      if (!voiceId) throw new Error("Pick the voice to change into.");
      const denoise = $("changeDenoise").checked;
      const project = await premiere.getProject();
      const bin = await premiere.getBin(project);
      const seq = await project.getActiveSequence();

      if (changeSource() === "file") {
        if (!changeFile) throw new Error("Choose an audio file first.");
        log("Changing " + changeFile.name + " to " + voiceName(voiceId) + "…");
        const data = await changeFile.read({ format: uxp.storage.formats.binary });
        const bytes = await eleven.changeVoice(voiceId, changeFile.name, data, denoise);
        const saved = await premiere.saveAudio(changeFile.name.replace(/\.[^.]+$/, "") + " " + voiceName(voiceId), bytes, eleven.fileExtension());
        const projectItem = await premiere.importFile(project, bin, saved);
        if (seq) {
          const at = (await seq.getPlayerPosition()).seconds;
          const track = await premiere.findFreeAudioTrack(seq, 0, at, at + estimateSeconds(bytes));
          if (track < 0) {
            log("Imported " + saved.fileName + ". No free track at the playhead, so it's in the bin only.", "ok");
            return;
          }
          await premiere.placeAt(project, projectItem, track, at);
          log("Added " + saved.fileName + " on A" + (track + 1) + " at the playhead.", "ok");
        } else {
          log("Imported " + saved.fileName + ".", "ok");
        }
        return;
      }

      if (!selectedClips.length) await readSelection();
      if (!seq) throw new Error("Open the sequence with those clips.");
      let ok = 0;
      for (const clip of selectedClips) {
        try {
          await changeClip(project, bin, seq, clip, voiceId, denoise);
          ok++;
        } catch (e) {
          log(clip.name + ": " + (e.message || e), "error");
        }
      }
      if (selectedClips.length > 1) log("Done · " + ok + " of " + selectedClips.length + " clip(s).", ok === selectedClips.length ? "ok" : "error");
    })
  );

  // ----- start --------------------------------------------------------------
  updateGenerateBox();
  loadSettings()
    .then(refreshVoices)
    .then(async () => {
      const missing = [];
      if (!(await settings.getKey("elevenlabs"))) missing.push("ElevenLabs");
      if (!(await settings.getKey("claude"))) missing.push("Claude");
      if (missing.length) log("Add your " + missing.join(" and ") + " key in Settings to get started.", "error");
      else log("Ready · " + voices.length + " voices loaded.", "ok");
    })
    .catch((e) => log(e.message, "error"));
})();
