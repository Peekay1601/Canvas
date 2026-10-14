"""Pick an ffmpeg that has the drawtext filter (Homebrew's plain `ffmpeg` lacks it; `ffmpeg-full` has it)."""
import os
import shutil
import subprocess
import sys

CANDIDATES = (
    os.environ.get("FFMPEG", ""),
    "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg",
    "/usr/local/opt/ffmpeg-full/bin/ffmpeg",
    shutil.which("ffmpeg") or "",
)


def has_drawtext(path):
    try:
        out = subprocess.run([path, "-hide_banner", "-filters"], capture_output=True, text=True)
    except OSError:
        return False
    return " drawtext " in out.stdout


def find():
    """Return (ffmpeg, ffprobe) paths from the same install."""
    for path in CANDIDATES:
        if path and os.path.exists(path) and has_drawtext(path):
            probe = os.path.join(os.path.dirname(path), "ffprobe")
            return path, probe if os.path.exists(probe) else "ffprobe"
    sys.exit("No ffmpeg with the drawtext filter found. On a Mac run:  brew install ffmpeg-full\n"
             "(or point FFMPEG=/path/to/ffmpeg at one that has it)")
