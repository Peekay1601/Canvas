// Voices tab: character voices (reusable across timelines), ElevenLabs library, clone, design.
(function () {
  const A = window.AIA;
  const { $, el, log, busy, state, on } = A.ui;
  const uxp = A.ui.uxp;

  // ----- character voices -------------------------------------------------------
  function renderCastLibrary() {
    const box = $("castLibrary");
    box.innerHTML = "";
    if (!state.cast.length) {
      box.appendChild(el("div", { class: "empty", text: "Approve a voice on a Cast card and it's saved here, ready for the same character in any timeline." }));
      return;
    }
    state.cast.forEach((c) => {
      const v = state.voices.find((x) => x.voice_id === c.voice_id);
      const play = el("button", { class: "btn tiny", text: "▶" });
      play.disabled = !v;
      play.addEventListener("click", () => busy(play, () => playVoiceSample(v)));
      const forget = A.ui.confirmButton("✕", async () => {
        await A.library.castRemove(c.name);
        await A.ui.refreshVoices();
        log(c.name + " removed from character voices (the ElevenLabs voice is kept).", "ok");
      });
      box.appendChild(el("div", { class: "voice" }, [
        el("div", { class: "voice-main" }, [
          el("div", { class: "voice-name" }, [el("span", { text: "🎭 " + c.name }), el("span", { class: "badge own", text: c.project || "" })]),
          el("div", { class: "voice-desc", text: (v ? v.name : "voice missing") + " · " + [c.age_range, c.gender].filter(Boolean).join(", ") }),
        ]),
        el("div", { class: "voice-actions" }, [play, forget]),
      ]));
    });
  }

  // ----- ElevenLabs voice library ---------------------------------------------------
  const voiceFilter = A.ui.segmented("voiceFilter", () => renderVoiceList());
  $("voiceSearch").addEventListener("input", () => renderVoiceList());
  $("refreshVoicesBtn").addEventListener("click", () =>
    busy($("refreshVoicesBtn"), async () => {
      await A.ui.refreshVoices();
      log("Voices refreshed · " + state.voices.length + " total.", "ok");
    })
  );

  async function playVoiceSample(v) {
    const bytes = v.previewUrl
      ? await A.eleven.downloadPreview(v.previewUrl)
      : await A.eleven.speakSample(v.voice_id, "Hi, this is " + v.name + ". Here is how I sound in your project.");
    await A.premiere.playPreview(v.name + " sample", bytes);
    log("Playing " + v.name + " in the Source Monitor.", "ok");
  }

  function renderVoiceList() {
    const box = $("voiceList");
    box.innerHTML = "";
    const q = $("voiceSearch").value.trim().toLowerCase();
    const onlyOwn = voiceFilter() === "own";
    const list = state.voices.filter((v) => (!onlyOwn || v.own) && (!q || (v.name + " " + v.description).toLowerCase().indexOf(q) !== -1));
    const def = A.settings.get("defaultVoice");
    if (!list.length) {
      box.appendChild(el("div", {
        class: "empty",
        text: !state.voices.length ? "Add your ElevenLabs key in Settings (⚙) to see your voices." : onlyOwn && !q ? "No voices of your own yet. Clone or design one below." : "No voices match.",
      }));
      return;
    }
    list.forEach((v) => {
      const isDefault = v.voice_id === def;
      const play = el("button", { class: "btn tiny", text: "▶" });
      play.addEventListener("click", () => busy(play, () => playVoiceSample(v)));
      const use = el("button", { class: "btn tiny" + (isDefault ? " primary" : ""), text: isDefault ? "Default" : "Use" });
      use.addEventListener("click", () => {
        A.settings.set("defaultVoice", v.voice_id);
        A.ui.refillVoiceSelects();
        renderVoiceList();
        log(v.name + " is now your default voice.", "ok");
      });
      const actions = [play, use];
      if (v.own) {
        actions.push(A.ui.confirmButton("Delete", async () => {
          await A.eleven.deleteVoice(v.voice_id);
          log("Deleted " + v.name + ".", "ok");
          await A.ui.refreshVoices();
        }));
      }
      box.appendChild(el("div", { class: "voice" + (isDefault ? " is-default" : "") }, [
        el("div", { class: "voice-main" }, [
          el("div", { class: "voice-name" }, [el("span", { text: v.name }), el("span", { class: "badge" + (v.own ? " own" : ""), text: v.category || "voice" })]),
          el("div", { class: "voice-desc", text: v.description || " " }),
        ]),
        el("div", { class: "voice-actions" }, actions),
      ]));
    });
  }

  // ----- add voices from the ElevenLabs Voice Library ---------------------------------
  let libPage = 0;
  async function searchLibrary(more) {
    libPage = more ? libPage + 1 : 0;
    const box = $("libResults");
    if (!more) box.innerHTML = "";
    const out = await A.eleven.searchSharedVoices({
      page: libPage,
      search: $("libSearch").value.trim(),
      gender: $("libGender").value,
      language: $("libLanguage").value,
    });
    if (!more && !out.voices.length) box.appendChild(el("div", { class: "empty", text: "No voices found. Try other words or filters." }));
    out.voices.forEach((v) => {
      const play = el("button", { class: "btn tiny", text: "▶" });
      play.disabled = !v.previewUrl;
      play.addEventListener("click", () => busy(play, () => playVoiceSample(v)));
      const have = state.voices.some((x) => x.voice_id === v.voice_id);
      const add = el("button", { class: "btn tiny good", text: have ? "Added" : "+ Add" });
      add.disabled = have;
      add.addEventListener("click", () =>
        busy(add, async () => {
          await A.eleven.addSharedVoice(v.owner, v.voice_id, v.name);
          await A.ui.refreshVoices();
          add.textContent = "Added";
          add.disabled = true;
          log("“" + v.name + "” added to My voices. Pick it in any voice dropdown.", "ok");
        })
      );
      box.appendChild(el("div", { class: "voice" }, [
        el("div", { class: "voice-main" }, [
          el("div", { class: "voice-name" }, [el("span", { text: v.name })]),
          el("div", { class: "voice-desc", text: v.description || " " }),
        ]),
        el("div", { class: "voice-actions" }, [play, add]),
      ]));
    });
    $("libMoreBtn").classList.toggle("hidden", !out.hasMore);
  }
  $("libSearchBtn").addEventListener("click", () => busy($("libSearchBtn"), () => searchLibrary(false)));
  $("libSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") busy($("libSearchBtn"), () => searchLibrary(false)); });
  $("libMoreBtn").addEventListener("click", () => busy($("libMoreBtn"), () => searchLibrary(true)));

  // ----- clone --------------------------------------------------------------------
  let cloneFiles = [];
  $("cloneFilesBtn").addEventListener("click", () =>
    busy($("cloneFilesBtn"), async () => {
      const picked = await uxp.storage.localFileSystem.getFileForOpening({ allowMultiple: true, types: ["mp3", "wav", "m4a", "aac", "flac", "ogg"] });
      cloneFiles = picked ? (Array.isArray(picked) ? picked : [picked]) : [];
      $("cloneFiles").textContent = cloneFiles.length ? cloneFiles.map((f) => f.name).join(", ") : "No files chosen";
    })
  );

  $("cloneBtn").addEventListener("click", () =>
    busy($("cloneBtn"), async () => {
      const name = $("cloneName").value.trim();
      if (!name) throw new Error("Give your voice a name.");
      if (!cloneFiles.length) throw new Error("Choose at least one recording.");
      const files = [];
      for (const f of cloneFiles) files.push({ name: f.name, data: await f.read({ format: uxp.storage.formats.binary }) });
      log("Uploading " + files.length + " recording(s) to ElevenLabs…");
      const id = await A.eleven.cloneVoice(name, files, $("cloneDenoise").checked);
      A.settings.set("defaultVoice", id);
      await A.ui.refreshVoices();
      log("“" + name + "” created and set as your default voice.", "ok");
    })
  );

  // ----- design with Claude -----------------------------------------------------------
  $("designPlanBtn").addEventListener("click", () =>
    busy($("designPlanBtn"), async () => {
      const brief = $("designBrief").value.trim();
      if (!brief) throw new Error("Describe the voice first.");
      log("Claude is writing the voice…");
      const v = await A.claude.designVoice(brief);
      $("designName").value = v.name;
      $("designDescription").value = v.voice_description;
      $("designText").value = v.preview_text;
      $("designPreviews").innerHTML = "";
      $("designBox").classList.remove("hidden");
      log("Voice written. Edit it if you like, then make options.", "ok");
    })
  );

  $("designPreviewBtn").addEventListener("click", () =>
    busy($("designPreviewBtn"), async () => {
      const description = $("designDescription").value.trim();
      const text = $("designText").value.trim();
      if (description.length < 20) throw new Error("The voice description needs at least 20 characters.");
      if (text.length < 100) throw new Error("The preview line needs at least 100 characters.");
      log("Making 3 voice options…");
      const previews = await A.eleven.designVoice(description, text);
      if (!previews.length) throw new Error("ElevenLabs returned no previews; try again.");
      const base = $("designName").value.trim() || "Voice";
      const box = $("designPreviews");
      box.innerHTML = "";
      previews.forEach((p, i) => {
        const play = el("button", { class: "btn tiny", text: "▶" });
        play.addEventListener("click", () => busy(play, () => A.premiere.playPreview(base + " " + (i + 1), p.bytes)));
        const keep = el("button", { class: "btn tiny good", text: "✓ Save" });
        keep.addEventListener("click", () =>
          busy(keep, async () => {
            const name = $("designName").value.trim() || base;
            const id = await A.eleven.saveDesignedVoice(name, description, p.generated_voice_id);
            A.settings.set("defaultVoice", id);
            await A.ui.refreshVoices();
            keep.textContent = "Saved";
            log("“" + name + "” saved to your voices and set as default.", "ok");
          })
        );
        box.appendChild(el("div", { class: "preview-row" }, [el("span", { text: "Option " + "ABC"[i] }), play, keep]));
      });
      log("3 options ready. ▶ to listen, ✓ to save.", "ok");
    })
  );

  on("voices", () => {
    renderCastLibrary();
    renderVoiceList();
  });
})();
