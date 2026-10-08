"""MCP server: Claude logs the footage in a folder against its script, then builds a Premiere Pro rough cut."""

from __future__ import annotations

import functools
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Literal

from mcp.server.mcpserver import Image, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import BaseModel, Field

from . import media, script, transcribe, xmeml

INSTRUCTIONS = """\
Rough-cut assistant for a folder of footage plus its script. Work like an assistant editor, then an editor:
1. open_footage_folder → read_script (whole thing) → transcribe_footage until done.
2. Log every clip: get_transcript / search_transcripts to tie takes to script lines; view_clip to judge
   performance, emotion, eyelines, framing, focus and continuity (props, hands, costume, screen direction);
   log_clip to save scene/take/rating/notes so nothing is lost.
3. Choose: per beat, the take with the truest emotion first, then technical quality, then continuity with the
   shots around it. Cut on action and on emotional turns, let reactions breathe, trim dead air, prefer
   performance over script fidelity when a take improves on the page and say so in the note.
4. build_rough_cut with the ordered edits; every edit gets a short label and a note explaining the choice.
Times are always seconds within the source clip.
"""

mcp = MCPServer("roughcut", instructions=INSTRUCTIONS)


def tool(fn):
    """Register a tool whose expected failures (bad path, bad edit, missing ffmpeg) reach Claude as readable errors."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except (ValueError, RuntimeError, OSError) as exc:
            raise ToolError(str(exc)) from exc

    return mcp.tool()(wrapper)


# ---------- state kept next to the footage, in <folder>/.roughcut ----------


def _folder(folder: str) -> Path:
    path = Path(folder).expanduser().resolve()
    if not path.is_dir():
        raise ValueError(f"Not a folder: {path}")
    return path


def _state(folder: Path) -> Path:
    state = folder / media.STATE_DIR
    state.mkdir(exist_ok=True)
    return state


def _load(folder: Path, name: str, default):
    path = folder / media.STATE_DIR / name
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def _save(folder: Path, name: str, data) -> None:
    path = _state(folder) / name
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _index(folder: Path) -> dict:
    index = _load(folder, "index.json", None)
    if index is None:
        raise ValueError("This folder hasn't been opened yet; call open_footage_folder first.")
    return index


def _clip(folder: Path, clip_id: str) -> dict:
    clip = _index(folder)["clips"].get(clip_id)
    if clip is None:
        raise ValueError(f"No clip {clip_id!r} in this folder. Use list_footage for ids.")
    return clip


def _transcript(folder: Path, clip_id: str) -> dict | None:
    return _load(folder, f"transcripts/{clip_id}.json", None)


def _tc(seconds: float) -> str:
    m, s = divmod(max(seconds, 0.0), 60)
    h, m = divmod(int(m), 60)
    return f"{h}:{m:02d}:{s:05.2f}" if h else f"{m:02d}:{s:05.2f}"


# ---------- tools ----------


@tool
def open_footage_folder(folder: str) -> str:
    """Scan a footage folder and all its subfolders: finds every video, audio and still, probes duration, frame
    rate, resolution, audio channels and timecode, and finds the script. Safe to call again; it picks up new files
    and keeps your logs. Call this first."""
    media.require_ffmpeg()
    root = _folder(folder)
    found = media.walk_folder(root)
    old = (_load(root, "index.json", {}) or {}).get("clips", {})

    def probe_one(path: Path) -> tuple[str, dict]:
        rel = path.relative_to(root).as_posix()
        cid = media.clip_id_for(rel)
        stat = path.stat()
        cached = old.get(cid)
        if cached and cached.get("size") == stat.st_size and cached.get("mtime") == int(stat.st_mtime):
            return cid, cached
        try:
            info = media.probe(path)
        except Exception as exc:  # unreadable file: record it rather than failing the scan
            info = {"kind": "error", "error": str(exc), "duration": 0.0}
        return cid, {
            "id": cid, "name": path.name, "rel_path": rel, "path": str(path),
            "size": stat.st_size, "mtime": int(stat.st_mtime), **info,
        }

    with ThreadPoolExecutor(max_workers=8) as pool:
        clips = dict(pool.map(probe_one, found.media))

    index = {
        "folder": str(root),
        "scanned_at": datetime.now().isoformat(timespec="seconds"),
        "clips": clips,
        "scripts": [p.relative_to(root).as_posix() for p in found.scripts],
        "skipped": [p.relative_to(root).as_posix() for p in found.skipped],
    }
    _save(root, "index.json", index)

    good = [c for c in clips.values() if c["kind"] != "error"]
    kinds = {k: [c for c in good if c["kind"] == k] for k in ("video", "audio", "image")}
    fmt = media.most_common_format(kinds["video"])
    transcribed = sum(1 for c in good if (root / media.STATE_DIR / "transcripts" / f"{c['id']}.json").exists())
    folders = sorted({str(Path(c["rel_path"]).parent) for c in good})
    lines = [
        f"Footage folder: {root}",
        f"Video clips: {len(kinds['video'])} ({_tc(sum(c['duration'] for c in kinds['video']))} total)",
        f"Audio files: {len(kinds['audio'])}   Stills: {len(kinds['image'])}",
        f"Subfolders with media: {len(folders)} — " + ", ".join(folders[:30]) + (" …" if len(folders) > 30 else ""),
    ]
    if fmt:
        lines.append(f"Most common format: {fmt[0]}x{fmt[1]} @ {fmt[2]} fps (used for the sequence unless you override)")
    mixed = {(c["width"], c["height"], c["fps"]) for c in kinds["video"]}
    if len(mixed) > 1:
        lines.append(f"Mixed formats present: {len(mixed)} different size/frame-rate combinations.")
    lines.append("Scripts found: " + (", ".join(index["scripts"]) if index["scripts"] else "none — ask the user for it"))
    if index["skipped"]:
        lines.append(
            f"Skipped {len(index['skipped'])} camera-raw files ffmpeg can't read (transcode to ProRes/H.264 "
            f"proxies to include them): " + ", ".join(index["skipped"][:10])
        )
    errors = [c for c in clips.values() if c["kind"] == "error"]
    if errors:
        lines.append("Unreadable: " + "; ".join(f"{c['rel_path']} ({c['error'][:80]})" for c in errors[:10]))
    lines.append(
        f"Transcribed: {transcribed}/{len(kinds['video']) + len(kinds['audio'])}"
        + ("" if transcribe.available() else
           "  (speech-to-text not installed: pip install 'roughcut-mcp[transcribe]' to match takes to lines)")
    )
    return "\n".join(lines)


@tool
def list_footage(folder: str, subfolder: str = "", offset: int = 0, limit: int = 200) -> str:
    """Table of clips with ids, durations, formats and anything already logged. Filter by subfolder prefix."""
    root = _folder(folder)
    clips = sorted(_index(root)["clips"].values(), key=lambda c: c["rel_path"].lower())
    if subfolder:
        prefix = subfolder.strip("/").replace("\\", "/") + "/"
        clips = [c for c in clips if c["rel_path"].startswith(prefix)]
    log = _load(root, "log.json", {})
    rows = ["id | file | kind | dur | format | audio ch | timecode | transcript | log"]
    for c in clips[offset: offset + limit]:
        fmt = f"{c.get('width')}x{c.get('height')}@{c.get('fps')}" if c["kind"] == "video" else ""
        entry = log.get(c["id"], {})
        logged = ", ".join(f"{k}={v}" for k, v in entry.items() if k != "updated" and v not in (None, ""))
        has_tx = "yes" if (root / media.STATE_DIR / "transcripts" / f"{c['id']}.json").exists() else ""
        rows.append(
            f"{c['id']} | {c['rel_path']} | {c['kind']} | {_tc(c['duration'])} | {fmt} | "
            f"{c.get('audio_channels', 0)} | {c.get('timecode', '')} | {has_tx} | {logged[:300]}"
        )
    more = len(clips) - offset - limit
    if more > 0:
        rows.append(f"… {more} more; call again with offset={offset + limit}")
    return "\n".join(rows)


@tool
def read_script(folder: str, script_file: str = "", start_line: int = 1, max_lines: int = 600) -> str:
    """Read the script (txt, Fountain, Final Draft .fdx, Word .docx, PDF) with line numbers. The first page also
    lists the scene headings. Page through long scripts with start_line."""
    root = _folder(folder)
    scripts = _index(root)["scripts"]
    if script_file:
        path = (root / script_file).resolve()
    elif len(scripts) == 1:
        path = root / scripts[0]
    elif not scripts:
        raise ValueError("No script file found in the folder. Ask the user where it is and pass script_file.")
    else:
        # Prefer one at the top level, then anything named like a script.
        top = [s for s in scripts if "/" not in s]
        named = [s for s in scripts if re.search(r"script|screenplay|draft", s, re.I)]
        pick = (named and [s for s in named if s in top]) or top or named
        if len(pick) != 1:
            return "Several possible scripts — pass script_file:\n" + "\n".join(scripts)
        path = root / pick[0]
    text = script.read_script_text(path)
    lines = text.splitlines()
    chunk = lines[start_line - 1: start_line - 1 + max_lines]
    out = [f"Script: {path.name} ({len(lines)} lines)"]
    if start_line == 1:
        scenes = script.scene_outline(text)
        if scenes:
            out.append("Scenes: " + " | ".join(f"L{s['line']} {s['heading']}" for s in scenes))
    out.append("")
    out += [f"{n:5d}  {line}" for n, line in enumerate(chunk, start=start_line)]
    end = start_line - 1 + len(chunk)
    if end < len(lines):
        out.append(f"… continues; call again with start_line={end + 1}")
    return "\n".join(out)


@tool
def transcribe_footage(
    folder: str, clip_ids: list[str] | None = None, language: str = "", time_budget_seconds: int = 50
) -> str:
    """Speech-to-text for clips with sound (all of them if clip_ids is empty), cached so it only runs once per
    clip. Works in batches to stay inside tool timeouts: call again until it reports nothing left. language is an
    optional code like 'hi', 'en', 'ta'; leave empty to auto-detect (Hinglish usually works best as 'hi')."""
    if not transcribe.available():
        return (
            "Speech-to-text isn't installed. On the user's machine run: pip install 'roughcut-mcp[transcribe]' "
            "(or add faster-whisper), then restart Claude. You can still log clips by viewing them."
        )
    root = _folder(folder)
    clips = _index(root)["clips"]
    wanted = clip_ids or sorted(clips, key=lambda i: clips[i]["rel_path"].lower())
    todo = [
        i for i in wanted
        if i in clips and clips[i].get("audio_channels") and _transcript(root, i) is None
    ]
    started, done = time.monotonic(), []
    for cid in todo:
        if done and time.monotonic() - started > time_budget_seconds:
            break
        result = transcribe.transcribe(Path(clips[cid]["path"]), language or None)
        _save(root, f"transcripts/{cid}.json", result)
        done.append(cid)
    left = len(todo) - len(done)
    summary = [f"Transcribed {len(done)} clip(s) this call; {left} left" + (" — call again." if left else ".")]
    for cid in done:
        tx = _transcript(root, cid)
        first = " ".join(s["text"] for s in tx["segments"])[:140]
        summary.append(f"{cid} {clips[cid]['rel_path']} [{tx.get('language')}]: {first or '(no speech)'}")
    return "\n".join(summary)


@tool
def get_transcript(folder: str, clip_id: str, start: float = 0, end: float = 0, words: bool = False) -> str:
    """Timestamped transcript of one clip (seconds within the clip). words=True adds per-word timings for a
    range, for finding the exact frame a line starts or ends."""
    root = _folder(folder)
    clip = _clip(root, clip_id)
    tx = _transcript(root, clip_id)
    if tx is None:
        return f"{clip_id} has no transcript yet; run transcribe_footage."
    out = [f"{clip_id} {clip['rel_path']} ({_tc(clip['duration'])}, language {tx.get('language')})"]
    for seg in tx["segments"]:
        if seg["end"] <= start or (end and seg["start"] >= end):
            continue
        out.append(f"[{seg['start']:.2f}–{seg['end']:.2f}] {seg['text']}")
        if words:
            out.append("    " + " ".join(f"{w[2]}@{w[0]:.2f}" for w in seg["words"]))
    if len(out) == 1:
        out.append("(no speech detected)")
    return "\n".join(out)


@tool
def search_transcripts(folder: str, line: str, max_results: int = 20) -> str:
    """Find every take of a script line: fuzzy-matches the line against all transcripts and returns each clip and
    time where it's spoken, best matches first."""
    root = _folder(folder)
    clips = _index(root)["clips"]
    target = re.sub(r"[^\w\s]", "", line.lower()).split()
    if not target:
        raise ValueError("Give some words to search for.")
    hits = []
    for cid, clip in clips.items():
        tx = _transcript(root, cid)
        if not tx:
            continue
        words = [w for seg in tx["segments"] for w in seg["words"]]
        tokens = [re.sub(r"[^\w]", "", w[2].lower()) for w in words]
        windows = []
        for size in range(max(1, len(target) - 2), len(target) + 3):
            for i in range(0, max(1, len(tokens) - size + 1)):
                if tokens[i: i + size]:
                    score = SequenceMatcher(None, target, tokens[i: i + size]).ratio()
                    if score >= 0.45:
                        windows.append((score, i, min(i + size, len(words))))
        # A clip often holds several takes of the same line: keep each non-overlapping strong match.
        taken: list[tuple[int, int]] = []
        for score, i, j in sorted(windows, reverse=True):
            if all(j <= a or i >= b for a, b in taken):
                taken.append((i, j))
                said = " ".join(w[2] for w in words[i:j])
                hits.append((score, cid, clip["rel_path"], words[i][0], words[j - 1][1], said))
    hits.sort(reverse=True)
    if not hits:
        return "No take of that line found in the transcripts."
    return "\n".join(
        f"{score:.2f}  {cid} {rel}  {start:.2f}–{end:.2f}  “{said}”"
        for score, cid, rel, start, end, said in hits[:max_results]
    )


@tool
def view_clip(
    folder: str, clip_id: str, start: float = 0, end: float = 0, frames: int = 12, tile_width: int = 384
) -> list:
    """Look at a clip: a contact sheet of evenly spaced frames, each labelled with its time in the clip. Use it to
    judge performance and emotion (faces, eyes, body), framing, focus, slates, and continuity. Narrow start/end and
    raise frames to choose an exact cut point."""
    media.require_ffmpeg()
    root = _folder(folder)
    clip = _clip(root, clip_id)
    if clip["kind"] not in ("video", "image"):
        return [f"{clip_id} is {clip['kind']}; nothing to see. Use get_transcript or analyze_clip_audio."]
    frames = max(1, min(frames, 48))
    end = min(end or clip["duration"], clip["duration"]) if clip["kind"] == "video" else 0
    start = min(max(start, 0), end)
    if clip["kind"] == "image" or frames == 1:
        times = [start]
    else:
        step = (end - start) / frames
        times = [start + step * (i + 0.5) for i in range(frames)]
    tiles = [(media.grab_frame(Path(clip["path"]), t, tile_width), _tc(t)) for t in times]
    sheet = media.contact_sheet(tiles, tile_width, columns=4 if tile_width <= 480 else 3)
    caption = f"{clip_id} {clip['rel_path']} — {len(times)} frames from {_tc(start)} to {_tc(end)} (label = time in clip)"
    return [caption, Image(data=sheet, format="jpeg")]


@tool
def overview_footage(folder: str, subfolder: str = "", offset: int = 0, limit: int = 24) -> list:
    """One frame from the middle of each clip, labelled with its id: a quick visual survey to group clips by scene,
    setup and wardrobe before logging them one by one."""
    media.require_ffmpeg()
    root = _folder(folder)
    clips = [
        c for c in sorted(_index(root)["clips"].values(), key=lambda c: c["rel_path"].lower())
        if c["kind"] in ("video", "image")
    ]
    if subfolder:
        prefix = subfolder.strip("/").replace("\\", "/") + "/"
        clips = [c for c in clips if c["rel_path"].startswith(prefix)]
    page = clips[offset: offset + max(1, min(limit, 48))]
    if not page:
        return ["No clips in that range."]
    tiles = [(media.grab_frame(Path(c["path"]), c["duration"] / 2, 320), c["id"]) for c in page]
    caption = "\n".join(f"{c['id']} = {c['rel_path']}" for c in page)
    rest = len(clips) - offset - len(page)
    if rest > 0:
        caption += f"\n… {rest} more; call again with offset={offset + len(page)}"
    return [caption, Image(data=media.contact_sheet(tiles, 320, columns=6), format="jpeg")]


@tool
def analyze_clip_audio(
    folder: str, clip_id: str, silence_db: float = -35, min_silence_seconds: float = 0.4, detect_shots: bool = False
) -> str:
    """Where a clip has sound and where it's silent (pauses between lines, before 'action' and after 'cut'), plus
    loudness. detect_shots=True also finds hard cuts inside the file (slower)."""
    media.require_ffmpeg()
    root = _folder(folder)
    clip = _clip(root, clip_id)
    out = [f"{clip_id} {clip['rel_path']} ({_tc(clip['duration'])})"]
    if clip.get("audio_channels"):
        act = media.audio_activity(Path(clip["path"]), clip["duration"], silence_db, min_silence_seconds)
        out.append(f"Mean {act['mean_volume_db']} dB, peak {act['peak_volume_db']} dB")
        out.append("Sound: " + ", ".join(f"{a:.2f}–{b:.2f}" for a, b in act["sound"][:200]))
    else:
        out.append("No audio.")
    if detect_shots and clip["kind"] == "video":
        cuts = media.shot_changes(Path(clip["path"]), 0.35)
        out.append("Shot changes at: " + (", ".join(f"{t:.2f}" for t in cuts) or "none"))
    return "\n".join(out)


@tool
def log_clip(
    folder: str,
    clip_id: str,
    scene: str = "",
    shot: str = "",
    take: str = "",
    rating: int | None = None,
    emotion: str = "",
    continuity: str = "",
    notes: str = "",
) -> str:
    """Save what you learned about a clip so it survives long sessions: scene/shot/take, a 1–5 rating, the
    emotional read of the performance, continuity details (props, hands, costume, eyelines, screen direction) and
    any notes (best moments with times, problems like focus buzz or boom in shot). Only the fields you pass change."""
    root = _folder(folder)
    _clip(root, clip_id)
    log = _load(root, "log.json", {})
    entry = log.setdefault(clip_id, {})
    for key, value in dict(scene=scene, shot=shot, take=take, rating=rating, emotion=emotion,
                           continuity=continuity, notes=notes).items():
        if value not in ("", None):
            entry[key] = value
    entry["updated"] = datetime.now().isoformat(timespec="seconds")
    _save(root, "log.json", log)
    return f"Logged {clip_id}: " + json.dumps({k: v for k, v in entry.items() if k != "updated"}, ensure_ascii=False)


class EditIn(BaseModel):
    clip_id: str = Field(description="Clip id from list_footage")
    source_in: float | str = Field(description="Start within the source clip, seconds (or MM:SS.ss)")
    source_out: float | str = Field(description="End within the source clip, seconds (or MM:SS.ss)")
    track: Literal["V1", "V2", "V3", "A"] = Field(
        "V1",
        description="V1 = main storyline, laid end to end in order. V2/V3 = cutaways or B-roll over the cut. "
        "A = audio only (music, wild lines, room tone).",
    )
    at: float | None = Field(
        None, description="For V2/V3/A: sequence time in seconds. Default: the start of the latest V1 edit."
    )
    audio: bool | None = Field(None, description="Use the clip's sound. Default: on for V1, off for V2/V3.")
    label: str = Field("", description="Short beat name, e.g. 'Sc 4 — Riya breaks'")
    note: str = Field("", description="Why this take and this cut point (emotion, continuity, performance)")


@tool
def build_rough_cut(
    folder: str,
    edits: list[EditIn],
    project_name: str = "",
    sequence_name: str = "Rough Cut v1",
    output_folder: str = "",
    width: int | None = None,
    height: int | None = None,
    fps: float | None = None,
) -> str:
    """Write the rough cut for Premiere Pro: an FCP XML with every clip in bins that mirror the footage folders and
    the cut sequence (labels and notes become timeline markers), plus a readable cut list. Sequence format defaults
    to the most common clip format. Call again with a new sequence_name for alternate versions."""
    root = _folder(folder)
    index = _index(root)
    all_clips = [c for c in index["clips"].values() if c["kind"] != "error"]
    fmt = media.most_common_format(all_clips) or (1920, 1080, 25.0)
    width, height, fps = width or fmt[0], height or fmt[1], fps or fmt[2]
    project_name = project_name or root.name
    out_dir = Path(output_folder).expanduser().resolve() if output_folder else root / "RoughCut"
    out_dir.mkdir(parents=True, exist_ok=True)

    cut = [
        xmeml.Edit(
            clip_id=e.clip_id,
            source_in=xmeml.parse_time(e.source_in),
            source_out=xmeml.parse_time(e.source_out),
            track=e.track,
            at=e.at,
            audio=e.audio,
            label=e.label,
            note=e.note,
        )
        for e in edits
    ]
    xml_text, placed, total = xmeml.build(project_name, sequence_name, all_clips, cut, width, height, fps)

    stem = re.sub(r"[^\w\- ]+", "", f"{project_name} - {sequence_name}").strip() or "RoughCut"
    xml_path = out_dir / f"{stem}.xml"
    xml_path.write_text(xml_text, encoding="utf-8")

    seq_fps = xmeml.real_fps(*xmeml.rate_for(fps))
    rows = [
        f"# {project_name} — {sequence_name}",
        "",
        f"{len([p for p in placed if p.edit.track == 'V1'])} main edits, running time {_tc(total)}, "
        f"{width}x{height} @ {fps} fps. Built {datetime.now():%Y-%m-%d %H:%M}.",
        "",
        "| # | Track | Seq in | Seq out | Clip | Source in–out | Beat | Why |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for n, p in enumerate(sorted(placed, key=lambda p: (p.start, xmeml.LAYERS.index(p.edit.track))), start=1):
        rows.append(
            f"| {n} | {p.edit.track} | {_tc(p.start / seq_fps)} | {_tc(p.end / seq_fps)} | {p.clip['rel_path']} | "
            f"{p.src_in / seq_fps:.2f}–{p.src_out / seq_fps:.2f} | {p.edit.label} | {p.edit.note.replace('|', '/')} |"
        )
    cutlist_path = out_dir / f"{stem} - cut list.md"
    cutlist_path.write_text("\n".join(rows) + "\n", encoding="utf-8")

    unused = len(all_clips) - len({p.clip["id"] for p in placed})
    return (
        f"Rough cut written ({_tc(total)}, {len(placed)} edits; {unused} clips unused but in the bins).\n"
        f"Premiere XML: {xml_path}\nCut list: {cutlist_path}\n"
        "Tell the user: in Premiere Pro, File > New > Project, save it in the folder they want, then File > Import "
        "and pick the XML. Bins 'Footage/…' and the sequence appear in the project; the markers carry the notes."
    )


@mcp.prompt()
def rough_cut(folder: str, notes: str = "") -> str:
    """Do a full rough cut of the footage in a folder against its script."""
    return (
        f"Make a rough cut of the footage in {folder}.\n"
        + (f"Director's notes: {notes}\n" if notes else "")
        + "Open the folder, read the whole script, transcribe everything, then log every clip (look at it, don't "
        "just read the transcript). Pick takes for emotion first, then technical quality and continuity; cut on "
        "action and emotional turns, keep reactions, trim dead air. Build the cut with a note on every edit, then "
        "summarise the choices, the alternates worth trying, and any coverage gaps against the script."
    )


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
