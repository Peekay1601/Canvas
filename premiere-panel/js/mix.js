// Mixdown: reads the generated audio that is on the timeline now (so your edits count),
// sorts it into dialogue, music and sound, and renders one WAV per stem and/or one full mix.
(function () {
  const A = window.AIA;

  const SOUND_FOLDERS = { ambience: "ambience", foley: "foley", human: "human", hard_fx: "hard_fx", designed_fx: "designed_fx" };
  const LABELS = { dialogue: "Dialogue", music: "Music", sound: "Sound FX", ambience: "Ambience", foley: "Foley", human: "Human", hard_fx: "Hard FX", designed_fx: "Designed FX" };

  // Which stem a clip belongs to, from where the panel saved it. null = not panel audio.
  function classify(path, projectRoot) {
    const p = path.replace(/\\/g, "/").toLowerCase();
    if (projectRoot && p.indexOf(projectRoot) !== 0) return null;
    if (/\/(dialogue|voice_change)\//.test(p)) return { stem: "dialogue" };
    if (/\/music\//.test(p)) return { stem: "music" };
    const m = /\/sound\/([^/]+)\//.exec(p);
    if (m) return { stem: "sound", category: SOUND_FOLDERS[m[1]] || "hard_fx" };
    return null;
  }

  async function mixdown(opts) {
    const log = opts.onLog || function () {};
    const project = await A.premiere.getProject();
    const seq = await A.premiere.getSequence(project);
    const end = (await seq.getEndTime()).seconds;
    const root = (await A.premiere.projectFolder()).nativePath.replace(/\\/g, "/").toLowerCase();
    const clips = await A.premiere.listAudioClips(project);

    // Group the clips into the stems that were asked for.
    const stems = {};
    const used = [];
    const skipped = [];
    clips.forEach((clip) => {
      const c = classify(clip.path, root);
      if (!c) return;
      if (c.stem === "dialogue" && !opts.dialogue) return;
      if (c.stem === "music" && !opts.music) return;
      if (c.stem === "sound" && !opts.sound) return;
      const key = c.stem === "sound" && opts.splitSound ? c.category : c.stem;
      (stems[key] = stems[key] || []).push(clip);
      used.push(clip);
    });
    const order = ["dialogue", "music", "sound", "ambience", "foley", "human", "hard_fx", "designed_fx"].filter((k) => stems[k]);
    if (!order.length) throw new Error("No panel-made audio found on the timeline for what you ticked. Generate and place something first.");

    // Premiere doesn't let panels add tracks, so check there's room before rendering.
    const wantStemsPre = opts.output !== "mixed";
    const needed = (wantStemsPre ? order.length : 0) + (opts.output !== "stems" ? 1 : 0);
    if (opts.place) {
      const count = await seq.getAudioTrackCount();
      let free = 0;
      for (let i = 0; i < count; i++) {
        const items = clips.filter((c) => c.trackIndex === i);
        if (!items.length) free++;
      }
      if (free < needed) {
        throw new Error("These files need " + needed + " empty audio tracks and the sequence has " + free + ". Add " + (needed - free) +
          " audio track(s) (Sequence ▸ Add Tracks…), or untick “Put on the timeline” to get the files in the bin.");
      }
    }

    // Read every file once; mix at the highest sample rate so nothing loses quality.
    const files = {};
    const rates = {};
    for (const clip of used) {
      if (files[clip.path] !== undefined) continue;
      const bytes = await A.premiere.readFileBytes(clip.path);
      const info = A.audio.parseWav(bytes);
      files[clip.path] = info ? bytes : null;
      if (info) rates[info.sampleRate] = (rates[info.sampleRate] || 0) + 1;
      else skipped.push(clip.path.split(/[\\/]/).pop());
    }
    const rate = Math.max.apply(null, Object.keys(rates).map(Number).concat([0])) || 48000;
    const length = Math.ceil(end * rate);
    const wantStems = opts.output !== "mixed";
    const wantMix = opts.output !== "stems";
    const full = wantMix ? new Float32Array(length) : null;
    const results = [];
    const safe = A.util.slug(seq.name, 50);

    for (const key of order) {
      log("Rendering " + LABELS[key] + " (" + stems[key].length + " clips)…");
      const buf = new Float32Array(length);
      for (const clip of stems[key]) {
        const bytes = files[clip.path];
        if (!bytes) continue;
        const d = A.audio.decodeWav(bytes, clip.inSec, clip.outSec);
        // Never run past the clip's length on the timeline.
        const maxLen = Math.round((clip.endSec - clip.startSec) * d.sampleRate);
        const samples = d.samples.length > maxLen ? d.samples.subarray(0, maxLen) : d.samples;
        A.audio.mixInto(buf, A.audio.resample(samples, d.sampleRate, rate), Math.round(clip.startSec * rate));
      }
      if (wantMix) A.audio.mixInto(full, buf, 0);
      if (wantStems) {
        A.audio.protectPeaks(buf);
        const saved = await A.premiere.saveAudio(safe + " - " + LABELS[key] + " stem", A.audio.encodeWav16(buf, rate), "wav", ["mix", seq.name]);
        results.push({ label: LABELS[key] + " stem", saved });
      }
    }
    if (wantMix) {
      const db = A.audio.protectPeaks(full);
      if (db < 0) log("Full mix lowered " + db.toFixed(1) + " dB to avoid clipping.");
      const saved = await A.premiere.saveAudio(safe + " - Full mix", A.audio.encodeWav16(full, rate), "wav", ["mix", seq.name]);
      results.push({ label: "Full mix", saved });
    }

    // Put the rendered files on the timeline from 00:00 on free tracks.
    if (opts.place) {
      for (const r of results) {
        r.track = await A.ui.importAndPlace(r.saved, 0, end, 1);
        if (!r.track) log(r.label + " is in the bin; add an empty audio track to place it.", "error");
      }
    }

    // Mute tracks whose clips all went into the render.
    if (opts.muteSources) {
      const count = await seq.getAudioTrackCount();
      for (let i = 0; i < count; i++) {
        const onTrack = clips.filter((c) => c.trackIndex === i);
        if (onTrack.length && onTrack.every((c) => used.indexOf(c) !== -1)) await (await seq.getAudioTrack(i)).setMute(true);
      }
    }
    return { results, skipped, rate, seconds: end };
  }

  A.mix = { mixdown, classify, LABELS };
})();
