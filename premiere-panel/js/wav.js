// Small WAV helpers: cut a time range out of a PCM WAV file without re-encoding.
(function () {
  function readChunks(view) {
    if (view.byteLength < 12) return null;
    const tag = (off) => String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3));
    if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
    let fmt = null;
    let data = null;
    let off = 12;
    while (off + 8 <= view.byteLength) {
      const id = tag(off);
      let size = view.getUint32(off + 4, true);
      const body = off + 8;
      if (id === "data" && body + size > view.byteLength) size = view.byteLength - body; // tolerate bad sizes
      if (id === "fmt ") fmt = { offset: body, size };
      if (id === "data") data = { offset: body, size };
      off = body + size + (size % 2);
    }
    if (!fmt || !data) return null;
    return {
      fmt,
      data,
      channels: view.getUint16(fmt.offset + 2, true),
      sampleRate: view.getUint32(fmt.offset + 4, true),
      blockAlign: view.getUint16(fmt.offset + 12, true),
    };
  }

  function isWav(buffer) {
    return !!readChunks(new DataView(buffer));
  }

  // Returns a new WAV containing [startSec, endSec) of the source; the fmt chunk is copied as is.
  function sliceWav(buffer, startSec, endSec) {
    const view = new DataView(buffer);
    const info = readChunks(view);
    if (!info) throw new Error("Not a WAV file.");
    const bytesPerSec = info.sampleRate * info.blockAlign;
    const frames = Math.floor(info.data.size / info.blockAlign);
    const a = Math.max(0, Math.min(frames, Math.floor(startSec * info.sampleRate)));
    const b = Math.max(a, Math.min(frames, Math.ceil(endSec * info.sampleRate)));
    const dataLen = (b - a) * info.blockAlign;
    if (!dataLen) throw new Error("The clip's range is empty.");

    const out = new ArrayBuffer(12 + 8 + info.fmt.size + (info.fmt.size % 2) + 8 + dataLen);
    const o = new DataView(out);
    const bytes = new Uint8Array(out);
    const str = (off, s) => { for (let i = 0; i < 4; i++) o.setUint8(off + i, s.charCodeAt(i)); };
    str(0, "RIFF"); o.setUint32(4, out.byteLength - 8, true); str(8, "WAVE");
    str(12, "fmt "); o.setUint32(16, info.fmt.size, true);
    bytes.set(new Uint8Array(buffer, info.fmt.offset, info.fmt.size), 20);
    const dataHead = 20 + info.fmt.size + (info.fmt.size % 2);
    str(dataHead, "data"); o.setUint32(dataHead + 4, dataLen, true);
    bytes.set(new Uint8Array(buffer, info.data.offset + a * info.blockAlign, dataLen), dataHead + 8);
    return { buffer: out, seconds: dataLen / bytesPerSec };
  }

  window.AIA = window.AIA || {};
  window.AIA.wav = { isWav, sliceWav };
})();
