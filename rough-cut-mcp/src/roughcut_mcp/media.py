"""Finding, probing and looking at footage with ffmpeg."""

from __future__ import annotations

import functools
import hashlib
import io
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


@functools.cache
def ffmpeg_exe() -> str:
    """ffmpeg from the system if there is one, else the copy bundled with imageio-ffmpeg, so nothing needs installing."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # no wheel for this platform, or the binary is missing
        raise RuntimeError(
            "ffmpeg isn't available. Install it (https://ffmpeg.org/download.html, or `brew install ffmpeg` on a "
            "Mac) and restart Claude."
        ) from exc


def require_ffmpeg() -> None:
    ffmpeg_exe()


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


def probe(path: Path) -> dict:
    import av

    ext = path.suffix.lower()
    with av.open(str(path)) as container:
        attached = getattr(getattr(av.stream, "Disposition", None), "attached_pic", 0)
        video = next(
            (v for v in container.streams.video if not (attached and v.disposition & attached)), None
        )
        audio = list(container.streams.audio)
        kind = "image" if ext in IMAGE_EXT else "video" if video else "audio"
        duration = container.duration / av.time_base if container.duration else 0.0
        result: dict = {"kind": kind}
        if video:
            ctx = video.codec_context
            fps = video.base_rate or video.average_rate or video.guessed_rate
            width, height = ctx.width, ctx.height
            if kind == "video" and abs(_rotation(container, video)) % 180 == 90:
                width, height = height, width  # phone footage shot vertical: Premiere shows it rotated
            result.update(
                fps=round(float(fps), 3) if kind == "video" and fps else None,
                width=width,
                height=height,
                codec=ctx.name,
            )
            if not duration and video.duration and video.time_base:
                duration = float(video.duration * video.time_base)
        if audio:
            result.update(
                audio_channels=sum(a.codec_context.channels or 0 for a in audio),
                audio_streams=len(audio),
                sample_rate=audio[0].codec_context.sample_rate or 48000,
            )
        else:
            result["audio_channels"] = 0
        timecode = container.metadata.get("timecode") or next(
            (st.metadata["timecode"] for st in container.streams if st.metadata.get("timecode")), None
        )
        if timecode:
            result["timecode"] = timecode
        if container.metadata.get("creation_time"):
            result["created"] = container.metadata["creation_time"]
    result["duration"] = round(duration, 3)
    return result


def _rotation(container, video) -> int:
    rotate = video.metadata.get("rotate")
    if rotate is not None:
        try:
            return int(float(rotate))
        except ValueError:
            return 0
    try:  # the display matrix only shows up on decoded frames
        frame = next(container.decode(video=video.index))
        return int(getattr(frame, "rotation", 0) or 0)
    except Exception:
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
            ffmpeg_exe(), "-v", "error", "-ss", f"{max(t, 0):.3f}", "-i", str(path),
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
            ffmpeg_exe(), "-v", "info", "-nostats", "-i", str(path), "-vn",
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
            ffmpeg_exe(), "-v", "info", "-nostats", "-i", str(path), "-an",
            "-vf", f"scale=320:-2,select='gt(scene,{threshold})',showinfo", "-f", "null", "-",
        ],
        capture_output=True,
        text=True,
    )
    return [round(float(t), 2) for t in _SCENE.findall(out.stderr)]
