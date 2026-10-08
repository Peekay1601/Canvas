"""Speech-to-text with faster-whisper (optional install), cached per clip."""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

_model = None


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        return False
    return True


def _load():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        _model = WhisperModel(
            os.environ.get("ROUGHCUT_WHISPER_MODEL", "small"),
            device=os.environ.get("ROUGHCUT_WHISPER_DEVICE", "auto"),
            compute_type=os.environ.get("ROUGHCUT_WHISPER_COMPUTE", "default"),
        )
    return _model


def transcribe(path: Path, language: str | None = None) -> dict:
    """Segments and word timings for one clip. Audio is pulled to a 16 kHz mono wav first."""
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "audio.wav"
        out = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", str(wav)],
            capture_output=True,
            text=True,
        )
        if out.returncode != 0 or not wav.exists():
            return {"language": None, "segments": [], "error": out.stderr.strip() or "no audio"}
        segments, info = _load().transcribe(
            str(wav),
            language=language or os.environ.get("ROUGHCUT_LANGUAGE") or None,
            word_timestamps=True,
            vad_filter=True,
        )
        result = []
        for seg in segments:
            result.append(
                {
                    "start": round(seg.start, 2),
                    "end": round(seg.end, 2),
                    "text": seg.text.strip(),
                    "words": [[round(w.start, 2), round(w.end, 2), w.word.strip()] for w in (seg.words or [])],
                }
            )
    return {"language": info.language, "segments": result}
