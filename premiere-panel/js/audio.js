// Minimal audio engine for the panel: read WAV, find speech, resample, mix, write WAV.
// All processing is mono Float32 (ElevenLabs returns mono), output is 16-bit PCM WAV.
(function () {
  function tag(view, off) {
    return String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3));
  }

  // { sampleRate, channels, bits, float, dataOffset, dataBytes, blockAlign } or null.
  function parseWav(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 12 || tag(view, 0) !== "RIFF" || tag(view, 8) !== "WAVE") return null;
    let fmt = null;
    let data = null;
    let off = 12;
    while (off + 8 <= view.byteLength) {
      const id = tag(view, off);
      let size = view.getUint32(off + 4, true);
      const body = off + 8;
      if (body + size > view.byteLength) size = view.byteLength - body;
      if (id === "fmt ") fmt = body;
      if (id === "data") data = { offset: body, size };
      off = body + size + (size % 2);
    }
    if (fmt == null || !data) return null;
    let format = view.getUint16(fmt, true);
    if (format === 0xfffe) format = view.getUint16(fmt + 24, true); // WAVE_FORMAT_EXTENSIBLE sub-format
    const channels = view.getUint16(fmt + 2, true);
    const bits = view.getUint16(fmt + 14, true);
    return {
      sampleRate: view.getUint32(fmt + 4, true),
      channels,
      bits,
      float: format === 3,
      blockAlign: view.getUint16(fmt + 12, true) || (channels * bits) / 8,
      dataOffset: data.offset,
      dataBytes: data.size,
    };
  }

  // Decodes [startSec, endSec) of a WAV into mono Float32. endSec null = to the end.
  function decodeWav(buffer, startSec, endSec) {
    const info = parseWav(buffer);
    if (!info) throw new Error("Not a WAV file.");
    const view = new DataView(buffer);
    const frames = Math.floor(info.dataBytes / info.blockAlign);
    const a = Math.max(0, Math.min(frames, Math.floor((startSec || 0) * info.sampleRate)));
    const b = endSec == null ? frames : Math.max(a, Math.min(frames, Math.ceil(endSec * info.sampleRate)));
    const out = new Float32Array(b - a);
    const bytes = info.bits / 8;
    for (let f = a; f < b; f++) {
      let sum = 0;
      const base = info.dataOffset + f * info.blockAlign;
      for (let ch = 0; ch < info.channels; ch++) {
        const p = base + ch * bytes;
        let v;
        if (info.float) v = info.bits === 64 ? view.getFloat64(p, true) : view.getFloat32(p, true);
        else if (info.bits === 16) v = view.getInt16(p, true) / 32768;
        else if (info.bits === 24) v = ((view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getInt8(p + 2) << 16))) / 8388608;
        else if (info.bits === 32) v = view.getInt32(p, true) / 2147483648;
        else v = (view.getUint8(p) - 128) / 128; // 8-bit
        sum += v;
      }
      out[f - a] = sum / info.channels;
    }
    return { samples: out, sampleRate: info.sampleRate };
  }

  // Raw 16-bit little-endian mono PCM (ElevenLabs pcm_* output) -> Float32.
  function pcm16ToFloat(buffer) {
    const view = new DataView(buffer);
    const n = Math.floor(buffer.byteLength / 2);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
    return out;
  }

  function resample(samples, fromRate, toRate) {
    if (fromRate === toRate) return samples;
    const ratio = fromRate / toRate;
    const n = Math.floor(samples.length / ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pos = i * ratio;
      const j = Math.floor(pos);
      const t = pos - j;
      const s0 = samples[j] || 0;
      const s1 = j + 1 < samples.length ? samples[j + 1] : s0;
      out[i] = s0 + (s1 - s0) * t;
    }
    return out;
  }

  // Adds `src` into `dest` starting at sample `at` (clips to the destination length).
  function mixInto(dest, src, at, gain) {
    const g = gain == null ? 1 : gain;
    const start = Math.max(0, at);
    const skip = start - at;
    const n = Math.min(src.length - skip, dest.length - start);
    for (let i = 0; i < n; i++) dest[start + i] += src[skip + i] * g;
  }

  // Scales down if the peak is over -0.3 dBFS, so stems and mixes never clip.
  function protectPeaks(samples) {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; }
    const limit = 0.966;
    if (peak > limit) {
      const g = limit / peak;
      for (let i = 0; i < samples.length; i++) samples[i] *= g;
      return 20 * Math.log10(g);
    }
    return 0;
  }

  function encodeWav16(samples, sampleRate) {
    const dataLen = samples.length * 2;
    const out = new ArrayBuffer(44 + dataLen);
    const v = new DataView(out);
    const str = (off, s) => { for (let i = 0; i < 4; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, dataLen, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
    }
    return out;
  }

  // Speech regions in seconds: [{ start, end }]. Quiet gaps shorter than `mergeGap` are bridged,
  // regions get `pad` seconds of air either side so word onsets and tails survive.
  function speechRegions(samples, rate, opts) {
    opts = opts || {};
    const win = Math.round(rate * 0.02); // 20 ms windows
    const mergeGap = opts.mergeGap || 1.2;
    const pad = opts.pad || 0.25;
    const n = Math.floor(samples.length / win);
    const rms = new Float32Array(n);
    let max = 0;
    for (let w = 0; w < n; w++) {
      let s = 0;
      for (let i = w * win; i < (w + 1) * win; i++) s += samples[i] * samples[i];
      rms[w] = Math.sqrt(s / win);
      if (rms[w] > max) max = rms[w];
    }
    // Threshold: -45 dBFS or 3% of the loudest window, whichever is higher.
    const thr = Math.max(0.0056, max * 0.03);
    const regions = [];
    let cur = null;
    for (let w = 0; w < n; w++) {
      const t = (w * win) / rate;
      if (rms[w] >= thr) {
        if (cur && t - cur.end <= mergeGap) cur.end = t + 0.02;
        else { cur = { start: t, end: t + 0.02 }; regions.push(cur); }
      }
    }
    const total = samples.length / rate;
    return regions
      .filter((r) => r.end - r.start >= 0.12)
      .map((r) => ({ start: Math.max(0, r.start - pad), end: Math.min(total, r.end + pad) }));
  }

  // Splits a long region at its quietest moments so each piece is at most `maxLen` seconds.
  function splitAtQuiet(samples, rate, region, maxLen) {
    const out = [];
    let start = region.start;
    while (region.end - start > maxLen) {
      const from = start + maxLen * 0.6;
      const to = start + maxLen;
      const win = Math.round(rate * 0.05);
      let best = to;
      let bestE = Infinity;
      for (let t = from; t < to; t += 0.05) {
        const i0 = Math.floor(t * rate);
        let e = 0;
        for (let i = i0; i < i0 + win && i < samples.length; i++) e += samples[i] * samples[i];
        if (e < bestE) { bestE = e; best = t; }
      }
      out.push({ start, end: best });
      start = best;
    }
    out.push({ start, end: region.end });
    return out;
  }

  function slice(samples, rate, startSec, endSec) {
    return samples.subarray(Math.max(0, Math.floor(startSec * rate)), Math.min(samples.length, Math.ceil(endSec * rate)));
  }

  window.AIA = window.AIA || {};
  window.AIA.audio = { parseWav, decodeWav, pcm16ToFloat, resample, mixInto, protectPeaks, encodeWav16, speechRegions, splitAtQuiet, slice };
})();
