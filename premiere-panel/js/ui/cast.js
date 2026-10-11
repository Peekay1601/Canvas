// Cast tab: one square card per character. Tick the characters to process, map each one's dub audio
// (a full-length file or a Premiere track), pick or design a voice, approve it, and convert the
// whole layer into ONE continuous file.
(function () {
  const A = window.AIA;
  const { $, el, log, busy, state, on } = A.ui;
  const uxp = A.ui.uxp;
  let trackCount = 0;

  // Voice names come from the dub file name, else the cue sheet/script, else the sequence (#4).
  function sourceLabel(c) {
    if (c.source && c.source.type === "file") return c.source.name.replace(/\.[^.]+$/, "");
    if (c.dub_clips && c.dub_clips.length) return c.dub_clips[0].replace(/\.[^.]+$/, "");
    if (state.dubSheet) return "Cue sheet";
    if (state.script) return "Script";
    return (state.film && state.film.sequence) || "Film";
  }

  function sourceText(c) {
    if (!c.source) return "Not mapped";
    if (c.source.type === "file") return "🎧 " + c.source.name;
    return "🎚 Track A" + (c.source.index + 1);
  }

  function saveFilm() {
    const film = state.film;
    if (!film) return Promise.resolve();
    const copy = Object.assign({}, film, {
      cast: (film.cast || []).map((c) => {
        const x = Object.assign({}, c);
        delete x.options;
        return x;
      }),
    });
    return A.library.saveAnalysis(film.sequence, copy).catch(() => {});
  }

  async function approve(c, voiceId, quiet) {
    const project = await A.premiere.getProject();
    const still = (state.film.stills || []).find((s) => s.index === c.best_still);
    c.voice_id = voiceId;
    c.approved = true;
    await A.library.castSave({
      name: c.name,
      voice_id: voiceId,
      voice_name: A.ui.voiceName(voiceId),
      look: c.look,
      age_range: c.age_range,
      gender: c.gender,
      voice_prompt: c.voice_prompt,
      project: project.name.replace(/\.prproj$/i, ""),
      sequence: state.film.sequence,
      still: still ? still.path : "",
    });
    await A.ui.refreshVoices();
    await saveFilm();
    if (!quiet) {
      render();
      log(c.name + " → " + A.ui.voiceName(voiceId) + " approved. Saved to your character voices.", "ok");
    }
  }

  // One character, whole layer, one file.
  async function changeCharacter(c) {
    if (!c.source) throw new Error("Map " + c.name + "'s dub audio first (a dubbing file or a timeline track).");
    if (!c.voice_id) throw new Error("Choose or design a voice for " + c.name + " first.");
    if (!c.approved) await approve(c, c.voice_id, true);
    const r = await A.dub.convertLayer(c, c.voice_id, {
      denoise: $("castDenoise").checked,
      muteSource: $("castMuteSource").checked,
      onLog: (m) => log(m),
      onProgress: (i, n) => ($("statusText").textContent = c.name + ": converting " + i + " / " + n + "…"),
    });
    c.layer = r.saved.path;
    await saveFilm();
    log(c.name + " → one " + Math.round(r.seconds) + " s layer" + (r.track ? " on A" + r.track : " in the bin (no free track)") + ". " + Math.round(r.sentSeconds) + " s of speech converted.", "ok");
  }

  function optionRow(c, opt) {
    const play = el("button", { class: "btn tiny", text: "▶", title: "Play" });
    play.addEventListener("click", () => busy(play, () => A.premiere.playPreview(c.name + " " + opt.letter, opt.bytes)));
    const use = el("button", { class: "btn tiny good", text: "✓", title: "Approve this voice" });
    use.addEventListener("click", () =>
      busy(use, async () => {
        const name = c.name + " · " + sourceLabel(c);
        log("Saving " + name + " to your ElevenLabs voices…");
        const id = await A.eleven.saveDesignedVoice(name, c.voice_prompt, opt.generated_voice_id);
        await A.ui.refreshVoices();
        await approve(c, id);
      })
    );
    return el("div", { class: "opt" }, [el("span", { text: c.name + " " + opt.letter + " · " + sourceLabel(c) }), play, use]);
  }

  // Dub audio mapping: an uploaded file, a timeline track, or upload a new full file.
  function mapBox(c) {
    const select = el("select");
    select.appendChild(el("option", { value: "", text: "Map dub audio…" }));
    (state.dubFiles || []).forEach((f) => select.appendChild(el("option", { value: "file:" + f.path, text: "🎧 " + f.name })));
    for (let i = 0; i < trackCount; i++) select.appendChild(el("option", { value: "track:" + i, text: "🎚 Track A" + (i + 1) + " (whole layer)" }));
    select.appendChild(el("option", { value: "upload", text: "⬆ Upload full file…" }));
    select.value = !c.source ? "" : c.source.type === "file" ? "file:" + c.source.path : "track:" + c.source.index;

    select.addEventListener("change", () =>
      busy(select, async () => {
        const v = select.value;
        if (v === "upload") {
          const file = await uxp.storage.localFileSystem.getFileForOpening({ types: ["wav", "mp3", "m4a", "aac", "flac", "aif", "aiff", "mp4", "mov"] });
          if (!file) { render(); return; }
          await A.ui.film.addDubFiles([file]);
          c.source = { type: "file", path: file.nativePath, name: file.name, offset: 0 };
        } else if (v.indexOf("file:") === 0) {
          const f = state.dubFiles.find((x) => x.path === v.slice(5));
          c.source = { type: "file", path: f.path, name: f.name, offset: 0 };
        } else if (v.indexOf("track:") === 0) {
          c.source = { type: "track", index: parseInt(v.slice(6), 10) };
        } else {
          c.source = null;
        }
        if (c.source) c.include = true;
        await saveFilm();
        render();
      })
    );

    const children = [el("div", { class: "label", text: "Dub audio" }), select];
    if (c.source && c.source.type === "file") {
      const offset = el("input", { type: "number", step: "0.1", value: String(c.source.offset || 0) });
      offset.addEventListener("change", () => {
        c.source.offset = parseFloat(offset.value) || 0;
        saveFilm();
      });
      children.push(el("div", { class: "map-row" }, [el("label", { text: "File starts on the timeline at (s)" }), offset]));
    }
    return el("div", { class: "map-box" }, children);
  }

  function card(c) {
    const film = state.film;
    const still = c.best_still ? (film.stills || []).find((s) => s.index === c.best_still) : null;
    const photo = el("div", { class: "cast-photo" });
    if (still) {
      const img = el("img", { alt: c.name });
      A.ui.stillDataUrl(still.path).then((u) => (img.src = u)).catch(() => {});
      photo.appendChild(img);
    } else {
      photo.appendChild(el("div", { class: "no-face", text: "🎧" }));
    }
    photo.appendChild(el("span", {
      class: "cast-status" + (c.approved ? " ok" : ""),
      text: c.layer ? "✓ Converted" : c.approved ? (c.fromLibrary ? "✓ From library" : "✓ Approved") : "Needs a voice",
    }));
    const pick = el("input", { type: "checkbox" });
    pick.checked = !!c.include;
    pick.addEventListener("change", () => {
      c.include = pick.checked;
      saveFilm();
      render();
    });
    photo.appendChild(el("label", { class: "cast-pick" }, [pick, el("span", { text: "Include" })]));

    const name = el("input", { type: "text", class: "cast-name", value: c.name });
    name.addEventListener("change", () => {
      c.name = name.value.trim() || c.name;
      saveFilm();
    });

    const select = el("select", { class: "voice-select" });
    A.ui.fillVoiceSelect(select, c.voice_id || "", { placeholder: "Choose a voice…" });
    select.addEventListener("change", () => {
      c.voice_id = select.value;
      c.approved = false;
      render();
    });

    const approveBtn = el("button", { class: "btn block good", text: "✓ Approve this voice" });
    approveBtn.disabled = !c.voice_id || c.approved;
    approveBtn.addEventListener("click", () => busy(approveBtn, () => approve(c, c.voice_id)));

    const optBtn = el("button", { class: "btn block", text: c.options ? "↻ 3 new voice options" : "✨ 3 voice options" });
    optBtn.addEventListener("click", () =>
      busy(optBtn, async () => {
        log("Designing 3 voices for " + c.name + "…");
        const previews = await A.eleven.designVoice(c.voice_prompt, c.preview_line);
        c.options = previews.map((p, i) => Object.assign({ letter: "ABC"[i] || String(i + 1) }, p));
        render();
        log(c.name + ": 3 voice options ready. ▶ to listen, ✓ to approve.", "ok");
      })
    );

    const promptWrap = el("div", { class: "hidden" }, [
      el("textarea", { class: "prompt-box", rows: "5", value: c.voice_prompt, oninput: (e) => (c.voice_prompt = e.target.value), onchange: saveFilm }),
      el("textarea", { class: "prompt-box", rows: "3", value: c.preview_line, oninput: (e) => (c.preview_line = e.target.value), onchange: saveFilm }),
    ]);
    const disclose = el("button", { class: "disclosure", text: "Voice prompt ▾" });
    disclose.addEventListener("click", () => {
      const open = promptWrap.classList.toggle("hidden") === false;
      disclose.textContent = open ? "Voice prompt ▴" : "Voice prompt ▾";
    });

    const changeBtn = el("button", { class: "btn block primary", text: c.layer ? "↻ Convert layer again" : "🔁 Convert layer" });
    changeBtn.disabled = !c.source || !c.voice_id;
    changeBtn.addEventListener("click", () => busy(changeBtn, async () => { await changeCharacter(c); render(); }));

    const playLayer = c.layer ? el("button", { class: "btn block", text: "▶ Play converted layer" }) : null;
    if (playLayer) playLayer.addEventListener("click", () => busy(playLayer, () => A.premiere.playFile(c.layer)));

    return el("div", { class: "cast-card" }, [
      el("div", { class: "cast-inner" + (c.approved ? " approved" : "") + (c.include ? "" : " excluded") }, [
        photo,
        el("div", { class: "cast-body" }, [
          name,
          el("div", { class: "cast-meta", text: [c.age_range, c.gender].filter(Boolean).join(" · ") }),
          el("div", { class: "cast-look", text: c.look, title: c.look + (c.notes ? "\n\n" + c.notes : "") }),
          mapBox(c),
          select,
          approveBtn,
          optBtn,
          el("div", {}, (c.options || []).map((o) => optionRow(c, o))),
          disclose,
          promptWrap,
          changeBtn,
          playLayer,
        ]),
      ]),
    ]);
  }

  async function render() {
    const film = state.film;
    const cast = film && film.cast;
    $("castEmpty").classList.toggle("hidden", !!(cast && cast.length));
    $("castBar").classList.toggle("hidden", !(cast && cast.length));
    const grid = $("castGrid");
    grid.innerHTML = "";
    if (!cast || !cast.length) return;
    try {
      trackCount = await (await A.premiere.getSequence()).getAudioTrackCount();
    } catch (e) {
      trackCount = 0;
    }
    grid.innerHTML = "";
    const picked = cast.filter((c) => c.include);
    const ready = picked.filter((c) => c.source && c.voice_id);
    $("castSummary").textContent = cast.length + " characters · " + picked.length + " selected · " + ready.length + " ready";
    $("castChangeAllBtn").textContent = ready.length ? "🔁 Change voice for " + ready.length + " selected" : "🔁 Change voice for selected";
    cast.forEach((c) => grid.appendChild(card(c)));
  }

  $("castChangeAllBtn").addEventListener("click", () =>
    busy($("castChangeAllBtn"), async () => {
      const picked = (state.film.cast || []).filter((c) => c.include);
      if (!picked.length) throw new Error("Tick “Include” on the characters you want to convert.");
      const notReady = picked.filter((c) => !c.source || !c.voice_id);
      if (notReady.length) throw new Error(notReady.map((c) => c.name).join(", ") + ": map the dub audio and choose a voice first.");
      let ok = 0;
      for (const c of picked) {
        try {
          await changeCharacter(c);
          ok++;
        } catch (e) {
          log(c.name + ": " + (e.message || e), "error");
        }
      }
      render();
      log("Done · " + ok + " of " + picked.length + " characters converted, one layer each.", ok === picked.length ? "ok" : "error");
    })
  );

  on("film", render);
  on("voices", render);
  on("dub", render);
})();
