// Film tab: script (backup reference), stills from the timeline, Claude analysis.
(function () {
  const A = window.AIA;
  const { $, el, log, busy, state, emit, on } = A.ui;
  const uxp = A.ui.uxp;
  const formats = uxp.storage.formats;

  const TEXT_TYPES = ["txt", "md", "fountain", "fdx", "srt", "rtf", "csv", "tsv"];
  const AUDIO_TYPES = ["wav", "mp3", "m4a", "aac", "flac", "aif", "aiff", "mp4", "mov"];

  // ----- script ------------------------------------------------------------
  async function scriptKey() {
    const project = await A.premiere.getProject();
    return "aia.script." + A.util.slug(project.name, 60);
  }

  function showScript(script) {
    $("scriptInfo").classList.toggle("hidden", !script);
    $("scriptBtn").textContent = script ? "Replace script…" : "Upload script…";
    if (script) $("scriptName").textContent = "📄 " + script.name;
    updateStep1Check();
  }

  function updateStep1Check() {
    const any = state.script || state.dubSheet || (state.dubFiles && state.dubFiles.length);
    $("scriptCheck").classList.toggle("hidden", !any);
  }

  async function readScriptFile(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (ext === "pdf") {
      const bytes = await file.read({ format: formats.binary });
      return { kind: "pdf", name: file.name, b64: A.util.bytesToBase64(bytes), bytes };
    }
    if (TEXT_TYPES.indexOf(ext) !== -1) {
      const text = await file.read({ format: formats.utf8 });
      return { kind: "text", name: file.name, text };
    }
    throw new Error("Use a TXT, CSV, Fountain, FDX, SRT or PDF file. For Word or Excel files, save as PDF or CSV first.");
  }

  $("scriptBtn").addEventListener("click", () =>
    busy($("scriptBtn"), async () => {
      const file = await uxp.storage.localFileSystem.getFileForOpening({ types: TEXT_TYPES.concat(["pdf"]) });
      if (!file) return;
      const script = await readScriptFile(file);
      // Keep a copy with the project so the analysis can always find it.
      const folder = await A.premiere.projectFolder("script");
      const copy = script.kind === "pdf"
        ? await A.util.writeBytes(folder, file.name, script.bytes)
        : await A.util.writeText(folder, file.name, script.text);
      delete script.bytes;
      script.path = copy.nativePath;
      state.script = script;
      localStorage.setItem(await scriptKey(), JSON.stringify({ name: script.name, path: script.path, kind: script.kind }));
      showScript(script);
      log("Script added: " + script.name, "ok");
    })
  );

  $("scriptRemoveBtn").addEventListener("click", async () => {
    state.script = null;
    localStorage.removeItem(await scriptKey());
    showScript(null);
    log("Script removed.", "ok");
  });

  async function restoreScript() {
    state.script = null;
    try {
      const saved = JSON.parse(localStorage.getItem(await scriptKey()) || "null");
      if (saved && saved.path) {
        const bytes = await A.premiere.readFileBytes(saved.path);
        state.script = saved.kind === "pdf"
          ? { kind: "pdf", name: saved.name, path: saved.path, b64: A.util.bytesToBase64(bytes) }
          : { kind: "text", name: saved.name, path: saved.path, text: new TextDecoderLite().decode(bytes) };
      }
    } catch (e) {
      state.script = null;
    }
    showScript(state.script);
  }

  // UTF-8 decoder (TextDecoder isn't in every UXP version).
  function TextDecoderLite() {}
  TextDecoderLite.prototype.decode = function (buffer) {
    const bytes = new Uint8Array(buffer);
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  };

  // ----- dubbing files + dubbing cue sheet -----------------------------------------
  async function dubKey() {
    const project = await A.premiere.getProject();
    return "aia.dub." + A.util.slug(project.name, 60);
  }

  async function saveDub() {
    localStorage.setItem(await dubKey(), JSON.stringify({
      files: state.dubFiles || [],
      sheet: state.dubSheet ? { name: state.dubSheet.name, path: state.dubSheet.path, kind: state.dubSheet.kind } : null,
    }));
    updateStep1Check();
  }

  function renderDub() {
    const box = $("dubFileList");
    box.innerHTML = "";
    (state.dubFiles || []).forEach((f) => {
      const rm = el("button", { class: "btn ghost small", text: "Remove" });
      rm.addEventListener("click", async () => {
        state.dubFiles = state.dubFiles.filter((x) => x.path !== f.path);
        await saveDub();
        renderDub();
        emit("dub");
      });
      box.appendChild(el("div", { class: "file-chip" }, [el("span", { class: "grow", text: "🎧 " + f.name }), rm]));
    });
    $("dubFilesBtn").textContent = state.dubFiles && state.dubFiles.length ? "Add more dubbing files…" : "Add dubbing files…";
    $("dubSheetInfo").classList.toggle("hidden", !state.dubSheet);
    $("dubSheetBtn").textContent = state.dubSheet ? "Replace cue sheet…" : "Upload cue sheet…";
    if (state.dubSheet) $("dubSheetName").textContent = "🗒 " + state.dubSheet.name;
    updateStep1Check();
  }

  // Adds dubbing files (kept where they are on disk; only their paths are remembered).
  async function addDubFiles(files) {
    state.dubFiles = state.dubFiles || [];
    files.forEach((f) => {
      if (!state.dubFiles.some((x) => x.path === f.nativePath)) state.dubFiles.push({ name: f.name, path: f.nativePath });
    });
    await saveDub();
    renderDub();
    emit("dub");
  }

  $("dubFilesBtn").addEventListener("click", () =>
    busy($("dubFilesBtn"), async () => {
      const picked = await uxp.storage.localFileSystem.getFileForOpening({ allowMultiple: true, types: AUDIO_TYPES });
      const files = picked ? (Array.isArray(picked) ? picked : [picked]) : [];
      if (!files.length) return;
      await addDubFiles(files);
      log(files.length + " dubbing file(s) added.", "ok");
    })
  );

  $("dubSheetBtn").addEventListener("click", () =>
    busy($("dubSheetBtn"), async () => {
      const file = await uxp.storage.localFileSystem.getFileForOpening({ types: TEXT_TYPES.concat(["pdf"]) });
      if (!file) return;
      const sheet = await readScriptFile(file);
      delete sheet.bytes;
      sheet.path = file.nativePath;
      state.dubSheet = sheet;
      await saveDub();
      renderDub();
      log("Dubbing cue sheet added: " + sheet.name, "ok");
    })
  );

  $("dubSheetRemoveBtn").addEventListener("click", async () => {
    state.dubSheet = null;
    await saveDub();
    renderDub();
  });

  async function restoreDub() {
    state.dubFiles = [];
    state.dubSheet = null;
    try {
      const saved = JSON.parse(localStorage.getItem(await dubKey()) || "null");
      if (saved) {
        state.dubFiles = saved.files || [];
        if (saved.sheet && saved.sheet.path) {
          const bytes = await A.premiere.readFileBytes(saved.sheet.path);
          state.dubSheet = saved.sheet.kind === "pdf"
            ? { kind: "pdf", name: saved.sheet.name, path: saved.sheet.path, b64: A.util.bytesToBase64(bytes) }
            : { kind: "text", name: saved.sheet.name, path: saved.sheet.path, text: new TextDecoderLite().decode(bytes) };
        }
      }
    } catch (e) {
      // keep whatever loaded
    }
    renderDub();
  }

  // ----- stills --------------------------------------------------------------
  async function renderStills() {
    const grid = $("stillsGrid");
    grid.innerHTML = "";
    const film = state.film;
    $("stillsCheck").classList.toggle("hidden", !(film && film.stills && film.stills.length));
    if (!film || !film.stills) return;
    $("stillsFolder").textContent = film.folder || "…/stills/";
    for (const st of film.stills) {
      const img = el("img", { alt: "" });
      grid.appendChild(el("div", { class: "thumb" }, [img, el("span", { text: A.util.fmtTime(st.seconds) })]));
      A.ui.stillDataUrl(st.path).then((url) => (img.src = url)).catch(() => {});
    }
  }

  A.ui.setSelect($("stillsCount"), A.settings.get("stillsCount"));
  $("stillsCount").addEventListener("change", () => A.settings.set("stillsCount", A.ui.selectValue($("stillsCount"))));

  $("grabBtn").addEventListener("click", () =>
    busy($("grabBtn"), async () => {
      const seq = await A.premiere.getSequence();
      const length = (await seq.getEndTime()).seconds;
      const choice = A.ui.selectValue($("stillsCount"));
      const count = choice === "auto" ? Math.max(12, Math.min(80, Math.round(length / 2))) : parseInt(choice, 10);
      log("Grabbing " + count + " stills from " + seq.name + "…");
      const grabbed = await A.premiere.grabStills(count, $("stillsInOut").checked, (i, n) => {
        $("statusText").textContent = "Grabbing stills " + i + " / " + n + "…";
      });
      // New stills replace the old analysis for this sequence.
      state.film = Object.assign({}, grabbed, { cast: null, sound: null });
      await A.library.saveAnalysis(grabbed.sequence, state.film);
      await renderStills();
      $("analyseCheck").classList.add("hidden");
      $("analyseResult").classList.add("hidden");
      log(count + " stills saved to " + grabbed.folder, "ok");
      emit("film");
    })
  );

  // ----- analysis ----------------------------------------------------------------
  // Matches characters to voices already approved in the cast library (same name, any timeline).
  async function attachCastVoices(characters, clips) {
    for (const c of characters) {
      const saved = await A.library.castFind(c.name);
      c.voice_id = saved ? saved.voice_id : "";
      c.approved = !!saved;
      c.fromLibrary = !!saved;
      if (saved && saved.photo) c.photo = saved.photo;
      // Map the dub audio: the uploaded full file first, else the track holding their dub clips.
      const file = (state.dubFiles || []).find((f) => f.name === c.dub_file);
      const clip = clips.find((x) => (c.dub_clips || []).indexOf(x.name) !== -1);
      if (file) c.source = { type: "file", path: file.path, name: file.name, offset: 0 };
      else if (clip) c.source = { type: "track", index: clip.trackIndex };
      else c.source = null;
      c.include = !!c.source;
    }
  }

  async function saveCueSheet(film) {
    const folder = await A.premiere.projectFolder("cue_sheets");
    const base = A.util.slug(film.sequence, 60) + "_cue_sheet";
    const rows = [["ID", "Category", "Title", "Start", "Duration (s)", "Evidence", "Intensity", "Loop", "Stills", "Prompt", "Notes"]];
    film.sound.cues.forEach((c) => rows.push([c.id, c.category, c.title, A.util.fmtTime(c.start_seconds), c.duration_seconds, c.evidence, c.intensity, c.loop ? "yes" : "", c.stills.join(" "), c.prompt, c.notes]));
    const csv = await A.util.writeText(folder, base + ".csv", A.util.toCsv(rows));
    await A.util.writeJson(folder, base + ".json", film.sound);
    return csv.nativePath;
  }

  $("analyseBtn").addEventListener("click", () =>
    busy($("analyseBtn"), async () => {
      const doCast = $("doCast").checked;
      const doSound = $("doSound").checked;
      if (!doCast && !doSound) throw new Error("Tick at least one thing to analyse.");
      const hasStills = state.film && state.film.stills && state.film.stills.length;
      const hasDub = (state.dubFiles && state.dubFiles.length) || state.dubSheet;
      if (doSound && !hasStills) throw new Error("The sound cue sheet needs stills: grab them in step 2 first.");
      if (!hasStills && !hasDub) throw new Error("Add dubbing files or a cue sheet (step 1), or grab stills (step 2).");
      if (!state.film) {
        const seq = await A.premiere.getSequence();
        state.film = { sequence: seq.name, start: 0, duration: Math.round((await seq.getEndTime()).seconds * 100) / 100, stills: [] };
      }
      const film = state.film;

      log("Preparing " + film.stills.length + " stills for Claude…");
      const project = await A.premiere.getProject();
      const stills = [];
      for (const st of film.stills) stills.push({ index: st.index, seconds: st.seconds, b64: await A.ui.stillBase64(st.path) });
      let clips = [];
      try {
        clips = await A.premiere.listAudioClips(project);
      } catch (e) {
        clips = [];
      }
      const media = {
        context: await A.premiere.getContext(),
        start: film.start,
        duration: film.duration,
        stills,
        clips,
        script: state.script,
        dubFiles: state.dubFiles,
        dubSheet: state.dubSheet,
      };

      if (doCast) {
        log("Claude is finding the characters…");
        const cast = await A.claude.analyzeCast(media);
        await attachCastVoices(cast.characters, clips);
        film.cast = cast.characters;
        film.clips = clips;
        await A.library.saveAnalysis(film.sequence, film);
        log(cast.characters.length + " characters found.", "ok");
        emit("film");
      }
      if (doSound) {
        log("Claude is building the sound cue sheet… (this can take a minute)");
        const sound = await A.claude.analyzeSound(media, A.settings.get("soundBrief"));
        sound.cues.sort((a, b) => a.start_seconds - b.start_seconds);
        sound.cues.forEach((c) => (c.selected = true));
        film.sound = sound;
        await A.library.saveAnalysis(film.sequence, film);
        const csv = await saveCueSheet(film);
        log(sound.cues.length + " sound cues. Cue sheet saved: " + csv, "ok");
        emit("film");
      }
      showResult();
    })
  );

  function showResult() {
    const film = state.film;
    const has = film && (film.cast || film.sound);
    $("analyseCheck").classList.toggle("hidden", !has);
    $("analyseResult").classList.toggle("hidden", !has);
    $("resCast").textContent = film && film.cast ? film.cast.length : 0;
    $("resCues").textContent = film && film.sound ? film.sound.cues.length : 0;
  }

  document.querySelectorAll(".result-chip").forEach((b) => b.addEventListener("click", () => A.ui.goTo(b.dataset.goto)));

  // ----- load saved work for the open sequence ---------------------------------------
  async function loadForActiveSequence() {
    const project = await A.premiere.getProject().catch(() => null);
    if (!project) return;
    const seq = await project.getActiveSequence();
    $("seqName").textContent = seq ? project.name.replace(/\.prproj$/i, "") + " · " + seq.name : "No sequence open";
    await restoreScript();
    await restoreDub();
    if (!seq) return;
    if (state.film && state.film.sequence === seq.name) return;
    state.film = await A.library.loadAnalysis(seq.name);
    try {
      $("stillsFolder").textContent = (await A.premiere.projectFolder("stills", seq.name)).nativePath;
    } catch (e) {
      // folder shown once stills are grabbed
    }
    await renderStills();
    showResult();
    emit("film");
  }

  A.ui.film = { loadForActiveSequence, saveCueSheet, addDubFiles };
  on("tab", (tab) => {
    if (tab === "film") loadForActiveSequence().catch(() => {});
  });
})();
