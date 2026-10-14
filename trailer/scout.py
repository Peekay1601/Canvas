#!/usr/bin/env python3
"""Scout every episode for the trailer: scene cuts + timecoded contact sheets.

    python3 scout.py --footage ".../EXPORTS/FINAL EXPORTS" --out scout

For each EPxx.mp4 writes:
    scout/EPxx_scenes.csv     one row per detected shot: start, end, length (s), score
    scout/EPxx_sheet_NN.jpg   contact sheets, one thumbnail per shot, its timecode burned in
Pick a shot from a sheet, then copy its start into shotlist.csv as src_in.
"""
import argparse
import csv
import glob
import os
import re
import subprocess

import ffmpeg_bin

FFMPEG, FFPROBE = ffmpeg_bin.find()

COLS, ROWS, THUMB_W = 6, 5, 320


def duration(path):
    out = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", path], capture_output=True, text=True, check=True)
    return float(out.stdout)


def detect_scenes(path, threshold):
    proc = subprocess.run([FFMPEG, "-hide_banner", "-i", path, "-an", "-vf",
                           f"select='gt(scene,{threshold})',metadata=print",
                           "-f", "null", "-"], capture_output=True, text=True)
    times, scores = [0.0], [1.0]
    for line in proc.stderr.splitlines():
        m = re.search(r"pts_time:([\d.]+)", line)
        if m:
            times.append(float(m.group(1)))
        m = re.search(r"lavfi\.scene_score=([\d.]+)", line)
        if m:
            scores.append(float(m.group(1)))
    return times, scores


def hms(t):
    return f"{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--footage", required=True)
    ap.add_argument("--out", default="scout")
    ap.add_argument("--threshold", type=float, default=0.3, help="scene-change sensitivity (lower = more cuts)")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    for path in sorted(glob.glob(os.path.join(args.footage, "*.mp4")) + glob.glob(os.path.join(args.footage, "*.mov"))):
        name = os.path.splitext(os.path.basename(path))[0]
        total = duration(path)
        times, scores = detect_scenes(path, args.threshold)
        ends = times[1:] + [total]
        with open(os.path.join(args.out, f"{name}_scenes.csv"), "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["shot", "start", "end", "length", "score"])
            for i, (a, b, s) in enumerate(zip(times, ends, scores)):
                w.writerow([i + 1, hms(a), hms(b), f"{b - a:.2f}", f"{s:.3f}"])
        # one frame from the middle of each shot, timecode of the shot start burned in
        per = COLS * ROWS
        for sheet in range(0, len(times), per):
            chunk = list(zip(times, ends))[sheet:sheet + per]
            inputs, labels = [], []
            for j, (a, b) in enumerate(chunk):
                inputs += ["-ss", f"{(a + b) / 2:.3f}", "-i", path]
                labels.append(f"[{j}:v]scale={THUMB_W}:-2,trim=end_frame=1,"
                              f"drawtext=text='{hms(a).replace(':', chr(92) + ':')}':fontcolor=white:fontsize=20:"
                              f"box=1:boxcolor=black@0.6:x=6:y=6[t{j}]")
            n = len(chunk)
            layout = "|".join(f"{'+'.join(['w0'] * (k % COLS)) or '0'}_{'+'.join(['h0'] * (k // COLS)) or '0'}"
                              for k in range(n))
            graph = ";".join(labels) + ";" + "".join(f"[t{k}]" for k in range(n))
            graph += f"xstack=inputs={n}:layout={layout}:fill=black" if n > 1 else "null"
            out = os.path.join(args.out, f"{name}_sheet_{sheet // per + 1:02d}.jpg")
            subprocess.run([FFMPEG, "-y", "-loglevel", "error"] + inputs +
                           ["-filter_complex", graph, "-frames:v", "1", "-q:v", "3", out], check=True)
        print(f"{name}: {len(times)} shots, {total:.0f}s")


if __name__ == "__main__":
    main()
