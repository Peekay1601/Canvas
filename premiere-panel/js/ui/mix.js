// Mix tab: one WAV per layer (dubbing, music, sound) and/or everything mixed, imported into Premiere.
(function () {
  const A = window.AIA;
  const { $, el, log, busy } = A.ui;

  const soundSplit = A.ui.segmented("mixSoundSplit", () => {});
  const output = A.ui.segmented("mixOutput", () => {});

  $("mixSound").addEventListener("change", () => $("mixSoundSplit").classList.toggle("hidden", !$("mixSound").checked));

  $("mixBtn").addEventListener("click", () =>
    busy($("mixBtn"), async () => {
      log("Collecting the panel's audio from the timeline…");
      const r = await A.mix.mixdown({
        dialogue: $("mixDialogue").checked,
        music: $("mixMusic").checked,
        sound: $("mixSound").checked,
        splitSound: soundSplit() === "five",
        output: output(),
        place: $("mixPlace").checked,
        muteSources: $("mixMute").checked,
        onLog: (m, k) => log(m, k),
      });
      const box = $("mixResults");
      box.innerHTML = "";
      r.results.forEach((x) => {
        const play = el("button", { class: "btn tiny", text: "▶" });
        play.addEventListener("click", () => busy(play, () => A.premiere.playFile(x.saved.path)));
        box.appendChild(el("div", { class: "mix-result" }, [
          el("span", { text: x.label }),
          el("span", { class: "muted small", text: x.track ? "A" + x.track : "bin" }),
          play,
        ]));
      });
      if (r.skipped.length) log("Skipped (not WAV, can't be mixed): " + r.skipped.join(", "), "error");
      log(r.results.length + " file(s) made, " + Math.round(r.seconds) + " s at " + r.rate + " Hz. Saved in the project's mix folder.", "ok");
    })
  );
})();
