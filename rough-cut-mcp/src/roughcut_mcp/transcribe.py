"""Speech-to-text with faster-whisper, cached per clip.

The model (hundreds of MB on first use) loads on a background thread so no tool call has to wait out the download.
"""

from __future__ import annotations

import threading
from pathlib import Path

from . import setting

_model = None
_error: str | None = None
_loading: threading.Thread | None = None
_lock = threading.Lock()


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        return False
    return True


def model_name() -> str:
    return setting("ROUGHCUT_WHISPER_MODEL") or "small"


def _load() -> None:
    global _model, _error
    try:
        from faster_whisper import WhisperModel

        _model = WhisperModel(
            model_name(),
            device=setting("ROUGHCUT_WHISPER_DEVICE") or "auto",
            compute_type=setting("ROUGHCUT_WHISPER_COMPUTE") or "default",
        )
    except Exception as exc:  # download blocked, out of disk, unsupported CPU...
        _error = f"{type(exc).__name__}: {exc}"


def status() -> str:
    """'ready', 'loading', or 'error: …' (the next call retries). Starts loading the model if nobody has yet."""
    global _loading, _error
    with _lock:
        if _model is not None:
            return "ready"
        if _error:
            error, _error, _loading = _error, None, None
            return f"error: {error}"
        if _loading is None:
            _loading = threading.Thread(target=_load, daemon=True)
            _loading.start()
        return "loading"


def transcribe(path: Path, language: str | None = None) -> dict:
    """Segments and word timings for one clip. faster-whisper decodes the audio itself (via PyAV)."""
    try:
        segments, info = _model.transcribe(
            str(path),
            language=language or setting("ROUGHCUT_LANGUAGE") or None,
            word_timestamps=True,
            vad_filter=True,
        )
        result = [
            {
                "start": round(seg.start, 2),
                "end": round(seg.end, 2),
                "text": seg.text.strip(),
                "words": [[round(w.start, 2), round(w.end, 2), w.word.strip()] for w in (seg.words or [])],
            }
            for seg in segments
        ]
    except Exception as exc:  # unreadable audio shouldn't stop the batch
        return {"language": None, "segments": [], "error": str(exc)}
    return {"language": info.language, "segments": result}
