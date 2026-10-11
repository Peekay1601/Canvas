// Premiere Pro side: sequence info, stills, project folders, import, timeline edits, playback.
(function () {
  const ppro = require("premierepro");
  const uxp = require("uxp");
  const S = () => window.AIA.settings;
  const U = () => window.AIA.util;

  async function getProject() {
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error("Open a Premiere Pro project first.");
    return project;
  }

  async function getSequence(project) {
    const seq = await (project || (await getProject())).getActiveSequence();
    if (!seq) throw new Error("Open a sequence on the timeline first.");
    return seq;
  }

  function round(n) {
    return Math.round(n * 100) / 100;
  }

  // Sequence info sent to Claude so it can time things relative to the playhead.
  async function getContext() {
    const project = await getProject();
    const seq = await project.getActiveSequence();
    if (!seq) return { project: project.name, sequence: null };
    const [playhead, end, audioTracks] = await Promise.all([
      seq.getPlayerPosition(),
      seq.getEndTime(),
      seq.getAudioTrackCount(),
    ]);
    return {
      project: project.name,
      sequence: seq.name,
      playhead_seconds: round(playhead.seconds),
      sequence_length_seconds: round(end.seconds),
      audio_tracks: audioTracks,
    };
  }

  // ----- project folders ----------------------------------------------------
  // <output folder>/<project>/<sub>/...  e.g. projectFolder("stills", "Scene 12")
  async function projectFolder(...sub) {
    const project = await getProject();
    const root = await S().getOutputFolder();
    return U().ensurePath(root, U().slug(project.name.replace(/\.prproj$/i, ""), 60), ...sub.map((s) => U().slug(s, 60)));
  }

  async function saveAudio(name, bytes, ext, sub) {
    const folder = await projectFolder(...(sub || ["generated"]));
    const fileName = U().slug(name) + "_" + U().stamp() + "." + ext;
    const file = await U().writeBytes(folder, fileName, bytes);
    return { fileName, path: file.nativePath };
  }

  // ----- bins + import -------------------------------------------------------
  async function findChild(folderItem, name) {
    const items = await folderItem.getItems();
    return items.find((it) => it.name === name) || null;
  }

  async function getBin(project, name) {
    const root = await project.getRootItem();
    const binName = name || S().get("binName");
    let bin = await findChild(root, binName);
    if (!bin) {
      project.lockedAccess(() => {
        project.executeTransaction((compound) => {
          compound.addAction(root.createBinAction(binName, true));
        }, "Create " + binName + " bin");
      });
      bin = await findChild(root, binName);
    }
    return bin ? ppro.FolderItem.cast(bin) : root;
  }

  async function importFile(project, bin, saved) {
    const ok = await project.importFiles([saved.path], true, bin, false);
    if (!ok) throw new Error("Premiere couldn't import " + saved.fileName);
    const base = saved.fileName.replace(/\.[^.]+$/, "");
    const items = await bin.getItems();
    const item = items.find((it) => it.name === saved.fileName || it.name === base);
    if (!item) throw new Error("Imported " + saved.fileName + " but couldn't find it in the bin.");
    return item;
  }

  // ----- timeline edits --------------------------------------------------------
  // Overwrite-edits a clip onto an audio track (1-based) at playhead + offset seconds.
  async function placeOnTimeline(project, projectItem, audioTrack, offsetSeconds) {
    const seq = await getSequence(project);
    const trackCount = await seq.getAudioTrackCount();
    if (audioTrack > trackCount) {
      throw new Error("Sequence has " + trackCount + " audio tracks; add a track for A" + audioTrack + ".");
    }
    const playhead = await seq.getPlayerPosition();
    await placeAt(project, projectItem, audioTrack - 1, playhead.seconds + (offsetSeconds || 0));
  }

  // First audio track at or below `fromIndex` (0-based) that is empty between startSec and endSec, or -1.
  async function findFreeAudioTrack(seq, fromIndex, startSec, endSec) {
    const count = await seq.getAudioTrackCount();
    for (let i = Math.max(0, fromIndex); i < count; i++) {
      const track = await seq.getAudioTrack(i);
      const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
      let busy = false;
      for (const it of items) {
        const [s, e] = await Promise.all([it.getStartTime(), it.getEndTime()]);
        if (s.seconds < endSec - 0.001 && e.seconds > startSec + 0.001) { busy = true; break; }
      }
      if (!busy) return i;
    }
    return -1;
  }

  // Overwrite-edits a project item onto a 0-based audio track at an absolute timeline time.
  // When inSec/outSec are given, only that part of the item is used.
  async function placeAt(project, projectItem, trackIndex, atSec, inSec, outSec) {
    const seq = await getSequence(project);
    const editor = ppro.SequenceEditor.getEditor(seq);
    const clip = inSec != null ? ppro.ClipProjectItem.cast(projectItem) : null;
    let done = false;
    project.lockedAccess(() => {
      done = project.executeTransaction((compound) => {
        if (clip) {
          compound.addAction(clip.createSetInOutPointsAction(
            ppro.TickTime.createWithSeconds(inSec),
            ppro.TickTime.createWithSeconds(outSec)
          ));
        }
        // The action must be created inside the transaction.
        compound.addAction(editor.createOverwriteItemAction(projectItem, ppro.TickTime.createWithSeconds(Math.max(0, atSec)), 0, trackIndex));
      }, "Place " + projectItem.name);
    });
    if (done === false) throw new Error("Premiere refused to place " + projectItem.name + " on the timeline.");
  }

  // ----- audio clips on the timeline ---------------------------------------------
  async function describeClip(item) {
    const clip = ppro.ClipProjectItem.cast(await item.getProjectItem());
    if (!clip) return null;
    const [path, inPt, outPt, start, end, track, name] = await Promise.all([
      clip.getMediaFilePath(),
      item.getInPoint(),
      item.getOutPoint(),
      item.getStartTime(),
      item.getEndTime(),
      item.getTrackIndex(),
      item.getName(),
    ]);
    return {
      name,
      path,
      inSec: inPt.seconds,
      outSec: outPt.seconds,
      startSec: start.seconds,
      endSec: end.seconds,
      trackIndex: track, // 0-based audio track
    };
  }

  async function getSelectedAudioClips(project) {
    const seq = await getSequence(project);
    const selection = await seq.getSelection();
    const items = (await selection.getTrackItems()).filter((it) => it instanceof ppro.AudioClipTrackItem);
    const clips = [];
    for (const item of items) {
      const c = await describeClip(item);
      if (c) clips.push(c);
    }
    return clips.sort((a, b) => a.startSec - b.startSec);
  }

  // Every audio clip in the active sequence (used to find dub files per character).
  async function listAudioClips(project) {
    const seq = await getSequence(project);
    const count = await seq.getAudioTrackCount();
    const clips = [];
    for (let i = 0; i < count; i++) {
      const track = await seq.getAudioTrack(i);
      const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
      for (const item of items) {
        const c = await describeClip(item);
        if (c) clips.push(c);
      }
    }
    return clips.sort((a, b) => a.startSec - b.startSec);
  }

  // Reads a media file from disk by its full path.
  async function readFileBytes(path) {
    const fs = uxp.storage.localFileSystem;
    const candidates = ["file:" + path, "file://" + path.replace(/\\/g, "/"), "file:///" + path.replace(/\\/g, "/").replace(/^\/+/, "")];
    for (const url of candidates) {
      try {
        const entry = await fs.getEntryWithUrl(url);
        if (entry && entry.isFile) return await entry.read({ format: uxp.storage.formats.binary });
      } catch (e) {
        // try the next spelling
      }
    }
    throw new Error("Couldn't read " + path);
  }

  // ----- stills ------------------------------------------------------------------
  async function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Exports `count` evenly spaced JPEG stills (640 px wide) from the active sequence into
  // <project>/stills/<sequence>/. Returns [{ index, seconds, name, path }].
  async function grabStills(count, onlyInOut, onProgress) {
    const project = await getProject();
    const seq = await getSequence(project);
    let start = 0;
    let end = (await seq.getEndTime()).seconds;
    if (onlyInOut) {
      const [i, o] = await Promise.all([seq.getInPoint(), seq.getOutPoint()]);
      if (o.seconds > i.seconds) { start = i.seconds; end = o.seconds; }
    }
    if (end - start < 0.5) throw new Error("The sequence is empty.");

    const size = await seq.getFrameSize();
    const width = 640;
    const height = Math.round((640 * (size.height || 9)) / (size.width || 16) / 2) * 2;
    const folder = await projectFolder("stills", seq.name);
    const step = (end - start) / count;
    const stills = [];
    for (let i = 0; i < count; i++) {
      const sec = start + step * (i + 0.5);
      const name = "still_" + String(i + 1).padStart(3, "0") + "_" + U().fmtTime(sec).replace(/[:.]/g, "-") + ".jpg";
      const ok = await ppro.Exporter.exportSequenceFrame(seq, ppro.TickTime.createWithSeconds(sec), name, folder.nativePath, width, height);
      if (!ok) throw new Error("Premiere couldn't export the still at " + U().fmtTime(sec) + ".");
      // The file can land a moment after the call returns.
      let entry = null;
      for (let t = 0; t < 30 && !entry; t++) {
        try { entry = await folder.getEntry(name); } catch (e) { await wait(100); }
      }
      if (!entry) throw new Error("The still " + name + " never appeared on disk.");
      stills.push({ index: i + 1, seconds: round(sec), name, path: entry.nativePath });
      if (onProgress) onProgress(i + 1, count);
    }
    return { sequence: seq.name, duration: round(end - start), start: round(start), folder: folder.nativePath, stills };
  }

  // ----- playback ----------------------------------------------------------------
  // Plays audio bytes in the Source Monitor without adding them to the project.
  async function playPreview(name, bytes) {
    const tmp = await uxp.storage.localFileSystem.getTemporaryFolder();
    const file = await U().writeBytes(tmp, U().slug(name) + "_" + Date.now() + ".mp3", bytes);
    await playFile(file.nativePath);
  }

  async function playFile(path) {
    const opened = await ppro.SourceMonitor.openFilePath(path);
    if (!opened) throw new Error("Premiere couldn't open " + path.split(/[\\/]/).pop());
    await ppro.SourceMonitor.play(1.0);
  }

  window.AIA.premiere = {
    getProject, getSequence, getContext, projectFolder, saveAudio, getBin, importFile,
    placeOnTimeline, placeAt, findFreeAudioTrack,
    getSelectedAudioClips, listAudioClips, readFileBytes,
    grabStills, playPreview, playFile,
  };
})();
