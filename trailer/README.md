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
The script needs `ffmpeg` (`brew install ffmpeg`).
```
FOOTAGE="/Users/peekay/Downloads/THE BIG BEAR STUDIOS/projects/MahishasuraMardini_V2/EXPORTS/FINAL EXPORTS"
EXPORTS="/Users/peekay/Downloads/THE BIG BEAR STUDIOS/projects/MahishasuraMardini_V2/EXPORTS"
```
1. **Scout the episodes.** `python3 scout.py --footage "$FOOTAGE" --out scout` writes `scout/EPxx_scenes.csv`, which has every detected shot with its start, end and length. It also writes `scout/EPxx_sheet_NN.jpg`, contact sheets that show one frame per shot with its start timecode burned in. Use `--threshold 0.2` if it misses soft cuts.
2. **Pick the shots.** In `shotlist.csv`, set `file` and `src_in` for each `clip` row from the sheets. The `note` column describes the shot. Leave `start` alone, because those are the beat-synced cut points. Keep `speed` 0.5 or 0.75 on hero/money shots for slow-mo. With slow-mo, the shot uses `duration × speed` seconds of source.
3. **Pick the sounds.** In `audio_cues.csv`, set `file` and `src_in` for each dialogue or SFX line. The sound comes from the episode's own audio. Rows without them are skipped. `duck_db` dips the music under the line, and `gain_db` sets its level.
4. **Render** exactly 60s into EXPORTS:
```
python3 build_trailer.py --footage "$FOOTAGE" --music trailer_music.mp3 \
  --cues audio_cues.csv --out "$EXPORTS/Mahishasura_Mardini_Trailer_60s.mp4"
```
For vertical (9:16) episodes, add `--vertical` to render 1080x1920 without the letterbox.
