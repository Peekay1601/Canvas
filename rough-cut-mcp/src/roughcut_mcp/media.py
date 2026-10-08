"""Finding, probing and looking at footage with ffmpeg."""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import subprocess
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

VIDEO_EXT = {".mov", ".mp4", ".m4v", ".mxf", ".avi", ".mkv", ".mts", ".m2ts", ".mpg", ".mpeg", ".webm"}
AUDIO_EXT = {".wav", ".mp3", ".aif", ".aiff", ".m4a", ".flac", ".aac", ".ogg"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp"}
# Camera-raw formats ffmpeg can't decode; listed so Claude can tell you they were skipped.
RAW_EXT = {".r3d", ".braw", ".ari", ".crm", ".dng"}
SCRIPT_EXT = {".txt", ".md", ".fountain", ".fdx", ".docx", ".pdf", ".rtf"}

# Folders that are ours, Premiere's, or system clutter.
SKIP_DIRS = {
    ".roughcut",
    "RoughCut",
    "Adobe Premiere Pro Auto-Save",
    "Adobe Premiere Pro Video Previews",
    "Adobe Premiere Pro Audio Previews",
    "__MACOSX",
}

STATE_DIR = ".roughcut"


def require_ffmpeg() -> None:
    missing = [tool for tool in ("ffmpeg", "ffprobe") if shutil.which(tool) is None]
    if missing:
        raise RuntimeError(
            f"{' and '.join(missing)} not found on PATH. Install ffmpeg (https://ffmpeg.org/download.html) "
            "and restart Claude."
        )


def clip_id_for(rel_path: str) -> str:
    """Stable short id from the path inside the footage folder, so ids survive rescans."""
    return "c" + hashlib.sha1(rel_path.replace("\\", "/").lower().encode()).hexdigest()[:7]


@dataclass
class Found:
    media: list[Path]
    scripts: list[Path]
    skipped: list[Path]


def walk_folder(folder: Path) -> Found:
    media, scripts, skipped = [], [], []
    for root, dirs, files in os.walk(folder):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith("."))
        for name in sorted(files):
            if name.startswith("._") or name.startswith("."):
                continue
            path = Path(root) / name
            ext = path.suffix.lower()
            if ext in VIDEO_EXT | AUDIO_EXT | IMAGE_EXT:
                media.append(path)
            elif ext in SCRIPT_EXT:
                scripts.append(path)
            elif ext in RAW_EXT:
                skipped.append(path)
    return Found(media, scripts, skipped)


def _ratio(value: str | None) -> float:
    if not value or value in ("0/0", "0"):
        return 0.0
    if "/" in value:
        num, den = value.split("/", 1)
        return float(num) / float(den) if float(den) else 0.0
    return float(value)


def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True,
        text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip() or "ffprobe failed")
    info = json.loads(out.stdout)
    streams = info.get("streams", [])
    fmt = info.get("format", {})
    video = next(
        (s for s in streams if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")),
        None,
    )
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    ext = path.suffix.lower()

    kind = "image" if ext in IMAGE_EXT else "video" if video else "audio"
    result: dict = {"kind": kind, "duration": float(fmt.get("duration") or 0.0)}
    if video:
        fps = _ratio(video.get("r_frame_rate")) or _ratio(video.get("avg_frame_rate"))
        width, height = int(video.get("width") or 0), int(video.get("height") or 0)
        rotation = _rotation(video)
        if rotation in (90, 270):
            width, height = height, width
        result.update(
            fps=round(fps, 3) if kind == "video" else None,
            width=width,
            height=height,
            codec=video.get("codec_name"),
        )
        if not result["duration"] and video.get("duration"):
            result["duration"] = float(video["duration"])
    if audio:
        result.update(
            audio_channels=sum(int(s.get("channels") or 0) for s in audio),
            audio_streams=len(audio),
            sample_rate=int(audio[0].get("sample_rate") or 48000),
        )
    else:
        result["audio_channels"] = 0
    timecode = (fmt.get("tags") or {}).get("timecode") or next(
        ((s.get("tags") or {}).get("timecode") for s in streams if (s.get("tags") or {}).get("timecode")), None
    )
    if timecode:
        result["timecode"] = timecode
    created = (fmt.get("tags") or {}).get("creation_time")
    if created:
        result["created"] = created
    result["duration"] = round(result["duration"], 3)
    return result


def _rotation(stream: dict) -> int:
    rotate = (stream.get("tags") or {}).get("rotate")
    if rotate is None:
        for side in stream.get("side_data_list") or []:
            if "rotation" in side:
                rotate = side["rotation"]
    try:
        return abs(int(float(rotate))) % 360 if rotate is not None else 0
    except ValueError:
        return 0


def most_common_format(clips: list[dict]) -> tuple[int, int, float] | None:
    formats = Counter(
        (c["width"], c["height"], c["fps"]) for c in clips if c.get("kind") == "video" and c.get("fps")
    )
    return formats.most_common(1)[0][0] if formats else None


# ---------- looking at footage ----------


def grab_frame(path: Path, t: float, width: int) -> Image.Image | None:
    out = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-ss", f"{max(t, 0):.3f}", "-i", str(path),
            "-frames:v", "1", "-vf", f"scale={width}:-2", "-f", "image2pipe", "-vcodec", "png", "-",
        ],
        capture_output=True,
    )
    if out.returncode != 0 or not out.stdout:
        return None
    return Image.open(io.BytesIO(out.stdout)).convert("RGB")


def _font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def contact_sheet(
    tiles: list[tuple[Image.Image | None, str]], tile_width: int, columns: int
) -> bytes:
    """Grid of frames, each labelled (timecode or clip id), returned as JPEG bytes."""
    sample = next((img for img, _ in tiles if img is not None), None)
    tile_height = sample.height if sample else int(tile_width * 9 / 16)
    label_h = max(18, tile_width // 16)
    columns = max(1, min(columns, len(tiles)))
    rows = (len(tiles) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * tile_width, rows * (tile_height + label_h)), (20, 20, 20))
    draw = ImageDraw.Draw(sheet)
    font = _font(label_h - 4)
    for i, (img, label) in enumerate(tiles):
        x = (i % columns) * tile_width
        y = (i // columns) * (tile_height + label_h)
        if img is not None:
            if img.size != (tile_width, tile_height):
                img = img.resize((tile_width, tile_height))
            sheet.paste(img, (x, y + label_h))
        else:
            draw.text((x + 6, y + label_h + 6), "(no frame)", fill=(160, 160, 160), font=font)
        draw.text((x + 4, y + 2), label, fill=(255, 220, 90), font=font)
    buf = io.BytesIO()
    sheet.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


# ---------- listening to footage ----------

_SILENCE = re.compile(r"silence_(start|end): (-?[\d.]+)")
_SCENE = re.compile(r"pts_time:([\d.]+)")
_VOLUME = re.compile(r"(mean|max)_volume: (-?[\d.]+) dB")


def audio_activity(path: Path, duration: float, noise_db: float, min_silence: float) -> dict:
    """Where there is sound vs. silence: takes, pauses between lines, 'action'/'cut' gaps."""
    out = subprocess.run(
        [
            "ffmpeg", "-v", "info", "-nostats", "-i", str(path), "-vn",
            "-af", f"silencedetect=n={noise_db}dB:d={min_silence},volumedetect", "-f", "null", "-",
        ],
        capture_output=True,
        text=True,
    )
    silences: list[list[float]] = []
    for kind, value in _SILENCE.findall(out.stderr):
        if kind == "start":
            silences.append([max(float(value), 0.0), duration])
        elif silences:
            silences[-1][1] = float(value)
    sound, cursor = [], 0.0
    for start, end in silences:
        if start - cursor > 0.05:
            sound.append([round(cursor, 2), round(start, 2)])
        cursor = end
    if duration - cursor > 0.05:
        sound.append([round(cursor, 2), round(duration, 2)])
    volume = {k: float(v) for k, v in _VOLUME.findall(out.stderr)}
    return {
        "sound": sound,
        "silence": [[round(a, 2), round(b, 2)] for a, b in silences],
        "mean_volume_db": volume.get("mean"),
        "peak_volume_db": volume.get("max"),
    }


def shot_changes(path: Path, threshold: float) -> list[float]:
    """Hard cuts inside a file (useful when one file holds several shots)."""
    out = subprocess.run(
        [
            "ffmpeg", "-v", "info", "-nostats", "-i", str(path), "-an",
            "-vf", f"scale=320:-2,select='gt(scene,{threshold})',showinfo", "-f", "null", "-",
        ],
        capture_output=True,
        text=True,
    )
    return [round(float(t), 2) for t in _SCENE.findall(out.stderr)]
