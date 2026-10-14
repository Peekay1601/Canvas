# Mahishasura Mardini: 60s Elevation Trailer

- `trailer_music.mp3`: score generated with ElevenLabs Music (take 1 of 4; the other takes are in `alt_music/`).
- `shotlist.csv`: the cut, 46 events timed to the music's beats.
- `build_trailer.py`: renders the cut with ffmpeg (1920x1080, 24 fps, 2.39:1 letterbox).
- `Mahishasura_Mardini_Animatic_60s.mp4`: timing preview with the final music, showing each shot as a text slate.

## Music map (trailer_music.mp3)
| Time | Music | Picture |
|---|---|---|
| 0–12s | drone fade-in, hits at 6.86 / 8.57 | ACT 1: brothers, Indra's betrayal, Agni's boon |
| 12–34s | build, hits every 1.714s (one bar at 140 bpm) | ACT 2: Mahisha born from the pyre, defeat, tapas, boon, conquest of heaven |
| 34.1s | big impact | A sun ignites over the Himalayas |
| 36.5–37.5s | near-silence | Black, Durga line: "Kaani vaadni champe Shakthi vacchindi." |
| 37.6s | DROP (elevation) | ACT 3: Durga's reveal, then cuts every half bar (0.857s) |
| 55.9s | climax | Tableau: foot on the buffalo, trident through Mahisha |
| 58–60s | fade | Title card |

## Build the real trailer (on the Mac with the footage)
1. In `shotlist.csv`, set `file` (filename inside FINAL EXPORTS) and `src_in` (source timecode) for each `clip` row. The `note` column describes the shot from the script. Leave `start` alone, because those values are the beat-synced cut points.
2. Run:
```
python3 build_trailer.py \
  --footage "/Users/peekay/Downloads/THE BIG BEAR STUDIOS/projects/MahishasuraMardini_V2/EXPORTS/FINAL EXPORTS" \
  --music trailer_music.mp3 --out Mahishasura_Mardini_Trailer_60s.mp4
```
The script needs `ffmpeg` (`brew install ffmpeg`). `speed` 0.5 or 0.75 gives slow-mo for elevation shots. Dialogue and SFX lines are listed in the notes. Lay them in your NLE after the build.
