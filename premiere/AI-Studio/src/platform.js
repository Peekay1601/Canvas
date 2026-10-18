/*
 * Everything that touches the host lives here: Premiere Pro (UXP) when the panel runs
 * inside Premiere, or a plain browser when you open index.html for a quick UI preview.
 * The rest of the panel only talks to Studio.platform, never to `uxp` or `premierepro` directly.
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});

  let uxp = null;
  let ppro = null;
  try {
    uxp = require("uxp");
  } catch (e) {
    uxp = null;
  }
  try {
    ppro = require("premierepro");
  } catch (e) {
    ppro = null;
  }

  const isUXP = !!uxp;
  const SECRET_PREFIX = "aistudio.secret.";

  // ---------- small helpers ----------

  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  /** ArrayBuffer -> base64, without relying on btoa or FileReader (both are patchy in UXP). */
  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let out = "";
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    const rest = bytes.length - i;
    if (rest === 1) {
      const n = bytes[i] << 16;
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + "==";
    } else if (rest === 2) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + "=";
    }
    return out;
  }

  function bytesToString(bytes) {
    if (typeof bytes === "string") return bytes;
    let s = "";
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    try {
      return decodeURIComponent(escape(s)); // UTF-8 decode
    } catch (e) {
      return s;
    }
  }

  function mimeFor(name) {
    const ext = String(name).split(".").pop().toLowerCase();
    return (
      {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        mp4: "video/mp4",
        mov: "video/quicktime",
        pdf: "application/pdf",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        txt: "text/plain",
        svg: "image/svg+xml",
        webm: "video/webm",
        m4v: "video/mp4",
      }[ext] ||
      "application/octet-stream"
    );
  }

  // ---------- secrets (API keys) ----------

  /**
   * Keys go into UXP's secure storage as explicit UTF-8 bytes and come back as bytes. Older builds saved
   * plain strings, which some Premiere versions hand back as UTF-16 (a zero byte after every letter):
   * that turned every saved key into garbage after a restart, so every service rejected it.
   */
  function decodeSecret(v) {
    if (v == null) return "";
    if (typeof v === "string") return v.replace(/\u0000/g, "");
    const arr = v instanceof Uint8Array ? v : new Uint8Array(v.buffer ? v.buffer : v);
    let zerosOdd = 0;
    for (let i = 1; i < arr.length; i += 2) if (arr[i] === 0) zerosOdd++;
    if (arr.length >= 4 && zerosOdd >= arr.length / 2 - 1) {
      let s = "";
      for (let i = 0; i + 1 < arr.length; i += 2) s += String.fromCharCode(arr[i] | (arr[i + 1] << 8));
      return s.replace(/\u0000/g, "");
    }
    return bytesToString(arr).replace(/\u0000/g, "");
  }

  function hasSecureStorage() {
    return !!(isUXP && uxp.storage && uxp.storage.secureStorage);
  }

  async function getSecret(name) {
    if (hasSecureStorage()) {
      try {
        const v = await uxp.storage.secureStorage.getItem(SECRET_PREFIX + name);
        const text = decodeSecret(v);
        if (text) return text;
      } catch (e) {
        /* keychain unavailable: try the fallback below */
      }
    }
    try {
      return localStorage.getItem(SECRET_PREFIX + name) || "";
    } catch (e) {
      return "";
    }
  }

  /** Returns where the key was kept: "keychain" or "panel" (when the keychain refuses it). */
  async function setSecret(name, value) {
    if (hasSecureStorage()) {
      try {
        if (value) await uxp.storage.secureStorage.setItem(SECRET_PREFIX + name, new TextEncoder().encode(value));
        else await uxp.storage.secureStorage.removeItem(SECRET_PREFIX + name);
        // Read it back: a keychain that silently mangles it is as bad as one that refuses it.
        const back = value ? decodeSecret(await uxp.storage.secureStorage.getItem(SECRET_PREFIX + name)) : "";
        if (back === (value || "")) {
          try {
            localStorage.removeItem(SECRET_PREFIX + name);
          } catch (e) {
            /* nothing kept there */
          }
          return "keychain";
        }
      } catch (e) {
        console.warn("Secure storage refused " + name + "; keeping it in the panel's own storage", e);
      }
    }
    try {
      if (value) localStorage.setItem(SECRET_PREFIX + name, value);
      else localStorage.removeItem(SECRET_PREFIX + name);
    } catch (e) {
      /* preview only */
    }
    return "panel";
  }

  // ---------- plain preferences ----------

  function getPref(key, fallback) {
    try {
      const raw = localStorage.getItem("aistudio." + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function setPref(key, value) {
    try {
      localStorage.setItem("aistudio." + key, JSON.stringify(value));
    } catch (e) {
      /* storage full or blocked: settings just won't persist */
    }
  }

  // ---------- files ----------

  async function mediaFolder() {
    const fs = uxp.storage.localFileSystem;
    const data = await fs.getDataFolder();
    try {
      return await data.getEntry("media");
    } catch (e) {
      return await data.createFolder("media");
    }
  }

  /** "Project/EP01/characters/RAVI.png" → safe path segments (no slashes or odd characters inside a name). */
  function cleanPath(relPath) {
    return String(relPath)
      .split("/")
      .map((seg) => seg.replace(/[\\:*?"<>|]+/g, "-").replace(/^\.+/, "").trim())
      .filter(Boolean);
  }

  async function folderAt(segments, create) {
    let folder = await mediaFolder();
    for (const seg of segments) {
      try {
        folder = await folder.getEntry(seg);
      } catch (e) {
        if (!create) throw e;
        folder = await folder.createFolder(seg);
      }
    }
    return folder;
  }

  /**
   * Save bytes under the panel's media folder, in subfolders: "Monsoon Chai/EP01/characters/RAVI_1.png".
   * Returns { fileName (the relative path), path (full path on disk), src (for <img>/<video>) }.
   * In the browser preview nothing is written; a blob URL stands in for the file.
   */
  async function saveMedia(relPath, buffer) {
    const segs = cleanPath(relPath);
    const fileName = segs.join("/");
    if (!isUXP) {
      const url = URL.createObjectURL(new Blob([buffer], { type: mimeFor(fileName) }));
      return { fileName, path: "", src: url };
    }
    const folder = await folderAt(segs.slice(0, -1), true);
    const file = await folder.createFile(segs[segs.length - 1], { overwrite: true });
    await file.write(buffer, { format: uxp.storage.formats.binary });
    return { fileName, path: file.nativePath, src: "plugin-data:/media/" + segs.map(encodeURIComponent).join("/") };
  }

  async function readMedia(relPath) {
    const segs = cleanPath(relPath);
    const folder = await folderAt(segs.slice(0, -1), false);
    const file = await folder.getEntry(segs[segs.length - 1]);
    return await file.read({ format: uxp.storage.formats.binary });
  }

  async function deleteMedia(relPath) {
    if (!isUXP || !relPath) return;
    try {
      const segs = cleanPath(relPath);
      const folder = await folderAt(segs.slice(0, -1), false);
      const file = await folder.getEntry(segs[segs.length - 1]);
      await file.delete();
    } catch (e) {
      /* already gone */
    }
  }

  /** Let the user pick a file. exts: ["pdf", "docx", ...]. Returns { name, mime, buffer } or null. */
  async function pickFile(exts) {
    if (isUXP) {
      const fs = uxp.storage.localFileSystem;
      const file = await fs.getFileForOpening({ types: exts });
      if (!file) return null;
      const buffer = await file.read({ format: uxp.storage.formats.binary });
      return { name: file.name, mime: mimeFor(file.name), buffer };
    }
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = exts.map((e) => "." + e).join(",");
      input.onchange = async () => {
        const f = input.files && input.files[0];
        if (!f) return resolve(null);
        resolve({ name: f.name, mime: f.type || mimeFor(f.name), buffer: await f.arrayBuffer() });
      };
      input.click();
    });
  }

  function pickImage() {
    return pickFile(["png", "jpg", "jpeg", "webp"]);
  }

  /** Ask where to save a text file (prompt sheets) and write it. Returns false if cancelled. */
  async function saveTextAs(name, text) {
    if (isUXP) {
      const fs = uxp.storage.localFileSystem;
      const file = await fs.getFileForSaving(name, { types: ["txt"] });
      if (!file) return false;
      await file.write(text, { format: uxp.storage.formats.utf8 });
      return true;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = name;
    a.click();
    return true;
  }

  // The uploaded script is kept in the panel's data folder so episodes can be re-analysed later.
  const memoryFiles = {};

  async function keepFile(fileName, buffer) {
    if (!isUXP) {
      memoryFiles[fileName] = buffer;
      return;
    }
    await saveMedia(fileName, buffer);
  }

  async function loadKeptFile(fileName) {
    if (!isUXP) return memoryFiles[fileName] || null;
    try {
      return await readMedia(fileName);
    } catch (e) {
      return null;
    }
  }

  // ---------- Premiere Pro ----------

  async function childBin(project, parent, name) {
    const items = await parent.getItems();
    for (const item of items) {
      if (item.name === name && ppro.FolderItem && ppro.FolderItem.cast) {
        const folder = ppro.FolderItem.cast(item);
        if (folder) return folder;
      }
    }
    const parentFolder = ppro.FolderItem.cast(parent) || parent;
    const action = parentFolder.createBinAction(name, true);
    project.lockedAccess(() => {
      project.executeTransaction((compound) => compound.addAction(action), "Create AI Studio bin");
    });
    const again = await parent.getItems();
    for (const item of again) {
      if (item.name === name) return ppro.FolderItem.cast(item);
    }
    return null;
  }

  /** binPath: "AI Studio" or nested "Monsoon Chai/EP01/Characters". Falls back to the project root. */
  async function findOrCreateBin(project, binPath) {
    const root = await project.getRootItem();
    let bin = root;
    for (const name of cleanPath(binPath || "")) {
      try {
        const next = await childBin(project, bin, name);
        if (!next) break;
        bin = next;
      } catch (e) {
        console.warn("Could not create bin " + name + ", importing one level up", e);
        break;
      }
    }
    return bin;
  }

  async function revealFolder(relPath) {
    if (!isUXP || !uxp.shell || !uxp.shell.openPath) return false;
    try {
      const folder = await folderAt(cleanPath(relPath || ""), true);
      await uxp.shell.openPath(folder.nativePath);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Several files at once (images or videos). Returns [{ name, mime, buffer }]. */
  async function pickFiles(exts) {
    if (isUXP) {
      const fs = uxp.storage.localFileSystem;
      const files = await fs.getFileForOpening({ types: exts, allowMultiple: true });
      const list = Array.isArray(files) ? files : files ? [files] : [];
      const out = [];
      for (const f of list) out.push({ name: f.name, mime: mimeFor(f.name), buffer: await f.read({ format: uxp.storage.formats.binary }) });
      return out;
    }
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept = exts.map((e) => "." + e).join(",");
      input.onchange = async () => {
        const out = [];
        for (const f of Array.from(input.files || [])) out.push({ name: f.name, mime: f.type || mimeFor(f.name), buffer: await f.arrayBuffer() });
        resolve(out);
      };
      input.click();
    });
  }

  /** Import files into the open Premiere project, inside a bin. */
  async function importToPremiere(paths, binName) {
    if (!isUXP || !ppro) {
      throw new Error("Open this panel inside Premiere Pro to add clips to your project.");
    }
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error("Open or create a Premiere Pro project first.");
    const bin = await findOrCreateBin(project, binName);
    const ok = await project.importFiles(paths, true, bin, false);
    if (ok === false) throw new Error("Premiere didn't accept the file. Is the project read-only?");
    return true;
  }

  /**
   * Lay imported clips end to end on a new sequence. clips: [{ path, seconds }] in order.
   * Premiere's UXP sequence-editing API is still young, so this is best effort: returns false
   * (and the clips simply stay in their bin, in order) if anything isn't available.
   */
  async function buildSequence(name, clips) {
    if (!isUXP || !ppro) return false;
    try {
      const project = await ppro.Project.getActiveProject();
      const bin = await findOrCreateBin(project, name);
      const items = await bin.getItems();
      const byName = {};
      items.forEach((it) => (byName[it.name] = it));
      const sequence = await project.createSequence(name);
      const editor = ppro.SequenceEditor.getEditor(sequence);
      let at = 0;
      for (const clip of clips) {
        const fileName = clip.path.split(/[\\/]/).pop();
        const item = byName[fileName] || byName[fileName.replace(/\.[^.]+$/, "")];
        if (item) {
          const clipItem = ppro.ClipProjectItem && ppro.ClipProjectItem.cast ? ppro.ClipProjectItem.cast(item) : item;
          const action = editor.createOverwriteItemAction(clipItem, ppro.TickTime.createWithSeconds(at), 0, 0);
          project.lockedAccess(() => project.executeTransaction((c) => c.addAction(action), "Add AI Studio shot"));
        }
        at += clip.seconds;
      }
      return true;
    } catch (e) {
      console.warn("Couldn't build the sequence automatically", e);
      return false;
    }
  }

  async function openExternal(url) {
    if (isUXP && uxp.shell) {
      try {
        await uxp.shell.openExternal(url, "Open this page in your browser?");
        return;
      } catch (e) {
        /* fall through */
      }
    }
    window.open(url, "_blank");
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      if (navigator.clipboard && navigator.clipboard.setContent) {
        await navigator.clipboard.setContent({ "text/plain": text });
        return true;
      }
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  Studio.platform = {
    isUXP,
    hasPremiere: !!ppro,
    toBase64,
    mimeFor,
    getSecret,
    setSecret,
    getPref,
    setPref,
    saveMedia,
    readMedia,
    deleteMedia,
    pickImage,
    pickFile,
    pickFiles,
    revealFolder,
    cleanPath,
    saveTextAs,
    keepFile,
    loadKeptFile,
    importToPremiere,
    buildSequence,
    openExternal,
    copyText,
  };
})();
