// Cast tab: one square card per character with their still, voice picker,
// three designed voice options to audition and approve, and voice change for their dub clips.
(function () {
  const A = window.AIA;
  const { $, el, log, busy, state, on } = A.ui;

  // Voice names come from the dub file name, else the script, else the project (#4).
  function sourceLabel(c) {
    if (c.dub_clips && c.dub_clips.length) return c.dub_clips[0].replace(/\.[^.]+$/, "");
    if (state.script) return "Script";
    return (state.film && state.film.sequence) || "Film";
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

  async function approve(c, voiceId) {
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
    render();
    log(c.name + " → " + A.ui.voiceName(voiceId) + " approved. Saved to your character voices.", "ok");
  }

  async function changeCharacter(c) {
    if (!c.approved || !c.voice_id) throw new Error("Approve a voice for " + c.name + " first.");
    if (!c.dub_clips || !c.dub_clips.length) throw new Error("No dub clips for " + c.name + ". Select their clips on the timeline and press “Use selected clips”.");
    const project = await A.premiere.getProject();
    const seq = await A.premiere.getSequence(project);
    const bin = await A.premiere.getBin(project);
    const all = await A.premiere.listAudioClips(project);
    const wanted = all.filter((x) => c.dub_clips.indexOf(x.name) !== -1);
    if (!wanted.length) throw new Error("Couldn't find " + c.name + "'s clips on this timeline.");
    let ok = 0;
    for (const clip of wanted) {
      try {
        await A.ui.changeClip(project, bin, seq, clip, c.voice_id, false, ["voice_change", c.name]);
        ok++;
      } catch (e) {
        log(clip.name + ": " + (e.message || e), "error");
      }
    }
    log(c.name + ": " + ok + " of " + wanted.length + " clip(s) changed.", ok === wanted.length ? "ok" : "error");
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

  function card(c) {
    const film = state.film;
    const still = (film.stills || []).find((s) => s.index === c.best_still) || (film.stills || [])[0];
    const img = el("img", { alt: c.name });
    if (still) A.ui.stillDataUrl(still.path).then((u) => (img.src = u)).catch(() => {});

    const status = el("span", {
      class: "cast-status" + (c.approved ? " ok" : ""),
      text: c.approved ? (c.fromLibrary ? "✓ From library" : "✓ Approved") : "Needs a voice",
    });

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
        log(c.name + ": 3 voice options ready. Press ▶ to listen, ✓ to approve.", "ok");
      })
    );

    const opts = el("div", {}, (c.options || []).map((o) => optionRow(c, o)));

    // Voice prompt, editable, behind a disclosure.
    const promptWrap = el("div", { class: "hidden" }, [
      el("textarea", { class: "prompt-box", rows: "5", value: c.voice_prompt, oninput: (e) => (c.voice_prompt = e.target.value), onchange: saveFilm }),
      el("textarea", { class: "prompt-box", rows: "3", value: c.preview_line, oninput: (e) => (c.preview_line = e.target.value), onchange: saveFilm }),
    ]);
    const disclose = el("button", { class: "disclosure", text: "Voice prompt ▾" });
    disclose.addEventListener("click", () => {
      const open = promptWrap.classList.toggle("hidden") === false;
      disclose.textContent = open ? "Voice prompt ▴" : "Voice prompt ▾";
    });

    const clipsInfo = el("div", { class: "cast-clips", text: "🎧 " + (c.dub_clips && c.dub_clips.length ? c.dub_clips.length + " dub clip(s): " + c.dub_clips.join(", ") : "No dub clips matched") });
    const useSel = el("button", { class: "btn tiny", text: "Use selected clips" });
    useSel.addEventListener("click", () =>
      busy(useSel, async () => {
        const sel = await A.premiere.getSelectedAudioClips(await A.premiere.getProject());
        if (!sel.length) throw new Error("Select " + c.name + "'s audio clips on the timeline first.");
        c.dub_clips = sel.map((x) => x.name).filter((n, i, a) => a.indexOf(n) === i);
        await saveFilm();
        render();
        log(c.name + ": " + c.dub_clips.length + " dub clip(s) assigned.", "ok");
      })
    );

    const changeBtn = el("button", { class: "btn block primary", text: "🔁 Change voice" });
    changeBtn.disabled = !c.approved || !(c.dub_clips && c.dub_clips.length);
    changeBtn.addEventListener("click", () => busy(changeBtn, () => changeCharacter(c)));

    return el("div", { class: "cast-card" }, [
      el("div", { class: "cast-inner" + (c.approved ? " approved" : "") }, [
        el("div", { class: "cast-photo" }, [img, status]),
        el("div", { class: "cast-body" }, [
          name,
          el("div", { class: "cast-meta", text: [c.age_range, c.gender].filter(Boolean).join(" · ") }),
          el("div", { class: "cast-look", text: c.look, title: c.look + (c.notes ? "\n\n" + c.notes : "") }),
          select,
          approveBtn,
          optBtn,
          opts,
          disclose,
          promptWrap,
          clipsInfo,
          useSel,
          changeBtn,
        ]),
      ]),
    ]);
  }

  function render() {
    const film = state.film;
    const cast = film && film.cast;
    $("castEmpty").classList.toggle("hidden", !!(cast && cast.length));
    $("castBar").classList.toggle("hidden", !(cast && cast.length));
    const grid = $("castGrid");
    grid.innerHTML = "";
    if (!cast || !cast.length) return;
    const approved = cast.filter((c) => c.approved).length;
    $("castSummary").textContent = cast.length + " characters · " + approved + " approved";
    cast.forEach((c) => grid.appendChild(card(c)));
  }

  $("castChangeAllBtn").addEventListener("click", () =>
    busy($("castChangeAllBtn"), async () => {
      const ready = (state.film.cast || []).filter((c) => c.approved && c.dub_clips && c.dub_clips.length);
      if (!ready.length) throw new Error("Approve voices and match dub clips first.");
      for (const c of ready) await changeCharacter(c).catch((e) => log(c.name + ": " + e.message, "error"));
    })
  );

  on("film", render);
  on("voices", render);
})();
