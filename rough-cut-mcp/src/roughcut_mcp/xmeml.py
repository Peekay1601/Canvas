"""Writing the rough cut as Final Cut Pro 7 XML (xmeml v4), which Premiere Pro imports natively.

Premiere's own .prproj format is closed, so this is the reliable way in: importing the XML gives a project with
every clip in bins that mirror the footage folders, plus the rough-cut sequence with Claude's notes as markers.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote
from xml.etree import ElementTree as ET

# Audio lanes per layer: each layer's audio gets its own pair of tracks so dialogue, B-roll sound and music stay apart.
LAYERS = ["V1", "V2", "V3", "A"]


@dataclass
class Edit:
    clip_id: str
    source_in: float
    source_out: float
    track: str = "V1"
    at: float | None = None
    audio: bool | None = None
    label: str = ""
    note: str = ""


@dataclass
class Placed:
    edit: Edit
    clip: dict
    start: int  # sequence frames
    end: int
    src_in: int
    src_out: int
    audio: bool
    items: dict = field(default_factory=dict)  # (mediatype, track index) -> clipitem id


class CutError(ValueError):
    pass


def rate_for(fps: float) -> tuple[int, bool]:
    """Timebase and NTSC flag the way FCP XML wants them (23.976 -> 24 + NTSC)."""
    for base in (24, 30, 48, 60, 120):
        if abs(fps - base * 1000 / 1001) < 0.01:
            return base, True
    return max(1, round(fps)), False


def real_fps(timebase: int, ntsc: bool) -> float:
    return timebase * 1000 / 1001 if ntsc else float(timebase)


def parse_time(value) -> float:
    """Seconds as a number, or 'MM:SS(.ms)' / 'HH:MM:SS(.ms)'."""
    if isinstance(value, (int, float)):
        return float(value)
    parts = str(value).strip().split(":")
    try:
        seconds = 0.0
        for part in parts:
            seconds = seconds * 60 + float(part)
        return seconds
    except ValueError as exc:
        raise CutError(f"Can't read time {value!r}; use seconds like 12.5 or 00:12.5") from exc


def path_url(path: str) -> str:
    posix = Path(path).as_posix()
    if not posix.startswith("/"):
        posix = "/" + posix  # Windows drive paths: C:/... -> /C%3A/...
    return "file://localhost" + quote(posix, safe="/")


def _sub(parent: ET.Element, tag: str, text=None, **attrs) -> ET.Element:
    el = ET.SubElement(parent, tag, attrs)
    if text is not None:
        el.text = str(text)
    return el


def _rate(parent: ET.Element, timebase: int, ntsc: bool) -> None:
    rate = _sub(parent, "rate")
    _sub(rate, "timebase", timebase)
    _sub(rate, "ntsc", "TRUE" if ntsc else "FALSE")


def _timecode_frames(tc: str, timebase: int) -> int | None:
    m = re.match(r"^(\d+)[:;](\d+)[:;](\d+)[:;.](\d+)$", tc or "")
    if not m:
        return None
    h, mnt, s, f = map(int, m.groups())
    return ((h * 60 + mnt) * 60 + s) * timebase + f


def place(edits: list[Edit], clips: dict[str, dict], seq_fps: float) -> list[Placed]:
    placed: list[Placed] = []
    cursor = 0
    last_main_start = 0
    for n, edit in enumerate(edits, start=1):
        where = f"Edit {n} ({edit.clip_id})"
        clip = clips.get(edit.clip_id)
        if clip is None:
            raise CutError(f"{where}: unknown clip id. Use list_footage for ids.")
        if edit.track not in LAYERS:
            raise CutError(f"{where}: track must be one of {', '.join(LAYERS)}")
        if clip["kind"] == "image":
            raise CutError(f"{where}: stills can't go in the sequence yet; they're in the bins.")
        if clip["kind"] == "audio" and edit.track != "A":
            raise CutError(f"{where}: audio-only file, put it on track 'A'.")
        if edit.track == "A" and not clip.get("audio_channels"):
            raise CutError(f"{where}: this clip has no audio.")
        duration = clip["duration"]
        src_in = max(0.0, edit.source_in)
        src_out = min(edit.source_out, duration)
        if src_out - src_in < 1 / seq_fps:
            raise CutError(f"{where}: source_out must be after source_in and inside the clip (0–{duration:.2f}s).")

        length = round((src_out - src_in) * seq_fps)
        f_in = round(src_in * seq_fps)
        if edit.track == "V1":
            start = cursor
            cursor += length
            last_main_start = start
            audio = edit.audio if edit.audio is not None else bool(clip.get("audio_channels"))
        else:
            start = round(edit.at * seq_fps) if edit.at is not None else last_main_start
            audio = edit.track == "A" or bool(edit.audio and clip.get("audio_channels"))
        placed.append(Placed(edit, clip, start, start + length, f_in, f_in + length, audio))

    for track in LAYERS:
        spans = sorted((p for p in placed if p.edit.track == track), key=lambda p: p.start)
        for a, b in zip(spans, spans[1:]):
            if b.start < a.end:
                raise CutError(
                    f"Track {track}: {b.edit.clip_id} at {b.start / seq_fps:.2f}s overlaps "
                    f"{a.edit.clip_id} which runs to {a.end / seq_fps:.2f}s."
                )
    return placed


class _Writer:
    def __init__(self, timebase: int, ntsc: bool):
        self.timebase, self.ntsc = timebase, ntsc
        self.seq_fps = real_fps(timebase, ntsc)
        self.file_ids: dict[str, str] = {}
        # Files written in full in the current section. Bins and the sequence each define a file in full the first
        # time they use it, so importers that only walk the sequence (or only the bins) still find the media.
        self.defined: set[str] = set()
        self.master_ids: dict[str, str] = {}
        self.next_item = 0

    def item_id(self) -> str:
        self.next_item += 1
        return f"clipitem-{self.next_item}"

    def clip_frames(self, clip: dict) -> int:
        return max(1, round(clip["duration"] * self.seq_fps))

    def file(self, parent: ET.Element, clip: dict) -> None:
        """Full <file> the first time a clip appears, a bare reference after that."""
        cid = clip["id"]
        fid = self.file_ids.setdefault(cid, f"file-{len(self.file_ids) + 1}")
        if cid in self.defined:
            _sub(parent, "file", id=fid)
            return
        self.defined.add(cid)
        f = _sub(parent, "file", id=fid)
        _sub(f, "name", Path(clip["path"]).name)
        _sub(f, "pathurl", path_url(clip["path"]))
        if clip.get("fps"):
            tb, ntsc = rate_for(clip["fps"])
            frames = max(1, round(clip["duration"] * clip["fps"]))
        else:
            tb, ntsc = self.timebase, self.ntsc
            frames = self.clip_frames(clip)
        _rate(f, tb, ntsc)
        _sub(f, "duration", frames)
        tc_frame = _timecode_frames(clip.get("timecode", ""), tb)
        if tc_frame is not None:
            tc = _sub(f, "timecode")
            _rate(tc, tb, ntsc)
            _sub(tc, "string", clip["timecode"])
            _sub(tc, "frame", tc_frame)
            _sub(tc, "displayformat", "DF" if ";" in clip["timecode"] else "NDF")
        media = _sub(f, "media")
        if clip["kind"] in ("video", "image"):
            sc = _sub(_sub(media, "video"), "samplecharacteristics")
            _rate(sc, tb, ntsc)
            _sub(sc, "width", clip.get("width") or 1920)
            _sub(sc, "height", clip.get("height") or 1080)
            _sub(sc, "anamorphic", "FALSE")
            _sub(sc, "pixelaspectratio", "square")
            _sub(sc, "fielddominance", "none")
        if clip.get("audio_channels"):
            audio = _sub(media, "audio")
            sc = _sub(audio, "samplecharacteristics")
            _sub(sc, "depth", 16)
            _sub(sc, "samplerate", clip.get("sample_rate") or 48000)
            _sub(audio, "channelcount", clip["audio_channels"])

    def masterclip(self, parent: ET.Element, clip: dict) -> None:
        mid = self.master_ids[clip["id"]] = f"masterclip-{len(self.master_ids) + 1}"
        el = _sub(parent, "clip", id=mid, explodedTracks="true")
        _sub(el, "uuid", str(uuid.uuid4()))
        _sub(el, "masterclipid", mid)
        _sub(el, "ismasterclip", "TRUE")
        _sub(el, "duration", self.clip_frames(clip))
        _rate(el, self.timebase, self.ntsc)
        _sub(el, "name", clip["name"])
        media = _sub(el, "media")
        if clip["kind"] in ("video", "image"):
            item = _sub(_sub(_sub(media, "video"), "track"), "clipitem", id=self.item_id())
            _sub(item, "masterclipid", mid)
            _sub(item, "name", clip["name"])
            _rate(item, self.timebase, self.ntsc)
            _sub(item, "alphatype", "none")
            self.file(item, clip)
        if clip.get("audio_channels"):
            audio = _sub(media, "audio")
            for ch in range(1, min(clip["audio_channels"], 2) + 1):
                item = _sub(_sub(audio, "track"), "clipitem", id=self.item_id())
                _sub(item, "masterclipid", mid)
                _sub(item, "name", clip["name"])
                _rate(item, self.timebase, self.ntsc)
                self.file(item, clip)
                st = _sub(item, "sourcetrack")
                _sub(st, "mediatype", "audio")
                _sub(st, "trackindex", ch)


def _bins(writer: _Writer, parent: ET.Element, clips: list[dict], root_name: str) -> None:
    tree: dict = {"clips": [], "dirs": {}}
    for clip in sorted(clips, key=lambda c: c["rel_path"].lower()):
        node = tree
        for part in Path(clip["rel_path"]).parent.parts:
            node = node["dirs"].setdefault(part, {"clips": [], "dirs": {}})
        node["clips"].append(clip)

    def emit(where: ET.Element, name: str, node: dict) -> None:
        bin_el = _sub(where, "bin")
        _sub(bin_el, "name", name)
        children = _sub(bin_el, "children")
        for clip in node["clips"]:
            writer.masterclip(children, clip)
        for sub_name, sub in sorted(node["dirs"].items()):
            emit(children, sub_name, sub)

    emit(parent, root_name, tree)


def build(
    project_name: str,
    sequence_name: str,
    all_clips: list[dict],
    edits: list[Edit],
    width: int,
    height: int,
    fps: float,
) -> tuple[str, list[Placed], float]:
    timebase, ntsc = rate_for(fps)
    writer = _Writer(timebase, ntsc)
    by_id = {c["id"]: c for c in all_clips}
    placed = place(edits, by_id, writer.seq_fps)

    xmeml = ET.Element("xmeml", version="4")
    project = _sub(xmeml, "project")
    _sub(project, "name", project_name)
    children = _sub(project, "children")
    _bins(writer, children, all_clips, "Footage")

    writer.defined.clear()
    seq = _sub(children, "sequence", id="sequence-1")
    _sub(seq, "uuid", str(uuid.uuid4()))
    total = max((p.end for p in placed), default=0)
    _sub(seq, "duration", total)
    _rate(seq, timebase, ntsc)
    _sub(seq, "name", sequence_name)
    tc = _sub(seq, "timecode")
    _rate(tc, timebase, ntsc)
    _sub(tc, "string", "00:00:00:00")
    _sub(tc, "frame", 0)
    _sub(tc, "displayformat", "NDF")
    media = _sub(seq, "media")

    # Video tracks V1..V3 (always at least V1), then audio lanes only for layers that carry sound.
    video = _sub(media, "video")
    fmt = _sub(_sub(video, "format"), "samplecharacteristics")
    _rate(fmt, timebase, ntsc)
    _sub(fmt, "width", width)
    _sub(fmt, "height", height)
    _sub(fmt, "anamorphic", "FALSE")
    _sub(fmt, "pixelaspectratio", "square")
    _sub(fmt, "fielddominance", "none")

    video_layers = [t for t in ("V1", "V2", "V3") if t == "V1" or any(p.edit.track == t for p in placed)]
    audio_layers = [t for t in LAYERS if t == "V1" or any(p.edit.track == t and p.audio for p in placed)]

    # Assign clipitem ids first so every item can carry the full link group.
    lanes: dict[tuple[str, int], list[tuple[Placed, int]]] = {}
    for p in sorted(placed, key=lambda p: p.start):
        if p.edit.track != "A":
            vi = video_layers.index(p.edit.track) + 1
            p.items[("video", vi)] = writer.item_id()
            lanes.setdefault(("video", vi), []).append((p, 0))
        if p.audio:
            base = audio_layers.index(p.edit.track) * 2
            for ch in range(1, min(p.clip.get("audio_channels") or 0, 2) + 1):
                p.items[("audio", base + ch)] = writer.item_id()
                lanes.setdefault(("audio", base + ch), []).append((p, ch))
    position = {}
    for (kind, idx), entries in lanes.items():
        for n, (p, _) in enumerate(entries, start=1):
            position[p.items[(kind, idx)]] = n

    def clipitem(track_el: ET.Element, p: Placed, kind: str, idx: int, channel: int) -> None:
        item_id = p.items[(kind, idx)]
        item = _sub(track_el, "clipitem", id=item_id)
        _sub(item, "masterclipid", writer.master_ids[p.clip["id"]])
        _sub(item, "name", p.clip["name"])
        _sub(item, "enabled", "TRUE")
        _sub(item, "duration", writer.clip_frames(p.clip))
        _rate(item, timebase, ntsc)
        _sub(item, "start", p.start)
        _sub(item, "end", p.end)
        _sub(item, "in", p.src_in)
        _sub(item, "out", p.src_out)
        writer.file(item, p.clip)
        if kind == "audio":
            st = _sub(item, "sourcetrack")
            _sub(st, "mediatype", "audio")
            _sub(st, "trackindex", channel)
        if len(p.items) > 1:
            for (lkind, lidx), linked in p.items.items():
                link = _sub(item, "link")
                _sub(link, "linkclipref", linked)
                _sub(link, "mediatype", lkind)
                _sub(link, "trackindex", lidx)
                _sub(link, "clipindex", position[linked])

    for vi in range(1, len(video_layers) + 1):
        track = _sub(video, "track")
        for p, _ in lanes.get(("video", vi), []):
            clipitem(track, p, "video", vi, 0)
        _sub(track, "enabled", "TRUE")
        _sub(track, "locked", "FALSE")

    audio = _sub(media, "audio")
    _sub(audio, "numOutputChannels", 2)
    afmt = _sub(_sub(audio, "format"), "samplecharacteristics")
    _sub(afmt, "depth", 16)
    _sub(afmt, "samplerate", 48000)
    for ai in range(1, len(audio_layers) * 2 + 1):
        track = _sub(audio, "track")
        for p, ch in lanes.get(("audio", ai), []):
            clipitem(track, p, "audio", ai, ch)
        _sub(track, "enabled", "TRUE")
        _sub(track, "locked", "FALSE")
        _sub(track, "outputchannelindex", 1 if ai % 2 else 2)

    # A sequence marker at every edit Claude annotated, so the reasoning reads along the timeline ruler.
    for p in sorted(placed, key=lambda p: p.start):
        if p.edit.label or p.edit.note:
            marker = _sub(seq, "marker")
            _sub(marker, "comment", p.edit.note)
            _sub(marker, "name", f"{p.edit.track}: {p.edit.label or p.clip['name']}")
            _sub(marker, "in", p.start)
            _sub(marker, "out", -1)

    ET.indent(xmeml, space="  ")
    text = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n' + ET.tostring(xmeml, encoding="unicode")
    return text, placed, total / writer.seq_fps
