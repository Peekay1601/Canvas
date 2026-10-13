// Tools tab: quick create (Claude plan or direct) and the general voice changer.
(function () {
  const A = window.AIA;
  const { $, el, log, busy, state } = A.ui;
  const uxp = A.ui.uxp;

  A.ui.segmented("toolMode", (m) => {
    $("toolCreate").classList.toggle("hidden", m !== "create");
    $("toolChange").classList.toggle("hidden", m !== "change");
  });

  // =============== quick create ===============
  let currentPlan = null;
  const directVoice = A.ui.voicePicker({ title: "Voice for the voiceover" });
  $("directVoice").appendChild(directVoice.el);
  const changeVoice = A.ui.voicePicker({ title: "Change into which voice?" });
  $("changeVoice").appendChild(changeVoice.el);

  function updateGenerateBox() {
    const mode = createMode();
    const hasPlan = currentPlan && currentPlan.items.length > 0;
    $("generateBox").classList.toggle("hidden", mode === "claude" && !hasPlan);
    $("generateBtn").textContent = mode === "claude" && hasPlan
      ? "Generate " + currentPlan.items.length + (currentPlan.items.length === 1 ? " item" : " items")
      : "Generate";
    $("trackField").querySelector("label").textContent = mode === "claude" ? "First audio track" : "Audio track";
  }

  const createMode = A.ui.segmented("createMode", (mode) => {
    $("claudeMode").classList.toggle("hidden", mode !== "claude");
    $("directMode").classList.toggle("hidden", mode !== "direct");
    updateGenerateBox();
  });

  const directType = A.ui.segmented("directType", (type) => {
    $("directVoiceField").classList.toggle("hidden", type !== "speech");
    $("directDurationField").classList.toggle("hidden", type === "speech");
    $("directTextLabel").textContent = type === "speech" ? "Text to speak" : "Describe the sound";
  });

  function field(labelText, input) {
    return el("div", { class: "field" }, [el("label", { text: labelText }), input]);
  }

  function numberInput(value, step, onChange) {
    const input = el("input", { type: "number", step, min: "0", value: String(value || 0) });
    input.addEventListener("input", () => onChange(parseFloat(input.value) || 0));
    return input;
  }

  function renderPlan() {
    const box = $("planItems");
    box.innerHTML = "";
    $("planSummary").textContent = currentPlan.summary || "";
    currentPlan.items.forEach((item, idx) => {
      const name = el("input", { type: "text", value: item.name, oninput: (e) => (item.name = e.target.value) });
      const remove = el("button", { class: "btn ghost small", text: "Remove" });
      remove.addEventListener("click", () => {
        currentPlan.items.splice(idx, 1);
        renderPlan();
      });
      const text = el("textarea", { rows: "3", value: item.text, oninput: (e) => (item.text = e.target.value) });
      let left;
      if (item.type === "speech") {
        // Falls back to the default voice if Claude's pick isn't in the list.
        if (!state.voices.some((v) => v.voice_id === item.voice_id)) item.voice_id = A.ui.defaultVoiceId();
        const p = A.ui.voicePicker({ value: item.voice_id, title: "Voice for “" + item.name + "”", onChange: (v) => (item.voice_id = v) });
        left = field("Voice", p.el);
      } else {
        left = field("Seconds (0 = auto)", numberInput(item.duration_seconds, "0.5", (v) => (item.duration_seconds = v)));
      }
      const right = field("Starts at (+s)", numberInput(item.start_offset_seconds, "0.1", (v) => (item.start_offset_seconds = v)));
      box.appendChild(el("div", { class: "item " + item.type }, [
        el("div", { class: "item-head" }, [el("span", { class: "badge " + item.type, text: item.type }), name, remove]),
        field(item.type === "speech" ? "Words" : "Prompt", text),
        el("div", { class: "item-row" }, [left, right]),
        item.notes ? el("div", { class: "notes", text: item.notes }) : null,
      ]));
    });
    $("planBox").classList.toggle("hidden", !currentPlan.items.length && !currentPlan.summary);
    updateGenerateBox();
  }

  $("planBtn").addEventListener("click", () =>
    busy($("planBtn"), async () => {
      const prompt = $("prompt").value.trim();
      if (!prompt) throw new Error("Describe what you want first.");
      if (!state.voices.length) await A.ui.refreshVoices();
      let context = null;
      if ($("useContext").checked) {
        try { context = await A.premiere.getContext(); } catch (e) { log("No sequence info: " + e.message); }
      }
      // Tell Claude which voice is the editor's default so "my voice" resolves to it.
      const def = A.ui.defaultVoiceId();
      const withDefault = def ? prompt + "\n\n(My default voice is " + A.ui.voiceName(def) + ", voice_id " + def + ".)" : prompt;
      log("Claude is planning…");
      currentPlan = await A.claude.plan(withDefault, context, state.voices);
      log("Plan ready · " + currentPlan.items.length + " item(s). Review, then generate.", "ok");
      renderPlan();
    })
  );

  $("clearPlanBtn").addEventListener("click", () => {
    currentPlan = null;
    $("planBox").classList.add("hidden");
    updateGenerateBox();
  });

  async function produce(items, place, firstTrack) {
    const project = await A.premiere.getProject();
    const bin = await A.premiere.getBin(project);
    const ext = A.eleven.fileExtension();
    let ok = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const label = (items.length > 1 ? i + 1 + "/" + items.length + " " : "") + item.name;
      try {
        log("Generating " + label + "…");
        const bytes = await A.eleven.generate(item);
        const saved = await A.premiere.saveAudio(item.name, bytes, ext, ["generated"]);
        const projectItem = await A.premiere.importFile(project, bin, saved);
        if (item.type !== "speech") {
          await A.library.add({
            kind: item.type === "music" ? "music" : "sound",
            category: item.type === "music" ? undefined : "hard_fx",
            mood: "Other",
            name: item.name,
            prompt: item.text,
            path: saved.path,
            seconds: item.duration_seconds || 0,
            project: project.name.replace(/\.prproj$/i, ""),
          });
        }
        if (place) {
          const track = firstTrack + i;
          await A.premiere.placeOnTimeline(project, projectItem, track, item.start_offset_seconds);
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
      await produce([{
        type,
        name: (type === "speech" ? "VO " : type + " ") + text.slice(0, 24),
        text,
        voice_id: type === "speech" ? directVoice.value : "",
        duration_seconds: type === "speech" ? 0 : parseFloat($("directDuration").value) || 0,
        start_offset_seconds: 0,
      }], place, firstTrack);
    })
  );

  $("placeOnTimeline").addEventListener("change", () => {
    $("trackField").classList.toggle("hidden", !$("placeOnTimeline").checked);
  });

  // =============== change voice ===============
  let selectedClips = [];
  let changeFile = null;

  const changeSource = A.ui.segmented("changeSource", (src) => {
    $("changeTimeline").classList.toggle("hidden", src !== "timeline");
    $("changeFile").classList.toggle("hidden", src !== "file");
  });

  async function readSelection() {
    selectedClips = await A.premiere.getSelectedAudioClips(await A.premiere.getProject());
    const box = $("selectedClips");
    box.innerHTML = "";
    if (!selectedClips.length) throw new Error("No audio clips selected. Click an audio clip on the timeline (Shift-click for more).");
    selectedClips.forEach((c) => {
      box.appendChild(el("div", { class: "clip" }, [
        el("span", { text: c.name }),
        el("span", { class: "muted", text: "A" + (c.trackIndex + 1) + " · " + A.util.fmtTime(c.startSec) + " · " + (c.endSec - c.startSec).toFixed(1) + "s" }),
      ]));
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

  $("changeBtn").addEventListener("click", () =>
    busy($("changeBtn"), async () => {
      const voiceId = changeVoice.value;
      if (!voiceId) throw new Error("Pick the voice to change into.");
      const denoise = $("changeDenoise").checked;
      const project = await A.premiere.getProject();
      const bin = await A.premiere.getBin(project);
      const seq = await project.getActiveSequence();

      if (changeSource() === "file") {
        if (!changeFile) throw new Error("Choose an audio file first.");
        log("Changing " + changeFile.name + " to " + A.ui.voiceName(voiceId) + "…");
        const data = await changeFile.read({ format: uxp.storage.formats.binary });
        const bytes = await A.eleven.changeVoice(voiceId, changeFile.name, data, denoise);
        const saved = await A.premiere.saveAudio(changeFile.name.replace(/\.[^.]+$/, "") + " " + A.ui.voiceName(voiceId), bytes, A.eleven.fileExtension(), ["voice_change"]);
        const at = seq ? (await seq.getPlayerPosition()).seconds : null;
        const track = await A.ui.importAndPlace(saved, at, A.ui.estimateSeconds(bytes), 1);
        log(track ? "Added " + saved.fileName + " on A" + track + " at the playhead." : "Imported " + saved.fileName + " into the bin.", "ok");
        return;
      }

      if (!selectedClips.length) await readSelection();
      if (!seq) throw new Error("Open the sequence with those clips.");
      let ok = 0;
      for (const clip of selectedClips) {
        try {
          await A.ui.changeClip(project, bin, seq, clip, voiceId, denoise);
          ok++;
        } catch (e) {
          log(clip.name + ": " + (e.message || e), "error");
        }
      }
      if (selectedClips.length > 1) log("Done · " + ok + " of " + selectedClips.length + " clip(s).", ok === selectedClips.length ? "ok" : "error");
    })
  );

  updateGenerateBox();
})();
