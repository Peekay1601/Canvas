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

## Use it from Claude on the web (claude.ai)

Claude on the web runs in the cloud, but your footage stays on your computer. So Rough Cut runs on your computer
and a secure Cloudflare tunnel lets claude.ai reach it. Your media is never uploaded; Claude only sees frames,
transcripts and the script, the same as on desktop.

1. Download [`dist/Rough Cut Web.zip`](dist/Rough%20Cut%20Web.zip) and unzip it.
2. Double-click **Start Rough Cut Web**: `.command` on a Mac, `.bat` on Windows. On a Mac, if it says the developer
   can't be verified, right-click it and choose **Open**. The first run installs what it needs, which takes a few
   minutes.
3. Choose your footage folder (with the script inside it). The window prints a connector URL like
   `https://something.trycloudflare.com/<secret>/mcp`.
4. In claude.ai, go to **Settings → Connectors → Add custom connector**, name it **Rough Cut**, paste the URL, and
   click **Add**. In a chat, enable it from the tools menu and say **"check the rough cut setup"**.
5. Keep the window open while Claude works. Close it to cut off access.

Things to know:

- **The URL is the key.** It contains a long random secret: don't share it. Claude can only open the folder you
  chose (and its subfolders). Run `roughcut-mcp web --new-token` to invalidate an old URL.
- **The tunnel address changes every time you start it.** Edit the connector's URL in claude.ai after each restart.
  For an address that never changes, use your own tunnel (for example ngrok's free static domain or Tailscale
  Funnel) and run
  `uv run roughcut-mcp web --folder "/path/to/footage" --no-tunnel --public-url https://your-address`.
- Your computer must stay awake and online while Claude works.
- Several folders: add `--folder` once per folder.

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
pytest                          # fake shoot with ffmpeg; checks the XML and the web connector
python scripts/build_dist.py    # rebuild dist/roughcut.mcpb and "dist/Rough Cut Web.zip" after changes
```
