"""Builds a small fake shoot with ffmpeg, drives the server through an MCP client, and checks the Premiere XML."""

import asyncio
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from roughcut_mcp import xmeml  # noqa: E402
from roughcut_mcp.server import mcp  # noqa: E402


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


@pytest.fixture(scope="module")
def shoot(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("My Short")
    (root / "Day 1" / "A Cam").mkdir(parents=True)
    (root / "Sound").mkdir()
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=24000/1001:duration=8",
           "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-ac", "2", "-shortest",
           "-timecode", "01:00:00:00", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(root / "Day 1" / "A Cam" / "A001_C001.mov"))
    ffmpeg("-f", "lavfi", "-i", "smptebars=size=1920x1080:rate=24000/1001:duration=6",
           "-f", "lavfi", "-i", "sine=frequency=220:duration=6", "-shortest",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", str(root / "Day 1" / "A Cam" / "A001_C002.mov"))
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=330:duration=10", str(root / "Sound" / "music.wav"))
    ffmpeg("-f", "lavfi", "-i", "testsrc=size=640x360:rate=1", "-frames:v", "1", str(root / "still.png"))
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p",
           str(root / "Day 1" / "phone.mp4"))
    ffmpeg("-display_rotation", "90", "-i", str(root / "Day 1" / "phone.mp4"), "-c", "copy",
           str(root / "Day 1" / "phone_vertical.mp4"))
    (root / "Day 1" / "phone.mp4").unlink()
    (root / "Script.fountain").write_text(
        "INT. KITCHEN - NIGHT\n\nRIYA\nYou never called.\n\nEXT. ROOF - DAY\n\nARJUN\nI'm here now.\n"
    )
    return root


def call(name, args):
    async def run():
        return await mcp.call_tool(name, args)

    result = asyncio.run(run())
    return getattr(result, "content", result)


def text_of(content) -> str:
    return "\n".join(getattr(c, "text", "") for c in content)


def test_full_flow(shoot):
    out = text_of(call("open_footage_folder", {"folder": str(shoot)}))
    assert "Video clips: 3" in out and "Audio files: 1" in out and "Stills: 1" in out
    assert "Script.fountain" in out
    assert "1920x1080 @ 23.976" in out

    listing = text_of(call("list_footage", {"folder": str(shoot)}))
    ids = {line.split(" | ")[1]: line.split(" | ")[0] for line in listing.splitlines()[1:]}
    a1, a2 = ids["Day 1/A Cam/A001_C001.mov"], ids["Day 1/A Cam/A001_C002.mov"]
    music = ids["Sound/music.wav"]

    script_text = text_of(call("read_script", {"folder": str(shoot)}))
    assert "INT. KITCHEN - NIGHT" in script_text and "Scenes:" in script_text

    view = call("view_clip", {"folder": str(shoot), "clip_id": a1, "frames": 6})
    assert any(getattr(c, "type", "") == "image" for c in view)

    overview = call("overview_footage", {"folder": str(shoot)})
    assert any(getattr(c, "type", "") == "image" for c in overview)

    audio = text_of(call("analyze_clip_audio", {"folder": str(shoot), "clip_id": a1}))
    assert "Sound:" in audio

    logged = text_of(call("log_clip", {"folder": str(shoot), "clip_id": a1, "scene": "1", "take": "3", "rating": 4}))
    assert '"take": "3"' in logged
    assert "scene=1" in text_of(call("list_footage", {"folder": str(shoot)}))

    built = text_of(call("build_rough_cut", {
        "folder": str(shoot),
        "edits": [
            {"clip_id": a1, "source_in": 1.0, "source_out": 4.0, "label": "Sc 1", "note": "Best eyes on the line"},
            {"clip_id": a2, "source_in": "00:01.5", "source_out": 5.5, "label": "Sc 2"},
            {"clip_id": a1, "source_in": 6, "source_out": 7, "track": "V2", "at": 2.0, "note": "cutaway"},
            {"clip_id": music, "source_in": 0, "source_out": 7, "track": "A", "at": 0},
        ],
    }))
    assert "Premiere XML:" in built
    xml_path = Path(built.split("Premiere XML: ")[1].splitlines()[0])
    tree = ET.parse(xml_path)
    seq = tree.find(".//sequence")
    assert seq.findtext("rate/timebase") == "24" and seq.findtext("rate/ntsc") == "TRUE"
    v_tracks = seq.findall("media/video/track")
    a_tracks = seq.findall("media/audio/track")
    assert len(v_tracks) == 2  # V1 + V2
    assert len(a_tracks) == 4  # dialogue pair + music pair (V2 cutaway has no sound)
    v1 = v_tracks[0].findall("clipitem")
    assert [(c.findtext("start"), c.findtext("end"), c.findtext("in"), c.findtext("out")) for c in v1] == [
        ("0", "72", "24", "96"), ("72", "168", "36", "132")
    ]
    # Every file is defined in full once in the bins and once in the sequence, and referenced by id after that.
    in_bins = [f for f in tree.find(".//bin").iter("file") if f.find("pathurl") is not None]
    in_seq = [f for f in seq.iter("file") if f.find("pathurl") is not None]
    assert len(in_bins) == 5 and len({f.get("id") for f in in_bins}) == 5
    assert sorted(f.get("id") for f in in_seq) == sorted({f.get("id") for f in seq.iter("file")})
    # Bins mirror the folders.
    names = [b.findtext("name") for b in tree.iter("bin")]
    assert names[:2] == ["Footage", "Day 1"] and "A Cam" in names and "Sound" in names
    markers = seq.findall("marker")
    assert len(markers) == 3
    assert (xml_path.parent / (xml_path.stem + " - cut list.md")).exists()


def test_rejects_overlap_and_bad_ranges(shoot):
    clips = {"c1": {"id": "c1", "kind": "video", "duration": 5.0, "audio_channels": 2}}
    with pytest.raises(xmeml.CutError):
        xmeml.place([xmeml.Edit("c1", 3, 2)], clips, 24)
    with pytest.raises(xmeml.CutError):
        xmeml.place([xmeml.Edit("c1", 0, 4), xmeml.Edit("c1", 0, 2, track="V2", at=0),
                     xmeml.Edit("c1", 0, 2, track="V2", at=1)], clips, 24)


def test_path_urls():
    assert xmeml.path_url("/Users/me/My Film/a.mov") == "file://localhost/Users/me/My%20Film/a.mov"
    assert xmeml.path_url("C:/Footage/a b.mov") == "file://localhost/C%3A/Footage/a%20b.mov"


def test_transcript_search_finds_every_take(shoot):
    import json

    call("open_footage_folder", {"folder": str(shoot)})
    listing = text_of(call("list_footage", {"folder": str(shoot)}))
    cid = next(line.split(" | ")[0] for line in listing.splitlines() if "A001_C001" in line)

    def words(start, text):
        return [[start + i * 0.4, start + i * 0.4 + 0.35, w] for i, w in enumerate(text.split())]

    segments = [
        {"start": 0.5, "end": 2.0, "text": "You never called.", "words": words(0.5, "You never called.")},
        {"start": 2.2, "end": 3.0, "text": "Cut.", "words": words(2.2, "Cut.")},
        {"start": 4.0, "end": 5.5, "text": "You never even called!", "words": words(4.0, "You never even called!")},
    ]
    path = shoot / ".roughcut" / "transcripts" / f"{cid}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"language": "en", "segments": segments}))

    found = text_of(call("search_transcripts", {"folder": str(shoot), "line": "You never called"}))
    takes = [line for line in found.splitlines() if cid in line]
    assert len(takes) == 2, found
    assert "0.50–" in found and "4.00–" in found

    tx = text_of(call("get_transcript", {"folder": str(shoot), "clip_id": cid, "start": 3, "words": True}))
    assert "even@4.80" in tx and "Cut." not in tx


def test_vertical_phone_footage_is_portrait(shoot):
    from roughcut_mcp import media

    info = media.probe(shoot / "Day 1" / "phone_vertical.mp4")
    assert (info["width"], info["height"], info["fps"]) == (1080, 1920, 30.0)


def test_bundled_ffmpeg_when_none_installed(shoot, monkeypatch):
    from roughcut_mcp import media

    media.ffmpeg_exe.cache_clear()
    monkeypatch.setattr(media.shutil, "which", lambda name: None)
    try:
        assert "imageio_ffmpeg" in media.ffmpeg_exe()
        frame = media.grab_frame(shoot / "Day 1" / "A Cam" / "A001_C001.mov", 1.0, 320)
        assert frame is not None and frame.width == 320
    finally:
        media.ffmpeg_exe.cache_clear()


def test_background_transcription(shoot, monkeypatch):
    from types import SimpleNamespace

    from roughcut_mcp import transcribe

    class FakeModel:
        def transcribe(self, path, **kwargs):
            word = SimpleNamespace(start=0.5, end=0.9, word=" hello")
            seg = SimpleNamespace(start=0.5, end=0.9, text=" hello", words=[word])
            return iter([seg]), SimpleNamespace(language="en")

    monkeypatch.setattr(transcribe, "_model", FakeModel())
    call("open_footage_folder", {"folder": str(shoot)})
    for path in (shoot / ".roughcut" / "transcripts").glob("*.json"):
        path.unlink()
    out = text_of(call("transcribe_footage", {"folder": str(shoot), "wait_seconds": 20}))
    assert "Transcribed 3/3" in out, out  # two camera clips with sound + the music file
    again = text_of(call("transcribe_footage", {"folder": str(shoot)}))
    assert "Nothing left" in again
