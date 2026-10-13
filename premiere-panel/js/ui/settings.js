// Settings pane (opened from the ⚙ button).
(function () {
  const A = window.AIA;
  const { $, log, busy } = A.ui;
  let lastTab = "film";

  async function refreshKeyPills() {
    $("keyEleven").classList.toggle("on", !!(await A.settings.getKey("elevenlabs")));
    $("keyClaude").classList.toggle("on", !!(await A.settings.getKey("claude")));
  }

  async function load() {
    $("claudeModel").value = A.settings.get("claudeModel");
    $("ttsModel").value = A.settings.get("ttsModel");
    A.ui.setSelect($("outputFormat"), A.settings.get("outputFormat"));
    $("binName").value = A.settings.get("binName");
    $("elevenKey").placeholder = (await A.settings.getKey("elevenlabs")) ? "Saved · type to replace" : "xi-…";
    $("claudeKey").placeholder = (await A.settings.getKey("claude")) ? "Saved · type to replace" : "sk-ant-…";
    $("outputFolder").textContent = (await A.settings.getOutputFolder()).nativePath;
    await refreshKeyPills();
  }

  function open() {
    const active = document.querySelector(".tab.active");
    if (active) lastTab = active.dataset.tab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.id === "tab-settings"));
  }

  $("settingsBtn").addEventListener("click", open);
  $("keyEleven").addEventListener("click", open);
  $("keyClaude").addEventListener("click", open);
  $("settingsCloseBtn").addEventListener("click", () => A.ui.goTo(lastTab));

  $("saveSettingsBtn").addEventListener("click", () =>
    busy($("saveSettingsBtn"), async () => {
      if ($("elevenKey").value) await A.settings.setKey("elevenlabs", $("elevenKey").value);
      if ($("claudeKey").value) await A.settings.setKey("claude", $("claudeKey").value);
      $("elevenKey").value = "";
      $("claudeKey").value = "";
      A.settings.set("claudeModel", $("claudeModel").value.trim());
      A.settings.set("ttsModel", $("ttsModel").value.trim());
      A.settings.set("outputFormat", A.ui.selectValue($("outputFormat")));
      A.settings.set("binName", $("binName").value.trim());
      await load();
      log("Settings saved.", "ok");
      await A.ui.refreshVoices();
    })
  );

  $("chooseFolderBtn").addEventListener("click", () =>
    busy($("chooseFolderBtn"), async () => {
      const folder = await A.settings.chooseOutputFolder();
      if (folder) $("outputFolder").textContent = folder.nativePath;
    })
  );

  $("testKeysBtn").addEventListener("click", () =>
    busy($("testKeysBtn"), async () => {
      try {
        const v = await A.eleven.listVoices();
        log("ElevenLabs OK · " + v.length + " voices.", "ok");
      } catch (e) {
        log(e.message, "error");
      }
      try {
        await A.claude.ping();
        log("Claude OK.", "ok");
      } catch (e) {
        log(e.message, "error");
      }
    })
  );

  A.ui.settingsView = { load, open, refreshKeyPills };
})();
