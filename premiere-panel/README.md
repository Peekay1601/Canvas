# AI Audio Studio — Premiere Pro UXP panel

A dockable Premiere Pro panel for your own machine:

- **Settings**: your ElevenLabs and Claude API keys, kept in the OS secure store (macOS Keychain / Windows Credential Manager), plus Claude model, ElevenLabs voice model, audio format, output folder and project bin.
- **Create**: write what you want in plain words. Claude turns it into a plan of voiceover lines, sound effects and music cues, and picks voices from your ElevenLabs library. You edit or remove items, then **Generate & import**: every file is generated with ElevenLabs, saved to disk, imported into a bin and, if you want, placed on the timeline at the playhead (one audio track per item).
- **Quick**: skip Claude. Type text or a sound description, generate and import in one click.

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
| `manifest.json` | Panel entry point, network allow-list (`api.elevenlabs.io`, `api.anthropic.com`), file system access |
| `js/settings.js` | API keys in `secureStorage`, other settings in `localStorage`, output folder |
| `js/claude.js` | Calls the Claude Messages API with a JSON schema so the plan always comes back as typed items |
| `js/elevenlabs.js` | Voices, text to speech, sound effects, music (raw `pcm_*` output gets a WAV header) |
| `js/premiere.js` | Sequence info, save file, import into the bin, overwrite edit onto an audio track |
| `js/main.js` | UI |

Notes:

- Claude only gets your prompt, your ElevenLabs voice names, and, if the checkbox is on, the sequence name, playhead time, length and track count. No media is uploaded to Claude.
- Placing on the timeline uses an overwrite edit on A*n*, A*n+1*, … so items don't overwrite each other. The tracks have to exist in the sequence; add tracks if the log says so.
- Default models: `claude-opus-5-5` for planning and `eleven_v4` for voice. Change either in Settings.
- Every generation spends ElevenLabs credits; every plan spends Claude API credits.
