# Script Builder MCP

An MCP server that turns **one idea into a complete, reviewed screenplay**. It works with Claude Desktop, Claude Code
and claude.ai, and exports the finished script as **Fountain, Final Draft (.fdx) and PDF**.

```
idea → concept → story bible → outline → writers' room reviews the outline → revised outline
     → beat sheets → screenplay pages (hard runtime cap per episode) → runtime balancing (series band)
     → writers' room reviews the COMPLETE script ⟲ corrections are rewritten and re-reviewed until the judge approves
     → Fountain + Final Draft (.fdx) + PDF + runtime report
```

The writers' room is the same six agents as in `../writers-room`:

| Agent | Lens |
|---|---|
| Maya | Emotional architect: whether payoffs are earned |
| Arjun | Dramaturg: causality, motivation, plot holes, continuity |
| Tara | Retention: hooks, pacing, endings, drop-off risk |
| Veda | World and character guardian: culture, source, character integrity |
| Kiran | Cold audience: confusion and assumed knowledge |
| Rudra | Judge: rules on every claim, approves or sends episodes back with corrections |

## House rules (microdrama defaults)

- **Every episode stays under 2:30 of screen time.** This is a hard cap. In guided mode an over-length page is
  rejected with cutting notes. In engine mode it is re-cut automatically, up to twice.
- **The whole series runs 55–60 minutes.** The episode count is chosen to fit, about 26 episodes at about 2:15 each.
  Once every page exists, the shortest or longest episodes are lengthened or cut until the total is inside the band.
- **Runtime is estimated from what is performed, not page count:** spoken words (about 1.9 words/s for Telugu and
  other Indic scripts, 2.5 for English), action beats, silences and scene changes. Calibrate with
  `SCRIPT_WPS_INDIC` / `SCRIPT_WPS` after a table read.
- **The full-script review runs up to 3 rounds** (`max_review_rounds`). Corrections from the last round are applied
  and logged in `room/open_questions.md`.

Override any of these per project in `start_script` (`max_episode_minutes`, `min_series_minutes`,
`max_series_minutes`, `review_script`, `max_review_rounds`) or later with `update_settings`.

## Two ways it writes

| | Guided mode (no API key) | Engine mode (`ANTHROPIC_API_KEY` set) |
|---|---|---|
| Who writes | The Claude you're chatting with, part by part (`get_writing_task` → `submit_writing`) | The server calls Claude itself, in the background |
| Cost | Your Claude plan | API usage (prompt caching keeps it down; see `build_status`) |
| Review room | Claude writes all six reviews in one pass | Five critics run in parallel, then the judge |
| Best for | Watching and steering each stage | "Write the whole series and tell me when it's done" |

## Tools

`start_script` · `build_status` · `continue_build` · `get_writing_task` · `submit_writing` · `revise_part` ·
`read_script` (concept, bible, outline, review, beats:N, draft:N, script_review:R, runtime, full) · `export_script` ·
`update_settings` · `list_scripts`

## Install

### Claude Desktop (one click)
Download `script-builder.mcpb` and double-click it, or drag it into Claude Desktop → Settings → Extensions. Choose a
projects folder and optionally paste an API key. PDF export uses Chrome or Edge if they're installed.

### Claude Code
```sh
unzip script-builder-mcp-0.2.0.zip -d script-builder-mcp && cd script-builder-mcp && npm ci && npx tsc
claude mcp add script-builder -e SCRIPT_BUILDER_DATA="$PWD/projects" -- node "$PWD/dist/index.js" --stdio
```
Or, inside this repo, open `writers-room/`. Its `.mcp.json` already registers the server and saves projects into
`writers-room/projects/`, where `/room-session` can review them again.

### claude.ai custom connector (hosted)
```sh
docker build -t script-builder-mcp .
docker run -p 8787:8787 -v script-data:/data \
  -e MCP_AUTH_TOKEN=<long-random-secret> -e PUBLIC_BASE_URL=https://your-host \
  [-e ANTHROPIC_API_KEY=sk-ant-...] script-builder-mcp
```
Then in claude.ai go to Settings → Connectors → Add custom connector, and use the URL
`https://your-host/mcp/<long-random-secret>`. With `PUBLIC_BASE_URL` set, the tools return download links
(`/files/<project>/script/…pdf`) protected by the same token.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `SCRIPT_BUILDER_DATA` | `./projects` | Where projects are saved |
| `ANTHROPIC_API_KEY` | — | Turns on engine mode |
| `SCRIPT_MODEL` / `SCRIPT_EFFORT` | `claude-opus-5-5` / `high` | Engine model and effort |
| `SCRIPT_CONCURRENCY` | `4` | Parallel episode writing in engine mode |
| `PORT`, `MCP_AUTH_TOKEN`, `PUBLIC_BASE_URL` | `8787` | HTTP server, auth and download links |
| `CHROMIUM_PATH` | — | Browser for PDF export, if not auto-detected |
| `SCRIPT_WPS_INDIC`, `SCRIPT_WPS` | `1.9`, `2.5` | Runtime estimator calibration |

## Project layout

Each project is a folder in the writers' room layout: `project.md`, `bible/`, `room/` (outline review, script
reviews, open questions), `build/` (concept, outline, beats, drafts, runtime report, emotional graph) and
`script/<slug>_v1.{fountain,fdx,html,pdf}`.

## Build the downloads
```sh
bash package.sh   # → release/script-builder.mcpb, script-builder-mcp-<ver>.tgz, script-builder-mcp-<ver>.zip
```

Fonts: Courier Prime and Noto Sans Telugu, both SIL Open Font License (see `fonts/`).
