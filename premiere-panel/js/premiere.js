// Premiere Pro side: read sequence info, save audio, import into a bin, place on the timeline.
(function () {
  const ppro = require("premierepro");
  const uxp = require("uxp");
  const S = () => window.AIA.settings;

  async function getProject() {
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error("Open a Premiere Pro project first.");
    return project;
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

  function round(n) {
    return Math.round(n * 100) / 100;
  }

  function slug(s) {
    return (s || "audio").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "audio";
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  async function saveAudio(name, bytes, ext) {
    const folder = await S().getOutputFolder();
    const fileName = slug(name) + "_" + stamp() + "." + ext;
    const file = await folder.createFile(fileName, { overwrite: true });
    await file.write(bytes, { format: uxp.storage.formats.binary });
    return { fileName, path: file.nativePath };
  }

  async function findChild(folderItem, name) {
    const items = await folderItem.getItems();
    return items.find((it) => it.name === name) || null;
  }

  // Finds (or creates) the bin that generated audio is imported into.
  async function getBin(project) {
    const root = await project.getRootItem();
    const binName = S().get("binName");
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

  // Overwrite-edits a clip onto an audio track (1-based) at playhead + offset seconds.
  async function placeOnTimeline(project, projectItem, audioTrack, offsetSeconds) {
    const seq = await project.getActiveSequence();
    if (!seq) throw new Error("Open a sequence to place clips on the timeline.");
    const trackCount = await seq.getAudioTrackCount();
    if (audioTrack > trackCount) {
      throw new Error("Sequence has " + trackCount + " audio tracks; add a track for A" + audioTrack + ".");
    }
    const playhead = await seq.getPlayerPosition();
    const at = ppro.TickTime.createWithSeconds(Math.max(0, playhead.seconds + (offsetSeconds || 0)));
    const editor = ppro.SequenceEditor.getEditor(seq);
    let done = false;
    project.lockedAccess(() => {
      done = project.executeTransaction((compound) => {
        // The action must be created inside the transaction.
        compound.addAction(editor.createOverwriteItemAction(projectItem, at, 0, audioTrack - 1));
      }, "Place " + projectItem.name);
    });
    if (done === false) throw new Error("Premiere refused to place " + projectItem.name + " on the timeline.");
  }

  window.AIA.premiere = { getProject, getContext, saveAudio, getBin, importFile, placeOnTimeline };
})();
