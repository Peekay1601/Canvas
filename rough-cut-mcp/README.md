# Rough Cut MCP

A local MCP server that lets Claude (Claude Desktop or Claude Code on your computer) work as your assistant editor.
Point it at a folder of footage that also contains the script, and Claude will:

1. **Scan** the folder and every subfolder: video, sound files and stills, with duration, frame rate,
   resolution, audio channels and timecode.
2. **Read the script**: `.txt`, `.md`, Fountain, Final Draft `.fdx`, Word `.docx`, PDF or `.rtf`.
3. **Transcribe** every clip (Whisper, running on your machine) so it can find each take of each line.
4. **Watch** the footage through contact sheets, judging performance, emotion, eyelines, focus, framing and
   continuity (props, hands, costume, screen direction).
5. **Log** each clip (scene, take, 1–5 rating, emotional read, continuity notes). The log is saved next to the
   footage, so a long session never loses its place.
6. **Cut**: it picks takes for emotion first, then technical quality and continuity. It cuts on action and on
   emotional turns, and keeps reactions.
7. **Write the rough cut for Premiere Pro**: an XML containing every clip in bins that mirror your folders, plus the
   cut sequence. Each edit carries a marker saying why that take and that cut point were chosen. A readable cut
   list is written alongside it.

Nothing leaves your computer except what Claude itself sees: contact-sheet frames, transcripts and the script.

## Why an XML and not a .prproj?

Premiere's `.prproj` format is closed and undocumented, so writing one directly would be fragile. Final Cut Pro XML
is the format Premiere has imported reliably for years. Importing it gives you exactly what a project would hold:
bins, clips linked to your original media (no copies, no transcodes), and the sequence. Then press Save and you
have your `.prproj` in the folder you want.

## Install in Claude Desktop (one click)

1. Download [`dist/roughcut.mcpb`](dist/roughcut.mcpb).
2. Double-click it with Claude Desktop open (or go to **Settings → Extensions → Advanced settings → Install
   Extension…** and choose the file). Click **Install**.
3. Optional: pick your usual **footage folder**, a **speech model** (`small` is a good start; `medium` is better
   for Hindi/Hinglish if your computer is fast), and the **dialogue language** (`hi`, `en`, `ta`, …).
4. In a new chat, say **"check the rough cut setup"**. Claude checks everything and walks you through the rest.

Claude Desktop installs Python and every dependency for you, including ffmpeg and the speech-to-text engine.
The first time you transcribe, it downloads the Whisper model (about 500 MB for `small`) in the background.
Works on macOS and Windows.

### Or use it from Claude Code

You need [uv](https://docs.astral.sh/uv/). From this folder:

```sh
claude mcp add roughcut -- uv run --directory "$PWD" main.py
```

## Use it

Put the script inside the footage folder (anywhere in it; the top level is preferred), then ask:

> Do a rough cut of `/Volumes/Shoot/EP03`. The script is in the folder. Favour the quieter takes in the fight scene.

or pick the **rough_cut** prompt from the server's prompt list. For a full shoot, expect Claude to work for a while:
it transcribes in batches and logs clip by clip.

When it's done, open Premiere Pro:

1. **File → New → Project** and save it wherever you want (for example, in the footage folder).
2. **File → Import** and choose `RoughCut/<project> - Rough Cut v1.xml` from the footage folder.
3. The bin `Footage/…` holds every clip. Open the **Rough Cut v1** sequence; its markers explain each choice.
   `RoughCut/… - cut list.md` holds the same notes as a table.

Ask Claude for another pass ("tighten scene 4, try take 2 for the confession") and it writes `Rough Cut v2` next
to v1. Import it the same way.

## Settings

In Claude Desktop, change these under **Settings → Extensions → Rough Cut for Premiere Pro**. Elsewhere, set them as
environment variables.

| Setting | Variable | Default | What it does |
|---|---|---|---|
| Footage folder | `ROUGHCUT_DEFAULT_FOLDER` | none | Folder used when you don't name one |
| Speech model | `ROUGHCUT_WHISPER_MODEL` | `small` | `tiny`, `base`, `small`, `medium`, `large-v3`: bigger is more accurate and slower |
| Dialogue language | `ROUGHCUT_LANGUAGE` | auto | e.g. `hi` for Hindi/Hinglish, `en` for English |
| | `ROUGHCUT_WHISPER_DEVICE` | `auto` | `cuda` on an NVIDIA GPU |

## What it doesn't do (yet)

- **Sync separately recorded sound.** If your audio was recorded on a separate recorder, sync it in Premiere first
  (merge clips) or give Claude synced files. Clips are cut with their own camera audio.
- **Camera RAW** (`.r3d`, `.braw`, `.ari`): ffmpeg can't read these. Make proxies, and Claude will tell you which
  files it skipped.
- **Drive Premiere directly.** The cut arrives through the XML import above. A Premiere UXP plugin could remove even
  that step.
- J/L cuts, transitions and audio levels: this is a rough cut. Claude lays out the story and the performances, and
  the finesse is yours.

Files it writes inside your footage folder: `.roughcut/` (index, transcripts, clip log; safe to delete) and
`RoughCut/` (the XML and cut lists). It never modifies or moves your media.

## Tools

| Tool | What it does |
|---|---|
| `check_setup` | Check that everything works, and walk you through setup and use |
| `open_footage_folder` | Scan the folder and its subfolders, probe every file, find the script |
| `list_footage` | Clip ids, formats, and what has been logged |
| `read_script` | Script with line numbers and scene headings |
| `transcribe_footage` | Speech-to-text for every clip, in batches, cached |
| `get_transcript` | Timestamped lines, optionally with word timings |
| `search_transcripts` | Every take of a script line across all clips |
| `overview_footage` | One frame per clip, to group by scene and setup |
| `view_clip` | Contact sheet of a clip or a stretch of it, with times |
| `analyze_clip_audio` | Sound vs. silence, loudness, shot changes inside a file |
| `log_clip` | Save scene/take/rating/emotion/continuity notes |
| `build_rough_cut` | Write the Premiere XML and cut list |

## Develop

```sh
pip install -e . pytest
pytest                                              # builds a fake shoot with ffmpeg and checks the XML
npx @anthropic-ai/mcpb pack . dist/roughcut.mcpb     # rebuild the Claude Desktop extension after changes
```
