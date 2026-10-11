// Sound tab: the cue sheet from the film analysis, segregated by category, generated with ElevenLabs.
(function () {
  const A = window.AIA;
  const { $, el, log, busy, state, on } = A.ui;

  const CATS = [
    { value: "ambience", label: "Ambience" },
    { value: "foley", label: "Foley" },
    { value: "human", label: "Human" },
    { value: "hard_fx", label: "Hard FX" },
    { value: "designed_fx", label: "Designed FX" },
  ];
  const catLabel = (v) => (CATS.find((c) => c.value === v) || { label: v }).label;
  const EVIDENCE = { observed: "seen", script: "script", inferred: "guess" };
  let filter = "all";

  function cues() {
    return (state.film && state.film.sound && state.film.sound.cues) || [];
  }

  function visible() {
    return cues().filter((c) => filter === "all" || c.category === filter);
  }

  function saveFilm() {
    const film = state.film;
    if (!film) return;
    const copy = Object.assign({}, film, {
      cast: (film.cast || []).map((c) => { const x = Object.assign({}, c); delete x.options; return x; }),
    });
    A.library.saveAnalysis(film.sequence, copy).catch(() => {});
  }

  // ----- render ---------------------------------------------------------------
  function renderScene() {
    const s = state.film.sound.scene || {};
    const rows = [
      ["Setting", s.setting_period],
      ["Emotion", s.emotion_arc],
      ["Perspective", s.perspective],
      ["Key moments", s.key_moments],
      ["Ending", s.ending],
      ["Limits", state.film.sound.limitations],
    ].filter((r) => r[1]);
    const card = $("sceneCard");
    card.innerHTML = "";
    card.appendChild(el("div", { class: "section-title", text: "Scene" }));
    rows.forEach((r) => card.appendChild(el("div", { class: "scene-row" }, [el("span", { class: "scene-key", text: r[0] }), el("span", { class: "scene-val", text: r[1] })])));
  }

  function renderFilter() {
    const all = cues();
    const items = [{ value: "all", label: "All", count: all.length }].concat(
      CATS.map((c) => ({ value: c.value, label: c.label, swatch: c.value, count: all.filter((x) => x.category === c.value).length }))
    );
    A.ui.chips($("cueFilter"), items, filter, (v) => {
      filter = v;
      render();
    });
  }

  function cueRow(c) {
    const box = el("input", { type: "checkbox" });
    box.checked = !!c.selected;
    box.addEventListener("change", () => {
      c.selected = box.checked;
      updateCount();
    });

    const detail = el("div", { class: "cue-detail hidden" });
    const title = el("span", { class: "cue-title", text: c.title });
    const row = el("div", { class: "cue-row" }, [
      box,
      el("span", { class: "cue-time", text: A.util.fmtTime(c.start_seconds) }),
      title,
      el("span", { class: "cue-tag " + c.evidence, text: EVIDENCE[c.evidence] || c.evidence }),
      c.file ? el("span", { class: "cue-tag done", text: "✓" }) : null,
    ]);
    title.addEventListener("click", () => detail.classList.toggle("hidden"));

    const prompt = el("textarea", { rows: "3", value: c.prompt });
    prompt.addEventListener("change", () => {
      c.prompt = prompt.value;
      saveFilm();
    });
    const genOne = el("button", { class: "btn small", text: c.file ? "↻ Regenerate" : "Generate this" });
    genOne.addEventListener("click", () => busy(genOne, async () => { await generateCue(c, $("cuePlace").checked); render(); }));
    const actions = el("div", { class: "button-row" }, [genOne]);
    if (c.file) {
      const play = el("button", { class: "btn small", text: "▶ Play" });
      play.addEventListener("click", () => busy(play, () => A.premiere.playFile(c.file)));
      actions.appendChild(play);
    }
    detail.appendChild(el("div", { class: "meta", text: c.id + " · " + catLabel(c.category) + " · " + c.duration_seconds + " s · " + c.intensity + (c.loop ? " · loop" : "") + (c.stills.length ? " · stills " + c.stills.join(", ") : "") }));
    detail.appendChild(prompt);
    if (c.notes) detail.appendChild(el("div", { class: "meta", text: c.notes }));
    detail.appendChild(actions);

    return el("div", { class: "cue " + c.category }, [row, detail]);
  }

  function updateCount() {
    const sel = cues().filter((c) => c.selected).length;
    $("cueCount").textContent = sel + " of " + cues().length + " selected";
    $("cueGenerateBtn").textContent = sel ? "Generate " + sel + " selected" : "Generate selected";
    const vis = visible();
    $("cueSelectAll").checked = vis.length > 0 && vis.every((c) => c.selected);
  }

  function render() {
    const has = cues().length > 0;
    $("soundEmpty").classList.toggle("hidden", has);
    $("soundBody").classList.toggle("hidden", !has);
    if (!has) return;
    renderScene();
    renderFilter();
    const list = $("cueList");
    list.innerHTML = "";
    const vis = visible();
    if (!vis.length) list.appendChild(el("div", { class: "empty", text: "No " + catLabel(filter).toLowerCase() + " cues." }));
    vis.forEach((c) => list.appendChild(cueRow(c)));
    updateCount();
  }

  $("cueSelectAll").addEventListener("change", () => {
    visible().forEach((c) => (c.selected = $("cueSelectAll").checked));
    render();
  });

  // ----- generate ----------------------------------------------------------------
  function baseTrack(category) {
    return Math.max(1, parseInt(A.settings.get("track_" + category), 10) || 1);
  }

  async function generateCue(c, place) {
    const project = await A.premiere.getProject();
    const dur = Math.max(0.5, c.duration_seconds || 0);
    const longBed = c.loop && dur > 30;
    log("Generating " + c.id + " " + c.title + "…");
    const bytes = await A.eleven.generate({ type: "sfx", name: c.title, text: c.prompt, duration_seconds: Math.min(30, dur), loop: c.loop });
    const saved = await A.premiere.saveAudio(c.id + " " + c.title, bytes, A.eleven.fileExtension(), ["sound", catLabel(c.category)]);
    c.file = saved.path;
    await A.library.add({
      kind: "sound",
      category: c.category,
      name: c.id + " · " + c.title,
      prompt: c.prompt,
      path: saved.path,
      seconds: Math.min(30, dur),
      project: project.name.replace(/\.prproj$/i, ""),
      sequence: state.film.sequence,
    });

    if (!place) {
      log(c.id + " saved to the library.", "ok");
      saveFilm();
      return;
    }
    const bin = await A.premiere.getBin(project);
    const item = await A.premiere.importFile(project, bin, saved);
    const seq = await A.premiere.getSequence(project);
    const track = await A.premiere.findFreeAudioTrack(seq, baseTrack(c.category) - 1, c.start_seconds, c.start_seconds + dur);
    if (track < 0) {
      log(c.id + " is in the bin, but no free track from A" + baseTrack(c.category) + " down. Add audio tracks to place it.", "error");
      saveFilm();
      return;
    }
    if (longBed) {
      // Lay the 30 s loop end to end until the bed covers the cue.
      const seg = Math.min(30, A.ui.estimateSeconds(bytes) || 30);
      for (let t = 0; t < dur - 0.05; t += seg) {
        await A.premiere.placeAt(project, item, track, c.start_seconds + t, 0, Math.min(seg, dur - t));
      }
    } else {
      await A.premiere.placeAt(project, item, track, c.start_seconds);
    }
    log(c.id + " " + c.title + " → A" + (track + 1) + " at " + A.util.fmtTime(c.start_seconds), "ok");
    saveFilm();
  }

  $("cueGenerateBtn").addEventListener("click", () =>
    busy($("cueGenerateBtn"), async () => {
      const todo = cues().filter((c) => c.selected);
      if (!todo.length) throw new Error("Tick the cues you want to generate.");
      const place = $("cuePlace").checked;
      let ok = 0;
      for (const c of todo) {
        try {
          await generateCue(c, place);
          ok++;
        } catch (e) {
          log(c.id + ": " + (e.message || e), "error");
        }
      }
      render();
      A.ui.emit("library");
      log("Done · " + ok + " of " + todo.length + " cues generated.", ok === todo.length ? "ok" : "error");
    })
  );

  $("cueCsvBtn").addEventListener("click", () =>
    busy($("cueCsvBtn"), async () => {
      const path = await A.ui.film.saveCueSheet(state.film);
      log("Cue sheet saved: " + path, "ok");
    })
  );

  // ----- tracks per category -------------------------------------------------------
  function renderTrackMap() {
    const box = $("trackMap");
    box.innerHTML = "";
    CATS.concat([{ value: "music", label: "Music" }]).forEach((c) => {
      const input = el("input", { type: "number", min: "1", class: "num", value: A.settings.get("track_" + c.value) });
      input.addEventListener("change", () => A.settings.set("track_" + c.value, Math.max(1, parseInt(input.value, 10) || 1)));
      box.appendChild(el("div", { class: "inline-field" }, [
        el("label", {}, [el("span", { class: "swatch c-" + c.value }), el("span", { text: c.label + " starts on A" })]),
        input,
      ]));
    });
  }

  // ----- master brief ---------------------------------------------------------------
  $("soundBrief").value = A.settings.get("soundBrief");
  $("briefSaveBtn").addEventListener("click", () => {
    A.settings.set("soundBrief", $("soundBrief").value);
    log("Sound design brief saved.", "ok");
  });
  $("briefResetBtn").addEventListener("click", () => {
    A.settings.set("soundBrief", "");
    $("soundBrief").value = A.settings.get("soundBrief");
    log("Brief reset to the default.", "ok");
  });

  renderTrackMap();
  on("film", render);
  A.ui.sound = { render };
})();
