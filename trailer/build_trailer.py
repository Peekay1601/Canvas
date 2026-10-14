#!/usr/bin/env python3
"""Cut the Mahishasura Mardini 60s trailer to the music, using ffmpeg.

Timing preview without footage:
    python3 build_trailer.py --animatic --music trailer_music.mp3 --out animatic.mp4

Usage (run on the machine that has the footage):
    python3 build_trailer.py --footage "/Users/peekay/Downloads/THE BIG BEAR STUDIOS/projects/MahishasuraMardini_V2/EXPORTS/FINAL EXPORTS" \
        --music trailer_music.mp3 --shotlist shotlist.csv --out Mahishasura_Mardini_Trailer_60s.mp4

shotlist.csv columns:
    start      trailer time (s) where the shot begins; the shot runs until the next row's start
    type       clip | black | white | card
    file       clip filename relative to --footage (clip rows only)
    src_in     in-point inside the source clip, seconds or HH:MM:SS.ff (clip rows only)
    speed      playback speed, 1 = normal, 0.5 = slow-mo (clip rows only)
    text       card text (card rows); use \\n for a second line
    note       free text, ignored
The last row must be type 'end' with start = total length.
"""
import argparse
import csv
import os
import subprocess
import sys
import tempfile
import textwrap

W, H, FPS = 1920, 1080, 24
SCOPE_H = 804  # 2.39:1 letterbox inside 1920x1080


def tc(value):
    value = value.strip()
    if not value:
        return 0.0
    if ":" not in value:
        return float(value)
    parts = [float(p) for p in value.split(":")]
    secs = 0.0
    for p in parts:
        secs = secs * 60 + p
    return secs


def find_font():
    for path in (
        "/System/Library/Fonts/Supplemental/Trajan Pro.ttf",
        "/Library/Fonts/TrajanPro-Regular.otf",
        "/System/Library/Fonts/Supplemental/Cinzel-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    ):
        if os.path.exists(path):
            return path
    return None


def run(cmd):
    print(" ".join(f'"{c}"' if " " in c else c for c in cmd))
    subprocess.run(cmd, check=True)


def letterbox_vf():
    return (
        f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
        f"crop={W}:{SCOPE_H},pad={W}:{H}:0:{(H - SCOPE_H) // 2}:black,"
        f"fps={FPS},format=yuv420p,setsar=1"
    )


def render_segment(row, dur, footage, font, out, animatic=False):
    kind = row["type"]
    frames = round(dur * FPS)
    dur = frames / FPS
    enc = ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-an", "-frames:v", str(frames), out]
    if kind in ("black", "white"):
        run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
             "-i", f"color=c={kind}:s={W}x{H}:r={FPS}", "-vf", "format=yuv420p,setsar=1"] + enc)
    elif kind == "card" or (kind == "clip" and animatic):
        if kind == "card":
            text, colour, size = row["text"].replace("\\n", "\n"), "0xE8C77A", 64
        else:
            text, colour, size = textwrap.fill(row["note"], 48), "0x9FB7D9", 40
        text = text.replace("'", "’").replace(":", "\\:").replace("%", "\\%")
        fade = min(0.35, dur / 3) if kind == "card" else 0.01
        draw = (f"drawtext=text='{text}':fontcolor={colour}:fontsize={size}:line_spacing=18:"
                f"x=(w-text_w)/2:y=(h-text_h)/2")
        if font:
            draw += f":fontfile='{font}'"
        vf = f"{draw},fade=t=in:st=0:d={fade:.2f},fade=t=out:st={dur - fade:.2f}:d={fade:.2f},format=yuv420p,setsar=1"
        run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
             "-i", f"color=c=black:s={W}x{H}:r={FPS}", "-vf", vf] + enc)
    elif kind == "clip":
        src = os.path.join(footage, row["file"])
        if not os.path.exists(src):
            sys.exit(f"Missing clip: {src}")
        speed = float(row.get("speed") or 1)
        src_len = dur * speed
        vf = f"setpts=PTS/{speed}," + letterbox_vf()
        run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{tc(row['src_in']):.3f}",
             "-t", f"{src_len + 0.2:.3f}", "-i", src, "-vf", vf] + enc)
    else:
        sys.exit(f"Unknown row type: {kind}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--footage", default=".")
    ap.add_argument("--music", required=True)
    ap.add_argument("--shotlist", default="shotlist.csv")
    ap.add_argument("--out", default="Mahishasura_Mardini_Trailer_60s.mp4")
    ap.add_argument("--animatic", action="store_true",
                    help="render clip rows as text slates (timing preview, no footage needed)")
    args = ap.parse_args()

    with open(args.shotlist, newline="") as f:
        rows = [r for r in csv.DictReader(f) if r["start"].strip() and not r["start"].startswith("#")]
    if rows[-1]["type"] != "end":
        sys.exit("Last shotlist row must be type 'end'")
    total = float(rows[-1]["start"])
    font = find_font()

    with tempfile.TemporaryDirectory() as tmp:
        parts = []
        for i, row in enumerate(rows[:-1]):
            # snap cut points to the frame grid so rounding never accumulates off the beat
            dur = (round(float(rows[i + 1]["start"]) * FPS) - round(float(row["start"]) * FPS)) / FPS
            if dur <= 0:
                sys.exit(f"Row {i + 2}: start times must increase")
            out = os.path.join(tmp, f"seg_{i:03d}.mp4")
            render_segment(row, dur, args.footage, font, out, args.animatic)
            parts.append(out)
        concat = os.path.join(tmp, "concat.txt")
        with open(concat, "w") as f:
            f.writelines(f"file '{p}'\n" for p in parts)
        run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concat,
             "-i", args.music, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
             "-af", f"afade=t=out:st={total - 1.5:.2f}:d=1.5", "-c:a", "aac", "-b:a", "320k",
             "-t", f"{total:.3f}", "-movflags", "+faststart", args.out])
    print(f"Done: {args.out}")


if __name__ == "__main__":
    main()
