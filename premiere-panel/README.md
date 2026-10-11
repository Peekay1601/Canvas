# AI Audio Studio — Premiere Pro UXP panel

A dockable Premiere Pro panel for your own machine:

- **Settings**: your ElevenLabs and Claude API keys, kept in the OS secure store (macOS Keychain / Windows Credential Manager), plus Claude model, ElevenLabs voice model, audio format, output folder and project bin.
- **Create**: two modes.
  - **Plan with Claude**: describe what you want in plain words. Claude splits it into voiceover lines, sound effects and music cues and picks voices from your library ("in my voice" uses your default voice). Edit or remove items, then **Generate**. Each file is generated with ElevenLabs, saved, imported into a bin and, if you want, placed at the playhead (one audio track per item).
  - **Direct**: skip Claude. Pick voiceover, sound effect or music, type, generate.
- **Change voice**: select audio clips on the timeline (or pick a file), choose a voice, and ElevenLabs re-performs the recording in that voice with the same timing and emotion. The new take lands on the first free track below the original, in sync. WAV sources are cut to just the part used on the timeline; other formats are sent whole (more credits).
- **Voices**: your ElevenLabs voice library.
  - Search, switch between **My voices** and **All voices**, **Play** a sample in Premiere's Source Monitor, **Use** to make a voice your default, **Delete** your own voices.
  - **Clone my voice** from 1–3 minutes of your recordings.
  - **Design a new voice with Claude**: Claude writes the ElevenLabs voice description and a preview line, you play the 3 previews and save the one you like.
- **Settings**: your ElevenLabs and Claude API keys, kept in the OS secure store (macOS Keychain / Windows Credential Manager), plus models, audio format, output folder and project bin.

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
| `js/settings.js` | API keys in `secureStorage`, other settings in `localStorage`, output folder |
| `js/claude.js` | Calls the Claude Messages API with a JSON schema so the plan always comes back as typed items |
| `js/elevenlabs.js` | Voices, text to speech, sound effects, music (raw `pcm_*` output gets a WAV header), instant voice clone, voice design |
| `js/premiere.js` | Sequence info, selected clips, save/import, free-track search, overwrite edits, Source Monitor playback |
| `js/wav.js` | Cuts a time range out of a WAV file without re-encoding |
| `js/main.js` | UI |

Notes:

- Claude only gets your prompt, your ElevenLabs voice names, and, if the checkbox is on, the sequence name, playhead time, length and track count. No media is uploaded to Claude.
- **Create** places items with an overwrite edit on A*n*, A*n+1*, …, so they don't overwrite each other. **Change voice** looks for a track that is empty for that stretch of time and never overwrites existing audio. The tracks have to exist in the sequence; add tracks if the status bar says so.
- Default models: `claude-opus-5-5` for planning and `eleven_v4` for voice. Change either in Settings.
- Every generation spends ElevenLabs credits; every plan spends Claude API credits.
