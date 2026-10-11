// Music tab: pick a mood, Claude writes the score prompt, ElevenLabs composes it, the library keeps it by mood.
(function () {
  const A = window.AIA;
  const { $, el, log, busy, state } = A.ui;

  const MOODS = ["Tense", "Hopeful", "Sad", "Epic", "Romantic", "Mysterious", "Joyful", "Calm", "Divine", "Action", "Dark", "Other"];
  let mood = "Epic";

  function renderMoods() {
    A.ui.chips($("moodChips"), MOODS.map((m) => ({ value: m, label: m })), mood, (m) => {
      mood = m;
      $("moodOther").classList.toggle("hidden", m !== "Other");
      renderMoods();
    });
  }

  function currentMood() {
    return mood === "Other" ? $("moodOther").value.trim() || "Custom" : mood;
  }

  $("musicPromptBtn").addEventListener("click", () =>
    busy($("musicPromptBtn"), async () => {
      const seconds = Math.max(3, Math.min(600, parseFloat($("musicLength").value) || 30));
      const scene = $("musicUseScene").checked && state.film && state.film.sound ? state.film.sound.scene : null;
      log("Claude is writing the score prompt…");
      const out = await A.claude.writeMusicPrompt(currentMood(), $("musicBrief").value.trim(), seconds, scene);
      $("musicTitle").value = out.title;
      $("musicPrompt").value = out.prompt;
      $("musicPromptCard").classList.remove("hidden");
      log("Prompt ready. Edit it if you like, then generate.", "ok");
    })
  );

  $("musicGenerateBtn").addEventListener("click", () =>
    busy($("musicGenerateBtn"), async () => {
      const prompt = $("musicPrompt").value.trim();
      if (!prompt) throw new Error("Write or generate a prompt first.");
      const title = $("musicTitle").value.trim() || currentMood() + " cue";
      const seconds = Math.max(3, Math.min(600, parseFloat($("musicLength").value) || 30));
      const m = currentMood();
      log("Composing “" + title + "” (" + seconds + " s)… this can take a minute.");
      const bytes = await A.eleven.generate({ type: "music", name: title, text: prompt, duration_seconds: seconds, instrumental: $("musicInstrumental").checked });
      const saved = await A.premiere.saveAudio(title, bytes, A.eleven.fileExtension(), ["music", m]);
      const project = await A.premiere.getProject();
      await A.library.add({
        kind: "music",
        mood: m,
        name: title,
        prompt,
        path: saved.path,
        seconds,
        project: project.name.replace(/\.prproj$/i, ""),
        sequence: state.film ? state.film.sequence : "",
      });
      A.ui.emit("library");
      if ($("musicPlace").checked) {
        const seq = await project.getActiveSequence();
        const at = seq ? (await seq.getPlayerPosition()).seconds : null;
        const track = await A.ui.importAndPlace(saved, at, seconds, parseInt(A.settings.get("track_music"), 10) || 1);
        log(track ? "“" + title + "” added on A" + track + " and saved under " + m + "." : "“" + title + "” saved under " + m + " (no free track at the playhead).", "ok");
      } else {
        log("“" + title + "” saved to Library → Music → " + m + ".", "ok");
      }
    })
  );

  renderMoods();
})();
