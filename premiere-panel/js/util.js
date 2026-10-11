// Shared helpers: base64, names, time formatting, folders and JSON files on disk.
(function () {
  const uxp = require("uxp");
  const formats = uxp.storage.formats;

  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function bytesToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let out = "";
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    if (i < bytes.length) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8);
      out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + "=";
    }
    return out;
  }

  function slug(s, max) {
    return (s || "untitled").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, max || 40) || "untitled";
  }

  // 74.5 -> "01:14.5"
  function fmtTime(sec) {
    sec = Math.max(0, sec || 0);
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // Returns parent/name, creating it if needed.
  async function ensureFolder(parent, name) {
    try {
      const entry = await parent.getEntry(name);
      if (entry.isFolder) return entry;
    } catch (e) {
      // not there yet
    }
    return parent.createFolder(name);
  }

  // ensurePath(root, "Project", "stills", "Seq") -> folder entry
  async function ensurePath(root, ...names) {
    let folder = root;
    for (const n of names) folder = await ensureFolder(folder, n);
    return folder;
  }

  async function readJson(folder, name, fallback) {
    try {
      const file = await folder.getEntry(name);
      return JSON.parse(await file.read({ format: formats.utf8 }));
    } catch (e) {
      return fallback;
    }
  }

  async function writeJson(folder, name, data) {
    const file = await folder.createFile(name, { overwrite: true });
    await file.write(JSON.stringify(data, null, 2), { format: formats.utf8 });
    return file;
  }

  async function writeText(folder, name, text) {
    const file = await folder.createFile(name, { overwrite: true });
    await file.write(text, { format: formats.utf8 });
    return file;
  }

  async function writeBytes(folder, name, bytes) {
    const file = await folder.createFile(name, { overwrite: true });
    await file.write(bytes, { format: formats.binary });
    return file;
  }

  function csvCell(v) {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
  }

  window.AIA = window.AIA || {};
  window.AIA.util = {
    bytesToBase64, slug, fmtTime, stamp, uid,
    ensureFolder, ensurePath, readJson, writeJson, writeText, writeBytes, toCsv,
  };
})();
