// Startup: wire tabs and the status bar, load settings, voices and the open sequence's saved work.
(function () {
  const A = window.AIA;
  const { $, log } = A.ui;

  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => A.ui.goTo(tab.dataset.tab)));
  A.ui.initCollapsibles();

  $("statusToggle").addEventListener("click", () => {
    const open = $("logPanel").classList.toggle("hidden") === false;
    $("statusArrow").textContent = open ? "Activity ▾" : "Activity ▴";
  });
  $("clearLogBtn").addEventListener("click", () => ($("log").innerHTML = ""));

  (async () => {
    try {
      await A.ui.settingsView.load();
      await A.ui.refreshVoices();
      await A.ui.film.loadForActiveSequence().catch(() => {});
      A.ui.libraryView.load();
      const missing = [];
      if (!(await A.settings.getKey("elevenlabs"))) missing.push("ElevenLabs");
      if (!(await A.settings.getKey("claude"))) missing.push("Claude");
      if (missing.length) {
        log("Add your " + missing.join(" and ") + " key in Settings to get started.", "error");
        A.ui.settingsView.open();
      } else {
        log("Ready · " + A.ui.state.voices.length + " voices loaded.", "ok");
      }
    } catch (e) {
      log(e.message || String(e), "error");
    }
  })();
})();
