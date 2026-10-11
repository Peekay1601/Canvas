# AI Audio Studio — Premiere Pro UXP panel

A dockable Premiere Pro panel for your own machine. It looks at your edit, maps the characters, builds a sound cue sheet, and generates voices, sound and music with ElevenLabs, with Claude doing the thinking.

| Tab | What it does |
|---|---|
| 🎬 **Film** | Start here. ① Add your **dubbing files** (one full-length file per character), the **dubbing cue sheet** (CSV, TXT or PDF) and the script (backup reference). ② Grab stills from the timeline into their own folder. ③ **Analyse film**: Claude names the characters from the dub file names and cue sheet, matches them to faces in the stills, and builds the sound cue sheet. Characters can be found from dubbing alone, without stills. |
| 🎭 **Cast** | One square card per character. Tick **Include** for the ones to process. **Dub audio**: map an uploaded dub file (with its start time), a whole Premiere track (A1, A2…), or upload a full file. Pick a voice, or press **3 voice options** to audition and ✓ approve one (named after the dub file). **Change voice for selected** converts each character's whole layer into **one continuous file**, in sync, on a free track, and can mute the original track. Only the parts with speech are sent to ElevenLabs. Approved voices are reused for the same character in any timeline. |
| 🔊 **Sound** | The cue sheet, split into Ambience, Foley, Human, Hard FX and Designed FX, each marked *seen*, *script* or *guess*, and tagged with a mood. Edit prompts, tick cues, **Generate**. Cues land at their times on per-type tracks without overwriting anything; long ambience beds are seamless loops laid end to end. The master sound design brief is editable here. |
| 🎵 **Music** | Pick a mood, describe the moment, Claude writes the score prompt, ElevenLabs composes it. |
| 🎚 **Mix** | One WAV per layer: **Dubbing**, **Music** and **Sound** (or 5 sound stems), and/or **everything mixed** into one file. Built from the panel's audio that is on the timeline now, so your edits count. Imported from 00:00 on empty tracks; optionally mutes the tracks that went in. |
| 📚 **Library** | Two separate libraries: **SFX** and **Music**. Each has a **Mood** dropdown (SFX also a **Type** dropdown), items grouped by mood, ▶ play, ＋ add at the playhead, **Prompt ▾** shows the exact prompt used. |
| 🎙 **Voices** | Character voices (reusable across timelines), your ElevenLabs voices (play, set default, delete), clone your voice, design a voice with Claude. |
| 🧰 **Tools** | Quick create (Claude plan or direct) and a general voice changer for any clip or file. |
| ⚙ **Settings** | API keys (OS secure storage), models, audio format, output folder, project bin. |

### Where things are saved

```
<output folder>/
├── library.json              sounds + music, with the prompt used
├── cast.json                 approved character voices (shared by all projects)
└── <Project>/
    ├── script/               copy of the uploaded script
    ├── stills/<Sequence>/    stills grabbed from the timeline
    ├── analysis/<Sequence>.json   characters + cue sheet (reloaded automatically)
    ├── cue_sheets/           <Sequence>_cue_sheet.csv / .json
    ├── sound/Ambience|Foley|Human|Hard_FX|Designed_FX/
    ├── music/<Mood>/
    ├── dialogue/<Character>/      one converted layer per character
    ├── mix/<Sequence>/            stems and full mix
    ├── voice_change/              Tools → Change voice
    └── generated/
```

Requires **Premiere Pro 25.6 or later** (the first release with UXP plugins).

## Install (developer mode, no packaging)

1. Install **Adobe UXP Developer Tool** from the Creative Cloud app (Apps → Categories → Developer).
2. In Premiere Pro: **Settings → Plugins → Enable developer mode**, then restart Premiere.
3. Open UXP Developer Tool → **Add Plugin** → select `premiere-panel/manifest.json`.
4. With Premiere open, click **Load** on the plugin (••• → Load).
5. In Premiere: **Window → UXP Plugins → AI Audio Studio**.
6. Open **Settings**, paste both keys, click **Save**, then **Test keys**.

You need to click **Load** again each time Premiere restarts in developer mode.

## Install permanently

In UXP Developer Tool choose ••• → **Package** for this plugin. That gives you a `.ccx` file. Double-click it to install it through Creative Cloud. After that it loads every time with no developer tool.

## How it works

| File | Job |
|---|---|
| `manifest.json` | Panel entry point, network allow-list (`api.elevenlabs.io`, `api.anthropic.com`, `storage.googleapis.com` for voice samples), file system access |
| `js/brief.js` | Default master sound design brief |
| `js/util.js` | Base64, names, times, folders, JSON/CSV files |
| `js/settings.js` | API keys in `secureStorage`, other settings in `localStorage`, output folder |
| `js/claude.js` | Claude Messages API with JSON schemas: quick plans, voice design, character analysis, sound cue sheet, score prompts. Stills go in as images, PDFs as documents. |
| `js/elevenlabs.js` | Voices, text to speech, sound effects (with loops), music, voice changer, clone, voice design |
| `js/premiere.js` | Sequence info, stills (`Exporter.exportSequenceFrame`), project folders, import, free-track search, overwrite edits, Source Monitor playback |
| `js/library.js` | Sound/music library, character voices, per-sequence analysis |
| `js/wav.js` | Cuts a time range out of a WAV file without re-encoding |
| `js/audio.js` | WAV decode/encode, speech detection, resampling, mixing, peak protection |
| `js/dub.js` | Single-layer voice change per character (speech regions only, re-assembled in sync) |
| `js/mix.js` | Stems and full mix from the panel's audio on the timeline |
| `js/ui/*.js` | One file per tab, plus `core.js` (shared helpers) and `app.js` (startup) |

Notes:

- **Analyse film** sends Claude the stills (640 px JPEGs), the script and the names of the audio clips on the timeline. Claude can't hear audio and only sees stills, so movement between stills is inferred; cues say whether they were *seen*, from the *script*, or a *guess*. Quick create sends only your prompt, voice names and, if ticked, the sequence name and playhead.
- **Create** places items with an overwrite edit on A*n*, A*n+1*, …, so they don't overwrite each other. **Change voice** looks for a track that is empty for that stretch of time and never overwrites existing audio. The tracks have to exist in the sequence; add tracks if the status bar says so.
- Default models: `claude-opus-5-5` for planning and `eleven_v4` for voice. Change either in Settings.
- Audio is generated as WAV (44.1 kHz, or 24 kHz automatically on plans without 44.1 kHz WAV) so the Mix tab can combine it. MP3 clips can't be mixed.
- Premiere doesn't let panels add tracks: the Mix tab tells you how many empty audio tracks to add first.
- Single-layer conversion and mixing happen in the panel's memory; very long sequences (over ~30 minutes) are best done scene by scene.
- Every generation spends ElevenLabs credits; every plan spends Claude API credits.
