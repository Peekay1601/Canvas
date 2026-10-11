// Settings: API keys live in the OS secure store; everything else in localStorage.
(function () {
  const uxp = require("uxp");
  const secure = uxp.storage.secureStorage;
  const fs = uxp.storage.localFileSystem;

  const DEFAULTS = {
    claudeModel: "claude-opus-5-5",
    ttsModel: "eleven_v4",
    outputFormat: "pcm_44100", // WAV, so the Mix tab can combine everything (falls back to 24 kHz on smaller plans)
    binName: "AI Audio",
    stillsCount: "auto",
    // First audio track (1-based) each sound category is placed from; the panel moves down to the next free track.
    track_ambience: "3",
    track_foley: "5",
    track_human: "7",
    track_hard_fx: "8",
    track_designed_fx: "9",
    track_music: "10",
    track_dialogue: "1",
  };
  const FOLDER_TOKEN_KEY = "aia.outputFolderToken";

  function bytesToString(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    let out = "";
    for (let i = 0; i < value.length; i++) out += String.fromCharCode(value[i]);
    return out;
  }

  async function getKey(name) {
    try {
      return bytesToString(await secure.getItem(name)).trim();
    } catch (e) {
      return "";
    }
  }

  async function setKey(name, value) {
    if (value) await secure.setItem(name, value.trim());
    else await secure.removeItem(name).catch(() => {});
  }

  function get(name) {
    const v = localStorage.getItem("aia." + name);
    if (v != null && v !== "") return v;
    if (name === "soundBrief") return window.AIA.DEFAULT_SOUND_BRIEF;
    return DEFAULTS[name];
  }

  function set(name, value) {
    localStorage.setItem("aia." + name, value == null ? "" : String(value));
  }

  // Output folder: a user-picked folder (kept with a persistent token) or the plugin data folder.
  async function chooseOutputFolder() {
    const folder = await fs.getFolder();
    if (!folder) return null;
    const token = await fs.createPersistentToken(folder);
    localStorage.setItem(FOLDER_TOKEN_KEY, token);
    return folder;
  }

  async function getOutputFolder() {
    const token = localStorage.getItem(FOLDER_TOKEN_KEY);
    if (token) {
      try {
        return await fs.getEntryForPersistentToken(token);
      } catch (e) {
        localStorage.removeItem(FOLDER_TOKEN_KEY);
      }
    }
    return fs.getDataFolder();
  }

  window.AIA = window.AIA || {};
  window.AIA.settings = { getKey, setKey, get, set, chooseOutputFolder, getOutputFolder };
})();
