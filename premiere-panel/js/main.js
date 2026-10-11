// Panel UI wiring.
(function () {
  const { settings, eleven, claude, premiere } = window.AIA;
  const $ = (id) => document.getElementById(id);

  let voices = [];
  let currentPlan = null;

  // ----- log -----------------------------------------------------------
  function log(msg, kind) {
    const line = document.createElement("div");
    if (kind) line.className = kind;
    const t = new Date().toLocaleTimeString();
    line.textContent = t + "  " + msg;
    $("log").appendChild(line);
    $("log").scrollTop = $("log").scrollHeight;
  }

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

  // ----- tabs ----------------------------------------------------------
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.id === "tab-" + tab.dataset.tab));
    });
  });

  // ----- settings ------------------------------------------------------
  async function loadSettings() {
    $("claudeModel").value = settings.get("claudeModel");
    $("ttsModel").value = settings.get("ttsModel");
    $("outputFormat").value = settings.get("outputFormat");
    $("binName").value = settings.get("binName");
    $("elevenKey").placeholder = (await settings.getKey("elevenlabs")) ? "Saved — type to replace" : "xi-…";
    $("claudeKey").placeholder = (await settings.getKey("claude")) ? "Saved — type to replace" : "sk-ant-…";
    const folder = await settings.getOutputFolder();
    $("outputFolder").textContent = folder.nativePath;
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
        log("ElevenLabs OK — " + v.length + " voices.", "ok");
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

  // ----- voices --------------------------------------------------------
  function fillVoiceSelect(select, selected) {
    select.innerHTML = "";
    if (!voices.length) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "(no voices — check ElevenLabs key)";
      select.appendChild(o);
      return;
    }
    voices.forEach((v) => {
      const o = document.createElement("option");
      o.value = v.voice_id;
      o.textContent = v.name;
      if (v.voice_id === selected) o.selected = true;
      select.appendChild(o);
    });
  }

  async function refreshVoices() {
    if (!(await settings.getKey("elevenlabs"))) return;
    try {
      voices = await eleven.listVoices();
      fillVoiceSelect($("quickVoice"), $("quickVoice").value);
    } catch (e) {
      log(e.message, "error");
    }
  }

  // ----- plan rendering ------------------------------------------------
  function field(labelText, input) {
    const wrap = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  function numberInput(value, step, onChange) {
    const input = document.createElement("input");
    input.type = "number";
    input.step = step;
    input.min = "0";
    input.value = String(value || 0);
    input.addEventListener("input", () => onChange(parseFloat(input.value) || 0));
    return input;
  }

  function renderPlan() {
    const box = $("planItems");
    box.innerHTML = "";
    $("planSummary").textContent = currentPlan.summary || "";

    currentPlan.items.forEach((item, idx) => {
      const card = document.createElement("div");
      card.className = "item";

      const head = document.createElement("div");
      head.className = "item-head";
      const badge = document.createElement("span");
      badge.className = "badge " + item.type;
      badge.textContent = item.type;
      const name = document.createElement("input");
      name.type = "text";
      name.value = item.name;
      name.addEventListener("input", () => (item.name = name.value));
      const remove = document.createElement("button");
      remove.textContent = "✕";
      remove.title = "Remove";
      remove.addEventListener("click", () => {
        currentPlan.items.splice(idx, 1);
        renderPlan();
      });
      head.append(badge, name, remove);
      card.appendChild(head);

      const text = document.createElement("textarea");
      text.rows = 3;
      text.value = item.text;
      text.addEventListener("input", () => (item.text = text.value));
      card.appendChild(field(item.type === "speech" ? "Words" : "Prompt", text));

      const grid = document.createElement("div");
      grid.className = "grid";
      if (item.type === "speech") {
        const sel = document.createElement("select");
        fillVoiceSelect(sel, item.voice_id);
        // Falls back to the first voice if Claude's pick isn't in the list.
        if (voices.length) item.voice_id = sel.value;
        sel.addEventListener("change", () => (item.voice_id = sel.value));
        grid.appendChild(field("Voice", sel));
      } else {
        grid.appendChild(field("Seconds (0 = auto)", numberInput(item.duration_seconds, "0.5", (v) => (item.duration_seconds = v))));
      }
      grid.appendChild(field("Start (+s from playhead)", numberInput(item.start_offset_seconds, "0.1", (v) => (item.start_offset_seconds = v))));
      card.appendChild(grid);

      if (item.notes) {
        const notes = document.createElement("div");
        notes.className = "notes";
        notes.textContent = item.notes;
        card.appendChild(notes);
      }
      box.appendChild(card);
    });

    $("planBox").classList.toggle("hidden", currentPlan.items.length === 0 && !currentPlan.summary);
  }

  // ----- create flow ---------------------------------------------------
  $("planBtn").addEventListener("click", () =>
    busy($("planBtn"), async () => {
      const prompt = $("prompt").value.trim();
      if (!prompt) throw new Error("Write what you want first.");
      if (!voices.length) await refreshVoices();

      let context = null;
      if ($("useContext").checked) {
        try {
          context = await premiere.getContext();
        } catch (e) {
          log("No sequence info: " + e.message);
        }
      }
      log("Asking Claude for a plan…");
      currentPlan = await claude.plan(prompt, context, voices);
      log("Plan ready: " + currentPlan.items.length + " item(s). Review and edit, then generate.", "ok");
      renderPlan();
    })
  );

  $("clearPlanBtn").addEventListener("click", () => {
    currentPlan = null;
    $("planBox").classList.add("hidden");
  });

  // Generates every item, saves it, imports it and optionally places it on its own track.
  async function produce(items, { place, firstTrack }) {
    const project = await premiere.getProject();
    const bin = await premiere.getBin(project);
    const ext = eleven.fileExtension();
    let ok = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const label = (i + 1) + "/" + items.length + " " + item.name;
      try {
        log("Generating " + label + "…");
        const bytes = await eleven.generate(item);
        const saved = await premiere.saveAudio(item.name, bytes, ext);
        const projectItem = await premiere.importFile(project, bin, saved);
        log("Imported " + saved.fileName);
        if (place) {
          const track = firstTrack + i;
          await premiere.placeOnTimeline(project, projectItem, track, item.start_offset_seconds);
          log("Placed on A" + track + " at +" + (item.start_offset_seconds || 0) + "s");
        }
        ok++;
      } catch (e) {
        log(label + ": " + (e.message || e), "error");
      }
    }
    log("Done: " + ok + " of " + items.length + " item(s).", ok === items.length ? "ok" : "error");
  }

  $("generateBtn").addEventListener("click", () =>
    busy($("generateBtn"), async () => {
      if (!currentPlan || !currentPlan.items.length) throw new Error("Nothing to generate.");
      await produce(currentPlan.items, {
        place: $("placeOnTimeline").checked,
        firstTrack: Math.max(1, parseInt($("firstTrack").value, 10) || 1),
      });
    })
  );

  // ----- quick flow ----------------------------------------------------
  function updateQuickForm() {
    const type = $("quickType").value;
    $("quickVoiceRow").classList.toggle("hidden", type !== "speech");
    $("quickDurationRow").classList.toggle("hidden", type === "speech");
    $("quickTextLabel").textContent = type === "speech" ? "Text to speak" : "Describe the sound";
  }
  $("quickType").addEventListener("change", updateQuickForm);

  $("quickBtn").addEventListener("click", () =>
    busy($("quickBtn"), async () => {
      const text = $("quickText").value.trim();
      if (!text) throw new Error("Enter some text first.");
      const type = $("quickType").value;
      const item = {
        type,
        name: type === "speech" ? "VO " + text.slice(0, 24) : type + " " + text.slice(0, 24),
        text,
        voice_id: type === "speech" ? $("quickVoice").value : "",
        duration_seconds: type === "speech" ? 0 : parseFloat($("quickDuration").value) || 0,
        start_offset_seconds: 0,
      };
      await produce([item], {
        place: $("quickPlace").checked,
        firstTrack: Math.max(1, parseInt($("quickTrack").value, 10) || 1),
      });
    })
  );

  // ----- voices: clone ---------------------------------------------------
  let cloneFiles = [];

  $("cloneFilesBtn").addEventListener("click", () =>
    busy($("cloneFilesBtn"), async () => {
      const fs = require("uxp").storage.localFileSystem;
      const picked = await fs.getFileForOpening({
        allowMultiple: true,
        types: ["mp3", "wav", "m4a", "aac", "flac", "ogg"],
      });
      cloneFiles = picked ? (Array.isArray(picked) ? picked : [picked]) : [];
      $("cloneFiles").textContent = cloneFiles.length
        ? cloneFiles.map((f) => f.name).join(", ")
        : "No files chosen";
    })
  );

  $("cloneBtn").addEventListener("click", () =>
    busy($("cloneBtn"), async () => {
      const name = $("cloneName").value.trim();
      if (!name) throw new Error("Give your voice a name.");
      if (!cloneFiles.length) throw new Error("Choose at least one recording of your voice.");
      const formats = require("uxp").storage.formats;
      const files = [];
      for (const f of cloneFiles) files.push({ name: f.name, data: await f.read({ format: formats.binary }) });
      log("Uploading " + files.length + " recording(s) to ElevenLabs…");
      await eleven.cloneVoice(name, files, $("cloneDenoise").checked);
      log('Voice "' + name + '" created. It is now in every voice list.', "ok");
      await refreshVoices();
    })
  );

  // ----- voices: design with Claude --------------------------------------
  let designPreviews = [];

  $("designPlanBtn").addEventListener("click", () =>
    busy($("designPlanBtn"), async () => {
      const brief = $("designBrief").value.trim();
      if (!brief) throw new Error("Describe the voice first.");
      log("Asking Claude to write the voice…");
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
      designPreviews = await eleven.designVoice(description, text);
      if (!designPreviews.length) throw new Error("ElevenLabs returned no previews; try again.");

      const project = await premiere.getProject();
      const bin = await premiere.getBin(project, "Voice previews");
      const base = $("designName").value.trim() || "Voice";
      const box = $("designPreviews");
      box.innerHTML = "";
      for (let i = 0; i < designPreviews.length; i++) {
        const p = designPreviews[i];
        const label = base + " preview " + (i + 1);
        const saved = await premiere.saveAudio(label, p.bytes, "mp3");
        await premiere.importFile(project, bin, saved);

        const row = document.createElement("div");
        row.className = "preview-row";
        const span = document.createElement("span");
        span.textContent = "Preview " + (i + 1) + " — " + saved.fileName;
        const keep = document.createElement("button");
        keep.textContent = "Save this voice";
        keep.addEventListener("click", () =>
          busy(keep, async () => {
            const name = $("designName").value.trim() || base;
            await eleven.saveDesignedVoice(name, description, p.generated_voice_id);
            log('Voice "' + name + '" saved to your ElevenLabs library.', "ok");
            await refreshVoices();
          })
        );
        row.append(span, keep);
        box.appendChild(row);
      }
      log(designPreviews.length + ' previews in the "Voice previews" bin. Listen in Premiere, then save one.', "ok");
    })
  );

  $("clearLogBtn").addEventListener("click", () => ($("log").innerHTML = ""));

  // ----- start ---------------------------------------------------------
  updateQuickForm();
  loadSettings()
    .then(refreshVoices)
    .then(async () => {
      const missing = [];
      if (!(await settings.getKey("elevenlabs"))) missing.push("ElevenLabs");
      if (!(await settings.getKey("claude"))) missing.push("Claude");
      if (missing.length) log("Add your " + missing.join(" and ") + " API key in Settings to get started.");
      else log("Ready.");
    })
    .catch((e) => log(e.message, "error"));
})();
