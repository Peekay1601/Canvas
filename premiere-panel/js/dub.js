// Voice change for a whole character layer, delivered as ONE continuous file in sync with the timeline.
// Source: a full-length dub file (with a start offset) or an audio track in the sequence.
// Only the parts with speech are sent to ElevenLabs (silence costs credits), then the converted
// lines are laid back at their exact times in a single WAV.
(function () {
  const A = window.AIA;
  const MAX_CHUNK = 110; // seconds per voice-changer request

  // -> [{ at, samples, rate }] (WAV sources, decoded) and [{ at, bytes, name, inSec, outSec, path }] (other formats)
  async function collectSources(source, onLog) {
    const wavPieces = [];
    const otherPieces = [];
    const cache = {};
    const read = async (path) => (cache[path] = cache[path] || (await A.premiere.readFileBytes(path)));

    if (source.type === "file") {
      const bytes = await read(source.path);
      if (A.audio.parseWav(bytes)) {
        const d = A.audio.decodeWav(bytes);
        wavPieces.push({ at: source.offset || 0, samples: d.samples, rate: d.sampleRate });
      } else {
        otherPieces.push({ at: source.offset || 0, bytes, name: source.name, inSec: 0, outSec: null, path: source.path });
      }
    } else if (source.type === "track") {
      const project = await A.premiere.getProject();
      const clips = (await A.premiere.listAudioClips(project)).filter((c) => c.trackIndex === source.index);
      if (!clips.length) throw new Error("Track A" + (source.index + 1) + " has no clips.");
      for (const clip of clips) {
        const bytes = await read(clip.path);
        if (A.audio.parseWav(bytes)) {
          const d = A.audio.decodeWav(bytes, clip.inSec, clip.outSec);
          wavPieces.push({ at: clip.startSec, samples: d.samples, rate: d.sampleRate });
        } else {
          otherPieces.push({ at: clip.startSec, bytes, name: clip.path.split(/[\\/]/).pop(), inSec: clip.inSec, outSec: clip.outSec, path: clip.path });
        }
      }
      if (otherPieces.length && onLog) onLog(otherPieces.length + " clip(s) on A" + (source.index + 1) + " aren't WAV, so their whole source files are converted (more credits).");
    } else {
      throw new Error("Map a dub file or a timeline track to this character first.");
    }
    return { wavPieces, otherPieces };
  }

  async function convertLayer(c, voiceId, opts) {
    opts = opts || {};
    const log = opts.onLog || function () {};
    const { wavPieces, otherPieces } = await collectSources(c.source, log);

    // Plan the requests: speech regions only, long ones split at quiet moments.
    const jobs = [];
    wavPieces.forEach((p) => {
      A.audio.speechRegions(p.samples, p.rate).forEach((r) => {
        A.audio.splitAtQuiet(p.samples, p.rate, r, MAX_CHUNK).forEach((part) => {
          jobs.push({ kind: "wav", at: p.at + part.start, samples: A.audio.slice(p.samples, p.rate, part.start, part.end), rate: p.rate });
        });
      });
    });
    const byPath = {};
    otherPieces.forEach((p) => (byPath[p.path] = byPath[p.path] || []).push(p));
    Object.keys(byPath).forEach((path) => jobs.push({ kind: "file", pieces: byPath[path] }));
    if (!jobs.length) throw new Error("No speech found in " + c.name + "'s audio.");

    const sent = jobs.reduce((n, j) => n + (j.kind === "wav" ? j.samples.length / j.rate : 0), 0);
    log(c.name + ": converting " + jobs.length + " line group(s), " + Math.round(sent) + " s of speech, into " + A.ui.voiceName(voiceId) + "…");

    // Convert.
    const outputs = []; // { at, samples, rate }
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      if (opts.onProgress) opts.onProgress(i + 1, jobs.length);
      if (j.kind === "wav") {
        const wavBytes = A.audio.encodeWav16(j.samples, j.rate);
        const r = await A.eleven.changeVoice(voiceId, A.util.slug(c.name) + "_" + i + ".wav", wavBytes, opts.denoise, { raw: true });
        outputs.push({ at: j.at, samples: r.samples, rate: r.sampleRate });
      } else {
        const first = j.pieces[0];
        const r = await A.eleven.changeVoice(voiceId, first.name, first.bytes, opts.denoise, { raw: true });
        j.pieces.forEach((p) => {
          const end = p.outSec == null ? r.samples.length / r.sampleRate : p.outSec;
          outputs.push({ at: p.at, samples: A.audio.slice(r.samples, r.sampleRate, p.inSec, end), rate: r.sampleRate });
        });
      }
    }

    // Lay every converted line at its time in one buffer.
    const rate = outputs[0].rate;
    const fileStart = Math.max(0, Math.floor(Math.min.apply(null, outputs.map((o) => o.at))));
    const fileEnd = Math.max.apply(null, outputs.map((o) => o.at + o.samples.length / o.rate)) + 0.5;
    const mix = new Float32Array(Math.ceil((fileEnd - fileStart) * rate));
    outputs.forEach((o) => A.audio.mixInto(mix, A.audio.resample(o.samples, o.rate, rate), Math.round((o.at - fileStart) * rate)));
    A.audio.protectPeaks(mix);
    const wav = A.audio.encodeWav16(mix, rate);

    // Save, import, place on a free track, optionally mute the source track.
    const saved = await A.premiere.saveAudio(c.name + " - " + A.ui.voiceName(voiceId) + " - dub layer", wav, "wav", ["dialogue", c.name]);
    const from = parseInt(A.settings.get("track_dialogue"), 10) || 1;
    const track = await A.ui.importAndPlace(saved, fileStart, fileEnd - fileStart, from);
    if (opts.muteSource && c.source.type === "track" && track) {
      const project = await A.premiere.getProject();
      const seq = await A.premiere.getSequence(project);
      await (await seq.getAudioTrack(c.source.index)).setMute(true);
    }
    return { saved, track, start: fileStart, seconds: fileEnd - fileStart, sentSeconds: sent };
  }

  A.dub = { convertLayer };
})();
